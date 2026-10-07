/**
 * Partido por games (V0.4) [§10.2, §10.3, §9.3]: cuántos games hacen falta según el modo, quién gana el partido y quién
 * saca primero en cada game. Puro: lo usan la sala y sus tests.
 */
import type { GameConfig, MatchMode } from '../config.ts';
import type { Side } from '../types.ts';

/** Games que hay que ganar para llevarse el partido (Rápido 1, Estándar 2, Completo 3). */
export function gamesToWin(mode: MatchMode, cfg: GameConfig): number {
  return cfg.room.gamesToWin[mode];
}

/** Ganador del partido con los games ganados `gw`, o null si sigue. */
export function matchWinner(gw: [number, number], mode: MatchMode, cfg: GameConfig): Side | null {
  const need = gamesToWin(mode, cfg);
  if (gw[0] >= need) return 0;
  if (gw[1] >= need) return 1;
  return null;
}

/** Quién saca primero en el game g (1, 2, 3…): el del partido en los impares, el otro en los pares (§9.3). */
export function firstServerOfGame(matchFirst: Side, game: number): Side {
  if (game % 2 === 1) return matchFirst;
  return matchFirst === 0 ? 1 : 0;
}
