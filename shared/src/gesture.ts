/**
 * Gesto → tipo de golpe y potencia [§4.6, §4.7].
 *
 * El gesto es `InputIntent.swing` (alturas de pantalla por segundo, vy + = hacia la red) YA multiplicado por
 * el factor de "colocado" de la simulación: persiguiendo la bola el gesto se anula y el golpe es normal.
 */
import type { GameConfig } from './config.ts';

/** Tipos de golpe. BLOCK no sale del gesto: es el click con Space mantenido (§8). */
export type ShotType = 'NORMAL' | 'TOPSPIN' | 'SLICE' | 'SMASH' | 'BLOCK';

export interface GestureShot {
  type: Exclude<ShotType, 'BLOCK'>;
  /** 0..1: de la velocidad del gesto en el umbral a la de potencia máxima. */
  power: number;
}

function ramp(v: number, from: number, to: number): number {
  const f = (v - from) / (to - from);
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/** Clasifica un gesto (ya escalado por "colocado") por su dirección dominante. */
export function classifyGesture(swing: { vx: number; vy: number }, cfg: GameConfig): GestureShot {
  const t = cfg.shotTypes;
  const ax = swing.vx < 0 ? -swing.vx : swing.vx;
  const ay = swing.vy < 0 ? -swing.vy : swing.vy;
  if (ax >= ay) {
    if (ax >= t.sliceThreshold) return { type: 'SLICE', power: ramp(ax, t.sliceThreshold, t.sliceFullPower) };
    return { type: 'NORMAL', power: 0 };
  }
  if (swing.vy >= t.topspinThreshold) return { type: 'TOPSPIN', power: ramp(swing.vy, t.topspinThreshold, t.topspinFullPower) };
  if (-swing.vy >= t.smashThreshold) return { type: 'SMASH', power: ramp(-swing.vy, t.smashThreshold, t.smashFullPower) };
  return { type: 'NORMAL', power: 0 };
}
