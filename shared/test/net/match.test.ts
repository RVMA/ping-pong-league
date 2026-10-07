import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../src/config.ts';
import { firstServerOfGame, gamesToWin, matchWinner } from '../../src/net/match.ts';

const cfg = makeConfig();

describe('match.ts: modos y games del partido', () => {
  it('games para ganar el partido según el modo', () => {
    expect(gamesToWin('quick', cfg)).toBe(1);
    expect(gamesToWin('standard', cfg)).toBe(2);
    expect(gamesToWin('full', cfg)).toBe(3);
  });

  it('ganador del partido con los games ganados', () => {
    expect(matchWinner([2, 1], 'standard', cfg)).toBe(0);
    expect(matchWinner([1, 1], 'standard', cfg)).toBeNull();
    expect(matchWinner([1, 0], 'quick', cfg)).toBe(0);
    expect(matchWinner([0, 1], 'quick', cfg)).toBe(1);
    expect(matchWinner([2, 2], 'full', cfg)).toBeNull();
    expect(matchWinner([1, 3], 'full', cfg)).toBe(1);
    expect(matchWinner([0, 0], 'standard', cfg)).toBeNull();
  });

  it('el primer saque de cada game alterna: el del partido en los impares, el otro en los pares (§9.3)', () => {
    expect([1, 2, 3, 4].map((g) => firstServerOfGame(1, g))).toEqual([1, 0, 1, 0]);
    expect([1, 2, 3, 4, 5].map((g) => firstServerOfGame(0, g))).toEqual([0, 1, 0, 1, 0]);
  });
});
