/**
 * Del resultado del golpe a la trayectoria [§4.3, §4.6, §7.5].
 *
 * 1. planShot: calidad + gesto (tipo y potencia) + punto de contacto → objetivos del tiro: punto de bote en
 *    campo rival, margen sobre la red y spin de salida. Todo determinista: el desvío del borde es
 *    proporcional a la distancia al centro, sin aleatoriedad. Cada objetivo se guarda desglosado en partes
 *    con nombre (timing, bola baja, potencia, ángulo…) para poder explicar un error ("¿por qué fallé?").
 * 2. solveShot: encuentra la velocidad inicial que cumple esos objetivos con la MISMA física, Magnus
 *    incluido (Newton 3×3 con diferencias finitas sobre trayectorias simuladas sin red).
 * 3. Después manda la física real: si el margen pedido es negativo, la bola choca con la red.
 */
import type { GameConfig, PaceCurvePoint, ShotCurvePoint } from './config.ts';
import { classifyGesture, type ShotType } from './gesture.ts';
import type { HitEvaluation } from './hit.ts';
import { type BallState, type PhysicsEnv, stepBall } from './physics.ts';
import { type RelSpin, relativeSpin, worldSpin } from './spin.ts';
import type { InputIntent, Side, Vec3 } from './types.ts';
import { sideSign } from './types.ts';

/** Partes con nombre del margen sobre la red (m). base + resto = margen pedido. */
export type ClearancePart =
  | 'base'
  | 'timing'
  | 'lowContact'
  | 'power'
  | 'topspin'
  | 'slice'
  | 'angle'
  | 'smashLow'
  | 'blockSpin'
  | 'paceCap'
  | 'floor';
/** Partes de la profundidad del bote (fracción de media mesa). */
export type DepthPart = 'base' | 'timing' | 'power' | 'powerLate' | 'smashLow' | 'blockSpin';
/** Partes del lateral del bote (m, coordenadas de quien golpea; + = su derecha). */
export type LateralPart = 'base' | 'aim' | 'angleRisk' | 'edge';

export interface ShotParts {
  clearance: Partial<Record<ClearancePart, number>>;
  depth: Partial<Record<DepthPart, number>>;
  lateral: Partial<Record<LateralPart, number>>;
}

export interface ShotTargets {
  /** Punto de bote objetivo en el campo rival (mundo). */
  landing: { x: number; z: number };
  /** Margen objetivo de la parte inferior de la bola sobre la cinta (m). */
  clearance: number;
  serve: boolean;
  /** Parte del objetivo lateral que viene del gesto, ya con el riesgo de ángulo (m, coordenadas del que golpea). */
  aim: number;
  type: ShotType;
  /** Potencia 0..1 (velocidad del gesto por encima del umbral del tipo) [§4.7]. */
  power: number;
  /** Spin de salida: relativo al vuelo (top/side) y en el mundo (lo que usa la física). */
  spinRel: RelSpin;
  spin: Vec3;
  /** Parte inferior de la bola sobre la cinta en el contacto (m): la referencia del umbral del smash. */
  aboveTape: number;
  parts: ShotParts;
}

/** Lo que necesita el solver: dónde botar, con qué margen sobre la red, si es saque y el spin de salida (mundo). */
export type ShotGoal = Pick<ShotTargets, 'landing' | 'clearance' | 'serve'> & { spin?: Vec3 };

/** Opciones del golpe que no salen del gesto. */
export interface ShotOptions {
  /** Click con Space mantenido: bloqueo [§8]. */
  block?: boolean;
  /** Bola entrante en el instante del contacto (el bloqueo usa su energía y su spin). */
  incoming?: { vel: Vec3; spin: Vec3 };
}

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

/** Interpolación lineal de una curva de ritmo (smash, bloqueo). */
export function interpolatePaceCurve(curve: PaceCurvePoint[], dt: number): PaceCurvePoint {
  const at = (a: PaceCurvePoint, b: PaceCurvePoint, f: number): PaceCurvePoint => ({
    dt,
    clearance: a.clearance + (b.clearance - a.clearance) * f,
    depth: a.depth + (b.depth - a.depth) * f,
    pace: a.pace + (b.pace - a.pace) * f,
  });
  if (dt <= curve[0].dt) return at(curve[0], curve[0], 0);
  const last = curve[curve.length - 1];
  for (let i = 0; i + 1 < curve.length; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (dt >= a.dt && dt <= b.dt) return at(a, b, (dt - a.dt) / (b.dt - a.dt));
  }
  return at(last, last, 0);
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
 * limitada al interior de la mesa (a `edgeMargin` de la banda; el slice llega más cerca).
 */
export function aimComponents(contactLateral: number, swingVx: number, cfg: GameConfig, edgeMargin = cfg.shot.aimEdgeMargin): { base: number; aim: number } {
  const s = cfg.shot;
  const maxX = cfg.world.tableWidth / 2 - edgeMargin;
  const dz = s.aimSwingDeadZone;
  const swing = swingVx > dz ? swingVx - dz : swingVx < -dz ? swingVx + dz : 0;
  const base = Math.max(-maxX, Math.min(maxX, contactLateral * s.aimBaseFromContact));
  const total = Math.max(-maxX, Math.min(maxX, base + swing * s.aimSwingGain));
  return { base, aim: total - base };
}

/** Fracción 0..1 del error de timing entre el borde de la ventana PERFECT y el de la débil. */
export function timingErrorFraction(dtMs: number, cfg: GameConfig): number {
  const { perfectMs, weakMs } = cfg.hit;
  const f = ((dtMs < 0 ? -dtMs : dtMs) - perfectMs) / (weakMs - perfectMs);
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/**
 * Riesgo de ángulo: pronto te pasas (el gesto abre más) y tarde no llegas a cruzar (abre menos).
 * Dentro de la ventana PERFECT no cambia nada. `gain` > 1 con potencia (más sensibilidad al timing).
 */
export function angleRisk(aim: number, dtMs: number, cfg: GameConfig, gain = 1): number {
  const f = timingErrorFraction(dtMs, cfg) * gain;
  return dtMs < 0 ? aim * (1 + cfg.shot.aimEarlyWiden * f) : aim * (1 - cfg.shot.aimLateNarrow * Math.min(1, f));
}

/**
 * Margen sobre la red de un tiro "de ritmo": la cuerda contacto → bote más la flecha de la parábola con
 * velocidad horizontal `vh` y gravedad efectiva `gEff` (sin drag; el solver luego cumple ese margen exacto).
 * Desde una bola baja la cuerda pasa por debajo de la cinta: a mucha velocidad la flecha no la salva.
 */
export function paceClearance(contact: Vec3, landing: { x: number; z: number }, vh: number, gEff: number, cfg: GameConfig): number {
  const r = cfg.ball.radius;
  const dx = landing.x - contact.x;
  const dz = landing.z - contact.z;
  const L = Math.sqrt(dx * dx + dz * dz);
  const u = contact.z / (contact.z - landing.z);
  const a = u * L;
  const b = L - a;
  const yChord = contact.y + u * (cfg.world.tableHeight + r - contact.y);
  const chord = yChord - r - (cfg.world.tableHeight + cfg.world.netHeight);
  return chord + (gEff * a * b) / (2 * vh * vh);
}

function sumParts(parts: Partial<Record<string, number>>): number {
  let t = 0;
  for (const k of Object.keys(parts)) t += parts[k] ?? 0;
  return t;
}

/** Calidad (sin WHIFF, que nunca llega a golpear) → factor de control del spin. */
function spinControl(evalr: HitEvaluation, cfg: GameConfig): number {
  const q = cfg.shotTypes.spinByTier;
  return evalr.tier === 'PERFECT' ? q.PERFECT : evalr.tier === 'GOOD' ? q.GOOD : q.WEAK;
}

export function planShot(
  evalr: HitEvaluation,
  contact: Vec3,
  intent: Pick<InputIntent, 'swing'>,
  side: Side,
  cfg: GameConfig,
  serve: boolean,
  opts: ShotOptions = {},
): ShotTargets {
  const sgn = sideSign(side);
  const half = cfg.world.tableLength / 2;
  const dt = evalr.dtMs;
  const contactLateral = contact.x * sgn;
  const aboveTape = contact.y - cfg.ball.radius - (cfg.world.tableHeight + cfg.world.netHeight);
  const edge = edgeDeviation(evalr, cfg.shot);

  // ——— Saque normal simplificado (V0.1): sin tipo de golpe, sin spin ———
  if (serve) {
    const { clearance, depth } = interpolateCurve(cfg.serve.timingCurve, dt);
    const { base, aim: cleanAim } = aimComponents(contactLateral, intent.swing.vx, cfg);
    const aim = angleRisk(cleanAim, dt, cfg);
    const maxX = cfg.world.tableWidth / 2 - cfg.shot.aimEdgeMargin;
    const anglePen = -cfg.shot.aimClearancePenalty * Math.min(1, Math.abs(cleanAim) / maxX);
    const landing = { x: (base + aim + edge) * sgn, z: -sgn * depth * half };
    keepServeBounceOnTable(contact, landing, cfg);
    return {
      landing,
      clearance: clearance + anglePen,
      serve,
      aim,
      type: 'NORMAL',
      power: 0,
      spinRel: { top: 0, side: 0 },
      spin: { x: 0, y: 0, z: 0 },
      aboveTape,
      parts: { clearance: { base: clearance, angle: anglePen }, depth: { base: depth }, lateral: { base, aim: cleanAim, angleRisk: aim - cleanAim, edge } },
    };
  }

  if (opts.block) return planBlock(evalr, contact, side, cfg, opts.incoming, aboveTape, edge);

  const { type, power: p } = classifyGesture(intent.swing, cfg);
  const st = cfg.shotTypes;
  const sens = 1 + p * st.powerTimingGain;
  const ctl = spinControl(evalr, cfg);

  // ——— Dirección: base + gesto (+ riesgo de ángulo) + borde ———
  const edgeMargin = type === 'SLICE' ? st.slice.edgeMargin : cfg.shot.aimEdgeMargin;
  const { base, aim: cleanAim } = aimComponents(contactLateral, intent.swing.vx, cfg, edgeMargin);
  const aim = angleRisk(cleanAim, dt, cfg, sens);
  const lateralParts: ShotParts['lateral'] = { base, aim: cleanAim, angleRisk: aim - cleanAim, edge };
  const lateral = base + aim + edge;

  // ——— Spin de salida ———
  let spinRel: RelSpin = { top: 0, side: 0 };
  if (type === 'TOPSPIN') spinRel = { top: (st.topspin.spinMin + p * (st.topspin.spinMax - st.topspin.spinMin)) * ctl, side: 0 };
  else if (type === 'SLICE') {
    const sideSpin = (st.slice.sideMin + p * (st.slice.sideMax - st.slice.sideMin)) * ctl;
    spinRel = { top: -st.slice.backspin * ctl, side: intent.swing.vx >= 0 ? sideSpin : -sideSpin };
  } else if (type === 'SMASH') spinRel = { top: st.smash.topspin * ctl, side: 0 };

  const cp: ShotParts['clearance'] = {};
  const dp: ShotParts['depth'] = {};
  const maxX = cfg.world.tableWidth / 2 - edgeMargin;
  let landing: { x: number; z: number };

  const gEff = (v: number) => cfg.ball.gravity + cfg.spin.magnusK * spinRel.top * v;
  if (type === 'SMASH') {
    // ——— Smash: objetivo de ritmo; el margen sale de la geometría [§4.6] ———
    const sm = st.smash;
    const c0 = interpolatePaceCurve(sm.timingCurve, 0);
    const c = interpolatePaceCurve(sm.timingCurve, dt);
    const pace0 = sm.paceMin + p * (sm.paceMax - sm.paceMin);
    const pace = pace0 * (1 - (1 - c.pace) * sens);
    const extra = c.clearance * sens;
    const at = (depth: number) => ({ x: lateral * sgn, z: -sgn * Math.max(0.1, depth) * half });
    dp.base = c0.depth;
    dp.timing = (c.depth - c0.depth) * sens;
    const deficit = sm.minAboveTape - aboveTape;
    if (deficit > 0) dp.smashLow = -sm.lowDepthPerM * deficit;
    landing = at(sumParts(dp));
    cp.base = paceClearance(contact, { x: (base + cleanAim) * sgn, z: -sgn * c0.depth * half }, pace0, gEff(pace0), cfg);
    const noLow = paceClearance(contact, at(dp.base + dp.timing), pace, gEff(pace), cfg) + extra;
    cp.timing = noLow - cp.base;
    if (deficit > 0) cp.smashLow = paceClearance(contact, landing, pace, gEff(pace), cfg) + extra - noLow;
  } else {
    // ——— Normal, topspin y slice: objetivos de margen y profundidad (curva de timing V0.1) ———
    const c0 = interpolateCurve(cfg.shot.timingCurve, 0);
    const c = interpolateCurve(cfg.shot.timingCurve, dt);
    cp.base = c0.clearance;
    cp.timing = (c.clearance - c0.clearance) * sens;
    if (p > 0) cp.power = -p * st.powerClearance;
    if (type === 'TOPSPIN' && p > 0) cp.topspin = -p * st.topspin.clearanceDrop;
    if (type === 'SLICE' && p > 0) cp.slice = -p * st.slice.clearancePenalty;
    dp.base = c0.depth;
    dp.timing = (c.depth - c0.depth) * (dt < 0 ? sens : 1);
    if (p > 0) dp.power = p * st.powerDepth;
    if (p > 0 && dt > 0) dp.powerLate = p * timingErrorFraction(dt, cfg) * st.powerLateLong;
    landing = { x: lateral * sgn, z: -sgn * sumParts(dp) * half };
    const anglePen = -cfg.shot.aimClearancePenalty * Math.min(1, Math.abs(cleanAim) / maxX);
    if (anglePen < 0) cp.angle = anglePen;
    // Techo de ritmo: desde una bola alta el margen pedido daría un tiro más rápido que el del tipo.
    const capBase = type === 'TOPSPIN' ? st.topspin.paceCap + p * st.topspin.paceCapPower : type === 'SLICE' ? st.slice.paceCap : st.normalPaceCap;
    const cap = capBase * (1 - st.paceCapTimingLoss * Math.min(1, timingErrorFraction(dt, cfg) * sens));
    const capClearance = paceClearance(contact, landing, cap, gEff(cap), cfg);
    const margin = sumParts(cp);
    if (capClearance > margin) cp.paceCap = capClearance - margin;
    // La bola cogida baja ("posición desfavorable", §6.1) es un riesgo que el techo de ritmo no tapa.
    const deficit = cfg.shot.lowContactRefHeight - (contact.y - cfg.world.tableHeight);
    if (deficit > 0) cp.lowContact = -deficit * cfg.shot.lowContactPenaltyPerM * (type === 'TOPSPIN' ? 1 + st.topspin.lowContactGain : 1);
  }

  const dirX = landing.x - contact.x;
  const dirZ = landing.z - contact.z;
  const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
  const spin = worldSpin(spinRel, dirX / dirLen, dirZ / dirLen);
  applyFloor(cp, contact, landing, spinRel, cfg);
  return { landing, clearance: sumParts(cp), serve, aim, type, power: p, spinRel, spin, aboveTape, parts: { clearance: cp, depth: dp, lateral: lateralParts } };
}

/**
 * Suelo del margen: con gravedad (y topspin) la trayectoria siempre pasa por encima de la cuerda contacto →
 * bote, así que no se puede pedir menos que la cuerda + la flecha a la velocidad máxima. Desde una bola alta,
 * "más bajo" ya no es posible: el golpe sale a la velocidad máxima (el riesgo pasa a la profundidad).
 */
function applyFloor(cp: ShotParts['clearance'], contact: Vec3, landing: { x: number; z: number }, spinRel: RelSpin, cfg: GameConfig): void {
  const v = cfg.shotTypes.maxPace;
  const floor = paceClearance(contact, landing, v, cfg.ball.gravity + cfg.spin.magnusK * Math.max(0, spinRel.top) * v, cfg);
  const c = sumParts(cp);
  if (c < floor) cp.floor = floor - c;
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
  /** Bote en campo rival, medido desde el punto de salida: a lo largo de la dirección de tiro y en lateral. */
  along: number;
  lateral: number;
}

const MAX_TRIAL_STEPS = 2400;

/**
 * Simula un tiro candidato con la física real (Magnus incluido) pero sin red: la velocidad inicial es
 * dir·vh + lat·vl + arriba·vy, con lat = (−dirZ, 0, dirX) (la derecha de quien golpea). Sin trigonometría.
 */
function runTrial(
  start: Vec3,
  dirX: number,
  dirZ: number,
  vh: number,
  vy: number,
  vl: number,
  spin: Vec3,
  env: PhysicsEnv,
  dt: number,
  serve: boolean,
): TrialResult {
  const b: BallState = {
    pos: { x: start.x, y: start.y, z: start.z },
    vel: { x: dirX * vh - dirZ * vl, y: vy, z: dirZ * vh + dirX * vl },
    spin: { x: spin.x, y: spin.y, z: spin.z },
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
      const ox = px + (b.pos.x - px) * f - start.x;
      const oz = pz + (b.pos.z - pz) * f - start.z;
      return { clearance, along: ox * dirX + oz * dirZ, lateral: -ox * dirZ + oz * dirX };
    }
    if (b.pos.y < 0) break;
  }
  return { clearance: crossed ? clearance : -1, along: 0, lateral: 0 };
}

export interface SolveResult {
  vel: Vec3;
  converged: boolean;
  /** Errores residuales (m). */
  clearanceError: number;
  landingError: number;
  lateralError: number;
}

/** Resuelve J·x = r (3×3) por la regla de Cramer. Devuelve null si el sistema es singular. */
function solve3(j: number[][], r: number[]): number[] | null {
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const det = det3(j);
  if (Math.abs(det) < 1e-12) return null;
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const m = j.map((row, i) => row.map((v, k) => (k === c ? r[i] : v)));
    out.push(det3(m) / det);
  }
  return out;
}

/**
 * Busca la velocidad inicial que bota en `targets.landing` pasando la red con `targets.clearance`, con el
 * spin del golpe ya aplicado: el Magnus va DENTRO de las trayectorias que se resuelven (§7.5), así que el
 * topspin permite pegar más fuerte con el mismo margen y el lateral se compensa apuntando hacia dentro.
 * Newton 3×3 (velocidad horizontal, vertical y lateral) con diferencias finitas.
 * Determinista: número fijo máximo de iteraciones y mismas operaciones en cliente y servidor.
 */
export function solveShot(start: Vec3, targets: ShotGoal, env: PhysicsEnv, dt: number, cfg: GameConfig): SolveResult {
  const dxT = targets.landing.x - start.x;
  const dzT = targets.landing.z - start.z;
  const D = Math.sqrt(dxT * dxT + dzT * dzT);
  const dirX = dxT / D;
  const dirZ = dzT / D;
  const spin = targets.spin ?? { x: 0, y: 0, z: 0 };
  const rel = relativeSpin(spin, { x: dirX, y: 0, z: dirZ });
  // Distancia horizontal hasta la red a lo largo de la dirección de tiro.
  const sNet = -start.z / dirZ;
  const yNet = env.netTop + env.r + targets.clearance;
  const yLand = env.tableContactY;

  const evalErr = (h: number, y: number, l: number) => {
    const r = runTrial(start, dirX, dirZ, h, y, l, spin, env, dt, targets.serve);
    return { ec: r.clearance - targets.clearance, el: r.along - D, eq: r.lateral };
  };
  const isConverged = (b: { ec: number; el: number; eq: number }) => Math.abs(b.ec) < 0.004 && Math.abs(b.el) < 0.01 && Math.abs(b.eq) < 0.01;

  /** Newton 3×3 con diferencias finitas desde una estimación inicial; devuelve el mejor intento. */
  const newton = (vh0: number, vy0: number, vl0: number) => {
    let vh = vh0;
    let vy = vy0;
    let vl = vl0;
    let best = { vh, vy, vl, err: Number.POSITIVE_INFINITY, ec: 0, el: 0, eq: 0 };
    for (let iter = 0; iter < 12; iter++) {
      const e = evalErr(vh, vy, vl);
      const err = Math.abs(e.ec) + Math.abs(e.el) + Math.abs(e.eq);
      if (err < best.err) best = { vh, vy, vl, err, ec: e.ec, el: e.el, eq: e.eq };
      if (Math.abs(e.ec) < 0.002 && Math.abs(e.el) < 0.005 && Math.abs(e.eq) < 0.005) break;
      const h = 1e-3;
      const eh = evalErr(vh + h, vy, vl);
      const ey = evalErr(vh, vy + h, vl);
      const ed = evalErr(vh, vy, vl + h);
      const step = solve3(
        [
          [(eh.ec - e.ec) / h, (ey.ec - e.ec) / h, (ed.ec - e.ec) / h],
          [(eh.el - e.el) / h, (ey.el - e.el) / h, (ed.el - e.el) / h],
          [(eh.eq - e.eq) / h, (ey.eq - e.eq) / h, (ed.eq - e.eq) / h],
        ],
        [-e.ec, -e.el, -e.eq],
      );
      if (!step) break;
      let [dvh, dvy, dvl] = step;
      // Amortiguación: pasos de como mucho 1.5 m/s.
      const stepLen = Math.sqrt(dvh * dvh + dvy * dvy + dvl * dvl);
      if (stepLen > 1.5) {
        dvh *= 1.5 / stepLen;
        dvy *= 1.5 / stepLen;
        dvl *= 1.5 / stepLen;
      }
      vh = Math.max(0.5, vh + dvh);
      vy += dvy;
      vl += dvl;
    }
    return best;
  };

  // Estimación del lateral: el Magnus del lateral (magnusK·side·vh hacia la derecha) desplaza el bote
  // ½·magnusK·side·D²/vh; se compensa saliendo con vl = −½·magnusK·side·D (no depende de vh).
  const vl0 = -0.5 * env.magnusK * rel.side * D;

  let best: { vh: number; vy: number; vl: number; err: number; ec: number; el: number; eq: number };
  if (!targets.serve) {
    // Estimación sin drag: parábola y = y0 + b·s + a·s² por (sNet, yNet) y (D, yLand). El topspin actúa como
    // una gravedad mayor (magnusK·top·vh hacia abajo): dos vueltas para estimar vh con esa gravedad.
    const y0 = start.y;
    const a = ((yLand - y0) / D - (yNet - y0) / sNet) / (D - sNet);
    const bq = (yNet - y0) / sNet - a * sNet;
    let vh = D / 0.4;
    if (a < -1e-6) {
      vh = Math.sqrt(env.g / (-2 * a));
      for (let k = 0; k < 2; k++) {
        const gEff = env.g + env.magnusK * rel.top * vh;
        if (gEff > 0.5) vh = Math.sqrt(gEff / (-2 * a));
      }
    }
    best = newton(vh, bq * vh, vl0);
  } else {
    // Saque, estimación 1 (sirve para casi todos): primer bote B1 a una fracción fija hasta la red; el tramo
    // B1 → red → bote rival se resuelve como un tiro normal desde la mesa y el tramo contacto → B1 se
    // aproxima sin drag con la misma velocidad horizontal.
    const h0 = start.y - yLand;
    const s1 = sNet * cfg.serve.firstBounceFraction;
    const post = solveShot({ x: start.x + dirX * s1, y: yLand, z: start.z + dirZ * s1 }, { landing: targets.landing, clearance: targets.clearance, serve: false }, env, dt, cfg);
    const vh1 = Math.sqrt(post.vel.x * post.vel.x + post.vel.z * post.vel.z) / (1 - env.flatBounceLoss);
    const T1 = s1 / vh1;
    best = newton(vh1, (0.5 * env.g * T1 * T1 - h0) / T1, vl0);
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
        vhB = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z) / (1 - env.flatBounceLoss);
        // h0 + vy0·T − g·T²/2 = 0 con vy0 = vyImpact + g·T  →  g·T²/2 + vyImpact·T + h0 = 0 (raíz menor).
        const disc = vyImpact * vyImpact - 2 * env.g * h0;
        const T = disc > 0 ? (-vyImpact - Math.sqrt(disc)) / env.g : -vyImpact / env.g;
        vyB = vyImpact + env.g * T;
        sB = Math.max(0.15 * sNet, Math.min(0.85 * sNet, vhB * T));
      }
      const alt = newton(vhB, vyB, vl0);
      if (alt.err < best.err) best = alt;
    }
  }

  return {
    vel: { x: dirX * best.vh - dirZ * best.vl, y: best.vy, z: dirZ * best.vh + dirX * best.vl },
    converged: isConverged(best),
    clearanceError: best.ec,
    landingError: best.el,
    lateralError: best.eq,
  };
}

/**
 * Bloqueo [§8]: sin gesto ni potencia propia. Objetivo de ritmo con la energía de la bola entrante (el margen
 * sale de la geometría), bola recta, y el spin entrante: un PERFECT lo devuelve en parte invertido; si no, el
 * topspin la levanta (larga) y el backspin la hunde (red).
 */
function planBlock(
  evalr: HitEvaluation,
  contact: Vec3,
  side: Side,
  cfg: GameConfig,
  incoming: ShotOptions['incoming'],
  aboveTape: number,
  edge: number,
): ShotTargets {
  const bc = cfg.block;
  const sgn = sideSign(side);
  const half = cfg.world.tableLength / 2;
  const tier = evalr.tier === 'PERFECT' ? 'PERFECT' : evalr.tier === 'GOOD' ? 'GOOD' : 'WEAK';
  const vin = incoming ? Math.sqrt(incoming.vel.x * incoming.vel.x + incoming.vel.z * incoming.vel.z) : 0;
  // Spin de la bola que llega, relativo a SU dirección de vuelo (top > 0 = topspin del rival).
  const inRel = incoming ? relativeSpin(incoming.spin, incoming.vel) : { top: 0, side: 0 };
  const c0 = interpolatePaceCurve(bc.timingCurve, 0);
  const c = interpolatePaceCurve(bc.timingCurve, evalr.dtMs);
  const pace0 = Math.max(bc.minPace, vin * bc.paceByTier[tier]);
  const pace = pace0 * c.pace;

  const { base } = aimComponents(contact.x * sgn, 0, cfg);
  const lateral = base + edge;
  const invert = tier === 'PERFECT' ? bc.spinInvert : 0;
  const spinRel: RelSpin = { top: -invert * inRel.top, side: -invert * inRel.side };
  const gEff = (v: number) => cfg.ball.gravity + cfg.spin.magnusK * spinRel.top * v;
  const at = (depth: number) => ({ x: lateral * sgn, z: -sgn * Math.max(0.1, depth) * half });

  const dp: ShotParts['depth'] = { base: c0.depth, timing: c.depth - c0.depth };
  const spinLong = bc.spinLongByTier[tier] * inRel.top;
  if (spinLong !== 0) dp.blockSpin = spinLong;
  const landing = at(sumParts(dp));
  const cp: ShotParts['clearance'] = {};
  cp.base = paceClearance(contact, at(c0.depth), pace0, gEff(pace0), cfg);
  const noSpin = paceClearance(contact, at(c0.depth + c.depth - c0.depth), pace, gEff(pace), cfg) + c.clearance;
  cp.timing = noSpin - cp.base;
  const withSpin = paceClearance(contact, landing, pace, gEff(pace), cfg) + c.clearance + bc.spinLiftByTier[tier] * inRel.top;
  if (withSpin !== noSpin) cp.blockSpin = withSpin - noSpin;

  const dirX = landing.x - contact.x;
  const dirZ = landing.z - contact.z;
  const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
  applyFloor(cp, contact, landing, spinRel, cfg);
  return {
    landing,
    clearance: sumParts(cp),
    serve: false,
    aim: 0,
    type: 'BLOCK',
    power: 0,
    spinRel,
    spin: worldSpin(spinRel, dirX / dirLen, dirZ / dirLen),
    aboveTape,
    parts: { clearance: cp, depth: dp, lateral: { base, edge } },
  };
}
