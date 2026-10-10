import { describe, expect, it } from 'vitest';
import { Bot, type BotDifficultyConfig, makeConfig, Simulation } from '../src/index.ts';

// Devolución de la prueba de lectura (§13.1): «a veces una bola alta, para que el rival pueda hacer smash». Con
// `lateWeak`, el golpe débil del bot sale siempre TARDE (la curva de timing: más alta y lenta), nunca pronto (a la red).

const cfg = makeConfig();

/** Δt (ms) de los golpes del lado 0 (saques incluidos) contra un bot Normal, con un perfil de solo golpes débiles. */
function weakDts(lateWeak: boolean | undefined, seed: number): number[] {
  const base = cfg.bot.difficulties.hard;
  const allWeak: BotDifficultyConfig = { ...base, quality: { perfect: 0, good: 0, weak: 1, whiff: 0 }, ...(lateWeak === undefined ? {} : { lateWeak }) };
  const sim = new Simulation(cfg, { firstServer: 0 });
  const bots = [new Bot(0, allWeak, cfg, seed), new Bot(1, cfg.bot.difficulties.medium, cfg, seed * 7 + 3)];
  const dts: number[] = [];
  for (let i = 0; i < 240 * 120 && dts.length < 40 && sim.state.phase !== 'gameOver'; i++) {
    for (const e of sim.step([bots[0].think(sim), bots[1].think(sim)])) if (e.type === 'hit' && e.player === 0) dts.push(e.evaluation.dtMs);
  }
  return dts;
}

describe('bot: golpes débiles tarde (lateWeak)', () => {
  it('con lateWeak todos los débiles salen tarde (Δt > 0); sin él, también pronto', () => {
    const late = weakDts(true, 21);
    expect(late.length).toBeGreaterThanOrEqual(20);
    // La banda débil es de 65 a 110 ms; el tick (≈ 11 ms con gameSpeed 0.75) mueve algo la medida.
    for (const dt of late) expect(dt).toBeGreaterThan(40);
    const both = weakDts(undefined, 21);
    expect(both.some((dt) => dt < 0)).toBe(true);
    expect(both.some((dt) => dt > 0)).toBe(true);
  });
});
