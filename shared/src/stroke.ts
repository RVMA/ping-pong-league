/**
 * Teclas → tipo de golpe y calidad → potencia (V0.2b, decisión del autor 2026-10-02; cambia §3.3 ✅ y §4.6–§4.7).
 *
 * El tipo de golpe se elige con teclas mantenidas en el instante del click (`InputIntent.modifiers`, §3.1):
 * Q = slice, W = topspin, E = smash; click sin tecla = golpe normal; Space = bloqueo (§8, sin cambios). El ratón
 * solo mueve la raqueta, hace click y cruza la bola con el gesto lateral de V0.1 (§4.5 ✅).
 * La potencia ya no sale de la velocidad de un gesto: sale de la CALIDAD del golpe (se premia el PERFECT) y se
 * reduce a la mitad si llegas persiguiendo la bola (regla de «colocado», que ya no decide el tipo).
 */
import type { GameConfig } from './config.ts';
import type { QualityTier } from './hit.ts';
import type { ShotTargets } from './shot.ts';
import type { ShotKeys } from './types.ts';

/** Tipos de golpe. BLOCK no sale de las teclas de golpe: es el click con Space mantenido (§8). */
export type ShotType = 'NORMAL' | 'TOPSPIN' | 'SLICE' | 'SMASH' | 'BLOCK';
/** Golpes activos (los que se eligen con teclas o sin ellas). */
export type StrokeType = Exclude<ShotType, 'BLOCK'>;
/** Etiqueta de la potencia: completo (PERFECT), reducido (GOOD o persiguiendo), flojo (débil). */
export type PowerLevel = 'FULL' | 'REDUCED' | 'WEAK';
/** Por qué un golpe salió distinto de lo pedido (además de la calidad). */
export type StrokeNote = 'CHASING' | 'SMASH_LOW';

/**
 * Tipo de golpe según las teclas mantenidas al hacer click. Con varias a la vez manda una prioridad fija
 * (smash > topspin > slice): el smash es el golpe más situacional y nunca se pulsa «sin querer».
 */
export function shotFromKeys(keys: ShotKeys | undefined): StrokeType {
  if (!keys) return 'NORMAL';
  if (keys.smash) return 'SMASH';
  if (keys.topspin) return 'TOPSPIN';
  if (keys.slice) return 'SLICE';
  return 'NORMAL';
}

/**
 * Potencia 0..1 de un golpe activo: la de su calidad (PERFECT completo, GOOD reducido, débil flojo) × el factor de
 * «colocado» (persiguiendo la bola, la mitad). El golpe normal no tiene potencia.
 */
export function strokePower(type: StrokeType, tier: QualityTier, aimFactor: number, cfg: GameConfig): number {
  if (type === 'NORMAL') return 0;
  const st = cfg.shotTypes;
  const q = tier === 'PERFECT' ? st.powerByTier.PERFECT : tier === 'GOOD' ? st.powerByTier.GOOD : st.powerByTier.WEAK;
  const a = aimFactor <= 0 ? 0 : aimFactor >= 1 ? 1 : aimFactor;
  return q * (st.chasingPower + (1 - st.chasingPower) * a);
}

export function powerLevel(power: number, cfg: GameConfig): PowerLevel {
  const l = cfg.shotTypes.powerLevels;
  return power >= l.full ? 'FULL' : power >= l.reduced ? 'REDUCED' : 'WEAK';
}

/**
 * Qué salió de un golpe, para el texto junto a la raqueta: la potencia (null en el normal y el bloqueo) y por qué
 * salió distinto de lo pedido: persiguiendo (potencia reducida) o smash con la bola baja (va a la red).
 */
export function describeStroke(t: ShotTargets, aimFactor: number, cfg: GameConfig): { level: PowerLevel | null; notes: StrokeNote[] } {
  const notes: StrokeNote[] = [];
  if (t.serve || t.type === 'NORMAL' || t.type === 'BLOCK') return { level: null, notes };
  if ((1 - cfg.shotTypes.chasingPower) * (1 - aimFactor) > 0.05) notes.push('CHASING');
  if (t.type === 'SMASH' && t.aboveTape < cfg.shotTypes.smash.minAboveTape) notes.push('SMASH_LOW');
  return { level: powerLevel(t.power, cfg), notes };
}
