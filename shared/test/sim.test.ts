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

  it('el bot usa los cuatro golpes y el bloqueo (V0.2), y el difícil más que el fácil', () => {
    const count = (d: BotDifficulty) => {
      const { sim } = playGame(d, d, 21);
      const t = { NORMAL: 0, TOPSPIN: 0, SLICE: 0, SMASH: 0, BLOCK: 0 };
      for (const st of sim.state.stats) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += st.types[k];
      return t;
    };
    const medium = count('medium');
    for (const k of ['NORMAL', 'TOPSPIN', 'SLICE', 'SMASH', 'BLOCK'] as const) expect(medium[k], k).toBeGreaterThan(0);
    const easy = count('easy');
    const hard = count('hard');
    const special = (t: typeof easy) => (t.TOPSPIN + t.SLICE + t.SMASH) / (t.NORMAL + t.TOPSPIN + t.SLICE + t.SMASH + t.BLOCK);
    expect(special(hard)).toBeGreaterThan(special(easy));
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

describe('puntería solo si estás colocado (decisión del autor, 2026-10-01)', () => {
  const run = (targets: (i: number) => number, ticks: number) => {
    const sim = new Simulation(makeConfig());
    sim.state.phase = 'rally';
    for (let i = 0; i < ticks; i++) {
      const intent = neutralIntent(1.6);
      intent.target.x = targets(i);
      sim.step([intent, neutralIntent()]);
    }
    return sim;
  };

  it('raqueta quieta antes del gesto → puntería completa', () => {
    const sim = run(() => 0.2, 80);
    expect(sim.aimFactor(0, sim.now)).toBe(1);
  });

  it('persiguiendo la bola hasta el click → la bola sale recta', () => {
    // El objetivo salta de lado a lado: la raqueta va a toda velocidad.
    const sim = run((i) => (Math.floor(i / 20) % 2 === 0 ? -1.2 : 1.2), 80);
    expect(sim.aimFactor(0, sim.now)).toBe(0);
  });

  it('un gesto rápido solo en los últimos 150 ms no cuenta como perseguir', () => {
    // Quieta 60 ticks (500 ms) y luego un movimiento brusco en los últimos ~100 ms.
    const sim = run((i) => (i < 68 ? 0 : 0.8), 80);
    expect(sim.aimFactor(0, sim.now)).toBe(1);
  });

  it('los golpes registran el factor de puntería', () => {
    const { events } = playGame('medium', 'medium', 4, 120);
    const hits = events.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit');
    expect(hits.length).toBeGreaterThan(10);
    for (const h of hits) {
      expect(h.aimFactor).toBeGreaterThanOrEqual(0);
      expect(h.aimFactor).toBeLessThanOrEqual(1);
    }
  });
});

describe('saque simplificado: posición lateral', () => {
  it('quien saca no puede salirse del ancho de la mesa', () => {
    const sim = new Simulation(makeConfig());
    const intent = neutralIntent(1.6);
    intent.target.x = -1.3;
    for (let i = 0; i < 100; i++) sim.step([intent, neutralIntent()]);
    expect(Math.abs(sim.state.paddles[0].pos.x)).toBeLessThanOrEqual(sim.cfg.paddle.serveMaxLateral + 1e-6);
  });
});

describe('cruzar no cuesta posición si estabas colocado (playtest 2)', () => {
  const settleThenFlick = () => {
    const sim = new Simulation(makeConfig());
    sim.state.phase = 'rally';
    for (let i = 0; i < 64; i++) sim.step([neutralIntent(1.6), neutralIntent()]);
    // Golpe seco: el objetivo salta 15 cm en los últimos ~33 ms.
    for (let i = 0; i < 4; i++) {
      const intent = neutralIntent(1.6);
      intent.target.x = 0.15;
      sim.step([intent, neutralIntent()]);
    }
    return sim;
  };

  it('con un golpe seco, la posición se mide con la raqueta de antes del gesto', () => {
    const sim = settleThenFlick();
    const moved = sim.state.paddles[0].pos.x;
    expect(moved).toBeGreaterThan(0.01);
    const pos = sim.clickPaddlePos(0, sim.now, { vx: 3, vy: 0 }, sim.aimFactor(0, sim.now));
    expect(Math.abs(pos.x)).toBeLessThan(1e-6);
  });

  it('un movimiento lento (por debajo de la zona muerta) sí recoloca', () => {
    const sim = settleThenFlick();
    const pos = sim.clickPaddlePos(0, sim.now, { vx: 0.3, vy: 0 }, sim.aimFactor(0, sim.now));
    expect(pos.x).toBeCloseTo(sim.state.paddles[0].pos.x, 9);
  });

  it('persiguiendo la bola se usa la posición real', () => {
    const sim = settleThenFlick();
    expect(sim.clickPaddlePos(0, sim.now, { vx: 3, vy: 0 }, 0).x).toBeCloseTo(sim.state.paddles[0].pos.x, 9);
  });
});
