import { describe, expect, it } from 'vitest';
import { makeConfig, simDt, tickMs } from '../../src/config.ts';
import { type BallState, makeEnv } from '../../src/physics.ts';
import { newRally } from '../../src/rules.ts';
import type { Side } from '../../src/types.ts';
import { Flight, strikeRally } from '../../src/net/flight.ts';
import { type C2S, exitFromWire, exitToWire, type HitInput, type HitMsg, hitToWire, quantizeHit, type S2C } from '../../src/net/protocol.ts';
import { resolveHit } from '../../src/net/resolve.ts';
import { ServerMatch } from '../../src/net/server-match.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);
const tick = tickMs(cfg);
const TOSS_Z = 1.6;

function setup() {
  const sent: { to: Side; msg: S2C }[] = [];
  const server = new ServerMatch(cfg, { send: (to, msg) => sent.push({ to, msg }) });
  const take = () => sent.splice(0, sent.length);
  return { server, sent, take };
}

function tossFlight(side: Side, x: number): Flight {
  const sgn = side === 0 ? 1 : -1;
  const exit: BallState = { pos: { x, y: cfg.world.tableHeight + cfg.serve.holdHeight, z: TOSS_Z * sgn }, vel: { x: 0, y: cfg.serve.tossSpeed, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
  return new Flight(cfg, env, exit, 'toss', side, newRally());
}

/** Instante (ms del vuelo) en que la bola del lanzamiento pasa bajando por la altura ideal del saque. */
function idealServeMs(f: Flight): number {
  const y = cfg.world.tableHeight + cfg.serve.idealContactHeight;
  for (let i = 1; i < f.end.i; i++) if (f.y(i - 1) >= y && f.y(i) < y) return i * tick;
  throw new Error('sin cruce');
}

function serveInput(f: Flight, offsetMs: number, x: number, side: Side, swingVx = 0): HitInput {
  const sgn = side === 0 ? 1 : -1;
  return quantizeHit({ t: idealServeMs(f) + offsetMs, pad: { x, z: TOSS_Z * sgn }, swingVx, keys: {}, block: false, speeds: [], ref: null }, cfg);
}

function hitMsg(n: number, f: number, h: HitInput): HitMsg {
  return { k: 'hit', n, f, ...hitToWire(h, cfg) };
}

function tossMsg(n: number, x: number, side: Side): C2S {
  return { k: 'toss', n, x: x * 1000, z: TOSS_Z * 1000 * (side === 0 ? 1 : -1), a: 0 };
}

describe('ServerMatch: autoridad por eventos [§17.2, §17.3]', () => {
  it('start avisa a los dos y empieza sacando el lado 0', () => {
    const { server, take } = setup();
    server.start(0);
    expect(take()).toEqual([
      { to: 0, msg: { k: 'start', fs: 0 } },
      { to: 1, msg: { k: 'start', fs: 0 } },
    ]);
  });

  it('solo saca quien tiene el saque; el lanzamiento se reenvía al otro', () => {
    const { server, take } = setup();
    server.start(0);
    take();
    server.receive(1, tossMsg(0, 0.1, 1), 100);
    expect(take()).toEqual([]);
    expect(server.record.rejected.length).toBe(1);
    server.receive(0, tossMsg(0, 0.1, 0), 100);
    expect(take()).toEqual([{ to: 1, msg: tossMsg(0, 0.1, 0) }]);
  });

  it('un saque válido produce el vuelo oficial que predice quien golpea', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    take();
    const toss = tossFlight(0, 0.1);
    const input = serveInput(toss, 0, 0.1, 0);
    const r = resolveHit(toss, 0, input, cfg, env, dt);
    expect(r.kind).toBe('hit');
    if (r.kind !== 'hit') return;
    server.receive(0, hitMsg(0, 0, input), 1000 + input.t + 20);
    const out = take();
    const fl = out.find((o) => o.msg.k === 'fl');
    expect(fl).toBeDefined();
    expect(out.filter((o) => o.msg.k === 'fl').map((o) => o.to)).toEqual([0, 1]);
    if (fl?.msg.k !== 'fl') return;
    expect(fl.msg.f).toBe(1);
    expect(fl.msg.j).toBe(r.hit.j);
    expect(fl.msg.s).toEqual(exitToWire(r.hit.exit!));
    expect(server.record.hits).toHaveLength(1);
    expect(server.record.hitCpuMs).toHaveLength(1);
  });

  it('un saque a la red cierra el punto en el acto (el receptor no puede cambiarlo)', () => {
    const { server, take } = setup();
    server.start(0);
    const toss = tossFlight(0, 0);
    let found = false;
    // Pronto y cruzado a tope: el cruce resta margen sobre la red (§4.5) y la bola va a la malla.
    for (let off = -114; off <= -60 && !found; off++) {
      const input = serveInput(toss, off, 0, 0, 4);
      const r = resolveHit(toss, 0, input, cfg, env, dt);
      if (r.kind !== 'hit' || !r.hit.exit) continue;
      const next = new Flight(cfg, env, exitFromWire(exitToWire(r.hit.exit)), 'rally', 0, strikeRally(newRally(), 0, true));
      if (!next.certain) continue;
      found = true;
      server.receive(0, tossMsg(0, 0, 0), 1000);
      take();
      server.receive(0, hitMsg(0, 0, input), 1000 + input.t + 20);
      const pt = take().find((o) => o.msg.k === 'pt');
      expect(pt?.msg).toMatchObject({ k: 'pt', n: 0, f: 1, i: next.end.i, w: 1, sc: [0, 1] });
    }
    expect(found).toBe(true);
  });

  it('rechaza una raqueta que no pudo llegar y cierra el punto con el desenlace del vuelo', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    const toss = tossFlight(0, 0.1);
    const input = serveInput(toss, 0, 0.1, 0);
    server.receive(0, { k: 'p', n: 0, r: Math.round(input.t - 30), x: 500, z: 1600 }, 1000 + input.t);
    take();
    server.receive(0, hitMsg(0, 0, input), 1000 + input.t + 20);
    const out = take();
    expect(out.some((o) => o.msg.k === 'fl')).toBe(false);
    expect(out.find((o) => o.msg.k === 'pt')?.msg).toMatchObject({ w: 1, r: 'TOSS_MISSED', i: toss.end.i });
    expect(server.record.rejected.at(-1)?.why).toBe('reach');
  });

  it('la raqueta del golpe es la del tick en que se procesa el click: no se rechaza por ese tick', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    const toss = tossFlight(0, 0.1);
    // Click justo después de un tick: la raqueta del evento es la de ese tick siguiente (8.3 ms después).
    const k = Math.ceil(idealServeMs(toss) / tick);
    const input = quantizeHit({ t: k * tick + 0.3, pad: { x: 0.14, z: TOSS_Z }, swingVx: 0, keys: {}, block: false, speeds: [], ref: null }, cfg);
    // Su última muestra, en el tick anterior (r redondeado), 4 cm atrás: a 6 m/s da tiempo en 8.3 ms.
    server.receive(0, { k: 'p', n: 0, r: Math.floor(input.t), x: 100, z: 1600 }, 1000 + input.t);
    take();
    server.receive(0, hitMsg(0, 0, input), 1000 + input.t + 20);
    expect(server.record.rejected).toEqual([]);
    expect(take().some((o) => o.msg.k === 'fl')).toBe(true);
  });

  it('rechaza un click «en el futuro»', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    take();
    const input = serveInput(tossFlight(0, 0.1), 0, 0.1, 0);
    server.receive(0, hitMsg(0, 0, input), 1000 + input.t - 200);
    expect(take().some((o) => o.msg.k === 'fl')).toBe(false);
    expect(server.record.rejected.at(-1)?.why).toBe('time');
  });

  it('end del receptor cierra el punto; un segundo end se ignora', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    take();
    server.receive(0, { k: 'end', n: 0, f: 0 }, 2500);
    const pt = take().find((o) => o.msg.k === 'pt');
    expect(pt?.msg).toMatchObject({ k: 'pt', n: 0, f: 0, w: 1, r: 'TOSS_MISSED', sc: [0, 1], ns: 0, go: -1 });
    server.receive(0, { k: 'end', n: 0, f: 0 }, 2600);
    expect(take()).toEqual([]);
  });

  it('a 11 puntos termina el game; again empieza otro', () => {
    const { server, take } = setup();
    server.start(0);
    take();
    let now = 0;
    let n = 0;
    let srv: Side = 0;
    let go = -1;
    while (go < 0 && n < 60) {
      now += 3000;
      server.receive(srv, tossMsg(n, 0, srv), now);
      if (srv === 1) {
        server.receive(1, { k: 'end', n, f: 0 }, now + 1500);
      } else {
        const toss = tossFlight(0, 0);
        const input = serveInput(toss, 0, 0, 0);
        server.receive(0, hitMsg(n, 0, input), now + input.t + 20);
        server.receive(1, { k: 'end', n, f: 1 }, now + 2500);
      }
      const pt = take().find((o) => o.msg.k === 'pt');
      if (pt?.msg.k !== 'pt') throw new Error('sin punto');
      expect(pt.msg.w).toBe(0);
      srv = pt.msg.ns;
      go = pt.msg.go;
      n++;
    }
    expect(go).toBe(0);
    expect(server.record.winner).toBe(0);
    expect(server.over).toBe(true);
    server.receive(1, { k: 'again' }, now + 5000);
    expect(take()).toEqual([
      { to: 0, msg: { k: 'start', fs: 0 } },
      { to: 1, msg: { k: 'start', fs: 0 } },
    ]);
    expect(server.score).toEqual([0, 0]);
  });

  it('descarta mensajes de un rally pasado sin lanzar', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    server.receive(0, { k: 'end', n: 0, f: 0 }, 2500);
    take();
    expect(() => server.receive(0, { k: 'end', n: 0, f: 0 }, 2600)).not.toThrow();
    expect(() => server.receive(1, hitMsg(0, 1, serveInput(tossFlight(0, 0.1), 0, 0.1, 0)), 2600)).not.toThrow();
    expect(take()).toEqual([]);
  });

  it('ping → pong al momento y las medias de los dos', () => {
    const { server, take } = setup();
    server.receive(0, { k: 'ping', i: 3, t: 123.5, a: 98 }, 10);
    server.receive(1, { k: 'ping', i: 1, t: 50, a: -1 }, 11);
    expect(take()).toEqual([
      { to: 0, msg: { k: 'pong', i: 3, t: 123.5 } },
      { to: 0, msg: { k: 'pings', a: [98, -1] } },
      { to: 1, msg: { k: 'pings', a: [98, -1] } },
      { to: 1, msg: { k: 'pong', i: 1, t: 50 } },
    ]);
  });

  it('la raqueta se reenvía al rival (sin teclas)', () => {
    const { server, take } = setup();
    server.start(0);
    take();
    server.receive(0, { k: 'p', n: 0, r: -1, x: 100, z: 1600 }, 5);
    expect(take()).toEqual([{ to: 1, msg: { k: 'p', n: 0, r: -1, x: 100, z: 1600 } }]);
  });

  it('si el receptor calla, el respaldo cierra el punto', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    take();
    server.poll(2000);
    expect(take()).toEqual([]);
    server.poll(1000 + tossFlight(0, 0.1).end.i * tick + cfg.net.timers.fallbackMs + 10);
    expect(take().find((o) => o.msg.k === 'pt')?.msg).toMatchObject({ r: 'TOSS_MISSED', w: 1 });
  });
});
