/**
 * Las cuentas de un partido de la sala (V0.4) [§9.3, §10.3, §14.3]: quién sacó primero (sorteo), el game en curso, los
 * games ganados, los registros de las autoridades de sus games (sin warm-up) y, al acabar, el `mend` (estadísticas y
 * rechazos) y la fila del registro de la sala. Puro.
 */
import type { GameConfig, MatchMode } from '../config.ts';
import type { Side } from '../types.ts';
import { firstServerOfGame, matchWinner } from './match.ts';
import { matchRejections, matchStats } from './match-stats.ts';
import type { MatchEndMsg } from './protocol.ts';
import type { MatchRecord } from './server-match.ts';

export interface MatchRow {
  mode: MatchMode;
  firstServer: Side;
  winner: Side;
  why: 'score' | 'abandon';
  games: { winner: Side; score: [number, number]; firstServer: Side }[];
}

export class MatchTally {
  /** Primer saque del partido (sorteo). */
  readonly first: Side;
  /** Game en curso (1, 2, 3…). */
  game = 1;
  readonly gw: [number, number] = [0, 0];
  private readonly mode: MatchMode;
  private readonly cfg: GameConfig;
  private readonly records: MatchRecord[] = [];
  private readonly games: MatchRow['games'] = [];

  constructor(first: Side, mode: MatchMode, cfg: GameConfig) {
    this.first = first;
    this.mode = mode;
    this.cfg = cfg;
  }

  /** Quién saca primero en el game en curso: el del partido en los impares, el otro en los pares (§9.3). */
  get firstServer(): Side {
    return firstServerOfGame(this.first, this.game);
  }

  /** El registro de la autoridad del game en curso (cuenta para las estadísticas, aunque no llegue a acabar). */
  addGame(record: MatchRecord): void {
    this.records.push(record);
  }

  /** Acabó el game en curso: devuelve el ganador del partido, o null si sigue. */
  gameOver(winner: Side, score: [number, number]): Side | null {
    this.gw[winner] += 1;
    this.games.push({ winner, score: [score[0], score[1]], firstServer: this.firstServer });
    return matchWinner(this.gw, this.mode, this.cfg);
  }

  /** El `mend` para los dos y la fila del registro de la sala. */
  finish(winner: Side, why: 'score' | 'abandon'): { mend: MatchEndMsg; row: MatchRow } {
    const r = this.records;
    return {
      mend: { k: 'mend', w: winner, why, gw: [this.gw[0], this.gw[1]], st: [matchStats(r, 0), matchStats(r, 1)], rj: matchRejections(r) },
      row: { mode: this.mode, firstServer: this.first, winner, why, games: this.games },
    };
  }
}
