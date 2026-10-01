/**
 * Del resultado del golpe a la trayectoria [§4.3].
 *
 * 1. planShot: calidad + gesto + punto de contacto → objetivos del tiro
 *    (punto de bote en campo rival y margen sobre la red). Todo determinista: el desvío del
 *    borde es proporcional a la distancia al centro, sin aleatoriedad.
 * 2. solveShot: encuentra la velocidad inicial que cumple esos objetivos con la MISMA física
 *    (Newton 2×2 con diferencias finitas sobre trayectorias simuladas sin red).
 * 3. Después manda la física real: si el margen pedido es negativo, la bola choca con la red.
 */
import type { GameConfig, ShotCurvePoint } from './config.ts';
import type { HitEvaluation } from './hit.ts';
import { type BallState, type PhysicsEnv, stepBall } from './physics.ts';
import type { InputIntent, Side, Vec3 } from './types.ts';
import { sideSign } from './types.ts';

export interface ShotTargets {
  /** Punto de bote objetivo en el campo rival (mundo). */
  landing: { x: number; z: number };
  /** Margen objetivo de la parte inferior de la bola sobre la cinta (m). */
  clearance: number;
  serve: boolean;
  /** Parte del objetivo lateral que viene del gesto, ya con el riesgo de ángulo (m, coordenadas del que golpea). */
  aim: number;
}

/** Lo que necesita el solver: dónde botar, con qué margen sobre la red y si es saque. */
export type ShotGoal = Pick<ShotTargets, 'landing' | 'clearance' | 'serve'>;

export function interpolateCurve(curve: ShotCurvePoint[], dt: number): { clearance: number; depth: number } {
  if (dt <= curve[0].dt) return { clearance: curve[0].clearance, depth: curve[0].depth };
  const last = curve[curve.length - 1];
  if (dt >= last.dt) return { clearance: last.clearance, depth: last.depth };
  for (let i = 0; i + 1 < curve.length; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (dt >= a.dt && dt <= b.dt) {
      const f = (dt - a.dt) / (b.dt - a.dt);
      return { clearance: a.clearance + (b.clearance - a.clearance) * f, depth: a.depth + (b.depth - a.depth) * f };
    }
  }
  return { clearance: last.clearance, depth: last.depth };
}

/** Desvío lateral por golpe descentrado (m), con signo hacia el lado del impacto. */
export function edgeDeviation(evalr: Pick<HitEvaluation, 'posFrac' | 'lateral'>, shot: GameConfig['shot']): number {
  const p = evalr.posFrac;
  const mag = shot.edgeDeviationSmall * Math.min(p, 0.5) + shot.edgeDeviationEdge * Math.max(0, p - 0.5);
  return evalr.lateral >= 0 ? mag : -mag;
}

/** Puntería lateral limpia (sin desvío) en coordenadas del jugador que golpea. */
export function aimLateral(contactLateral: number, swingVx: number, cfg: GameConfig): number {
  const { base, aim } = aimComponents(contactLateral, swingVx, cfg);
  return base + aim;
}

/**
 * Puntería separada en dos partes: `base` (sale de dónde golpeas) y `aim` (sale del gesto), con la suma
 * limitada al interior de la mesa.
 */
export function aimComponents(contactLateral: number, swingVx: number, cfg: GameConfig): { base: number; aim: number } {
  const s = cfg.shot;
  const maxX = cfg.world.tableWidth / 2 - s.aimEdgeMargin;
  const dz = s.aimSwingDeadZone;
  const swing = swingVx > dz ? swingVx - dz : swingVx < -dz ? swingVx + dz : 0;
  const base = Math.max(-maxX, Math.min(maxX, contactLateral * s.aimBaseFromContact));
  const total = Math.max(-maxX, Math.min(maxX, base + swing * s.aimSwingGain));
  return { base, aim: total - base };
}

/**
 * Riesgo de ángulo: pronto te pasas (el gesto abre más) y tarde no llegas a cruzar (abre menos).
 * Dentro de la ventana PERFECT no cambia nada.
 */
export function angleRisk(aim: number, dtMs: number, cfg: GameConfig): number {
  const { perfectMs, weakMs } = cfg.hit;
  const f = Math.max(0, Math.min(1, (Math.abs(dtMs) - perfectMs) / (weakMs - perfectMs)));
  return dtMs < 0 ? aim * (1 + cfg.shot.aimEarlyWiden * f) : aim * (1 - cfg.shot.aimLateNarrow * f);
}

export function planShot(
  evalr: HitEvaluation,
  contact: Vec3,
  intent: Pick<InputIntent, 'swing'>,
  side: Side,
  cfg: GameConfig,
  serve: boolean,
): ShotTargets {
  const sgn = sideSign(side);
  const curve = serve ? cfg.serve.timingCurve : cfg.shot.timingCurve;
  const { clearance: baseClearance, depth } = interpolateCurve(curve, evalr.dtMs);
  let clearance = baseClearance;
  if (!serve) {
    const h = contact.y - cfg.world.tableHeight;
    const deficit = cfg.shot.lowContactRefHeight - h;
    if (deficit > 0) clearance -= deficit * cfg.shot.lowContactPenaltyPerM;
  }
  const half = cfg.world.tableLength / 2;
  const contactLateral = contact.x * sgn;
  const { base, aim: cleanAim } = aimComponents(contactLateral, intent.swing.vx, cfg);
  const aim = angleRisk(cleanAim, evalr.dtMs, cfg);
  const maxX = cfg.world.tableWidth / 2 - cfg.shot.aimEdgeMargin;
  clearance -= cfg.shot.aimClearancePenalty * Math.min(1, Math.abs(cleanAim) / maxX);
  const lateral = base + aim + edgeDeviation(evalr, cfg.shot);
  const landing = { x: lateral * sgn, z: -sgn * depth * half };
  if (serve) keepServeBounceOnTable(contact, landing, cfg);
  return {
    landing,
    clearance,
    serve,
    aim,
  };
}

/**
 * Saque: sin efecto lateral la trayectoria horizontal es recta, así que el primer bote (en tu campo) cae
 * sobre la línea contacto → bote rival. Si quedaría fuera del ancho de la mesa, se corrige el objetivo
 * para que ese primer bote quede dentro. Muta `landing` (coordenadas del mundo).
 */
export function keepServeBounceOnTable(contact: Vec3, landing: { x: number; z: number }, cfg: GameConfig): void {
  const limit = cfg.world.tableWidth / 2 - cfg.shot.aimEdgeMargin;
  const zB1 = contact.z * (1 - cfg.serve.firstBounceFraction);
  const u = (contact.z - zB1) / (contact.z - landing.z);
  const xB1 = contact.x + u * (landing.x - contact.x);
  if (Math.abs(xB1) > limit) {
    const x = contact.x + ((xB1 > 0 ? limit : -limit) - contact.x) / u;
    landing.x = Math.max(-limit, Math.min(limit, x));
  }
}

/** Resultado de simular una trayectoria candidata. */
interface TrialResult {
  /** Margen (parte inferior de la bola − cinta) al cruzar z = 0; −1 si no cruza. */
  clearance: number;
  /** Distancia horizontal recorrida hasta el bote en campo rival, a lo largo de la dirección de tiro. */
  landing: number;
}

const MAX_TRIAL_STEPS = 2400;

function runTrial(start: Vec3, dirX: number, dirZ: number, vh: number, vy: number, env: PhysicsEnv, dt: number, serve: boolean): TrialResult {
  const b: BallState = {
    pos: { x: start.x, y: start.y, z: start.z },
    vel: { x: dirX * vh, y: vy, z: dirZ * vh },
    spin: { x: 0, y: 0, z: 0 },
  };
  const s0 = start.z >= 0 ? 1 : -1;
  let clearance = Number.NaN;
  let crossed = false;
  // Para el saque: la bola bota en tu campo (mesa real) antes de la red. Tras la red, la mesa es un plano
  // infinito para medir dónde cruzaría la altura de bote aunque sea fuera.
  for (let i = 0; i < MAX_TRIAL_STEPS; i++) {
    const px = b.pos.x;
    const py = b.pos.y;
    const pz = b.pos.z;
    stepBall(b, dt, env, undefined, { net: false, table: serve && !crossed, infiniteTable: false });
    if (!crossed && b.pos.z * s0 <= 0) {
      const f = pz / (pz - b.pos.z);
      const yAt = py + (b.pos.y - py) * f;
      clearance = yAt - env.r - env.netTop;
      crossed = true;
    }
    if (crossed && b.pos.y <= env.tableContactY && b.vel.y < 0) {
      const f = (py - env.tableContactY) / (py - b.pos.y);
      const x = px + (b.pos.x - px) * f;
      const z = pz + (b.pos.z - pz) * f;
      const landing = (x - start.x) * dirX + (z - start.z) * dirZ;
      return { clearance, landing };
    }
    if (b.pos.y < 0) break;
  }
  return { clearance: crossed ? clearance : -1, landing: 0 };
}

export interface SolveResult {
  vel: Vec3;
  converged: boolean;
  /** Errores residuales (m). */
  clearanceError: number;
  landingError: number;
}

/**
 * Busca la velocidad inicial que bota en `targets.landing` pasando la red con `targets.clearance`.
 * Determinista: número fijo máximo de iteraciones y mismas operaciones en cliente y servidor.
 */
export function solveShot(start: Vec3, targets: ShotGoal, env: PhysicsEnv, dt: number, cfg: GameConfig): SolveResult {
  const dxT = targets.landing.x - start.x;
  const dzT = targets.landing.z - start.z;
  const D = Math.sqrt(dxT * dxT + dzT * dzT);
  const dirX = dxT / D;
  const dirZ = dzT / D;
  // Distancia horizontal hasta la red a lo largo de la dirección de tiro.
  const sNet = -start.z / dirZ;
  const yNet = env.netTop + env.r + targets.clearance;
  const yLand = env.tableContactY;

  const evalErr = (h: number, y: number) => {
    const r = runTrial(start, dirX, dirZ, h, y, env, dt, targets.serve);
    return { ec: r.clearance - targets.clearance, el: r.landing - D };
  };
  const isConverged = (b: { ec: number; el: number }) => Math.abs(b.ec) < 0.004 && Math.abs(b.el) < 0.01;

  /** Newton 2×2 con diferencias finitas desde una estimación inicial; devuelve el mejor intento. */
  const newton = (vh0: number, vy0: number) => {
    let vh = vh0;
    let vy = vy0;
    let best = { vh, vy, err: Number.POSITIVE_INFINITY, ec: 0, el: 0 };
    for (let iter = 0; iter < 12; iter++) {
      const e = evalErr(vh, vy);
      const err = Math.abs(e.ec) + Math.abs(e.el);
      if (err < best.err) best = { vh, vy, err, ec: e.ec, el: e.el };
      if (Math.abs(e.ec) < 0.002 && Math.abs(e.el) < 0.005) break;
      const h = 1e-3;
      const eh = evalErr(vh + h, vy);
      const ey = evalErr(vh, vy + h);
      const j11 = (eh.ec - e.ec) / h;
      const j12 = (ey.ec - e.ec) / h;
      const j21 = (eh.el - e.el) / h;
      const j22 = (ey.el - e.el) / h;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-12) break;
      let dvh = -(j22 * e.ec - j12 * e.el) / det;
      let dvy = -(-j21 * e.ec + j11 * e.el) / det;
      // Amortiguación: pasos de como mucho 1.5 m/s.
      const stepLen = Math.sqrt(dvh * dvh + dvy * dvy);
      if (stepLen > 1.5) {
        dvh *= 1.5 / stepLen;
        dvy *= 1.5 / stepLen;
      }
      vh = Math.max(0.5, vh + dvh);
      vy += dvy;
    }
    return best;
  };

  let best: { vh: number; vy: number; err: number; ec: number; el: number };
  if (!targets.serve) {
    // Estimación sin drag: parábola y = y0 + b·s + a·s² por (sNet, yNet) y (D, yLand).
    const y0 = start.y;
    const a = ((yLand - y0) / D - (yNet - y0) / sNet) / (D - sNet);
    const bq = (yNet - y0) / sNet - a * sNet;
    const vh = a < -1e-6 ? Math.sqrt(env.g / (-2 * a)) : D / 0.4;
    best = newton(vh, bq * vh);
  } else {
    // Saque, estimación 1 (sirve para casi todos): primer bote B1 a una fracción fija hasta la red; el tramo
    // B1 → red → bote rival se resuelve como un tiro normal desde la mesa y el tramo contacto → B1 se
    // aproxima sin drag con la misma velocidad horizontal.
    const h0 = start.y - yLand;
    const s1 = sNet * cfg.serve.firstBounceFraction;
    const post = solveShot({ x: start.x + dirX * s1, y: yLand, z: start.z + dirZ * s1 }, { landing: targets.landing, clearance: targets.clearance, serve: false }, env, dt, cfg);
    const vh1 = Math.sqrt(post.vel.x * post.vel.x + post.vel.z * post.vel.z) / (1 - env.tableFriction);
    const T1 = s1 / vh1;
    best = newton(vh1, (0.5 * env.g * T1 * T1 - h0) / T1);
    if (!isConverged(best)) {
      // Estimación 2 (saques tardíos, contacto bajo): hay que golpear hacia abajo con fuerza para que el bote
      // suba lo bastante. Velocidad de llegada a B1 que pide el tramo posterior (deshaciendo restitución y
      // fricción) → golpe desde la altura real que llega con esa velocidad vertical → nuevo B1; 3 vueltas.
      let sB = s1;
      let vhB = vh1;
      let vyB = -1;
      for (let k = 0; k < 3; k++) {
        const p = solveShot({ x: start.x + dirX * sB, y: yLand, z: start.z + dirZ * sB }, { landing: targets.landing, clearance: targets.clearance, serve: false }, env, dt, cfg);
        const vyImpact = -p.vel.y / env.tableE;
        vhB = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z) / (1 - env.tableFriction);
        // h0 + vy0·T − g·T²/2 = 0 con vy0 = vyImpact + g·T  →  g·T²/2 + vyImpact·T + h0 = 0 (raíz menor).
        const disc = vyImpact * vyImpact - 2 * env.g * h0;
        const T = disc > 0 ? (-vyImpact - Math.sqrt(disc)) / env.g : -vyImpact / env.g;
        vyB = vyImpact + env.g * T;
        sB = Math.max(0.15 * sNet, Math.min(0.85 * sNet, vhB * T));
      }
      const alt = newton(vhB, vyB);
      if (alt.err < best.err) best = alt;
    }
  }

  return {
    vel: { x: dirX * best.vh, y: best.vy, z: dirZ * best.vh },
    converged: isConverged(best),
    clearanceError: best.ec,
    landingError: best.el,
  };
}
