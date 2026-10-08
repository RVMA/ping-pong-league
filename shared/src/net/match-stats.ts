/**
 * Estadísticas del partido (V0.4, Decisión 17 del plan) [§14.3, §5.1], a partir de los registros de las autoridades de
 * sus games (nunca las del warm-up, que también registran puntos), por jugador:
 *  - `pf`: % de sus golpes que fueron PERFECT (saques incluidos), redondeado;
 *  - `ms`: racha máxima de PERFECT consecutivos suyos dentro de un rally (la corta un golpe que no es PERFECT y el fin
 *    del punto);
 *  - `ne`: puntos que perdió con motivo `NET` (la bola de su golpe no pasó la red);
 *  - `pts`: puntos ganados (los let no son de nadie).
 * Y `rj`, los rechazos del servidor por lado (diagnóstico: deberían ser 0). Puro.
 */
import type { Side } from '../types.ts';
import type { PlayerStatsWire } from './protocol.ts';
import type { MatchRecord } from './server-match.ts';

/** Cota del protocolo para los contadores de las estadísticas. */
const MAX_COUNT = 999;

export function matchStats(games: readonly MatchRecord[], side: Side): PlayerStatsWire {
  let hits = 0;
  let perfect = 0;
  let streak = 0;
  let best = 0;
  let net = 0;
  let pts = 0;
  // El n de un rally no se repite en toda la sala: cambia de n = acabó el punto (también entre games).
  let n = -1;
  for (const g of games) {
    for (const h of g.hits) {
      if (h.player !== side) continue;
      if (h.n !== n) {
        n = h.n;
        streak = 0;
      }
      hits += 1;
      if (h.tier === 'PERFECT') {
        perfect += 1;
        streak += 1;
        if (streak > best) best = streak;
      } else streak = 0;
    }
    for (const p of g.points) {
      if (p.winner === side) pts += 1;
      else if (p.winner !== -1 && p.reason === 'NET') net += 1;
    }
  }
  return {
    pf: hits ? Math.round((perfect * 100) / hits) : 0,
    ms: Math.min(MAX_COUNT, best),
    ne: Math.min(MAX_COUNT, net),
    pts: Math.min(MAX_COUNT, pts),
  };
}

/** Rechazos del servidor por lado en esos games (`record.rejected`; lo ignorado sin culpa del jugador no cuenta). */
export function matchRejections(games: readonly MatchRecord[]): [number, number] {
  const rj: [number, number] = [0, 0];
  for (const g of games) for (const r of g.rejected) rj[r.from] += 1;
  return rj;
}
