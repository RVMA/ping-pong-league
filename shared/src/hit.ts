/**
 * Medición de precisión del golpe [§4.2] y clasificación de calidad.
 *
 * En el instante del click se busca el paso más cercano de la bola al sweet spot (t_ideal),
 * usando historial (pasado) y predicción determinista (futuro). De ahí salen:
 *  - TIMING: Δt = t_click − t_ideal, en ms de tiempo real.
 *  - POSICIÓN: distancia perpendicular bola–sweet spot en t_ideal, como fracción del radio.
 * Calidad final = la peor de las dos.
 */
import type { GameConfig } from './config.ts';
import type { PathSample } from './physics.ts';
import type { Side, Vec3 } from './types.ts';
import { sideSign } from './types.ts';

/** Niveles de calidad de peor a mejor. WEAK agrupa EARLY / LATE / borde (la fila "EARLY / LATE" de la tabla §4.2). */
export type QualityTier = 'WHIFF' | 'WEAK' | 'GOOD' | 'PERFECT';
export const TIER_RANK: Record<QualityTier, number> = { WHIFF: 0, WEAK: 1, GOOD: 2, PERFECT: 3 };

/** Causas legibles de que un golpe no sea PERFECT (base de las etiquetas "pronto"/"tarde"/"borde"). */
export type HitCause = 'EARLY' | 'LATE' | 'EDGE' | 'OUT_OF_REACH' | 'NO_BALL';

export interface HitMeasurement {
  /** t_click − t_ideal (ms). */
  dtMs: number;
  /** Distancia perpendicular en fracción del radio de la raqueta (incluye exceso de altura fuera de alcance). */
  posFrac: number;
  /** Desplazamiento lateral con signo en coordenadas del jugador (+ = la bola pasa por la derecha del sweet spot), en m. */
  lateral: number;
  /** Instante del paso más cercano (ms). */
  tIdeal: number;
  /** Posición de la bola en t_ideal. */
  ballAtIdeal: Vec3;
  /** Exceso vertical fuera del alcance automático (m), 0 si es alcanzable. */
  reachOverflow: number;
}

export interface HitEvaluation extends HitMeasurement {
  tier: QualityTier;
  timingTier: QualityTier;
  positionTier: QualityTier;
  causes: HitCause[];
}

type HitCfg = GameConfig['hit'];

export function classifyTiming(dtMs: number, hit: HitCfg): QualityTier {
  const a = Math.abs(dtMs);
  if (a <= hit.perfectMs) return 'PERFECT';
  if (a <= hit.goodMs) return 'GOOD';
  if (a <= hit.weakMs) return 'WEAK';
  return 'WHIFF';
}

export function classifyPosition(posFrac: number, hit: HitCfg): QualityTier {
  if (posFrac < hit.perfectPos) return 'PERFECT';
  if (posFrac < hit.goodPos) return 'GOOD';
  if (posFrac < hit.weakPos) return 'WEAK';
  return 'WHIFF';
}

/** Calidad final = la peor de timing y posición. */
export function worstTier(a: QualityTier, b: QualityTier): QualityTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

export function classifyHit(m: HitMeasurement, hit: HitCfg): HitEvaluation {
  const timingTier = classifyTiming(m.dtMs, hit);
  const positionTier = classifyPosition(m.posFrac, hit);
  const tier = worstTier(timingTier, positionTier);
  const causes: HitCause[] = [];
  if (timingTier !== 'PERFECT' && timingTier !== 'GOOD') causes.push(m.dtMs < 0 ? 'EARLY' : 'LATE');
  if (m.reachOverflow > 0 && positionTier === 'WHIFF') causes.push('OUT_OF_REACH');
  else if (m.posFrac >= hit.goodPos) causes.push('EDGE');
  return { ...m, tier, timingTier, positionTier, causes };
}

export interface ClosestApproachInput {
  /** Muestras ordenadas por tiempo (historial + predicción). */
  samples: PathSample[];
  /** Sweet spot en coordenadas del mundo. */
  sweet: Vec3;
  /** Peso del eje vertical en la distancia: 0 = altura automática (rally), 1 = altura fija (saque). */
  weightY: number;
  side: Side;
  tClick: number;
  paddleRadius: number;
  /** Rango vertical alcanzable (y del mundo). Solo se aplica con weightY = 0. */
  reachMinY: number;
  reachMaxY: number;
  /** Solo se consideran muestras en el campo de este jugador. */
  ownSideOnly: boolean;
}

/**
 * Busca el paso más cercano de la trayectoria al sweet spot (precisión sub-tick por proyección
 * sobre cada segmento entre muestras). Devuelve null si no hay bola en la ventana.
 */
export function measureClosestApproach(inp: ClosestApproachInput): HitMeasurement | null {
  const { samples, sweet, weightY, side } = inp;
  const sgn = sideSign(side);
  let best: { d2: number; t: number; x: number; y: number; z: number } | null = null;

  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (inp.ownSideOnly && (a.pos.z * sgn < 0 || b.pos.z * sgn < 0)) continue;
    const dx = b.pos.x - a.pos.x;
    const dy = (b.pos.y - a.pos.y) * weightY;
    const dz = b.pos.z - a.pos.z;
    const ex = sweet.x - a.pos.x;
    const ey = (sweet.y - a.pos.y) * weightY;
    const ez = sweet.z - a.pos.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    let f = len2 > 1e-14 ? (ex * dx + ey * dy + ez * dz) / len2 : 0;
    if (f < 0) f = 0;
    else if (f > 1) f = 1;
    const rx = a.pos.x + dx * f - sweet.x;
    const ry = (a.pos.y - sweet.y) * weightY + dy * f;
    const rz = a.pos.z + dz * f - sweet.z;
    const d2 = rx * rx + ry * ry + rz * rz;
    if (!best || d2 < best.d2) {
      best = {
        d2,
        t: a.t + (b.t - a.t) * f,
        x: a.pos.x + dx * f,
        y: a.pos.y + (b.pos.y - a.pos.y) * f,
        z: a.pos.z + dz * f,
      };
    }
  }
  if (!best) return null;

  let reachOverflow = 0;
  if (weightY === 0) {
    if (best.y < inp.reachMinY) reachOverflow = inp.reachMinY - best.y;
    else if (best.y > inp.reachMaxY) reachOverflow = best.y - inp.reachMaxY;
  }
  const dist = Math.sqrt(best.d2 + reachOverflow * reachOverflow);
  // Lateral con signo en coordenadas del jugador (derecha del jugador = +x para el lado 0).
  const lateral = (best.x - sweet.x) * sgn;
  return {
    dtMs: inp.tClick - best.t,
    posFrac: dist / inp.paddleRadius,
    lateral,
    tIdeal: best.t,
    ballAtIdeal: { x: best.x, y: best.y, z: best.z },
    reachOverflow,
  };
}
