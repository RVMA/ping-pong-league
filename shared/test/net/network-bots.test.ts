import { describe, expect, it } from 'vitest';
import { Bot } from '../../src/bot.ts';
import { makeConfig } from '../../src/config.ts';
import { Simulation, type SimEvent } from '../../src/sim.ts';
import { decodeC2S } from '../../src/net/protocol.ts';
import { runNetworkMatch } from './harness.ts';

const cfg = makeConfig();
const MAX = 120 * 60 * 8;

function runLocal(seeds: [number, number]): SimEvent[] {
  const sim = new Simulation(cfg);
  const bots = [new Bot(0, cfg.bot.difficulties.medium, cfg, seeds[0]), new Bot(1, cfg.bot.difficulties.medium, cfg, seeds[1])];
  const out: SimEvent[] = [];
  for (let i = 0; i < MAX && sim.state.phase !== 'gameOver'; i++) out.push(...sim.step([bots[0].think(sim), bots[1].think(sim)]));
  return out;
}

/** Lo discreto de un partido: golpes (quién, calidad, tipo), fallos (quién) y puntos (ganador, motivo, marcador). */
function summary(events: SimEvent[]) {
  return {
    hits: events.filter((e) => e.type === 'hit').map((e) => (e.type === 'hit' ? `${e.player}:${e.tier}:${e.serve ? 'SERVE' : e.targets.type}` : '')),
    whiffs: events.filter((e) => e.type === 'whiff').map((e) => (e.type === 'whiff' ? e.player : -1)),
    points: events.filter((e) => e.type === 'point' || e.type === 'let').map((e) => (e.type === 'point' ? `${e.winner}:${e.reason}:${e.score.join('-')}` : 'LET')),
    over: events.filter((e) => e.type === 'gameOver').map((e) => (e.type === 'gameOver' ? `${e.winner}:${e.score.join('-')}` : '')),
  };
}

describe('red en memoria: bots por la red', () => {
  for (const seeds of [
    [7, 8],
    [21, 22],
    [5, 3],
  ] as [number, number][]) {
    it(`con ping 0 es el mismo partido que en local (semillas ${seeds.join('/')})`, () => {
      const local = summary(runLocal(seeds));
      const net = runNetworkMatch({ cfg, seeds, ping: [0, 0], jitter: 0, maxTicks: MAX });
      expect(local.over).toHaveLength(1);
      for (const side of [0, 1] as const) {
        const view = summary(net.events[side].map((x) => x.e));
        expect(view.points).toEqual(local.points);
        expect(view.hits).toEqual(local.hits);
        expect(view.whiffs).toEqual(local.whiffs);
        expect(view.over).toEqual(local.over);
        expect(net.clients[side].stats.corrections).toBe(0);
      }
      expect(net.server.record.rejected).toEqual([]);
    });
  }

  for (const ping of [100, 150]) {
    it(`con ping ${ping} y ±10 % de variación: 0 discrepancias entre clientes y servidor`, () => {
      for (const seeds of [
        [7, 8],
        [11, 12],
      ] as [number, number][]) {
        const net = runNetworkMatch({ cfg, seeds, ping: [ping, ping], jitter: 0.1, maxTicks: MAX * 2 });
        expect(net.server.record.winner).not.toBeNull();
        expect(net.server.record.rejected).toEqual([]);
        for (const side of [0, 1] as const) {
          const c = net.clients[side];
          expect(c.stats.corrections, `correcciones del lado ${side}: ${c.stats.correctionKinds.join(', ')}`).toBe(0);
          expect(c.finished).toBe(true);
          const scores = net.events[side].filter((x) => x.e.type === 'point' || x.e.type === 'let').map((x) => (x.e.type === 'point' ? x.e.score.join('-') : null));
          const withLets = net.server.record.points.map((p) => (p.winner === -1 ? null : p.score.join('-')));
          expect(scores).toEqual(withLets);
          expect(c.stats.maxRenderJump, 'salto visible de la bola').toBeLessThan(0.03);
        }
      }
    });
  }

  it('regresión: casos que dieron discrepancias (vuelo seguro propio y raqueta medida un tick después del click)', () => {
    for (const [seeds, ping] of [
      [[815, 25266], 150],
      [[3845, 119196], 100],
    ] as [[number, number], number][]) {
      const net = runNetworkMatch({ cfg, seeds, ping: [ping, ping], jitter: 0.1, maxTicks: MAX * 2 });
      expect(net.server.record.rejected).toEqual([]);
      for (const c of net.clients) expect(c.stats.correctionKinds).toEqual([]);
    }
  });

  it('las teclas de golpe solo viajan dentro del golpe (§13)', () => {
    const net = runNetworkMatch({ cfg, seeds: [7, 8], ping: [100, 100], jitter: 0.1, maxTicks: 120 * 60 });
    let pads = 0;
    let hits = 0;
    for (const { text } of net.c2s) {
      const m = decodeC2S(text)!;
      if (m.k === 'p') {
        pads++;
        expect(Object.keys(m).sort()).toEqual(['k', 'n', 'r', 'x', 'z']);
      } else if (m.k === 'hit') hits++;
      else expect(text).not.toMatch(/"q"/);
    }
    expect(pads).toBeGreaterThan(1000);
    expect(hits).toBeGreaterThan(10);
  });

  it('es determinista: dos ejecuciones iguales envían los mismos mensajes', () => {
    const a = runNetworkMatch({ cfg, seeds: [3, 4], ping: [150, 50], jitter: 0.1, maxTicks: 120 * 40 });
    const b = runNetworkMatch({ cfg, seeds: [3, 4], ping: [150, 50], jitter: 0.1, maxTicks: 120 * 40 });
    expect(a.c2s).toEqual(b.c2s);
    expect(a.s2c).toEqual(b.s2c);
  });
});
