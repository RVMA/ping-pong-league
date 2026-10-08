import { describe, expect, it } from 'vitest';
import { makeConfig, simDt, tickMs } from '../../src/config.ts';
import { type BallState, makeEnv } from '../../src/physics.ts';
import { newRally, serverFor } from '../../src/rules.ts';
import type { Side } from '../../src/types.ts';
import { Flight, strikeRally } from '../../src/net/flight.ts';
import { type C2S, decodeS2C, exitFromWire, exitToWire, type HitInput, type HitMsg, hitToWire, type PointMsg, quantizeHit, type S2C } from '../../src/net/protocol.ts';
import { resolveHit } from '../../src/net/resolve.ts';
import { type GameStart, ServerMatch } from '../../src/net/server-match.ts';
import { runNetworkMatch } from './harness.ts';

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
      { to: 0, msg: { k: 'start', fs: 0, n: 0, wu: 0, g: 1, sc: [0, 0], ns: 0 } },
      { to: 1, msg: { k: 'start', fs: 0, n: 0, wu: 0, g: 1, sc: [0, 0], ns: 0 } },
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

  it('un golpe de quien no debe golpear se descarta sin cerrar el punto del otro', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    take();
    const input = serveInput(tossFlight(0, 0.1), 0, 0.1, 0);
    server.receive(1, hitMsg(0, 0, input), 1000 + input.t + 20);
    expect(take()).toEqual([]);
    expect(server.record.rejected.at(-1)).toMatchObject({ from: 1, why: 'turn' });
    // El que saca sigue pudiendo golpear su lanzamiento.
    server.receive(0, hitMsg(0, 0, input), 1000 + input.t + 25);
    expect(take().some((o) => o.msg.k === 'fl')).toBe(true);
  });

  it('rechaza un click «en el futuro»: más tarde de lo que pudo verse el vuelo que mandó el servidor', () => {
    const { server, take } = setup();
    server.start(0);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    const input = serveInput(tossFlight(0, 0.1), 0, 0.1, 0);
    const sent = 1000 + input.t + 20;
    server.receive(0, hitMsg(0, 0, input), sent);
    expect(take().filter((o) => o.msg.k === 'fl')).toHaveLength(2);
    // El saque salió del servidor en `sent`: un click a 300 ms de su vuelo que llega 100 ms después no pudo verse.
    const back = quantizeHit({ t: 300, pad: { x: 0, z: -1.6 }, swingVx: 0, keys: {}, block: false, speeds: [], ref: null }, cfg);
    server.receive(1, hitMsg(0, 1, back), sent + 100);
    expect(take().some((o) => o.msg.k === 'fl')).toBe(false);
    expect(server.record.rejected).toEqual([{ from: 1, kind: 'hit', why: 'time' }]);
  });

  it('un saque cuyo lanzamiento llegó tarde (pico de TCP, con el golpe justo detrás) no se rechaza: el lanzamiento lo empezó el cliente', () => {
    const { server, take } = setup();
    server.start(0);
    const input = serveInput(tossFlight(0, 0.1), 0, 0.1, 0);
    // El cliente lanzó en 1000 y golpeó en 1000 + t (ida 50 ms); el toss sufrió un pico de 300 ms y el golpe, sin pico,
    // llega detrás de él: al servidor le parece que entre los dos pasaron t − 300 ms.
    server.receive(0, tossMsg(0, 0.1, 0), 1000 + 50 + 300);
    take();
    server.receive(0, hitMsg(0, 0, input), 1000 + input.t + 50);
    expect(server.record.rejected).toEqual([]);
    expect(take().filter((o) => o.msg.k === 'fl')).toHaveLength(2);
    // Sigue sin poder golpear después del final del lanzamiento.
    const late = setup();
    late.server.start(0);
    late.server.receive(0, tossMsg(0, 0.1, 0), 1000);
    const toss = tossFlight(0, 0.1);
    const after = quantizeHit({ t: toss.end.i * tick + 5, pad: { x: 0.1, z: TOSS_Z }, swingVx: 0, keys: {}, block: false, speeds: [], ref: null }, cfg);
    late.server.receive(0, hitMsg(0, 0, after), 1000 + after.t + 50);
    expect(late.server.record.rejected).toEqual([{ from: 0, kind: 'hit', why: 'time' }]);
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
      { to: 0, msg: { k: 'start', fs: 0, n: 0, wu: 0, g: 1, sc: [0, 0], ns: 0 } },
      { to: 1, msg: { k: 'start', fs: 0, n: 0, wu: 0, g: 1, sc: [0, 0], ns: 0 } },
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

const other = (s: Side): Side => (s === 0 ? 1 : 0);
const GAME1: GameStart = { firstServer: 0, n0: 0, practice: false, game: 1 };
type Take = () => { to: Side; msg: S2C }[];

/**
 * Juega el rally `n` (saca `srv`) para que lo gane `winner`: si gana quien saca, saque bueno y el receptor avisa con
 * `end`; si no, el que saca deja caer su lanzamiento. Devuelve el `pt` que recibe el lado 0.
 */
function playPoint(server: ServerMatch, take: Take, srv: Side, winner: Side, n: number, now: number): PointMsg {
  server.receive(srv, tossMsg(n, 0, srv), now);
  if (winner === srv) {
    const input = serveInput(tossFlight(srv, 0), 0, 0, srv);
    server.receive(srv, hitMsg(n, 0, input), now + input.t + 20);
    server.receive(other(srv), { k: 'end', n, f: 1 }, now + 2500);
  } else {
    server.receive(srv, { k: 'end', n, f: 0 }, now + 1500);
  }
  const pt = take().find((o) => o.to === 0 && o.msg.k === 'pt');
  if (pt?.msg.k !== 'pt') throw new Error(`sin punto en el rally ${n}`);
  expect(pt.msg.w).toBe(winner);
  return pt.msg;
}

interface Cursor {
  srv: Side;
  n: number;
  now: number;
}

function playPoints(server: ServerMatch, take: Take, winners: Side[], from: Cursor): { at: Cursor; pts: PointMsg[] } {
  const at = { ...from };
  const pts: PointMsg[] = [];
  for (const w of winners) {
    const pm = playPoint(server, take, at.srv, w, at.n, at.now);
    pts.push(pm);
    at.srv = pm.ns;
    at.n += 1;
    at.now += 5000;
  }
  return { at, pts };
}

describe('ServerMatch como GameAuthority de una sala (V0.4)', () => {
  it('start con GameStart manda el start v2 con n0, game, marcador y saque', () => {
    const { server, take } = setup();
    server.start(0, { firstServer: 1, n0: 37, practice: false, game: 2 });
    expect(take()).toEqual([
      { to: 0, msg: { k: 'start', fs: 1, n: 37, wu: 0, g: 2, sc: [0, 0], ns: 1 } },
      { to: 1, msg: { k: 'start', fs: 1, n: 37, wu: 0, g: 2, sc: [0, 0], ns: 1 } },
    ]);
    expect(server.rally).toBe(37);
    expect(server.busy).toBe(false);
    expect(server.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    // Con marcador: saca quien diga el marcador (6-4 → el que no empezó), salvo que se indique otro.
    server.start(0, { firstServer: 0, n0: 50, practice: false, game: 3, score: [6, 4] });
    expect(take()[0].msg).toEqual({ k: 'start', fs: 0, n: 50, wu: 0, g: 3, sc: [6, 4], ns: serverFor([6, 4], 0, cfg.rules) });
    expect(server.score).toEqual([6, 4]);
    server.start(0, { firstServer: 0, n0: 51, practice: false, game: 3, score: [6, 4], server: 0 });
    expect(take()[0].msg).toMatchObject({ sc: [6, 4], ns: 0 });
    // Práctica: wu 1, game 0 y sin marcador.
    server.start(0, { firstServer: 1, n0: 60, practice: true, game: 0, score: [3, 3] });
    expect(take()[0].msg).toEqual({ k: 'start', fs: 1, n: 60, wu: 1, g: 0, sc: [0, 0], ns: 1 });
  });

  it('(c) n monótono: el primer toss válido es el del rally n0; lo de un rally anterior a n0 es pasado (ignorado, no rechazo)', () => {
    const { server, take } = setup();
    server.start(0, { firstServer: 0, n0: 37, practice: false, game: 1 });
    take();
    server.receive(0, tossMsg(0, 0, 0), 100);
    server.receive(0, tossMsg(36, 0, 0), 100);
    server.receive(1, { k: 'end', n: 36, f: 3 }, 100);
    expect(take()).toEqual([]);
    expect(server.record.ignored).toEqual([
      { from: 0, kind: 'toss', why: 'past' },
      { from: 0, kind: 'toss', why: 'past' },
      { from: 1, kind: 'end', why: 'past' },
    ]);
    server.receive(0, tossMsg(37, 0, 0), 1000);
    expect(take()).toEqual([{ to: 1, msg: tossMsg(37, 0, 0) }]);
    expect(server.busy).toBe(true);
    const input = serveInput(tossFlight(0, 0), 0, 0, 0);
    server.receive(0, hitMsg(36, 0, input), 1000 + input.t + 20);
    expect(take()).toEqual([]);
    expect(server.record.ignored.at(-1)).toEqual({ from: 0, kind: 'hit', why: 'past' });
    expect(server.record.rejected).toEqual([]);
    expect(server.busy).toBe(true);
    server.receive(0, hitMsg(37, 0, input), 1000 + input.t + 25);
    expect(take().find((o) => o.msg.k === 'fl')?.msg).toMatchObject({ n: 37, f: 1 });
    server.receive(1, { k: 'end', n: 37, f: 1 }, 4000);
    expect(take().find((o) => o.msg.k === 'pt')?.msg).toMatchObject({ n: 37, w: 0, sc: [1, 0] });
    expect(server.rally).toBe(38);
    expect(server.record.rejected).toEqual([]);
  });

  it('un mensaje tardío de un rally que acabó en punto en este game sí es un rechazo («stale»): es una discrepancia', () => {
    const { server, take } = setup();
    server.start(0, { firstServer: 0, n0: 37, practice: false, game: 1 });
    server.receive(0, tossMsg(37, 0.1, 0), 1000);
    take();
    // El respaldo cierra el punto y luego llega el `end` del que debía golpear.
    server.poll(1000 + tossFlight(0, 0.1).end.i * tick + cfg.net.timers.fallbackMs);
    expect(take().find((o) => o.msg.k === 'pt')?.msg).toMatchObject({ n: 37, r: 'TOSS_MISSED' });
    server.receive(0, { k: 'end', n: 37, f: 0 }, 5000);
    server.receive(0, tossMsg(37, 0.1, 0), 5000);
    expect(take()).toEqual([]);
    expect(server.record.rejected).toEqual([
      { from: 0, kind: 'end', why: 'stale' },
      { from: 0, kind: 'toss', why: 'stale' },
    ]);
    expect(server.record.ignored).toEqual([]);
  });

  it('rally es siempre el próximo n sin usar: con un vuelo en juego, el siguiente al suyo', () => {
    const { server, take } = setup();
    server.start(0, { firstServer: 0, n0: 37, practice: false, game: 1 });
    expect(server.rally).toBe(37);
    server.receive(0, tossMsg(37, 0, 0), 1000);
    expect(server.busy).toBe(true);
    expect(server.rally).toBe(38);
    const input = serveInput(tossFlight(0, 0), 0, 0, 0);
    server.receive(0, hitMsg(37, 0, input), 1000 + input.t + 20);
    expect(take().some((o) => o.msg.k === 'fl')).toBe(true);
    expect(server.busy).toBe(true);
    expect(server.rally).toBe(38);
    server.receive(1, { k: 'end', n: 37, f: 1 }, 4000);
    expect(server.busy).toBe(false);
    expect(server.rally).toBe(38);
    // Otra autoridad sembrada con él en mitad de un vuelo no reutiliza el rally en juego.
    server.receive(0, tossMsg(38, 0, 0), 9000);
    const next = setup();
    next.server.start(0, { firstServer: 0, n0: server.rally, practice: true, game: 0 });
    next.server.receive(0, tossMsg(38, 0, 0), 9100);
    expect(next.take().filter((o) => o.msg.k === 'toss')).toEqual([]);
    expect(next.server.record.ignored).toEqual([{ from: 0, kind: 'toss', why: 'past' }]);
  });

  it('(d) pause descarta toss/hit/end sin contarlos como rechazos; resume manda start con el marcador, el saque y el n siguiente', () => {
    const { server, take } = setup();
    server.start(0, GAME1);
    take();
    const { at } = playPoints(server, take, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0], { srv: 0, n: 0, now: 1000 });
    expect(server.score).toEqual([7, 5]);
    expect(server.rally).toBe(12);
    server.pause();
    // El rally 12 queda cortado: lo que llegue de él es pasado.
    expect(server.rally).toBe(13);
    expect(server.busy).toBe(false);
    const rejected = server.record.rejected.length;
    server.receive(at.srv, tossMsg(12, 0, at.srv), at.now);
    server.receive(at.srv, tossMsg(13, 0, at.srv), at.now + 10);
    server.receive(other(at.srv), { k: 'end', n: 12, f: 0 }, at.now + 20);
    server.receive(at.srv, hitMsg(13, 0, serveInput(tossFlight(at.srv, 0), 0, 0, at.srv)), at.now + 30);
    expect(take()).toEqual([]);
    expect(server.busy).toBe(false);
    expect(server.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    expect(server.record.rejected).toHaveLength(rejected);
    expect(server.record.ignored).toEqual([
      { from: at.srv, kind: 'toss', why: 'paused' },
      { from: at.srv, kind: 'toss', why: 'paused' },
      { from: other(at.srv), kind: 'end', why: 'paused' },
      { from: at.srv, kind: 'hit', why: 'paused' },
    ]);
    // La raqueta se sigue reenviando.
    server.receive(0, { k: 'p', n: 12, r: -1, x: 0, z: 1600 }, at.now + 40);
    expect(take()).toEqual([{ to: 1, msg: { k: 'p', n: 12, r: -1, x: 0, z: 1600 } }]);
    server.resume(at.now + 5000);
    const ns = serverFor([7, 5], 0, cfg.rules);
    expect(take()).toEqual([
      { to: 0, msg: { k: 'start', fs: 0, n: 13, wu: 0, g: 1, sc: [7, 5], ns } },
      { to: 1, msg: { k: 'start', fs: 0, n: 13, wu: 0, g: 1, sc: [7, 5], ns } },
    ]);
    // Un lanzamiento del rally cortado (12) que cruza el `start` es pasado: ignorado, no rechazo.
    server.receive(at.srv, tossMsg(12, 0, at.srv), at.now + 5010);
    expect(take()).toEqual([]);
    expect(server.record.ignored.at(-1)).toEqual({ from: at.srv, kind: 'toss', why: 'past' });
    expect(server.record.rejected).toHaveLength(rejected);
    // El juego sigue en el rally 13 desde 7-5.
    const pm = playPoint(server, take, ns, 1, 13, at.now + 6000);
    expect(pm).toMatchObject({ n: 13, sc: [7, 6], go: -1 });
    expect(server.rally).toBe(14);
    expect(server.record.rejected).toHaveLength(rejected);
  });

  it('pause en mitad de un vuelo lo corta sin punto; lo que llegue después de ese rally queda pasado', () => {
    const { server, take } = setup();
    const points: PointMsg[] = [];
    server.onPoint = (pm) => points.push(pm);
    server.start(0, { firstServer: 0, n0: 5, practice: true, game: 0 });
    server.receive(0, tossMsg(5, 0, 0), 1000);
    take();
    expect(server.busy).toBe(true);
    expect(server.rally).toBe(6);
    expect(server.nextDeadline()).toBeLessThan(Number.POSITIVE_INFINITY);
    server.pause();
    expect(server.busy).toBe(false);
    expect(server.rally).toBe(6);
    expect(server.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    server.poll(60000);
    server.receive(0, { k: 'end', n: 5, f: 0 }, 60000);
    expect(take()).toEqual([]);
    server.resume(61000);
    expect(take().map((o) => o.msg)).toEqual([
      { k: 'start', fs: 0, n: 6, wu: 1, g: 0, sc: [0, 0], ns: 0 },
      { k: 'start', fs: 0, n: 6, wu: 1, g: 0, sc: [0, 0], ns: 0 },
    ]);
    // Lo del rally cortado que cruza el `start` es pasado: se ignora, no es un rechazo.
    server.receive(0, { k: 'end', n: 5, f: 0 }, 61010);
    server.receive(0, tossMsg(5, 0, 0), 61020);
    expect(take()).toEqual([]);
    expect(server.record.ignored).toEqual([
      { from: 0, kind: 'end', why: 'paused' },
      { from: 0, kind: 'end', why: 'past' },
      { from: 0, kind: 'toss', why: 'past' },
    ]);
    expect(server.record.rejected).toEqual([]);
    expect(points).toEqual([]);
    expect(server.busy).toBe(false);
  });

  it('(e) receptor ausente: el punto se cierra en sentAt + end.i·tick con el desenlace del vuelo, sin los 3 s del respaldo', () => {
    const { server, take } = setup();
    server.start(0, GAME1);
    server.setPing(1, 120);
    server.receive(0, tossMsg(0, 0, 0), 1000);
    const input = serveInput(tossFlight(0, 0), 0, 0, 0);
    const sentAt = 1000 + input.t + 20;
    server.receive(0, hitMsg(0, 0, input), sentAt);
    const fl = take().find((o) => o.msg.k === 'fl');
    if (fl?.msg.k !== 'fl') throw new Error('sin vuelo');
    const next = new Flight(cfg, env, exitFromWire(fl.msg.s), 'rally', 0, strikeRally(newRally(), 0, true));
    const end = sentAt + next.end.i * tick;
    expect(server.nextDeadline()).toBe(end + 120 + cfg.net.timers.fallbackMs);
    server.setAbsent(1, true);
    expect(server.nextDeadline()).toBe(end);
    server.poll(end - 1);
    expect(take()).toEqual([]);
    expect(server.busy).toBe(true);
    server.poll(end);
    const outcome = next.end.outcome;
    if (outcome.kind !== 'point') throw new Error('el vuelo debía acabar en punto');
    expect(take().find((o) => o.msg.k === 'pt')?.msg).toEqual({ k: 'pt', n: 0, f: 1, i: next.end.i, w: outcome.winner, r: outcome.reason, sc: [1, 0], ns: 0, go: -1 });
    expect(server.busy).toBe(false);
    expect(server.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
  });

  it('(e) quien saca y se va tras lanzar pierde el punto al caer el lanzamiento; un mensaje que llega después ve el punto ya cerrado', () => {
    const { server, take } = setup();
    server.start(0, GAME1);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    take();
    server.setAbsent(0, true);
    const toss = tossFlight(0, 0.1);
    const end = 1000 + toss.end.i * tick;
    expect(server.nextDeadline()).toBe(end);
    // La raqueta del rival llega después del fin del vuelo y antes de que la sala llame a poll: el punto se cierra antes.
    server.receive(1, { k: 'p', n: 0, r: -1, x: 0, z: -1600 }, end + 5);
    expect(take().map((o) => o.msg.k)).toEqual(['pt', 'pt', 'p']);
    expect(server.record.points.at(-1)).toEqual({ n: 0, winner: 1, reason: 'TOSS_MISSED', score: [0, 1] });
    // Ausente desde antes del vuelo: el que le llega se cierra al acabar.
    server.setAbsent(0, false);
    server.setAbsent(1, true);
    server.receive(0, tossMsg(1, 0, 0), 10000);
    const input = serveInput(tossFlight(0, 0), 0, 0, 0);
    server.receive(0, hitMsg(1, 0, input), 10000 + input.t + 20);
    const fl = take().find((o) => o.msg.k === 'fl');
    if (fl?.msg.k !== 'fl') throw new Error('sin vuelo');
    const next = new Flight(cfg, env, exitFromWire(fl.msg.s), 'rally', 0, strikeRally(newRally(), 0, true));
    expect(server.nextDeadline()).toBe(10000 + input.t + 20 + next.end.i * tick);
  });

  it('(f) onPoint en cada punto y onGameOver una sola vez, a los 11 con 2 de diferencia', () => {
    const { server, take } = setup();
    const points: PointMsg[] = [];
    const overs: { w: Side; sc: [number, number] }[] = [];
    server.onPoint = (pm) => points.push(pm);
    server.onGameOver = (w, sc) => overs.push({ w, sc });
    server.start(0, { firstServer: 1, n0: 200, practice: false, game: 2 });
    take();
    const winners: Side[] = [];
    for (let k = 0; k < 10; k++) winners.push(0, 1);
    winners.push(0, 1, 0); // 11-10, 11-11, 12-11: aún sin ganador
    const { at, pts } = playPoints(server, take, winners, { srv: 1, n: 200, now: 1000 });
    expect(pts.every((p) => p.go === -1)).toBe(true);
    expect(overs).toEqual([]);
    expect(server.score).toEqual([12, 11]);
    const last = playPoint(server, take, at.srv, 0, at.n, at.now);
    expect(last).toMatchObject({ n: 223, sc: [13, 11], go: 0 });
    expect(overs).toEqual([{ w: 0, sc: [13, 11] }]);
    expect(points).toHaveLength(24);
    expect(points.map((p) => p.n)).toEqual(Array.from({ length: 24 }, (_, k) => 200 + k));
    expect(points.at(-1)).toEqual(last);
    expect(server.record.winner).toBe(0);
    expect(server.busy).toBe(false);
    // Tras el fin del game nada cuenta, y en una sala `again` no hace nada.
    server.receive(last.ns, tossMsg(224, 0, last.ns), at.now + 10000);
    server.receive(0, { k: 'again' }, at.now + 10000);
    expect(take()).toEqual([]);
    expect(overs).toHaveLength(1);
    expect(points).toHaveLength(24);
  });

  it('(b) práctica: el punto no suma, go −1 siempre y saca quien perdió la bola; nunca hay fin de game', () => {
    const { server, take } = setup();
    const overs: Side[] = [];
    server.onGameOver = (w) => overs.push(w);
    server.start(0, { firstServer: 1, n0: 9, practice: true, game: 0 });
    take();
    const winners: Side[] = [];
    for (let k = 0; k < 15; k++) winners.push(0, 0, 1);
    const { pts } = playPoints(server, take, winners, { srv: 1, n: 9, now: 1000 });
    for (const pm of pts) {
      expect(pm.sc).toEqual([0, 0]);
      expect(pm.go).toBe(-1);
      expect(pm.ns).toBe(other(pm.w as Side));
    }
    expect(server.score).toEqual([0, 0]);
    expect(server.record.winner).toBeNull();
    expect(overs).toEqual([]);
    expect(server.rally).toBe(9 + 45);
  });

  it('(b) práctica con bots por la red (ping 100): 5 puntos con el marcador a 0-0, go −1 y saca el que perdió la bola', () => {
    const net = runNetworkMatch({ cfg, seeds: [7, 8], ping: [100, 100], jitter: 0.1, maxTicks: 120 * 120, start: { firstServer: 0, n0: 0, practice: true, game: 0 }, stopAfterPoints: 5 });
    const toZero = net.s2c.filter((m) => m.to === 0).map((m) => decodeS2C(m.text)!);
    expect(toZero[0]).toEqual({ k: 'start', fs: 0, n: 0, wu: 1, g: 0, sc: [0, 0], ns: 0 });
    const pts = toZero.filter((m): m is PointMsg => m.k === 'pt');
    expect(pts.length).toBeGreaterThanOrEqual(5);
    let srv: Side = 0;
    for (const pt of pts) {
      expect(pt.go).toBe(-1);
      expect(pt.sc).toEqual([0, 0]);
      expect(pt.ns).toBe(pt.w === -1 ? srv : other(pt.w));
      srv = pt.ns;
    }
    expect(pts.map((p) => p.n)).toEqual(pts.map((_, k) => k));
    expect(net.server.score).toEqual([0, 0]);
    expect(net.server.record.points.every((p) => p.score[0] === 0 && p.score[1] === 0)).toBe(true);
    expect(net.server.record.rejected).toEqual([]);
    expect(net.server.record.winner).toBeNull();
    for (const side of [0, 1] as const) {
      const c = net.clients[side];
      expect(c.practice).toBe(true);
      expect(c.game).toBe(0);
      expect(c.state.score).toEqual([0, 0]);
      expect(c.finished).toBe(false);
      expect(c.stats.myPing).not.toBeNull();
      expect(c.stats.corrections, c.stats.correctionKinds.join(', ')).toBe(0);
      expect(net.events[side].some((x) => x.e.type === 'gameOver')).toBe(false);
      expect(net.events[side].filter((x) => x.e.type === 'point' || x.e.type === 'let').length).toBeGreaterThanOrEqual(5);
    }
  });

  it('en una sala no contesta los ping ni los again (lo hace la sala): el ping le llega con setPing', () => {
    const { server, take } = setup();
    server.start(0, GAME1);
    take();
    server.receive(0, { k: 'ping', i: 1, t: 5, a: 80 }, 10);
    server.receive(1, { k: 'again' }, 10);
    expect(take()).toEqual([]);
    server.receive(0, tossMsg(0, 0.1, 0), 1000);
    expect(take()).toEqual([{ to: 1, msg: tossMsg(0, 0.1, 0) }]);
    const end = 1000 + tossFlight(0, 0.1).end.i * tick;
    expect(server.nextDeadline()).toBe(end + cfg.net.timers.fallbackMs);
    server.setPing(0, 90);
    expect(server.nextDeadline()).toBe(end + 90 + cfg.net.timers.fallbackMs);
    server.poll(end + 90 + cfg.net.timers.fallbackMs - 1);
    expect(take()).toEqual([]);
    server.poll(end + 90 + cfg.net.timers.fallbackMs);
    expect(take().find((o) => o.msg.k === 'pt')?.msg).toMatchObject({ n: 0, r: 'TOSS_MISSED', w: 1 });
  });
});
