import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../../src/hit.ts';
import { matchRejections, matchStats } from '../../src/net/match-stats.ts';
import type { MatchRecord } from '../../src/net/server-match.ts';
import type { PointReason } from '../../src/rules.ts';
import type { Side } from '../../src/types.ts';

type H = [n: number, f: number, player: Side, tier: QualityTier, serve?: boolean];
type P = [n: number, winner: Side | -1, reason: PointReason | 'LET'];

function rec(hits: H[], points: P[]): MatchRecord {
  return {
    hits: hits.map(([n, f, player, tier, serve]) => ({ n, f, player, tier, type: 'NORMAL', dtMs: 0, serve: serve ?? false })),
    points: points.map(([n, winner, reason]) => ({ n, winner, reason, score: [0, 0] as [number, number] })),
    rejected: [],
    ignored: [],
    hitCpuMs: [],
    winner: null,
  };
}

const P = 'PERFECT';
const G = 'GOOD';
const W = 'WEAK';

// Dos games con rallies numerados como en una sala (el n nunca se repite).
const game1 = rec(
  [
    [10, 0, 0, P, true],
    [10, 1, 1, G],
    [10, 2, 0, P],
    [10, 3, 1, P],
    [10, 4, 0, P],
    [11, 0, 1, P, true],
    [11, 1, 0, P],
    [11, 2, 1, P],
    [11, 3, 0, W],
    [11, 4, 1, P],
    [12, 0, 0, G, true],
    [12, 1, 1, P],
  ],
  [
    [10, 1, 'NET'],
    [11, 0, 'OUT'],
    [12, 0, 'NET'],
  ],
);
const game2 = rec(
  [
    [13, 0, 1, P, true],
    [13, 1, 0, P],
    [13, 2, 1, P],
    [13, 3, 0, P],
    [14, 0, 1, P, true],
  ],
  [
    [13, -1, 'LET'],
    [14, 0, 'NET'],
  ],
);

describe('matchStats: estadísticas del partido (Decisión 17)', () => {
  it('lado 0: pf, racha máxima, errores en la red y puntos', () => {
    // golpes: 3 + 2 + 1 + 2 = 8, PERFECT 3 + 1 + 0 + 2 = 6 → 75 %; racha 3 (rally 10; sin cortarla al acabar el punto serían 4)
    expect(matchStats([game1, game2], 0)).toEqual({ pf: 75, ms: 3, ne: 1, pts: 3 });
  });

  it('lado 1: pf redondeado, la racha se corta al acabar el punto, el let no cuenta', () => {
    // golpes: 2 + 3 + 1 + 2 + 1 = 9, PERFECT 8 → 88.9 → 89 %; racha 3 (rally 11); red en los rallies 12 y 14
    expect(matchStats([game1, game2], 1)).toEqual({ pf: 89, ms: 3, ne: 2, pts: 1 });
  });

  it('un golpe no PERFECT corta la racha dentro del rally', () => {
    const g = rec(
      [
        [5, 0, 0, P, true],
        [5, 1, 1, W],
        [5, 2, 0, G],
        [5, 4, 0, P],
        [5, 6, 0, P],
      ],
      [[5, 0, 'OUT']],
    );
    expect(matchStats([g], 0).ms).toBe(2);
  });

  it('la racha tampoco pasa de un game al siguiente', () => {
    const a = rec([[20, 0, 0, P, true], [20, 2, 0, P]], [[20, 0, 'OUT']]);
    const b = rec([[21, 0, 0, P, true]], [[21, 0, 'OUT']]);
    expect(matchStats([a, b], 0).ms).toBe(2);
  });

  it('sin golpes: 0 % y racha 0', () => {
    expect(matchStats([], 0)).toEqual({ pf: 0, ms: 0, ne: 0, pts: 0 });
    expect(matchStats([rec([], [[3, 1, 'TOSS_MISSED']])], 0)).toEqual({ pf: 0, ms: 0, ne: 0, pts: 0 });
    expect(matchStats([rec([], [[3, 1, 'TOSS_MISSED']])], 1)).toEqual({ pf: 0, ms: 0, ne: 0, pts: 1 });
  });
});

describe('matchRejections: rechazos del servidor por lado (rj)', () => {
  it('suma los rechazos de todos los games, sin los descartes que no son culpa del jugador', () => {
    const a = rec([], []);
    a.rejected.push({ from: 1, kind: 'hit', why: 'reach' }, { from: 0, kind: 'end', why: 'stale' });
    a.ignored.push({ from: 0, kind: 'toss', why: 'past' });
    const b = rec([], []);
    b.rejected.push({ from: 1, kind: 'toss', why: 'turn' });
    b.ignored.push({ from: 1, kind: 'hit', why: 'paused' });
    expect(matchRejections([a, b])).toEqual([1, 2]);
    expect(matchRejections([])).toEqual([0, 0]);
  });
});
