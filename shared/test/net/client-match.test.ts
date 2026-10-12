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
    c.receive({ k: 'start', fs: 0, n: 0, wu: 0, g: 1, sc: [0, 0], ns: 0 }, 0);
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
    c.receive({ k: 'start', fs: 0, n: 0, wu: 0, g: 1, sc: [0, 0], ns: 0 }, 0);
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

  it('(g) un start con wu 1 en mitad de un vuelo lo corta: serveHold con el n nuevo, la bola en la mano del que saca y sin punto', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    c.receive({ k: 'start', fs: 0, n: 5, wu: 0, g: 1, sc: [3, 2], ns: 0 }, 0);
    c.step(neutralIntent(1.6));
    expect(c.rally).toBe(5);
    expect(c.game).toBe(1);
    expect(c.practice).toBe(false);
    expect(c.state.score).toEqual([3, 2]);
    const toss = neutralIntent(1.6);
    toss.fire = c.now + 4;
    c.step(toss);
    expect(c.state.phase).toBe('serveToss');
    expect(sent.filter((m) => m.k === 'toss').at(-1)).toMatchObject({ n: 5 });
    for (let i = 0; i < 20; i++) c.step(neutralIntent(1.6));
    expect(c.state.phase).toBe('serveToss');
    // La sala corta el rally (cuenta atrás → warm-up, o al revés): manda start con wu 1, otro n y otro saque.
    c.receive({ k: 'start', fs: 1, n: 9, wu: 1, g: 0, sc: [0, 0], ns: 1 }, c.now);
    const events = [...c.step(neutralIntent(1.6))];
    expect(c.state.phase).toBe('serveHold');
    expect(c.rally).toBe(9);
    expect(c.practice).toBe(true);
    expect(c.game).toBe(0);
    expect(c.state.server).toBe(1);
    expect(c.state.firstServer).toBe(1);
    expect(c.state.score).toEqual([0, 0]);
    const hand = c.state.paddles[1].pos;
    expect(c.state.ball.pos).toEqual({ x: hand.x, y: cfg.world.tableHeight + cfg.serve.holdHeight, z: hand.z });
    // Un pt del rally cortado que llega tarde se ignora; el vuelo cortado no acaba en punto.
    c.receive({ k: 'pt', n: 5, f: 0, i: 120, w: 1, r: 'TOSS_MISSED', sc: [3, 3], ns: 0, go: -1 }, c.now);
    for (let i = 0; i < 400; i++) events.push(...c.step(neutralIntent(1.6)));
    expect(events.some((e) => e.type === 'point' || e.type === 'let' || e.type === 'gameOver')).toBe(false);
    expect(c.state.phase).toBe('serveHold');
    expect(c.state.score).toEqual([0, 0]);
    expect(sent.some((m) => m.k === 'end')).toBe(false);
  });

  it('(g) un start de reanudación pone el marcador; el siguiente lanzamiento lleva el n nuevo', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    c.receive({ k: 'start', fs: 1, n: 0, wu: 0, g: 2, sc: [0, 0], ns: 1 }, 0);
    c.step(neutralIntent(1.6));
    c.state.stats[0].hits = 4;
    // Reanudación del mismo game: marcador, saque y n del servidor; las estadísticas del game se conservan.
    c.receive({ k: 'start', fs: 1, n: 13, wu: 0, g: 2, sc: [7, 5], ns: 0 }, c.now);
    const events = c.step(neutralIntent(1.6));
    expect(events.some((e) => e.type === 'serveReady' && e.server === 0)).toBe(true);
    expect(c.state.score).toEqual([7, 5]);
    expect(c.state.server).toBe(0);
    expect(c.state.firstServer).toBe(1);
    expect(c.rally).toBe(13);
    expect(c.game).toBe(2);
    expect(c.state.stats[0].hits).toBe(4);
    const toss = neutralIntent(1.6);
    toss.fire = c.now + 4;
    c.step(toss);
    expect(c.state.phase).toBe('serveToss');
    expect(sent.filter((m) => m.k === 'toss').at(-1)).toMatchObject({ n: 13 });
    // Un game nuevo empieza de cero (también las estadísticas).
    c.receive({ k: 'start', fs: 0, n: 30, wu: 0, g: 3, sc: [0, 0], ns: 0 }, c.now);
    c.step(neutralIntent(1.6));
    expect(c.state.phase).toBe('serveHold');
    expect(c.state.score).toEqual([0, 0]);
    expect(c.state.stats[0].hits).toBe(0);
    expect(c.game).toBe(3);
    expect(c.rally).toBe(30);
  });

  it('el último pt del partido y el start del warm-up llegan juntos: se ve el punto y el fin del game, y luego el warm-up', () => {
    const env = makeEnv(cfg);
    const c = new ClientMatch(cfg, 1, () => {});
    c.receive({ k: 'start', fs: 0, n: 40, wu: 0, g: 3, sc: [3, 10], ns: 0 }, 0);
    c.step(neutralIntent(1.6));
    // El rival lanza y no saca: el servidor cierra el punto al caer el lanzamiento (3-11, fin del partido) y la sala, en el
    // mismo instante, manda el start del warm-up. Los dos llegan antes de que mi pantalla vea caer la bola.
    c.receive({ k: 'toss', n: 40, x: 0, z: 1600, a: 0 }, c.now);
    c.step(neutralIntent(1.6));
    const tossExit: BallState = { pos: { x: 0, y: cfg.world.tableHeight + cfg.serve.holdHeight, z: 1.6 }, vel: { x: 0, y: cfg.serve.tossSpeed, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
    const end = new Flight(cfg, env, tossExit, 'toss', 0, newRally()).end.i;
    c.receive({ k: 'pt', n: 40, f: 0, i: end, w: 1, r: 'TOSS_MISSED', sc: [3, 11], ns: 1, go: 1 }, c.now);
    c.receive({ k: 'start', fs: 0, n: 41, wu: 1, g: 0, sc: [0, 0], ns: 0 }, c.now);
    const seen: { t: number; type: string }[] = [];
    let point: unknown = null;
    for (let k = 0; k < 600 && !c.practice; k++) {
      for (const e of c.step(neutralIntent(1.6))) {
        if (e.type === 'point') point = { ...e };
        if (e.type === 'point' || e.type === 'gameOver' || e.type === 'serveReady') seen.push({ t: c.now, type: e.type });
      }
    }
    expect(seen.map((x) => x.type)).toEqual(['point', 'gameOver', 'serveReady']);
    expect(point).toEqual({ type: 'point', winner: 1, reason: 'TOSS_MISSED', score: [3, 11] });
    // El punto se queda en pantalla su tiempo antes del warm-up, que empieza entonces (el saque automático cuenta desde ahí).
    expect(seen[2].t - seen[0].t).toBeGreaterThanOrEqual(cfg.rules.pointDelayMs);
    expect(c.practice).toBe(true);
    expect(c.rally).toBe(41);
    expect(c.state.score).toEqual([0, 0]);
    expect(c.state.phaseStartMs).toBe(seen[2].t);
    expect(c.stats.corrections).toBe(0);
  });

  it('quieta (la decide la sala): no saca, ni sola ni con click, aunque llegue un start; la raqueta y el ping siguen', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    c.receive({ k: 'start', fs: 0, n: 5, wu: 1, g: 0, sc: [0, 0], ns: 0 }, 0);
    c.step(neutralIntent(1.6));
    c.hold(true);
    const click = neutralIntent(1.6);
    click.fire = c.now + 4;
    c.step(click);
    const ticks = Math.ceil((cfg.serve.autoTossMs * 3) / tick);
    for (let i = 0; i < ticks; i++) c.step(neutralIntent(1.6));
    expect(c.state.phase).toBe('serveHold');
    expect(sent.some((m) => m.k === 'toss')).toBe(false);
    expect(sent.some((m) => m.k === 'p')).toBe(true);
    expect(sent.some((m) => m.k === 'ping')).toBe(true);
    // Un start no la suelta (p. ej. el warm-up tras el partido, con las estadísticas encima): sigue quieta.
    c.receive({ k: 'start', fs: 0, n: 6, wu: 1, g: 0, sc: [0, 0], ns: 0 }, c.now);
    for (let i = 0; i < ticks; i++) c.step(click);
    expect(c.held).toBe(true);
    expect(c.rally).toBe(6);
    expect(c.state.phase).toBe('serveHold');
    expect(sent.some((m) => m.k === 'toss')).toBe(false);
  });

  it('al soltarla, el saque automático cuenta desde ese momento (no sale de golpe) y el click saca en el acto', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    c.hold(true);
    c.receive({ k: 'start', fs: 0, n: 6, wu: 1, g: 0, sc: [0, 0], ns: 0 }, 0);
    const ticks = Math.ceil((cfg.serve.autoTossMs * 3) / tick);
    for (let i = 0; i < ticks; i++) c.step(neutralIntent(1.6));
    expect(sent.some((m) => m.k === 'toss')).toBe(false);
    c.hold(false);
    expect(c.held).toBe(false);
    const releasedAt = c.now;
    let tossAt = -1;
    for (let i = 0; i < ticks && tossAt < 0; i++) {
      c.step(neutralIntent(1.6));
      if (sent.some((m) => m.k === 'toss')) tossAt = c.now;
    }
    expect(sent.filter((m) => m.k === 'toss')).toMatchObject([{ n: 6, a: 1 }]);
    expect(tossAt - releasedAt).toBeGreaterThanOrEqual(cfg.serve.autoTossMs);
    expect(tossAt - releasedAt).toBeLessThan(cfg.serve.autoTossMs + 2 * tick);
    // Otra vez quieta y suelta: con click se saca en el mismo tick, sin esperar.
    const c2 = new ClientMatch(cfg, 0, (m) => sent.push(m));
    sent.length = 0;
    c2.hold(true);
    c2.receive({ k: 'start', fs: 0, n: 9, wu: 1, g: 0, sc: [0, 0], ns: 0 }, 0);
    for (let i = 0; i < ticks; i++) c2.step(neutralIntent(1.6));
    c2.hold(false);
    const click = neutralIntent(1.6);
    click.fire = c2.now + 4;
    c2.step(click);
    expect(c2.state.phase).toBe('serveToss');
    expect(sent.filter((m) => m.k === 'toss')).toMatchObject([{ n: 9, a: 0 }]);
  });

  it('soltada mientras la vista va atrasada (calibrando), la puesta al día no saca con el tiempo pasado', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    c.hold(true);
    c.receive({ k: 'start', fs: 0, n: 4, wu: 1, g: 0, sc: [0, 0], ns: 0 }, 0);
    c.step(neutralIntent(1.6));
    // La vista se para 10 s (calibrando) y se suelta en el reloj de la partida de ahora, no en el de la vista.
    const now = c.now + 10_000;
    c.hold(false, now);
    let tossAt = -1;
    while (tossAt < 0 && c.now < now + 3000) {
      c.step(neutralIntent(1.6), true);
      if (sent.some((m) => m.k === 'toss')) tossAt = c.now;
    }
    expect(tossAt).toBeGreaterThanOrEqual(now + cfg.serve.autoTossMs);
    expect(tossAt).toBeLessThan(now + cfg.serve.autoTossMs + 2 * tick);
  });

  it('tras un tirón (muchos ticks en un frame) la raqueta sale una sola vez, con su último estado; a 60 fps, a 30 Hz', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    // Saca el rival: aquí solo cuenta lo que envía este cliente del estado (raqueta y ping).
    c.receive({ k: 'start', fs: 1, n: 3, wu: 1, g: 0, sc: [0, 0], ns: 1 }, 0);
    const still = neutralIntent(1.6);
    // Un frame como en el navegador: sus ticks sin enviar el estado y, al acabarlos, un solo envío con el último.
    const frame = (ticks: number, intent = still) => {
      for (let i = 0; i < ticks; i++) c.step(intent, true);
      c.flushSends();
    };
    frame(1);
    // 60 fps (2 ticks por frame) durante 1 s: la raqueta sale a su ritmo de siempre (paddleHz).
    sent.length = 0;
    for (let f = 0; f < 60; f++) frame(2);
    expect(sent.filter((m) => m.k === 'p').length).toBe(cfg.net.paddleHz);
    // Calibrando 10 s (sin frames de juego) y la puesta al día de golpe, con la raqueta movida: un `p`, no 300.
    sent.length = 0;
    const moved = neutralIntent(1.6);
    moved.target = { x: 0.4, z: 1.2 };
    frame(Math.round(10_000 / tick), moved);
    const pads = sent.filter((m) => m.k === 'p');
    expect(pads.length).toBe(1);
    const pad = c.state.paddles[0].pos;
    expect(pads[0]).toMatchObject({ k: 'p', n: 3, x: Math.round(pad.x * 1000), z: Math.round(pad.z * 1000) });
    expect(Math.round(pad.x * 1000)).not.toBe(0);
    // Y del ping, como mucho uno: nada que se acerque a la ráfaga de 200 que corta el servidor.
    expect(sent.filter((m) => m.k === 'ping').length).toBeLessThanOrEqual(1);
    expect(sent.length).toBeLessThanOrEqual(2);
    // Sin `flushSends` (el uso de siempre: un tick, un envío), nada cambia.
    sent.length = 0;
    for (let i = 0; i < 120; i++) c.step(still);
    expect(sent.filter((m) => m.k === 'p').length).toBe(cfg.net.paddleHz);
  });

  it('callada (sala de espera tras irse el rival): ni un `p`, el ping sigue; al dejar de estarlo, la raqueta vuelve a 30 Hz', () => {
    const sent: C2S[] = [];
    const c = new ClientMatch(cfg, 0, (m) => sent.push(m));
    c.receive({ k: 'start', fs: 1, n: 3, wu: 1, g: 0, sc: [0, 0], ns: 1 }, 0);
    const still = neutralIntent(1.6);
    for (let i = 0; i < 120; i++) c.step(still);
    expect(sent.filter((m) => m.k === 'p').length).toBe(cfg.net.paddleHz);
    // Un `p` que ya tocaba en un frame con deferSends (4 ticks: uno es de envío) tampoco sale si se calla antes del flushSends.
    sent.length = 0;
    for (let i = 0; i < 4; i++) c.step(still, true);
    c.setQuiet(true);
    c.flushSends();
    expect(c.quiet).toBe(true);
    // 3 s callada: ningún `p` (ni con un tick por envío ni por frames), pero sí el ping cada 2 s.
    for (let i = 0; i < 180; i++) c.step(still);
    for (let f = 0; f < 90; f++) {
      c.step(still, true);
      c.step(still, true);
      c.flushSends();
    }
    expect(sent.filter((m) => m.k === 'p').length).toBe(0);
    expect(sent.filter((m) => m.k === 'ping').length).toBeGreaterThanOrEqual(1);
    // Con rival otra vez: 30 Hz.
    c.setQuiet(false);
    sent.length = 0;
    for (let i = 0; i < 120; i++) c.step(still);
    expect(sent.filter((m) => m.k === 'p').length).toBe(cfg.net.paddleHz);
  });

  it('en práctica no hay fin de game aunque llegue un pt con ganador', () => {
    const c = new ClientMatch(cfg, 1, () => {});
    c.receive({ k: 'start', fs: 0, n: 3, wu: 1, g: 0, sc: [0, 0], ns: 0 }, 0);
    c.step(neutralIntent(1.6));
    c.receive({ k: 'toss', n: 3, x: 0, z: 1600, a: 0 }, c.now);
    c.step(neutralIntent(1.6));
    expect(c.state.phase).toBe('serveToss');
    c.receive({ k: 'pt', n: 3, f: 0, i: 1, w: 1, r: 'TOSS_MISSED', sc: [0, 0], ns: 0, go: 1 }, c.now);
    const events = [...c.step(neutralIntent(1.6))];
    for (let i = 0; i < 300; i++) events.push(...c.step(neutralIntent(1.6)));
    expect(events.some((e) => e.type === 'point')).toBe(true);
    expect(events.some((e) => e.type === 'gameOver')).toBe(false);
    expect(c.finished).toBe(false);
    expect(c.state.score).toEqual([0, 0]);
    expect(c.state.phase).toBe('serveHold');
    expect(c.rally).toBe(4);
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
