/**
 * Piezas puras del click [§4.2, §4.5] que comparten la simulación local, el cliente en red, el servidor y el bot:
 *  - el factor de «colocado» a partir de las velocidades de la raqueta antes del gesto;
 *  - la posición fija con la que se mide el golpe (la raqueta de antes de un gesto lateral seco);
 *  - la evaluación del click sobre muestras de la trayectoria (historial + predicción).
 * Mismas comparaciones y mismo orden de operaciones que tenía Simulation (V0.2): el modo local no cambia.
 */
import type { GameConfig } from './config.ts';
import { classifyHit, type HitEvaluation, measureClosestApproach } from './hit.ts';
import type { PathSample, PhysicsEnv } from './physics.ts';
import type { Side } from './types.ts';

/** Muestra de la raqueta en un tick: instante (ms), velocidad (m/s reales) y posición (mundo). */
export interface PaddleSample {
  t: number;
  v: number;
  x: number;
  z: number;
}

/** Velocidades de la raqueta en [fire − aimSettleFromMs, fire − aimSettleToMs], en orden. Reutiliza `out`. */
export function settleSpeeds(hist: readonly PaddleSample[], fire: number, cfg: GameConfig, out: number[] = []): number[] {
  const sc = cfg.shot;
  out.length = 0;
  for (const h of hist) if (h.t >= fire - sc.aimSettleFromMs && h.t <= fire - sc.aimSettleToMs) out.push(h.v);
  return out;
}

/** Última muestra con t ≤ fire − aimSettleToMs: la raqueta «de antes del gesto», o null si no hay. */
export function settleRef(hist: readonly PaddleSample[], fire: number, cfg: GameConfig): { x: number; z: number } | null {
  const tRef = fire - cfg.shot.aimSettleToMs;
  let ref: { x: number; z: number } | null = null;
  for (const h of hist) if (h.t <= tRef) ref = { x: h.x, z: h.z };
  return ref;
}

/**
 * Puntería solo si estás colocado: velocidad máxima de la raqueta antes de la ventana del gesto.
 * Persiguiendo la bola → 0 (sale recta y con la mitad de potencia); quieta → 1 (el gesto lateral apunta).
 */
export function aimFactorFromSpeeds(speeds: readonly number[], cfg: GameConfig): number {
  const sc = cfg.shot;
  let vmax = 0;
  for (const v of speeds) if (v > vmax) vmax = v;
  const f = (sc.aimChasingSpeed - vmax) / (sc.aimChasingSpeed - sc.aimSettledSpeed);
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/**
 * Posición de la raqueta con la que se mide el golpe. Si estabas colocado y el gesto LATERAL es un golpe seco
 * (por encima de la zona muerta), el gesto es swing, no recolocación: se usa la raqueta de antes del gesto
 * (`ref`), mezclada según lo colocado que estuvieras. Así cruzar no cuesta posición; su riesgo está en el ángulo
 * (shot.ts). `swingVx` es el gesto efectivo (ya × aimFactor).
 */
export function fixedHitPos(
  pad: { x: number; z: number },
  ref: { x: number; z: number } | null,
  swingVx: number,
  aimFactor: number,
  cfg: GameConfig,
): { x: number; z: number } {
  const mag = swingVx < 0 ? -swingVx : swingVx;
  if (aimFactor <= 0 || mag <= cfg.shot.aimSwingDeadZone) return { x: pad.x, z: pad.z };
  if (!ref) return { x: pad.x, z: pad.z };
  return { x: pad.x + (ref.x - pad.x) * aimFactor, z: pad.z + (ref.z - pad.z) * aimFactor };
}

/**
 * Evalúa un click sobre muestras de la trayectoria (se usan las de ±searchWindowMs alrededor del click). En el saque
 * la altura del sweet spot es fija y solo cuenta la bola bajando; en el rally la altura es automática y solo cuentan
 * las muestras en el campo de quien golpea.
 */
export function evaluateClickSamples(
  samples: readonly PathSample[],
  side: Side,
  fire: number,
  paddlePos: { x: number; z: number },
  serve: boolean,
  cfg: GameConfig,
  env: PhysicsEnv,
): HitEvaluation | null {
  const near = samples.filter((p) => Math.abs(p.t - fire) <= cfg.hit.searchWindowMs);
  const m = measureClosestApproach({
    samples: near,
    sweet: { x: paddlePos.x, y: serve ? env.tableTop + cfg.serve.idealContactHeight : 0, z: paddlePos.z },
    weightY: serve ? 1 : 0,
    side,
    tClick: fire,
    paddleRadius: cfg.paddle.radius,
    reachMinY: env.tableTop + cfg.paddle.minReachHeight,
    reachMaxY: env.tableTop + cfg.paddle.maxReachHeight,
    ownSideOnly: !serve,
    descendingOnly: serve,
  });
  return m ? classifyHit(m, cfg.hit) : null;
}
