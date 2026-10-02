/**
 * Física propia de la bola [§7]: gravedad, drag cuadrático, efecto Magnus, bote en la mesa con
 * intercambio spin↔velocidad, red (malla + cinta) y suelo.
 *
 * Determinista: solo usa + − × ÷ y Math.sqrt (correctamente redondeada por IEEE-754), sin
 * Math.sin/cos/exp/pow, sin aleatoriedad y sin dependencias del DOM. Paso fijo: el llamador
 * decide dt (normalmente simDt(cfg) = gameSpeed / 120).
 */
import type { GameConfig } from './config.ts';
import type { Side, Vec3 } from './types.ts';

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** rad/s de tiempo de simulación, en el mundo (ver spin.ts para el spin relativo al vuelo). */
  spin: Vec3;
}

export type BallContact =
  | { kind: 'table'; pos: Vec3; side: Side; impactSpeed: number }
  | { kind: 'net'; pos: Vec3; cord: boolean; fromSide: Side }
  | { kind: 'floor'; pos: Vec3 };

/** Geometría y coeficientes precalculados a partir de la config. */
export interface PhysicsEnv {
  r: number;
  g: number;
  k: number;
  tableTop: number;
  /** Altura del centro de la bola cuando toca la mesa. */
  tableContactY: number;
  halfLength: number;
  halfWidth: number;
  netTop: number;
  netHalfWidth: number;
  tableE: number;
  /** Fracción del deslizamiento del punto de contacto que elimina el bote. */
  tableGrip: number;
  /** Fracción de velocidad horizontal que pierde en el bote una bola sin spin (= 2/5 · agarre). */
  flatBounceLoss: number;
  magnusK: number;
  spinDecay: number;
  netSpinKeep: number;
  floorSpinKeep: number;
  floorE: number;
  floorFriction: number;
  netFaceE: number;
  netFaceDamping: number;
  netCordE: number;
  netCordFriction: number;
}

export interface StepOptions {
  /** false = trayectoria "fantasma" sin red (para el solver de tiro). */
  net?: boolean;
  /** true = la mesa es un plano infinito (para medir dónde cruzaría la altura de la mesa). */
  infiniteTable?: boolean;
  /** false = sin botes en la mesa. */
  table?: boolean;
}

/**
 * Esfera hueca (I = ⅔·m·R²): de un impulso tangencial en el punto de contacto, la fracción que cambia la
 * velocidad del centro es 1 / (1 + m·R²/I) = 2/5; el resto cambia el giro.
 */
const SHELL_LINEAR = 0.4;

export function makeEnv(cfg: GameConfig): PhysicsEnv {
  const { world, ball, spin } = cfg;
  return {
    r: ball.radius,
    g: ball.gravity,
    k: ball.dragK,
    tableTop: world.tableHeight,
    tableContactY: world.tableHeight + ball.radius,
    halfLength: world.tableLength / 2,
    halfWidth: world.tableWidth / 2,
    netTop: world.tableHeight + world.netHeight,
    netHalfWidth: world.tableWidth / 2 + world.netOverhang,
    tableE: ball.tableRestitution,
    tableGrip: ball.tableGrip,
    flatBounceLoss: SHELL_LINEAR * ball.tableGrip,
    magnusK: spin.magnusK,
    spinDecay: spin.airDecay,
    netSpinKeep: spin.netSpinKeep,
    floorSpinKeep: spin.floorSpinKeep,
    floorE: ball.floorRestitution,
    floorFriction: ball.floorFriction,
    netFaceE: ball.netFaceRestitution,
    netFaceDamping: ball.netFaceDamping,
    netCordE: ball.netCordRestitution,
    netCordFriction: ball.netCordFriction,
  };
}

export function cloneBall(b: BallState): BallState {
  return {
    pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
    vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
    spin: { x: b.spin.x, y: b.spin.y, z: b.spin.z },
  };
}

/** Lado de la mesa en el que está una coordenada z del mundo (la red en z = 0). */
export function sideOfZ(z: number): Side {
  return z >= 0 ? 0 : 1;
}

/**
 * Avanza la bola un paso de dt segundos de simulación y resuelve colisiones de forma continua
 * a lo largo del segmento recorrido. Muta `b`.
 * Integración: velocidad con Euler explícito y posición con la velocidad media del paso
 * (trapezoidal), exacta para gravedad constante. Las colisiones se añaden a `contacts`.
 * Fuerzas: gravedad, drag −k·|v|·v y Magnus magnusK·(ω × v) [§7.1].
 */
export function stepBall(b: BallState, dt: number, env: PhysicsEnv, contacts?: BallContact[], opts?: StepOptions): void {
  const v = b.vel;
  const w = b.spin;
  const v0x = v.x;
  const v0y = v.y;
  const v0z = v.z;
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const kd = env.k * speed;
  const km = env.magnusK;
  const mx0 = km * (w.y * v0z - w.z * v0y);
  const my0 = km * (w.z * v0x - w.x * v0z);
  const mz0 = km * (w.x * v0y - w.y * v0x);
  v.x += (-kd * v0x + mx0) * dt;
  v.y += (-env.g - kd * v0y + my0) * dt;
  v.z += (-kd * v0z + mz0) * dt;
  const keep = 1 - env.spinDecay * dt;
  w.x *= keep;
  w.y *= keep;
  w.z *= keep;

  let remaining = dt;
  // Velocidad media del tramo antes de la primera colisión; después, la velocidad ya reflejada.
  let mx = (v0x + v.x) * 0.5;
  let my = (v0y + v.y) * 0.5;
  let mz = (v0z + v.z) * 0.5;
  // Como mucho 3 colisiones encadenadas por paso (p. ej. cinta → mesa).
  for (let iter = 0; iter < 3 && remaining > 0; iter++) {
    const p = b.pos;
    const qx = p.x + mx * remaining;
    const qy = p.y + my * remaining;
    const qz = p.z + mz * remaining;
    const hit = findEarliestContact(p, qx, qy, qz, env, opts);
    if (!hit) {
      p.x = qx;
      p.y = qy;
      p.z = qz;
      return;
    }
    // Mover hasta el punto de contacto y responder.
    p.x += (qx - p.x) * hit.f;
    p.y += (qy - p.y) * hit.f;
    p.z += (qz - p.z) * hit.f;
    remaining *= 1 - hit.f;
    respond(b, hit.type, env, contacts);
    mx = v.x;
    my = v.y;
    mz = v.z;
  }
}

type ContactType = 'table' | 'floor' | 'netFace' | 'netCord';

function findEarliestContact(
  p: Vec3,
  qx: number,
  qy: number,
  qz: number,
  env: PhysicsEnv,
  opts?: StepOptions,
): { f: number; type: ContactType } | null {
  let bestF = 2;
  let bestType: ContactType | null = null;
  const EPS = 1e-9;

  // Mesa: plano y = tableContactY, bajando, con el centro sobre la superficie.
  if (opts?.table !== false && p.y >= env.tableContactY - EPS && qy < env.tableContactY && qy < p.y) {
    const f = (p.y - env.tableContactY) / (p.y - qy);
    const x = p.x + (qx - p.x) * f;
    const z = p.z + (qz - p.z) * f;
    const onTable = opts?.infiniteTable || (Math.abs(x) <= env.halfWidth && Math.abs(z) <= env.halfLength);
    if (onTable && f < bestF) {
      bestF = f;
      bestType = 'table';
    }
  }

  // Suelo.
  if (qy < env.r && p.y >= env.r - EPS && qy < p.y) {
    const f = (p.y - env.r) / (p.y - qy);
    if (f < bestF) {
      bestF = f;
      bestType = 'floor';
    }
  }

  if (opts?.net !== false) {
    // Malla: plano |z| = r por el lado de llegada, centro por debajo de la cinta.
    const s = p.z >= 0 ? 1 : -1;
    const face = s * env.r;
    if (Math.abs(p.z) >= env.r - EPS && (qz - face) * s < 0) {
      const f = (p.z - face) / (p.z - qz);
      const x = p.x + (qx - p.x) * f;
      const y = p.y + (qy - p.y) * f;
      if (f >= 0 && f < bestF && y <= env.netTop && y >= env.tableTop && Math.abs(x) <= env.netHalfWidth) {
        bestF = f;
        bestType = 'netFace';
      }
    }
    // Cinta: línea horizontal en (y = netTop, z = 0). Distancia en el plano (y, z) = r.
    const dy0 = p.y - env.netTop;
    const dz0 = p.z;
    const ddy = qy - p.y;
    const ddz = qz - p.z;
    const a = ddy * ddy + ddz * ddz;
    if (a > 1e-14) {
      const bq = 2 * (dy0 * ddy + dz0 * ddz);
      const c = dy0 * dy0 + dz0 * dz0 - env.r * env.r;
      const disc = bq * bq - 4 * a * c;
      if (c > 0 && disc >= 0 && bq < 0) {
        const f = (-bq - Math.sqrt(disc)) / (2 * a);
        if (f >= 0 && f <= 1 && f < bestF) {
          const x = p.x + (qx - p.x) * f;
          const y = p.y + ddy * f;
          // Solo cuenta como cinta si el contacto está por encima de la línea (si no, lo resuelve la malla).
          if (Math.abs(x) <= env.netHalfWidth && y > env.netTop) {
            bestF = f;
            bestType = 'netCord';
          }
        }
      }
    }
  }

  return bestType ? { f: bestF, type: bestType } : null;
}

function respond(b: BallState, type: ContactType, env: PhysicsEnv, contacts?: BallContact[]): void {
  const p = b.pos;
  const v = b.vel;
  switch (type) {
    case 'table': {
      const impactSpeed = -v.y;
      v.y = -v.y * env.tableE;
      // Fricción en el punto de contacto (r = (0, −R, 0)): su velocidad es v + ω × r = (vx + R·ωz, 0, vz − R·ωx).
      // El bote elimina la fracción `tableGrip` de ese deslizamiento: el topspin (que "rueda" más rápido que la
      // bola) la empuja hacia delante y el backspin la frena [§7.1]. Δω = (3 / 2R)·(−jz, 0, jx).
      const w = b.spin;
      const R = env.r;
      const jx = -env.flatBounceLoss * (v.x + R * w.z);
      const jz = -env.flatBounceLoss * (v.z - R * w.x);
      v.x += jx;
      v.z += jz;
      w.x += (-1.5 * jz) / R;
      w.z += (1.5 * jx) / R;
      p.y = env.tableContactY;
      contacts?.push({ kind: 'table', pos: { x: p.x, y: p.y, z: p.z }, side: sideOfZ(p.z), impactSpeed });
      break;
    }
    case 'floor': {
      v.y = -v.y * env.floorE;
      v.x *= 1 - env.floorFriction;
      v.z *= 1 - env.floorFriction;
      b.spin.x *= env.floorSpinKeep;
      b.spin.y *= env.floorSpinKeep;
      b.spin.z *= env.floorSpinKeep;
      p.y = env.r;
      contacts?.push({ kind: 'floor', pos: { x: p.x, y: p.y, z: p.z } });
      break;
    }
    case 'netFace': {
      const fromSide = sideOfZ(p.z);
      v.z = -v.z * env.netFaceE;
      v.x *= env.netFaceDamping;
      v.y *= env.netFaceDamping;
      b.spin.x *= env.netSpinKeep;
      b.spin.y *= env.netSpinKeep;
      b.spin.z *= env.netSpinKeep;
      contacts?.push({ kind: 'net', pos: { x: p.x, y: p.y, z: p.z }, cord: false, fromSide });
      break;
    }
    case 'netCord': {
      const fromSide = sideOfZ(p.z);
      // Normal en el plano (y, z) desde la cinta hacia el centro de la bola.
      const ny0 = p.y - env.netTop;
      const nz0 = p.z;
      const len = Math.sqrt(ny0 * ny0 + nz0 * nz0);
      const ny = ny0 / len;
      const nz = nz0 / len;
      const vn = v.y * ny + v.z * nz;
      if (vn < 0) {
        // Componente tangencial (incluye x) con fricción, normal con restitución.
        const tx = v.x;
        const ty = v.y - vn * ny;
        const tz = v.z - vn * nz;
        const keep = 1 - env.netCordFriction;
        v.x = tx * keep;
        v.y = ty * keep - env.netCordE * vn * ny;
        v.z = tz * keep - env.netCordE * vn * nz;
      }
      contacts?.push({ kind: 'net', pos: { x: p.x, y: p.y, z: p.z }, cord: true, fromSide });
      break;
    }
  }
}

/** Muestra de trayectoria: instante (ms de tiempo real) y posición. */
export interface PathSample {
  t: number;
  pos: Vec3;
}

/**
 * Predice la trayectoria de la bola sin intervención de raquetas.
 * Devuelve una muestra por tick a partir de t0 (excluido) durante `durationMs`.
 */
export function predictPath(
  ball: BallState,
  env: PhysicsEnv,
  dt: number,
  tickMs: number,
  t0: number,
  durationMs: number,
  contacts?: BallContact[],
): PathSample[] {
  const b = cloneBall(ball);
  const out: PathSample[] = [];
  const n = Math.ceil(durationMs / tickMs);
  for (let i = 1; i <= n; i++) {
    stepBall(b, dt, env, contacts);
    out.push({ t: t0 + i * tickMs, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z } });
  }
  return out;
}
