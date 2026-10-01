import { describe, expect, it } from 'vitest';
import { Bot, type BotDifficulty, type InputIntent, makeConfig, neutralIntent, Simulation, type SimEvent } from '../src/index.ts';

function playGame(d0: BotDifficulty, d1: BotDifficulty, seed: number, maxSeconds = 1200) {
  const cfg = makeConfig();
  const sim = new Simulation(cfg);
  const bots = [new Bot(0, cfg.bot.difficulties[d0], cfg, seed), new Bot(1, cfg.bot.difficulties[d1], cfg, seed * 7 + 3)];
  const rallies: number[] = [];
  let hits = 0;
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSeconds * 120 && sim.state.phase !== 'gameOver'; i++) {
    for (const e of sim.step([bots[0].think(sim), bots[1].think(sim)])) {
      events.push(e);
      if (e.type === 'hit') hits++;
      if (e.type === 'point') {
        rallies.push(hits);
        hits = 0;
      }
      if (e.type === 'let') hits = 0;
    }
  }
  return { sim, rallies, events };
}

describe('simulación completa', () => {
  it('un game bot contra bot termina a 11 con 2 de diferencia para todas las dificultades', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const { sim } = playGame(d, d, 11);
      expect(sim.state.phase).toBe('gameOver');
      const [a, b] = sim.state.score;
      expect(Math.max(a, b)).toBeGreaterThanOrEqual(11);
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(2);
    }
  });

  it('bot medio contra medio: rallies de 6+ golpes son habituales', () => {
    const { rallies } = playGame('medium', 'medium', 5);
    const long = rallies.filter((n) => n >= 6).length;
    expect(long / rallies.length).toBeGreaterThan(0.3);
  });

  it('la dificultad importa: el bot difícil gana al fácil', () => {
    let hardWins = 0;
    for (const seed of [1, 2, 3]) {
      const { sim } = playGame('easy', 'hard', seed);
      if (sim.state.winner === 1) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(2);
  });

  it('es determinista: misma semilla → mismo partido', () => {
    const a = playGame('medium', 'hard', 42);
    const b = playGame('medium', 'hard', 42);
    expect(a.sim.state.score).toEqual(b.sim.state.score);
    expect(a.sim.state.tick).toBe(b.sim.state.tick);
    expect(a.sim.state.ball).toEqual(b.sim.state.ball);
  });

  it('las rachas de PERFECT suben de nivel y se rompen con el punto', () => {
    const { events } = playGame('hard', 'hard', 9);
    const streaks = events.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit');
    expect(Math.max(...streaks.map((e) => e.streak))).toBeGreaterThanOrEqual(2);
    for (const e of streaks) expect(e.streak > 0).toBe(e.tier === 'PERFECT');
  });
});

describe('whiff y recuperación [§4.4]', () => {
  it('hacer click sin parar no sirve: tras un whiff hay ~300 ms sin poder golpear', () => {
    const cfg = makeConfig();
    const sim = new Simulation(cfg);
    // Sacar inmediatamente con un click y luego spamear clicks cada 50 ms.
    const intents = (): [InputIntent, InputIntent] => [neutralIntent(), neutralIntent()];
    let i0 = intents();
    i0[0].fire = 1;
    sim.step(i0);
    const whiffs: number[] = [];
    let lastFire = 0;
    for (let i = 0; i < 40; i++) {
      i0 = intents();
      if (sim.now - lastFire >= 50) {
        lastFire = sim.now + 1;
        i0[0].fire = lastFire;
      }
      for (const e of sim.step(i0)) if (e.type === 'whiff' && e.player === 0) whiffs.push(sim.now);
    }
    expect(whiffs.length).toBeGreaterThanOrEqual(1);
    for (let k = 1; k < whiffs.length; k++) expect(whiffs[k] - whiffs[k - 1]).toBeGreaterThanOrEqual(cfg.hit.whiffLockoutMs);
  });
});

describe('saque simplificado [§9.1]', () => {
  it('la bola se lanza sola al cabo de ~1 s', () => {
    const cfg = makeConfig();
    const sim = new Simulation(cfg);
    let tossAt = -1;
    for (let i = 0; i < 200 && tossAt < 0; i++) {
      for (const e of sim.step([neutralIntent(), neutralIntent()])) if (e.type === 'toss') tossAt = sim.now;
    }
    expect(tossAt).toBeGreaterThanOrEqual(cfg.serve.autoTossMs);
    expect(tossAt).toBeLessThan(cfg.serve.autoTossMs + 20);
  });

  it('si nadie golpea el saque, punto para el receptor', () => {
    const sim = new Simulation(makeConfig());
    let point: SimEvent | undefined;
    for (let i = 0; i < 600 && !point; i++) for (const e of sim.step([neutralIntent(), neutralIntent()])) if (e.type === 'point') point = e;
    expect(point).toMatchObject({ type: 'point', winner: 1, reason: 'TOSS_MISSED' });
  });

  it('el lado 0 no puede moverse dentro de la mesa mientras saca', () => {
    const sim = new Simulation(makeConfig());
    const intent = neutralIntent(0.2);
    for (let i = 0; i < 100; i++) sim.step([intent, neutralIntent()]);
    expect(sim.state.paddles[0].pos.z).toBeGreaterThanOrEqual(sim.cfg.paddle.serveMinDepth - 1e-6);
  });
});
