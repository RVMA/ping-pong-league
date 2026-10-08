import { describe, expect, it } from 'vitest';
import { makeConfig, tickMs } from '../../src/config.ts';
import { firstServerOfGame } from '../../src/net/match.ts';
import type { S2C } from '../../src/net/protocol.ts';
import type { MatchRecord } from '../../src/net/server-match.ts';
import { type RoomRun, type RoomRunOptions, runRoomMatch } from './room-harness.ts';

const cfg = makeConfig();
const TICK = tickMs(cfg);
/** Tope de 40 min de tiempo virtual por partido (un Estándar de bots dura unos 6). */
const MAX = 120 * 60 * 40;

const label = (g: number, w: number, sc: readonly number[]): string => `${g}:${w === -1 ? 'LET' : sc.join('-')}`;

/** Marcadores de la sala: los puntos de cada game según su autoridad, en orden. */
function roomPoints(run: RoomRun): string[] {
  return run.games.flatMap((r, i) => r.points.map((p) => label(i + 1, p.winner, p.score)));
}

/** Los `pt` de los games que la sala mandó a la conexión `c` (cada conexión es un cliente). */
function sentPoints(run: RoomRun, c: number): string[] {
  let g = 0;
  const out: string[] = [];
  for (const x of run.s2c) {
    if (x.c !== c) continue;
    if (x.msg.k === 'start') g = x.msg.wu === 1 ? 0 : x.msg.g;
    else if (x.msg.k === 'pt' && g > 0) out.push(label(g, x.msg.w, x.msg.sc));
  }
  return out;
}

/** Los puntos que el cliente `c` enseñó en los games (sin el warm-up). */
function shownPoints(run: RoomRun, c: number): string[] {
  const out: string[] = [];
  for (const x of run.events) {
    if (x.c !== c || x.wu) continue;
    if (x.e.type === 'point') out.push(label(x.g, x.e.winner, x.e.score));
    else if (x.e.type === 'let') out.push(label(x.g, -1, []));
  }
  return out;
}

const sentTo = <K extends S2C['k']>(run: RoomRun, c: number, k: K) =>
  run.s2c.filter((x) => x.c === c && x.msg.k === k) as { to: 0 | 1; c: number; t: number; msg: Extract<S2C, { k: K }> }[];

/** Sin punto doble: en cada game, cada punto suma exactamente 1 al ganador (un let, nada) y los rallies no se repiten. */
function expectNoDoublePoint(games: MatchRecord[]): void {
  let lastN = -1;
  for (const r of games) {
    let prev: [number, number] = [0, 0];
    for (const p of r.points) {
      expect(p.n).toBeGreaterThan(lastN);
      lastN = p.n;
      const want: [number, number] = [prev[0], prev[1]];
      if (p.winner !== -1) want[p.winner] += 1;
      expect(p.score).toEqual(want);
      prev = p.score;
    }
  }
}

/** 0 discrepancias: ni correcciones en ningún cliente ni rechazos en ninguna autoridad; nunca hace falta el respaldo. */
function expectClean(run: RoomRun): void {
  expect(run.corrections, `correcciones: ${run.clients.map((c) => c.stats.correctionKinds.join(',')).join(' | ')}`).toBe(0);
  expect(run.room.record.authorities.flatMap((a) => a.rejected)).toEqual([]);
  expect(run.log.filter((l) => l.includes('respaldo'))).toEqual([]);
  expectNoDoublePoint(run.games);
}

/** Partido acabado por marcador, visto igual por la sala y por los dos clientes. */
function expectFullMatch(run: RoomRun): void {
  const rec = run.room.record;
  expect(rec.matches).toHaveLength(1);
  const m = rec.matches[0];
  expect(m.why).toBe('score');
  expect(run.games).toHaveLength(m.games.length);
  m.games.forEach((g, i) => expect(run.games[i].points.at(-1)?.score).toEqual(g.score));
  const room = roomPoints(run);
  expect(room.length).toBeGreaterThan(20);
  for (const c of [0, 1]) {
    expect(sentPoints(run, c)).toEqual(room);
    expect(shownPoints(run, c)).toEqual(room);
    expect(sentTo(run, c, 'mend').map((x) => x.msg)).toEqual([expect.objectContaining({ w: m.winner, why: 'score' })]);
  }
}

const base = { cfg, mode: 'standard', seeds: [7, 8], jitter: 0.1, maxTicks: MAX } as const satisfies Partial<RoomRunOptions>;

describe('red en memoria con salas (V0.4)', () => {
  it('(b) Estándar, ping 0/0: el partido acaba, 0 correcciones y 0 rechazos, los marcadores de los clientes son los de la sala y el fs alterna por game', () => {
    const run = runRoomMatch({ ...base, ping: [0, 0], jitter: 0 });
    expectClean(run);
    expectFullMatch(run);
    expect(run.maxRenderJump).toBeLessThan(0.03);
    const m = run.room.record.matches[0];
    const fs = m.games.map((_, i) => firstServerOfGame(m.firstServer, i + 1));
    expect(m.games.map((g) => g.firstServer)).toEqual(fs);
    for (let i = 1; i < fs.length; i++) expect(fs[i]).not.toBe(fs[i - 1]);
    for (const c of [0, 1]) {
      // El primer `start` de cada game: fs del game y saca él, 0-0.
      const firsts = sentTo(run, c, 'start').filter((x, i, all) => x.msg.wu === 0 && all.findIndex((y) => y.msg.wu === 0 && y.msg.g === x.msg.g) === i);
      expect(firsts.map((x) => [x.msg.g, x.msg.fs, x.msg.ns, x.msg.sc.join('-')])).toEqual(fs.map((f, i) => [i + 1, f, f, '0-0']));
    }
    // Warm-up de 2 puntos, Listo de los dos, cuenta atrás, games y vuelta al warm-up.
    const ev = run.room.record.events.map((e) => e.what);
    expect(ev.slice(0, 6)).toEqual(['join 0', 'join 1', 'warmup 0', expect.stringMatching(/^ready /), expect.stringMatching(/^ready /), 'countdown']);
    expect(ev).toContain(`mend ${m.winner}`);
  });

  for (const ping of [
    [100, 100],
    [50, 150],
  ] as [number, number][]) {
    it(`(c) ping ${ping.join('/')} con ±10 %: 0 discrepancias`, () => {
      const run = runRoomMatch({ ...base, ping });
      expectClean(run);
      expectFullMatch(run);
      // Sin picos, como en V0.3: la bola dibujada no salta.
      expect(run.maxRenderJump, 'mayor salto de renderBall por tick (m)').toBeLessThan(0.03);
    });
  }

  it('(d) reconexión: el lado 1 se cae en el game 1, punto 5, y vuelve a los 2 s', () => {
    const run = runRoomMatch({ ...base, ping: [100, 100], disconnect: { side: 1, atPoint: 5, game: 1, backAfterMs: 2000 } });
    const cut = run.cut!;
    expect(cut).toEqual(expect.objectContaining({ side: 1, game: 1, point: 5 }));
    expect(run.clients.map((c) => c.side)).toEqual([0, 1, 1]);

    // El punto en juego acaba al terminar el vuelo que le tocaba al lado 1 (ausente), sin esperar el respaldo de 3 s.
    expect(run.log.filter((l) => l.includes(`ausente: rally ${cut.n} `))).toHaveLength(1);
    const pt = sentTo(run, 0, 'pt').find((x) => x.msg.n === cut.n)!;
    const fl = sentTo(run, 0, 'fl').find((x) => x.msg.n === cut.n && x.msg.f === pt.msg.f)!;
    const flightEnd = fl.t + pt.msg.i * TICK;
    expect(pt.t).toBeCloseTo(Math.max(cut.t, flightEnd), 6);
    expect(pt.t).toBeLessThan(flightEnd + cfg.net.timers.fallbackMs);
    // Ese `pt` ya no llegó al lado 1: ni a la conexión vieja ni a la nueva.
    expect(sentTo(run, 1, 'pt').some((x) => x.msg.n === cut.n)).toBe(false);
    expect(sentTo(run, 2, 'pt').some((x) => x.msg.n === cut.n)).toBe(false);

    // La sala pasa por la pausa y la cuenta atrás de vuelta.
    const ev = run.room.record.events.map((e) => e.what);
    const from = ev.indexOf('disconnect 1');
    expect(from).toBeGreaterThan(0);
    expect(ev.slice(from, from + 5)).toEqual(['disconnect 1', 'pause 1', 'rejoin 1', 'countdown resume', 'resume']);
    expect(sentTo(run, 0, 'room').map((x) => x.msg.ph)).toEqual(expect.arrayContaining(['paused', 'countdown']));
    const back = run.room.record.events.find((e) => e.what === 'rejoin 1')!.at;
    expect(back - cut.t).toBeGreaterThanOrEqual(2000);
    expect(back - cut.t).toBeLessThan(2000 + TICK + 100);

    // El marcador del cliente nuevo es el del servidor: su primer `start` trae el marcador tras el punto cortado.
    const game1 = run.games[0].points;
    const cutPoint = game1.find((p) => p.n === cut.n)!;
    const resume = sentTo(run, 2, 'start')[0].msg;
    expect(resume).toEqual(expect.objectContaining({ wu: 0, g: 1, sc: cutPoint.score }));
    expect(resume.n).toBeGreaterThan(cut.n);

    // Sin punto doble ni salto de la bola: el lado 0 lo ve todo; el lado 1 todo menos el punto que se jugó sin él.
    expectClean(run);
    expect(run.maxRenderJump).toBeLessThan(0.03);
    const room = roomPoints(run);
    const missing = label(1, cutPoint.winner, cutPoint.score);
    expect(sentPoints(run, 0)).toEqual(room);
    expect(shownPoints(run, 0)).toEqual(room);
    const side1 = [...shownPoints(run, 1), ...shownPoints(run, 2)];
    expect(side1).toEqual(room.filter((l) => l !== missing));
    expect([...sentPoints(run, 1), ...sentPoints(run, 2)]).toEqual(side1);
    // El lado 0 siguió jugando durante la pausa (el rally siguiente, que la pausa corta): eso se descarta sin rechazo,
    // sin reenvío y sin punto. Lo que la conexión vieja del lado 1 tenía en vuelo se descartó con sus colas.
    const cutRally = (n: number) => n > cut.n && n < resume.n;
    const late = run.c2s.filter((x) => x.c === 0 && (x.msg.k === 'toss' || x.msg.k === 'hit' || x.msg.k === 'wf' || x.msg.k === 'end') && cutRally(x.msg.n));
    expect(late.length).toBeGreaterThan(0);
    expect(run.s2c.filter((x) => (x.msg.k === 'toss' || x.msg.k === 'fl' || x.msg.k === 'wf' || x.msg.k === 'pt') && cutRally(x.msg.n))).toEqual([]);

    const m = run.room.record.matches[0];
    expect(m.why).toBe('score');
    expect(sentTo(run, 0, 'mend')).toHaveLength(1);
    expect(sentTo(run, 2, 'mend')).toHaveLength(1);
  });

  it('(e) abandono: si no vuelve, mend abandon a los 30 s del corte (± 1 tick) y la sala espera rival', () => {
    const run = runRoomMatch({ ...base, mode: 'quick', ping: [100, 100], disconnect: { side: 1, atPoint: 5, game: 1, backAfterMs: null } });
    const cut = run.cut!;
    expect(cut).toEqual(expect.objectContaining({ side: 1, game: 1, point: 5 }));
    const mends = sentTo(run, 0, 'mend');
    expect(mends.map((x) => x.msg)).toEqual([expect.objectContaining({ w: 0, why: 'abandon' })]);
    expect(Math.abs(mends[0].t - (cut.t + cfg.room.reconnectMs))).toBeLessThanOrEqual(TICK);
    expect(run.room.record.matches).toEqual([expect.objectContaining({ why: 'abandon', winner: 0 })]);
    expect(run.room.phase).toBe('waiting');
    expect(run.room.players).toBe(1);
    expect(run.clients).toHaveLength(2);
    expectClean(run);
    expect(shownPoints(run, 0)).toEqual(roomPoints(run));
  });

  it('(f) picos de TCP (ping 100/100, spike 0.02): 0 discrepancias; el salto de la bola en pantalla se funde', () => {
    const run = runRoomMatch({ ...base, ping: [100, 100], spike: 0.02 });
    expect(run.spikes).toBeGreaterThan(100);
    expectClean(run);
    expectFullMatch(run);
    // Un pico retrasa el golpe rival más allá de lo que frenó la bola que se aleja: la pantalla ya pasó su contacto
    // (sigue a velocidad real, V0.3) y el vuelo nuevo empieza en él. Ese hueco (≈ 2 m con 300 ms de retraso) se funde en
    // blendMs (80 ms ≈ 10 ticks), así que el salto por tick queda en décimas: sin fundir serían metros (medido: 0.22 m).
    expect(run.maxRenderJump, 'mayor salto de renderBall por tick (m)').toBeLessThan(0.4);
  });

  it('(g) determinismo: dos ejecuciones iguales (con picos y reconexión) mandan los mismos mensajes', () => {
    const o: RoomRunOptions = { ...base, mode: 'quick', seeds: [3, 4], ping: [150, 50], spike: 0.02, disconnect: { side: 0, atPoint: 3, game: 1, backAfterMs: 1500 } };
    const a = runRoomMatch(o);
    const b = runRoomMatch(o);
    expect(a.cut).not.toBeNull();
    expect(a.c2s.length).toBeGreaterThan(1000);
    expect(a.c2s).toEqual(b.c2s);
    expect(a.s2c).toEqual(b.s2c);
  });
});
