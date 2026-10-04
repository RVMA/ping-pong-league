import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot.ts';
import { aimFactorFromSpeeds, evaluateClickSamples, fixedHitPos, type PaddleSample, settleRef, settleSpeeds } from '../src/click.ts';
import { makeConfig, tickMs } from '../src/config.ts';
import { Simulation } from '../src/sim.ts';

const cfg = makeConfig();
const tick = tickMs(cfg);

/** Muestras de raqueta cada tick, con velocidad v(k) y posición x = k mm. */
function history(n: number, v: (k: number) => number): PaddleSample[] {
  return Array.from({ length: n }, (_, k) => ({ t: (k + 1) * tick, v: v(k), x: k / 1000, z: 1.6 }));
}

describe('factor de «colocado» a partir de las velocidades de la raqueta [§4.5]', () => {
  it('quieta → 1, persiguiendo → 0, en medio proporcional', () => {
    expect(aimFactorFromSpeeds([], cfg)).toBe(1);
    expect(aimFactorFromSpeeds([0.6], cfg)).toBe(1);
    expect(aimFactorFromSpeeds([1.6], cfg)).toBe(0);
    expect(aimFactorFromSpeeds([1.1], cfg)).toBeCloseTo(0.5, 12);
    expect(aimFactorFromSpeeds([0.2, 1.6, 0.3], cfg)).toBe(0);
  });

  it('solo cuenta la ventana [click − 270, click − 150] ms y la referencia es la última ≤ click − 150', () => {
    const hist = history(60, (k) => k);
    const fire = 60 * tick;
    const speeds = settleSpeeds(hist, fire, cfg);
    const inWindow = hist.filter((h) => h.t >= fire - 270 && h.t <= fire - 150);
    expect(speeds).toEqual(inWindow.map((h) => h.v));
    expect(speeds.length).toBeGreaterThan(10);
    const ref = settleRef(hist, fire, cfg)!;
    expect(ref.x).toBe(inWindow[inWindow.length - 1].x);
    expect(settleRef(history(5, () => 0), 5 * tick, cfg)).toBeNull();
  });
});

describe('posición fija del golpe [§4.2]', () => {
  const pad = { x: 0.1, z: 1.6 };
  const ref = { x: 0.3, z: 1.5 };
  it('un movimiento lento solo recoloca: se mide con la raqueta actual', () => {
    expect(fixedHitPos(pad, ref, 0.3, 1, cfg)).toEqual(pad);
  });
  it('un gesto seco estando colocado se mide con la raqueta de antes del gesto', () => {
    expect(fixedHitPos(pad, ref, 3, 1, cfg)).toEqual(ref);
    const half = fixedHitPos(pad, ref, -3, 0.5, cfg);
    expect(half.x).toBeCloseTo(0.2, 12);
    expect(half.z).toBeCloseTo(1.55, 12);
  });
  it('sin referencia o persiguiendo, la raqueta actual', () => {
    expect(fixedHitPos(pad, null, 3, 1, cfg)).toEqual(pad);
    expect(fixedHitPos(pad, ref, 3, 0, cfg)).toEqual(pad);
  });
});

describe('evaluación del click sobre muestras', () => {
  it('da exactamente lo mismo que Simulation.evaluateClick en un partido real', () => {
    const sim = new Simulation(cfg);
    const bots = [new Bot(0, cfg.bot.difficulties.medium, cfg, 3), new Bot(1, cfg.bot.difficulties.medium, cfg, 4)];
    let checked = 0;
    for (let i = 0; i < 120 * 90 && checked < 50; i++) {
      sim.step([bots[0].think(sim), bots[1].think(sim)]);
      const s = sim.state;
      if (s.phase !== 'rally' || s.rally.lastHitter === null || i % 7 !== 0) continue;
      const side = s.rally.lastHitter === 0 ? 1 : 0;
      const pad = { x: s.ball.pos.x + 0.03, z: s.ball.pos.z };
      for (const off of [-60, 0, 45]) {
        const fire = sim.now + off;
        const expected = sim.evaluateClick(side, fire, pad);
        expect(evaluateClickSamples(sim.sampleWindow(), side, fire, pad, false, cfg, sim.env)).toEqual(expected);
        if (expected) checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(50);
  });
});
