import { describe, expect, it } from 'vitest';
import { makeConfig, tickMs } from '../../src/config.ts';
import { neutralIntent } from '../../src/types.ts';
import { makeEnv, type BallState } from '../../src/physics.ts';
import { newRally } from '../../src/rules.ts';
import { simDt } from '../../src/config.ts';
import { ClientMatch } from '../../src/net/client-match.ts';
import { Flight } from '../../src/net/flight.ts';
import { type C2S, exitToWire, hitToWire, quantizeHit, type S2C } from '../../src/net/protocol.ts';
import { resolveHit } from '../../src/net/resolve.ts';
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

  it('una volea propia que el servidor confirma antes de mi contacto no es una corrección', () => {
    const env = makeEnv(cfg);
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 1, (m) => sent.push(m));
    c.receive({ k: 'start', fs: 0 }, 0);
    c.step(neutralIntent(1.6));
    // El rival (lado 0) lanza y saca un PERFECT.
    c.receive({ k: 'toss', n: 0, x: 0, z: 1600, a: 0 }, c.now);
    c.step(neutralIntent(1.6));
    const tossExit: BallState = { pos: { x: 0, y: cfg.world.tableHeight + cfg.serve.holdHeight, z: 1.6 }, vel: { x: 0, y: cfg.serve.tossSpeed, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
    const toss = new Flight(cfg, env, tossExit, 'toss', 0, newRally());
    const yIdeal = cfg.world.tableHeight + cfg.serve.idealContactHeight;
    let ideal = 0;
    for (let i = 1; i < toss.end.i && !ideal; i++) if (toss.y(i - 1) >= yIdeal && toss.y(i) < yIdeal) ideal = i * tick;
    const serveIn = quantizeHit({ t: ideal, pad: { x: 0, z: 1.6 }, swingVx: 0, keys: {}, block: false, speeds: [], ref: null }, cfg);
    const r = resolveHit(toss, 0, serveIn, cfg, env, simDt(cfg));
    if (r.kind !== 'hit' || !r.hit.exit) throw new Error('saque');
    c.receive({ k: 'fl', n: 0, f: 1, p: 0, j: r.hit.j, h: hitToWire(serveIn, cfg), s: exitToWire(r.hit.exit) }, c.now);
    for (let k = 0; k < 120 && c.state.rally.lastHitter !== 0; k++) c.step(neutralIntent(1.6));
    expect(c.state.phase).toBe('rally');
    // Punto del saque en mi campo antes de botar en él (z ≤ −0.85): ahí pongo la raqueta y hago click 40 ms antes.
    const serve = new Flight(cfg, env, r.hit.exit, 'rally', 0, { lastHitter: 0, isServe: true, bounces: [], netTouched: false, hits: 1 });
    let vi = 0;
    for (let i = 1; i < serve.end.i && !vi; i++) {
      const bouncedMine = [...Array(i + 1).keys()].some((k) => serve.contactsAt(k).some((x) => x.kind === 'table' && x.side === 1));
      if (!bouncedMine && serve.z(i) <= -0.85) vi = i;
    }
    expect(vi).toBeGreaterThan(0);
    const T0 = c.now - (c as unknown as { stepIdx: number }).stepIdx * tick;
    const target = { x: -serve.x(vi), z: -serve.z(vi) };
    const clickAt = T0 + vi * tick - 40;
    while (c.now + tick < clickAt) {
      const it = neutralIntent(1.6);
      it.target = target;
      c.step(it);
    }
    const it = neutralIntent(1.6);
    it.target = target;
    it.fire = clickAt;
    c.stepInput(it);
    c.stepWorld();
    const hit = sent.filter((m) => m.k === 'hit').at(-1);
    expect(hit).toBeDefined();
    // El servidor decide la volea al recibir el golpe y su punto llega antes de mi tick de contacto.
    const j = (c as unknown as { myHit: { hit: { j: number; foul: unknown } } }).myHit.hit;
    expect(j.foul).toEqual({ kind: 'point', winner: 0, reason: 'VOLLEY' });
    c.receive({ k: 'pt', n: 0, f: 1, i: j.j + 1, w: 0, r: 'VOLLEY', sc: [1, 0], ns: 0, go: -1 }, c.now);
    for (let k = 0; k < 30; k++) c.step(neutralIntent(1.6));
    expect(c.state.phase).toBe('pointOver');
    expect(c.state.score).toEqual([1, 0]);
    expect(c.stats.correctionKinds).toEqual([]);
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
