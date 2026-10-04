import { describe, expect, it } from 'vitest';
import { makeConfig, tickMs } from '../../src/config.ts';
import { neutralIntent } from '../../src/types.ts';
import { ClientMatch } from '../../src/net/client-match.ts';
import type { C2S, S2C } from '../../src/net/protocol.ts';
import { runNetworkMatch } from './harness.ts';

const cfg = makeConfig();
const tick = tickMs(cfg);

describe('ClientMatch: predicción, reloj de vuelo y correcciones', () => {
  it('si el servidor corrige el estado de salida de tu golpe, se adopta sin salto visible', () => {
    let tampered = false;
    const marks: { side: 0 | 1 }[] = [];
    const net = runNetworkMatch({
      cfg,
      seeds: [7, 8],
      ping: [100, 100],
      jitter: 0,
      maxTicks: 120 * 20,
      tamper: (msg, to) => {
        if (tampered || msg.k !== 'fl' || msg.p !== to || msg.f < 2) return msg;
        tampered = true;
        marks.push({ side: to });
        return { ...msg, s: msg.s.map((v, i) => (i === 3 ? v + 0.6 : v)) };
      },
    });
    expect(tampered).toBe(true);
    const side = marks[0].side;
    const c = net.clients[side];
    expect(c.stats.corrections).toBeGreaterThanOrEqual(1);
    expect(c.stats.correctionKinds[0]).toBe('exit');
  });

  it('el salto por una corrección se funde en varios ticks', () => {
    // Corrección grande (+1.5 m/s lateral): lo que la bola dibujada se desplaza por tick de más respecto a su propio
    // movimiento se queda en unos centímetros (se funde en blendMs).
    let done = false;
    const net = runNetworkMatch({
      cfg,
      seeds: [7, 8],
      ping: [150, 150],
      jitter: 0,
      maxTicks: 120 * 20,
      tamper: (msg, to) => {
        if (done || msg.k !== 'fl' || msg.p !== to || msg.f < 2 || to !== 0) return msg;
        done = true;
        return { ...msg, s: msg.s.map((v, i) => (i === 3 ? v + 1.5 : v)) };
      },
    });
    expect(done).toBe(true);
    expect(net.clients[0].stats.corrections).toBeGreaterThanOrEqual(1);
    expect(net.clients[0].stats.maxRenderJump).toBeLessThan(0.05);
  });

  it('un golpe que el servidor rechaza acaba en punto con su marcador', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    c.receive({ k: 'start', fs: 0 }, 0);
    c.step(neutralIntent(1.6)); // el inicio se aplica en el primer tick
    // Lanzar la bola.
    const toss = neutralIntent(1.6);
    toss.fire = c.now + 4;
    c.step(toss);
    expect(c.state.phase).toBe('serveToss');
    // Click cuando la bola baja por la altura ideal (sin mover la raqueta).
    const yIdeal = cfg.world.tableHeight + cfg.serve.idealContactHeight;
    let fired = false;
    for (let i = 0; i < 200 && !fired; i++) {
      const it = neutralIntent(1.6);
      const b = c.state.ball;
      if (b.vel.y < 0 && b.pos.y < yIdeal + 0.03) {
        it.fire = c.now + tick * 0.5;
        fired = true;
      }
      c.step(it);
    }
    expect(sent.some((m) => m.k === 'hit')).toBe(true);
    for (let i = 0; i < 30; i++) c.step(neutralIntent(1.6));
    expect(c.state.rally.lastHitter).toBe(0);
    const reject: S2C = { k: 'pt', n: 0, f: 0, i: 200, w: 1, r: 'TOSS_MISSED', sc: [0, 1], ns: 0, go: -1 };
    c.receive(reject, c.now);
    c.step(neutralIntent(1.6));
    expect(c.state.phase).toBe('pointOver');
    expect(c.state.score).toEqual([0, 1]);
    expect(c.stats.correctionKinds).toContain('rejected');
  });

  it('con ping 150 la bola que se aleja se frena entre un 15 y un 45 % de media y nunca por debajo del límite', () => {
    const net = runNetworkMatch({ cfg, seeds: [7, 8], ping: [150, 150], jitter: 0.1, maxTicks: 120 * 60 });
    for (const c of net.clients) {
      expect(c.stats.brakes.flights).toBeGreaterThan(10);
      expect(c.stats.brakes.meanSlowdown).toBeGreaterThan(0.15);
      expect(c.stats.brakes.meanSlowdown).toBeLessThan(0.45);
      expect(c.stats.brakes.maxSlowdown).toBeLessThanOrEqual(1 - cfg.net.brake.minSpeed + 1e-9);
    }
  });

  it('el golpe propio sale en su tick de contacto, como en local, sin esperar a la red', () => {
    const net = runNetworkMatch({ cfg, seeds: [7, 8], ping: [150, 150], jitter: 0.1, maxTicks: 120 * 60 });
    let n = 0;
    for (const side of [0, 1] as const) {
      const ev = net.events[side];
      for (let k = 0; k < ev.length; k++) {
        const s = ev[k].e;
        if (s.type !== 'swing' || s.player !== side) continue;
        const hit = ev.slice(k + 1).find((x) => (x.e.type === 'hit' || x.e.type === 'point' || x.e.type === 'let') && (x.e.type !== 'hit' || x.e.player === side));
        if (!hit || hit.e.type !== 'hit') continue;
        expect(hit.t).toBeGreaterThanOrEqual(s.contactMs - 1e-6);
        expect(hit.t - tick).toBeLessThan(s.contactMs);
        n++;
      }
    }
    expect(n).toBeGreaterThan(20);
  });
});
