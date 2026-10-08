import { describe, expect, it } from 'vitest';
import { type MatchMode, makeConfig } from '../../src/config.ts';
import { configHash } from '../../src/net/config-hash.ts';
import { matchStats } from '../../src/net/match-stats.ts';
import { type C2S, type HelloMsg, type MatchEndMsg, type PointMsg, PROTOCOL_VERSION, type RoomMsg, type S2C, type StartMsg } from '../../src/net/protocol.ts';
import { RoomCore } from '../../src/net/room.ts';
import { cleanName } from '../../src/net/route.ts';
import type { GameAuthority, GameStart, MatchRecord } from '../../src/net/server-match.ts';
import type { Side } from '../../src/types.ts';

const cfg = makeConfig();
const other = (s: Side): Side => (s === 0 ? 1 : 0);

/**
 * Autoridad falsa: guarda lo que recibe y lo que le pide la sala, reenvía la raqueta como la real, y emite puntos y fin
 * de game cuando el test quiere. Las acciones programadas con `at` se ejecutan dentro de `poll`, como el respaldo de la
 * autoridad real, así los callbacks llegan dentro de una llamada de la sala (con su reloj).
 */
class FakeAuthority implements GameAuthority {
  busy = false;
  rally = 0;
  score: [number, number] = [0, 0];
  readonly record: MatchRecord = { points: [], hits: [], rejected: [], ignored: [], hitCpuMs: [], winner: null };
  onPoint: (pm: PointMsg) => void = () => {};
  onGameOver: (winner: Side, score: [number, number]) => void = () => {};
  g: GameStart | null = null;
  paused = false;
  over = false;
  readonly received: { from: Side; msg: C2S }[] = [];
  readonly calls: string[] = [];
  /** Lo que hace al recibir un `end` (para probar callbacks dentro de `receive`). */
  onEnd: ((from: Side) => void) | null = null;
  private readonly queue: { at: number; fn: () => void }[] = [];
  private readonly send: (to: Side, msg: S2C) => void;

  constructor(send: (to: Side, msg: S2C) => void) {
    this.send = send;
  }

  start(_now: number, g?: GameStart): void {
    this.calls.push('start');
    this.g = g ?? null;
    this.rally = g?.n0 ?? 0;
    this.score = g?.score ? [g.score[0], g.score[1]] : [0, 0];
    this.paused = false;
    this.sendStart();
  }

  receive(from: Side, msg: C2S, now: number): void {
    this.poll(now);
    this.received.push({ from, msg });
    if (msg.k === 'p') this.send(other(from), msg);
    if (msg.k === 'end' && this.onEnd) this.onEnd(from);
  }

  poll(now: number): void {
    for (;;) {
      const i = this.queue.findIndex((q) => q.at <= now);
      if (i < 0) return;
      const [q] = this.queue.splice(i, 1);
      q.fn();
    }
  }

  pause(): void {
    this.calls.push('pause');
    if (this.paused) return;
    this.paused = true;
    if (this.over) return;
    // Como la real: el rally en juego (o el que iba a empezar) queda cortado; `rally` es el siguiente sin usar.
    if (!this.busy) this.rally += 1;
    this.busy = false;
  }

  resume(_now: number): void {
    this.calls.push('resume');
    if (this.over) {
      this.paused = false;
      return;
    }
    if (!this.paused) this.pause();
    this.paused = false;
    this.sendStart();
  }

  setAbsent(side: Side, absent: boolean): void {
    this.calls.push(`absent ${side} ${absent ? 1 : 0}`);
  }

  setPing(side: Side, ms: number): void {
    this.calls.push(`ping ${side} ${ms}`);
  }

  nextDeadline(): number {
    let t = Number.POSITIVE_INFINITY;
    for (const q of this.queue) t = Math.min(t, q.at);
    return t;
  }

  /** Empieza un vuelo (busy): como en la real, `rally` pasa a ser el siguiente al del rally en juego. */
  flight(): void {
    if (!this.busy) this.rally += 1;
    this.busy = true;
  }

  /** Programa una acción para cuando la sala llame a poll con now ≥ t. */
  at(t: number, fn: () => void): void {
    this.queue.push({ at: t, fn });
  }

  emitPoint(winner: Side): void {
    const n = this.busy ? this.rally - 1 : this.rally;
    if (!this.g?.practice) this.score[winner] += 1;
    this.close(n, winner, -1);
  }

  emitGameOver(winner: Side): void {
    const n = this.busy ? this.rally - 1 : this.rally;
    this.score = winner === 0 ? [11, 6] : [6, 11];
    this.over = true;
    this.record.winner = winner;
    this.close(n, winner, winner);
    this.onGameOver(winner, [this.score[0], this.score[1]]);
  }

  private close(n: number, winner: Side, go: Side | -1): void {
    this.busy = false;
    this.rally = n + 1;
    const sc: [number, number] = [this.score[0], this.score[1]];
    this.record.points.push({ n, winner, reason: 'OUT', score: [sc[0], sc[1]] });
    const pm: PointMsg = { k: 'pt', n, f: 1, i: 10, w: winner, r: 'OUT', sc, ns: other(winner), go };
    this.send(0, pm);
    this.send(1, pm);
    this.onPoint(pm);
  }

  private sendStart(): void {
    const g = this.g;
    if (!g) return;
    const msg: StartMsg = { k: 'start', fs: g.firstServer, n: this.rally, wu: g.practice ? 1 : 0, g: g.practice ? 0 : g.game, sc: [this.score[0], this.score[1]], ns: g.server ?? g.firstServer };
    this.send(0, msg);
    this.send(1, msg);
  }
}

type Out = { to: Side; msg: S2C } | { to: Side; drop: true };

function hello(nm: string, tk?: string): HelloMsg {
  const h: HelloMsg = { k: 'hello', v: PROTOCOL_VERSION, h: configHash(cfg), r: 'player', nm, p: 0, bp: 0, j: 0, sp: 0, d: 'medium', s: 1, o: 0 };
  if (tk !== undefined) h.tk = tk;
  return h;
}

const rdy = (on: 0 | 1): C2S => ({ k: 'rdy', on });
const pad = (n: number): C2S => ({ k: 'p', n, r: -1, x: 0, z: 1500 });
const toss = (n: number): C2S => ({ k: 'toss', n, x: 100, z: 1600, a: 0 });
const hit = (n: number): C2S => ({ k: 'hit', n, f: 0, t: 500, x: 0, z: 1500, vx: 0, q: 0, b: 0, sv: [] });

function sent<K extends S2C['k']>(out: Out[], to: Side, k: K): Extract<S2C, { k: K }>[] {
  const r: Extract<S2C, { k: K }>[] = [];
  for (const o of out) if (o.to === to && 'msg' in o && o.msg.k === k) r.push(o.msg as Extract<S2C, { k: K }>);
  return r;
}

const rooms = (out: Out[], to: Side): RoomMsg[] => sent(out, to, 'room');

function lastRoom(out: Out[], to: Side): RoomMsg {
  const r = rooms(out, to);
  if (!r.length) throw new Error(`sin room para el lado ${to}`);
  return r[r.length - 1];
}

/** Resumen del orden: «0:room», «1:drop»… */
const order = (out: Out[]): string[] => out.map((o) => ('msg' in o ? `${o.to}:${o.msg.k}` : `${o.to}:drop`));

function setup(o: { mode?: MatchMode; random?: number[] } = {}) {
  const out: Out[] = [];
  const all: Out[] = [];
  const fakes: FakeAuthority[] = [];
  const randoms = o.random ?? [0.3];
  let ri = 0;
  let tk = 0;
  const room = new RoomCore({
    cfg,
    code: 'ABCD',
    mode: o.mode ?? 'standard',
    send: (to, msg) => {
      out.push({ to, msg });
      all.push({ to, msg });
    },
    drop: (to) => {
      out.push({ to, drop: true });
      all.push({ to, drop: true });
    },
    newToken: () => `tok-${++tk}-abcdef`,
    random: () => randoms[ri++ % randoms.length],
    makeAuthority: (send) => {
      const f = new FakeAuthority(send);
      fakes.push(f);
      return f;
    },
  });
  const take = (): Out[] => out.splice(0, out.length);
  const auth = (): FakeAuthority => fakes[fakes.length - 1];
  /** A los `now` ms, la autoridad de ese momento hace `fn` (dentro de room.poll). */
  const act = (now: number, fn: () => void): void => {
    auth().at(now, fn);
    room.poll(now);
  };
  const events = (): string[] => room.record.events.map((e) => e.what);
  return { room, out, all, take, fakes, auth, act, events };
}

/** Dos jugadores (Ana en el 0, Bea en el 1) en el warm-up a t = 0. */
function warm(o: { mode?: MatchMode; random?: number[] } = {}) {
  const t = setup(o);
  const a = t.room.join(hello('Ana'), 0);
  const b = t.room.join(hello('Bea'), 0);
  if (!a.ok || !b.ok) throw new Error('join');
  const tk = [sent(t.out, 0, 'welcome')[0].tk, sent(t.out, 1, 'welcome')[0].tk] as const;
  t.take();
  return { ...t, tk };
}

/** Warm-up con un punto y un rechazo (no cuentan en el partido), Listos a 1000 y 2000, y el game 1 a t = 5000. */
function toMatch(o: { mode?: MatchMode; random?: number[] } = {}) {
  const t = warm(o);
  const practice = t.auth();
  t.act(500, () => practice.emitPoint(1));
  practice.record.rejected.push({ from: 1, kind: 'hit', why: 'reach' });
  t.room.receive(0, rdy(1), 1000);
  t.room.receive(1, rdy(1), 2000);
  t.room.poll(5000);
  if (t.room.phase !== 'match') throw new Error(`fase ${t.room.phase}`);
  t.take();
  return { ...t, practice };
}

describe('RoomCore: la sala (V0.4) [§14]', () => {
  it('(a) el 1.º entra en el lado 0 y espera; el 2.º en el 1 y empieza el warm-up; el 3.º, full', () => {
    const t = setup();
    expect(t.room.join(hello('Ana'), 0)).toEqual({ ok: true, side: 0, resumed: false });
    expect(t.take()).toEqual([
      { to: 0, msg: { k: 'welcome', v: PROTOCOL_VERSION, side: 0, room: 'ABCD', tk: 'tok-1-abcdef', md: 'standard' } },
      { to: 0, msg: { k: 'room', code: 'ABCD', md: 'standard', ph: 'waiting', pl: [{ nm: 'Ana', c: 1, r: 0, rt: 0 }, null], gw: [0, 0], dl: -1, dk: '' } },
    ]);
    expect(t.room.phase).toBe('waiting');
    expect(t.room.players).toBe(1);
    expect(t.room.closed).toBe(false);
    expect(t.fakes).toHaveLength(0);

    expect(t.room.join(hello('Bea'), 500)).toEqual({ ok: true, side: 1, resumed: false });
    const room: RoomMsg = { k: 'room', code: 'ABCD', md: 'standard', ph: 'warmup', pl: [{ nm: 'Ana', c: 1, r: 0, rt: 0 }, { nm: 'Bea', c: 1, r: 0, rt: 0 }], gw: [0, 0], dl: -1, dk: '' };
    const start: StartMsg = { k: 'start', fs: 0, n: 0, wu: 1, g: 0, sc: [0, 0], ns: 0 };
    expect(t.take()).toEqual([
      { to: 1, msg: { k: 'welcome', v: PROTOCOL_VERSION, side: 1, room: 'ABCD', tk: 'tok-2-abcdef', md: 'standard' } },
      { to: 0, msg: room },
      { to: 1, msg: room },
      { to: 0, msg: start },
      { to: 1, msg: start },
    ]);
    expect(t.room.phase).toBe('warmup');
    expect(t.auth().g).toEqual({ firstServer: 0, n0: 0, practice: true, game: 0 });
    expect(t.room.record.authorities).toEqual([t.auth().record]);

    expect(t.room.join(hello('Cris'), 900)).toEqual({ ok: false, err: 'full' });
    expect(t.take()).toEqual([]);
    expect(t.room.players).toBe(2);
    expect(t.events()).toEqual(['join 0', 'join 1', 'warmup 0']);
  });

  it('(b) uno Listo: aviso a los 150 s; a los 180 s el otro sale (bye + drop) y el Listo del primero vuelve a 0', () => {
    const t = warm();
    t.room.receive(0, rdy(1), 1000);
    let m = t.take();
    expect(rooms(m, 0)).toEqual([expect.objectContaining({ ph: 'warmup', dk: '', dl: -1, pl: [expect.objectContaining({ r: 1 }), expect.objectContaining({ r: 0 })] })]);
    expect(rooms(m, 1)).toEqual(rooms(m, 0));
    expect(t.room.nextDeadline()).toBe(151000);

    t.room.poll(150999);
    expect(t.take()).toEqual([]);
    t.room.poll(151000);
    m = t.take();
    expect(rooms(m, 0)).toEqual([expect.objectContaining({ ph: 'warmup', dk: 'ready', dl: 30000 })]);
    expect(rooms(m, 1)).toEqual([expect.objectContaining({ ph: 'warmup', dk: 'ready', dl: 30000 })]);
    expect(t.room.nextDeadline()).toBe(181000);
    t.room.poll(170000);
    expect(t.take()).toEqual([]);

    t.room.poll(181000);
    m = t.take();
    expect(m).toEqual([
      { to: 1, msg: { k: 'bye', m: 'No diste a Listo a tiempo' } },
      { to: 1, drop: true },
      { to: 0, msg: { k: 'room', code: 'ABCD', md: 'standard', ph: 'waiting', pl: [{ nm: 'Ana', c: 1, r: 0, rt: 0 }, null], gw: [0, 0], dl: -1, dk: '' } },
    ]);
    expect(t.room.phase).toBe('waiting');
    expect(t.room.players).toBe(1);
    expect(t.room.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    expect(t.events()).toEqual(['join 0', 'join 1', 'warmup 0', 'ready 0', 'warn', 'timeout 1']);
    // Su hueco no queda reservado: su token ya no vale y quien llega entra como nuevo.
    expect(t.room.join(hello('Bea', t.tk[1]), 182000)).toEqual({ ok: true, side: 1, resumed: false });
  });

  it('(b) si nadie está Listo, el warm-up no tiene plazo: 10 min sin nada', () => {
    const t = warm();
    expect(t.room.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    for (let s = 1; s <= 600; s++) t.room.poll(s * 1000);
    expect(t.take()).toEqual([]);
    expect(t.room.phase).toBe('warmup');
    expect(t.room.players).toBe(2);
  });

  it('(c) los dos Listos → cuenta atrás de 3 s y el game 1, con fs por sorteo (0.3 → 0, 0.7 → 1)', () => {
    for (const [rnd, fs] of [
      [0.3, 0],
      [0.7, 1],
    ] as const) {
      const t = warm({ random: [rnd] });
      const practice = t.auth();
      t.room.receive(0, rdy(1), 1000);
      t.room.receive(1, rdy(1), 2000);
      const m = t.take();
      expect(t.room.phase).toBe('countdown');
      const count = expect.objectContaining({ ph: 'countdown', dk: 'count', dl: 3000, pl: [expect.objectContaining({ r: 1 }), expect.objectContaining({ r: 1 })] });
      expect(lastRoom(m, 0)).toEqual(count);
      expect(lastRoom(m, 1)).toEqual(count);
      expect(practice.calls).toEqual(['start', 'pause']);
      expect(t.room.nextDeadline()).toBe(5000);

      t.room.poll(4999);
      expect(t.take()).toEqual([]);
      t.room.poll(5000);
      const n = t.take();
      expect(t.room.phase).toBe('match');
      expect(t.fakes).toHaveLength(2);
      // El rally del warm-up quedó cortado: el game 1 empieza en el siguiente.
      expect(practice.rally).toBe(1);
      expect(t.auth().g).toEqual({ firstServer: fs, n0: 1, practice: false, game: 1 });
      const start: StartMsg = { k: 'start', fs, n: 1, wu: 0, g: 1, sc: [0, 0], ns: fs };
      expect(n).toEqual([
        { to: 0, msg: expect.objectContaining({ k: 'room', ph: 'match', dk: '', dl: -1 }) },
        { to: 1, msg: expect.objectContaining({ k: 'room', ph: 'match', dk: '', dl: -1 }) },
        { to: 0, msg: start },
        { to: 1, msg: start },
      ]);
      expect(t.events()).toContain(`match ${fs}`);
    }
  });

  it('(c) rdy 0 durante la cuenta atrás vuelve al warm-up con una práctica nueva', () => {
    const t = warm();
    const p1 = t.auth();
    t.room.receive(0, rdy(1), 1000);
    t.room.receive(1, rdy(1), 2000);
    t.take();
    t.room.receive(1, rdy(0), 3000);
    const m = t.take();
    expect(t.room.phase).toBe('warmup');
    expect(t.fakes).toHaveLength(2);
    expect(t.auth().g).toEqual({ firstServer: 0, n0: p1.rally, practice: true, game: 0 });
    expect(lastRoom(m, 0)).toEqual(expect.objectContaining({ ph: 'warmup', dk: '', dl: -1, pl: [expect.objectContaining({ r: 1 }), expect.objectContaining({ r: 0 })] }));
    expect(order(m)).toEqual(['0:room', '1:room', '0:start', '1:start']);
    expect(sent(m, 0, 'start')).toEqual([{ k: 'start', fs: 0, n: 1, wu: 1, g: 0, sc: [0, 0], ns: 0 }]);
    // Ya no hay cuenta atrás; sigue el plazo del Listo del lado 0 (desde su primer Listo).
    expect(t.room.nextDeadline()).toBe(151000);
    t.room.poll(10000);
    expect(t.room.phase).toBe('warmup');
    expect(t.events().slice(-3)).toEqual(['unready 1', 'cancel', 'warmup 0']);
  });

  it('(d) Estándar: dos games del mismo → mend score [2,0]; warm-up con Listos a 0 y saca el perdedor; entre games, 4 s', () => {
    const t = toMatch({ random: [0.3] });
    const g1 = t.auth();
    expect(g1.g).toEqual({ firstServer: 0, n0: 2, practice: false, game: 1 });
    t.act(9000, () => g1.emitPoint(1));
    expect(t.room.phase).toBe('match');
    g1.record.rejected.push({ from: 1, kind: 'toss', why: 'turn' });
    t.take();

    t.act(20000, () => g1.emitGameOver(0));
    let m = t.take();
    expect(t.room.phase).toBe('between');
    expect(order(m)).toEqual(['0:pt', '1:pt', '0:room', '1:room']);
    expect(lastRoom(m, 0)).toEqual(expect.objectContaining({ ph: 'between', gw: [1, 0], dk: 'between', dl: 4000 }));
    expect(t.room.nextDeadline()).toBe(24000);
    t.room.poll(23999);
    expect(t.room.phase).toBe('between');
    t.room.poll(24000);
    const g2 = t.auth();
    expect(g2).not.toBe(g1);
    expect(g2.g).toEqual({ firstServer: 1, n0: g1.rally, practice: false, game: 2 });
    expect(t.room.phase).toBe('match');
    m = t.take();
    expect(order(m)).toEqual(['0:room', '1:room', '0:start', '1:start']);
    expect(lastRoom(m, 1)).toEqual(expect.objectContaining({ ph: 'match', gw: [1, 0] }));

    t.act(40000, () => g2.emitGameOver(0));
    m = t.take();
    expect(order(m)).toEqual(['0:pt', '1:pt', '0:mend', '1:mend', '0:room', '1:room', '0:start', '1:start']);
    // Estadísticas y rechazos solo de los games (el punto y el rechazo del warm-up no cuentan).
    const games = [g1.record, g2.record];
    const mend: MatchEndMsg = { k: 'mend', w: 0, why: 'score', gw: [2, 0], st: [matchStats(games, 0), matchStats(games, 1)], rj: [0, 1] };
    expect(mend.st).toEqual([
      { pf: 0, ms: 0, ne: 0, pts: 2 },
      { pf: 0, ms: 0, ne: 0, pts: 1 },
    ]);
    expect(sent(m, 0, 'mend')).toEqual([mend]);
    expect(sent(m, 1, 'mend')).toEqual([mend]);
    expect(lastRoom(m, 0)).toEqual(expect.objectContaining({ ph: 'warmup', gw: [0, 0], dk: '', pl: [expect.objectContaining({ r: 0 }), expect.objectContaining({ r: 0 })] }));
    expect(t.room.phase).toBe('warmup');
    expect(t.auth().g).toEqual({ firstServer: 1, n0: g2.rally, practice: true, game: 0 });
    expect(sent(m, 1, 'start')).toEqual([{ k: 'start', fs: 1, n: g2.rally, wu: 1, g: 0, sc: [0, 0], ns: 1 }]);
    expect(t.room.record.matches).toEqual([
      {
        mode: 'standard',
        firstServer: 0,
        winner: 0,
        why: 'score',
        games: [
          { winner: 0, score: [11, 6], firstServer: 0 },
          { winner: 0, score: [11, 6], firstServer: 1 },
        ],
      },
    ]);
    expect(t.room.record.authorities).toHaveLength(4);

    // Revancha: Listo otra vez.
    t.room.receive(1, rdy(1), 41000);
    t.room.receive(0, rdy(1), 41500);
    expect(t.room.phase).toBe('countdown');
  });

  it('(d) Rápido acaba en 1 game; Completo en 3 ganados, con el fs alternando por game', () => {
    const q = toMatch({ mode: 'quick' });
    q.act(9000, () => q.auth().emitGameOver(1));
    expect(sent(q.take(), 0, 'mend')).toEqual([expect.objectContaining({ w: 1, why: 'score', gw: [0, 1] })]);
    expect(q.room.phase).toBe('warmup');

    const f = toMatch({ mode: 'full', random: [0.7] });
    const winners: Side[] = [1, 0, 1, 1];
    const fs: Side[] = [];
    let now = 5000;
    for (const [i, w] of winners.entries()) {
      const g = f.auth();
      expect(g.g?.game).toBe(i + 1);
      fs.push(g.g?.firstServer ?? 0);
      now += 10000;
      f.act(now, () => g.emitGameOver(w));
      if (i < winners.length - 1) {
        expect(f.room.phase).toBe('between');
        now += 4000;
        f.room.poll(now);
        expect(f.room.phase).toBe('match');
      }
    }
    expect(fs).toEqual([1, 0, 1, 0]);
    expect(sent(f.take(), 0, 'mend')).toEqual([expect.objectContaining({ w: 1, why: 'score', gw: [1, 3] })]);
    expect(f.room.record.matches[0].games.map((g) => g.firstServer)).toEqual([1, 0, 1, 0]);
    expect(f.room.record.matches[0].games.map((g) => g.winner)).toEqual([1, 0, 1, 1]);
    // Saca el que perdió el partido.
    expect(f.auth().g).toEqual(expect.objectContaining({ practice: true, firstServer: 0 }));
  });

  it('el fin del partido dentro de receive (re-entrada): mend y warm-up; la autoridad vieja ya no llega a nadie', () => {
    const t = toMatch({ mode: 'quick' });
    const g = t.auth();
    g.onEnd = () => g.emitGameOver(0);
    t.room.receive(1, { k: 'end', n: 2, f: 1 }, 9000);
    expect(order(t.take())).toEqual(['0:pt', '1:pt', '0:mend', '1:mend', '0:room', '1:room', '0:start', '1:start']);
    expect(t.room.phase).toBe('warmup');
    // Lo que hiciera la autoridad retirada no sale ni cambia la sala.
    g.receive(0, pad(3), 9100);
    g.emitGameOver(1);
    expect(t.take()).toEqual([]);
    expect(t.room.record.matches).toHaveLength(1);
    expect(t.room.phase).toBe('warmup');
  });

  it('(e) se corta con un vuelo en juego: ausente y sigue el partido; pausa al acabar el punto; vuelve con el token a los 10 s', () => {
    const t = toMatch();
    const g = t.auth();
    g.flight();
    t.room.disconnect(1, 6000);
    let m = t.take();
    expect(g.calls).toContain('absent 1 1');
    expect(t.room.phase).toBe('match');
    expect(m).toEqual([{ to: 0, msg: expect.objectContaining({ k: 'room', ph: 'match', pl: [expect.objectContaining({ c: 1 }), expect.objectContaining({ c: 0 })] }) }]);

    // El punto acaba (el ausente no devuelve) a los 3 s del corte.
    t.act(9000, () => g.emitPoint(0));
    m = t.take();
    expect(t.room.phase).toBe('paused');
    expect(g.calls.at(-1)).toBe('pause');
    expect(order(m)).toEqual(['0:pt', '0:room']);
    expect(lastRoom(m, 0)).toEqual(expect.objectContaining({ ph: 'paused', dk: 'pause', dl: 27000 }));
    expect(t.room.nextDeadline()).toBe(36000);

    expect(t.room.join(hello('Bea', t.tk[1]), 16000)).toEqual({ ok: true, side: 1, resumed: true });
    m = t.take();
    expect(m[0]).toEqual({ to: 1, msg: { k: 'welcome', v: PROTOCOL_VERSION, side: 1, room: 'ABCD', tk: t.tk[1], md: 'standard' } });
    const count = expect.objectContaining({ ph: 'countdown', dk: 'count', dl: 3000, pl: [expect.objectContaining({ c: 1 }), expect.objectContaining({ c: 1 })] });
    expect(lastRoom(m, 0)).toEqual(count);
    expect(lastRoom(m, 1)).toEqual(count);
    expect(g.calls).toContain('absent 1 0');
    expect(t.room.nextDeadline()).toBe(19000);

    t.room.poll(18999);
    expect(t.room.phase).toBe('countdown');
    t.room.poll(19000);
    m = t.take();
    expect(t.room.phase).toBe('match');
    expect(g.calls.at(-1)).toBe('resume');
    expect(t.fakes).toHaveLength(2);
    const start: StartMsg = { k: 'start', fs: 0, n: g.rally, wu: 0, g: 1, sc: [1, 0], ns: 0 };
    expect(order(m)).toEqual(['0:room', '1:room', '0:start', '1:start']);
    expect(sent(m, 1, 'start')).toEqual([start]);
    expect(t.events().slice(-5)).toEqual(['disconnect 1', 'pause 1', 'rejoin 1', 'countdown resume', 'resume']);
  });

  it('(e) si vuelve antes de que acabe el punto: al acabar, cuenta atrás y resume sin pasar por la pausa', () => {
    const t = toMatch();
    const g = t.auth();
    g.flight();
    t.room.disconnect(1, 6000);
    expect(t.room.join(hello('Bea', t.tk[1]), 6500)).toEqual({ ok: true, side: 1, resumed: true });
    expect(t.room.phase).toBe('match');
    // El punto en juego sigue cerrándose como si no devolviera la bola.
    expect(g.calls).not.toContain('absent 1 0');
    t.act(8000, () => g.emitPoint(0));
    expect(t.room.phase).toBe('countdown');
    expect(g.calls.slice(-2)).toEqual(['pause', 'absent 1 0']);
    t.room.poll(11000);
    expect(t.room.phase).toBe('match');
    expect(g.calls.at(-1)).toBe('resume');
    expect(t.all.some((o) => 'msg' in o && o.msg.k === 'room' && o.msg.ph === 'paused')).toBe(false);
  });

  it('(e) cortes en otras fases: warm-up (pausa y reanuda), cuenta atrás (se cancela), cuenta atrás de vuelta (pausa)', () => {
    const t = warm();
    const p = t.auth();
    t.room.receive(1, rdy(1), 500);
    t.room.disconnect(1, 1000);
    let m = t.take();
    expect(p.calls.at(-1)).toBe('pause');
    expect(t.room.phase).toBe('warmup');
    expect(lastRoom(m, 0)).toEqual(expect.objectContaining({ ph: 'warmup', dk: 'pause', dl: 30000, pl: [expect.objectContaining({ c: 1 }), expect.objectContaining({ c: 0, r: 0 })] }));
    t.room.join(hello('Bea', t.tk[1]), 3000);
    m = t.take();
    expect(p.calls.at(-1)).toBe('resume');
    expect(order(m)).toEqual(['1:welcome', '0:room', '1:room', '0:start', '1:start']);

    t.room.receive(0, rdy(1), 4000);
    t.room.receive(1, rdy(1), 4100);
    expect(t.room.phase).toBe('countdown');
    t.room.disconnect(0, 5000);
    expect(t.room.phase).toBe('warmup');
    expect(t.fakes).toHaveLength(2);
    expect(t.auth().calls).toEqual(['start', 'pause']);
    expect(t.events()).toContain('cancel');

    const u = toMatch();
    u.room.disconnect(1, 6000);
    u.room.join(hello('Bea', u.tk[1]), 7000);
    expect(u.room.phase).toBe('countdown');
    u.room.disconnect(0, 8000);
    expect(u.room.phase).toBe('paused');
    expect(lastRoom(u.take(), 1)).toEqual(expect.objectContaining({ ph: 'paused', dk: 'pause', dl: 30000 }));
    expect(u.room.nextDeadline()).toBe(38000);
  });

  it('(f) sin vuelta: a los 30 s del corte, mend abandon para el presente y a esperar rival', () => {
    const t = toMatch();
    const g = t.auth();
    t.room.disconnect(1, 6000);
    let m = t.take();
    expect(t.room.phase).toBe('paused');
    expect(lastRoom(m, 0)).toEqual(expect.objectContaining({ ph: 'paused', dk: 'pause', dl: 30000 }));
    t.room.poll(35999);
    expect(t.room.phase).toBe('paused');
    t.room.poll(36000);
    m = t.take();
    expect(m.every((o) => o.to === 0)).toBe(true);
    expect(sent(m, 0, 'mend')).toEqual([{ k: 'mend', w: 0, why: 'abandon', gw: [0, 0], st: [matchStats([g.record], 0), matchStats([g.record], 1)], rj: [0, 0] }]);
    expect(lastRoom(m, 0)).toEqual({ k: 'room', code: 'ABCD', md: 'standard', ph: 'waiting', pl: [{ nm: 'Ana', c: 1, r: 0, rt: 0 }, null], gw: [0, 0], dl: -1, dk: '' });
    expect(t.room.phase).toBe('waiting');
    expect(t.room.players).toBe(1);
    expect(t.room.record.matches).toEqual([{ mode: 'standard', firstServer: 0, winner: 0, why: 'abandon', games: [] }]);
    expect(t.events()).toContain('abandon 1');
    // Su hueco ya no existe: con su token entra como nuevo.
    expect(t.room.join(hello('Bea', t.tk[1]), 40000)).toEqual({ ok: true, side: 1, resumed: false });
    expect(t.room.phase).toBe('warmup');
    expect(t.auth().g).toEqual(expect.objectContaining({ practice: true, firstServer: 0 }));
  });

  it('(f) abandono en el game 2: los games acabados quedan en el registro y en el mend', () => {
    const t = toMatch({ mode: 'full' });
    t.act(9000, () => t.auth().emitGameOver(1));
    t.room.disconnect(1, 10000);
    t.room.poll(13000);
    expect(t.room.phase).toBe('paused');
    t.room.poll(40000);
    expect(sent(t.take(), 0, 'mend')).toEqual([expect.objectContaining({ w: 0, why: 'abandon', gw: [0, 1] })]);
    expect(t.room.record.matches[0]).toEqual(expect.objectContaining({ winner: 0, why: 'abandon', games: [{ winner: 1, score: [6, 11], firstServer: 0 }] }));
  });

  it('(g) leave en el partido = abandono inmediato; en el warm-up, a esperar rival sin reserva', () => {
    const t = toMatch();
    t.room.receive(1, { k: 'leave' }, 7000);
    let m = t.take();
    expect(m[0]).toEqual({ to: 1, drop: true });
    expect(sent(m, 0, 'mend')).toEqual([expect.objectContaining({ w: 0, why: 'abandon' })]);
    expect(m.slice(1).every((o) => o.to === 0)).toBe(true);
    expect(t.room.phase).toBe('waiting');
    expect(t.room.players).toBe(1);
    expect(t.room.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    expect(t.events().slice(-2)).toEqual(['leave 1', 'abandon 1']);

    const u = warm();
    u.room.receive(0, { k: 'leave' }, 2000);
    m = u.take();
    expect(m).toEqual([
      { to: 0, drop: true },
      { to: 1, msg: { k: 'room', code: 'ABCD', md: 'standard', ph: 'waiting', pl: [null, { nm: 'Bea', c: 1, r: 0, rt: 0 }], gw: [0, 0], dl: -1, dk: '' } },
    ]);
    expect(u.room.phase).toBe('waiting');
    expect(u.room.players).toBe(1);
    expect(u.room.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    expect(u.room.record.matches).toEqual([]);
    expect(u.room.join(hello('Cris'), 3000)).toEqual({ ok: true, side: 0, resumed: false });
    expect(u.room.phase).toBe('warmup');
  });

  it('(h) token desconocido con la sala llena → full', () => {
    const t = warm();
    expect(t.room.join(hello('Cris', 'desconocido-123'), 1000)).toEqual({ ok: false, err: 'full' });
    expect(t.take()).toEqual([]);
    expect(t.room.players).toBe(2);
  });

  it('(h) el mismo token aún conectado (pestaña duplicada): bye y drop a la vieja, la nueva ocupa el lado, sin pausa', () => {
    const t = warm();
    expect(t.room.join(hello('Ana', t.tk[0]), 1000)).toEqual({ ok: true, side: 0, resumed: true });
    let m = t.take();
    expect(m.slice(0, 3)).toEqual([
      { to: 0, msg: { k: 'bye', m: 'Conectado desde otra pestaña' } },
      { to: 0, drop: true },
      { to: 0, msg: { k: 'welcome', v: PROTOCOL_VERSION, side: 0, room: 'ABCD', tk: t.tk[0], md: 'standard' } },
    ]);
    expect(rooms(m, 0)).toHaveLength(1);
    expect(rooms(m, 1)).toEqual([]);
    expect(sent(m, 0, 'start')).toHaveLength(1);
    expect(t.room.phase).toBe('warmup');
    expect(t.room.players).toBe(2);
    expect(t.events()).toContain('replace 0');

    // En el partido, con un vuelo en juego: el punto acaba como si no devolviera, cuenta atrás y resume.
    const u = toMatch();
    const g = u.auth();
    g.flight();
    expect(u.room.join(hello('Bea', u.tk[1]), 6000)).toEqual({ ok: true, side: 1, resumed: true });
    m = u.take();
    expect(order(m).slice(0, 3)).toEqual(['1:bye', '1:drop', '1:welcome']);
    expect(rooms(m, 0)).toEqual([]);
    expect(g.calls).toContain('absent 1 1');
    expect(u.room.phase).toBe('match');
    u.act(7000, () => g.emitPoint(0));
    expect(u.room.phase).toBe('countdown');
    u.room.poll(10000);
    expect(u.room.phase).toBe('match');
    expect(g.calls.at(-1)).toBe('resume');
    expect(sent(u.take(), 1, 'start')).toHaveLength(1);
    expect(u.all.some((o) => 'msg' in o && o.msg.k === 'room' && (o.msg.ph === 'paused' || o.msg.pl.some((p) => p?.c === 0)))).toBe(false);
    expect(u.events().some((e) => e.startsWith('pause') || e.startsWith('disconnect'))).toBe(false);
    expect(u.events()).toContain('replace 1');
  });

  it('(i) se van los dos: la sala se cierra a los 30 s del último corte, no antes', () => {
    const t = warm();
    t.room.disconnect(0, 1000);
    t.room.disconnect(1, 5000);
    expect(t.room.nextDeadline()).toBe(31000);
    t.room.poll(31000);
    expect(t.room.closed).toBe(false);
    expect(t.room.players).toBe(1);
    t.room.poll(34999);
    expect(t.room.closed).toBe(false);
    t.room.poll(35000);
    expect(t.room.closed).toBe(true);
    expect(t.room.players).toBe(0);
    expect(t.room.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    expect(t.room.join(hello('Cris'), 36000)).toEqual({ ok: false, err: 'room' });

    // En el partido: abandono al vencer la primera reserva y cierre al vencer la última.
    const u = toMatch();
    u.room.disconnect(0, 6000);
    u.room.disconnect(1, 8000);
    u.room.poll(36000);
    expect(u.room.record.matches).toEqual([expect.objectContaining({ winner: 1, why: 'abandon' })]);
    expect(u.room.closed).toBe(false);
    u.room.poll(37999);
    expect(u.room.closed).toBe(false);
    u.room.poll(38000);
    expect(u.room.closed).toBe(true);
    expect(u.events().at(-1)).toBe('closed');
  });

  it('(j) ping: pong al que lo manda en cualquier fase; pings a los dos y setPing a la autoridad', () => {
    const t = setup();
    t.room.join(hello('Ana'), 0);
    t.take();
    t.room.receive(0, { k: 'ping', i: 1, t: 50, a: -1 }, 100);
    expect(t.take()).toEqual([{ to: 0, msg: { k: 'pong', i: 1, t: 50 } }]);
    t.room.receive(0, { k: 'ping', i: 2, t: 2050, a: 40 }, 2100);
    expect(t.take()).toEqual([
      { to: 0, msg: { k: 'pong', i: 2, t: 2050 } },
      { to: 0, msg: { k: 'pings', a: [40, -1] } },
    ]);

    t.room.join(hello('Bea'), 3000);
    const m = t.take();
    expect(sent(m, 1, 'pings')).toEqual([{ k: 'pings', a: [40, -1] }]);
    // Cada autoridad nueva empieza con los pings conocidos.
    expect(t.auth().calls).toEqual(['ping 0 40', 'start']);

    t.room.receive(1, { k: 'ping', i: 7, t: 10, a: 80 }, 4000);
    expect(t.take()).toEqual([
      { to: 1, msg: { k: 'pong', i: 7, t: 10 } },
      { to: 0, msg: { k: 'pings', a: [40, 80] } },
      { to: 1, msg: { k: 'pings', a: [40, 80] } },
    ]);
    expect(t.auth().calls.at(-1)).toBe('ping 1 80');

    // En la cuenta atrás también; y el game 1 los hereda.
    t.room.receive(0, rdy(1), 5000);
    t.room.receive(1, rdy(1), 5000);
    t.room.receive(0, { k: 'ping', i: 3, t: 4000, a: 44 }, 6000);
    expect(sent(t.take(), 0, 'pong')).toEqual([{ k: 'pong', i: 3, t: 4000 }]);
    t.room.poll(8000);
    expect(t.room.phase).toBe('match');
    expect(t.auth().calls.slice(0, 2)).toEqual(['ping 0 44', 'ping 1 80']);
  });

  it('(k) toss/hit en countdown, between o paused no llegan a la autoridad; p sí, y se reenvía si el rival está conectado', () => {
    const t = warm();
    const p = t.auth();
    t.room.receive(0, toss(0), 500);
    expect(p.received.map((r) => r.msg.k)).toEqual(['toss']);

    t.room.receive(0, rdy(1), 1000);
    t.room.receive(1, rdy(1), 1000);
    expect(t.room.phase).toBe('countdown');
    t.take();
    t.room.receive(0, toss(0), 1100);
    t.room.receive(1, hit(0), 1100);
    t.room.receive(1, { k: 'end', n: 0, f: 0 }, 1100);
    t.room.receive(1, { k: 'wf', n: 0, f: 0, t: 300 }, 1100);
    t.room.receive(0, pad(1), 1200);
    expect(p.received.map((r) => r.msg.k)).toEqual(['toss', 'p']);
    expect(t.take()).toEqual([{ to: 1, msg: pad(1) }]);

    t.room.poll(4000);
    const g = t.auth();
    t.room.receive(0, toss(1), 4100);
    expect(g.received.map((r) => r.msg.k)).toEqual(['toss']);

    t.act(9000, () => g.emitGameOver(0));
    expect(t.room.phase).toBe('between');
    t.take();
    t.room.receive(1, hit(1), 9100);
    t.room.receive(1, toss(2), 9100);
    t.room.receive(1, pad(2), 9200);
    expect(g.received.map((r) => r.msg.k)).toEqual(['toss', 'p']);
    expect(t.take()).toEqual([{ to: 0, msg: pad(2) }]);

    t.room.poll(13000);
    const g2 = t.auth();
    t.room.disconnect(1, 14000);
    expect(t.room.phase).toBe('paused');
    t.take();
    t.room.receive(0, toss(3), 14100);
    t.room.receive(0, hit(3), 14100);
    t.room.receive(0, pad(3), 14200);
    expect(g2.received.map((r) => r.msg.k)).toEqual(['p']);
    // El rival no está conectado: no se le manda nada.
    expect(t.take()).toEqual([]);
  });

  it('(l) nextDeadline es siempre el plazo más cercano (aviso, autoridad, reserva, timeout, cuenta atrás, entre games)', () => {
    const t = warm();
    expect(t.room.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    t.room.receive(0, rdy(1), 1000);
    expect(t.room.nextDeadline()).toBe(151000);
    t.auth().at(2000, () => {});
    expect(t.room.nextDeadline()).toBe(2000);
    t.room.poll(2000);
    expect(t.room.nextDeadline()).toBe(151000);
    t.room.disconnect(1, 130000);
    expect(t.room.nextDeadline()).toBe(151000);
    t.room.poll(151000);
    expect(t.room.nextDeadline()).toBe(160000);
    t.room.join(hello('Bea', t.tk[1]), 155000);
    expect(t.room.nextDeadline()).toBe(181000);
    t.room.receive(1, rdy(1), 156000);
    expect(t.room.phase).toBe('countdown');
    expect(t.room.nextDeadline()).toBe(159000);
    t.room.poll(159000);
    expect(t.room.phase).toBe('match');
    expect(t.room.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    const g = t.auth();
    g.at(165000, () => {});
    expect(t.room.nextDeadline()).toBe(165000);
    t.room.poll(165000);
    t.act(170000, () => g.emitGameOver(0));
    expect(t.room.nextDeadline()).toBe(174000);
    t.room.disconnect(0, 172000);
    expect(t.room.nextDeadline()).toBe(174000);
    t.room.poll(174000);
    expect(t.room.phase).toBe('paused');
    expect(t.room.nextDeadline()).toBe(202000);
  });

  it('(l) un temporizador que llega tarde atiende los plazos vencidos en orden', () => {
    const t = toMatch({ mode: 'standard' });
    const g = t.auth();
    t.act(9000, () => g.emitGameOver(0));
    // El fin de los 4 s entre games (13000) y nada más: un poll a los 20 s empieza el game 2 una vez.
    t.room.poll(20000);
    expect(t.room.phase).toBe('match');
    expect(t.fakes).toHaveLength(3);
    // Una reserva vencida antes que el plazo de la autoridad: primero el abandono.
    const g2 = t.auth();
    g2.flight();
    t.room.disconnect(1, 21000);
    g2.at(60000, () => g2.emitPoint(0));
    t.room.receive(0, pad(9), 70000);
    expect(t.room.phase).toBe('waiting');
    expect(t.room.record.matches).toEqual([expect.objectContaining({ why: 'abandon', winner: 0 })]);
    expect(g2.record.points).toEqual([]);
  });

  it('(m) rt 1 → room con rt 1 para ese jugador; los nombres llegan limpios en pl', () => {
    const t = setup();
    const evil = '<img src=x onerror=alert(1)>';
    t.room.join(hello(evil), 0);
    t.room.join(hello('\u200B\u202E  \u0007'), 0);
    let m = t.take();
    const pl = lastRoom(m, 1).pl;
    expect(pl[0]?.nm).toBe(cleanName(evil, 'Jugador 1', cfg));
    expect(pl[0]?.nm).not.toMatch(/[<>]/);
    expect(Array.from(pl[0]?.nm ?? '').length).toBeLessThanOrEqual(16);
    expect(pl[1]?.nm).toBe('Jugador 2');

    t.room.receive(1, { k: 'rt', on: 1 }, 1000);
    m = t.take();
    const withRt = expect.objectContaining({ pl: [expect.objectContaining({ rt: 0 }), expect.objectContaining({ rt: 1 })] });
    expect(rooms(m, 0)).toEqual([withRt]);
    expect(rooms(m, 1)).toEqual([withRt]);
    t.room.receive(1, { k: 'rt', on: 1 }, 1100);
    expect(t.take()).toEqual([]);
    t.room.receive(1, { k: 'rt', on: 0 }, 1200);
    expect(lastRoom(t.take(), 0).pl[1]?.rt).toBe(0);

    // Un nombre vacío en el lado 0 → «Jugador 1».
    const u = setup();
    u.room.join(hello(''), 0);
    expect(lastRoom(u.take(), 0).pl[0]?.nm).toBe('Jugador 1');
  });

  it('room solo sale cuando cambia algo: nada en cada mensaje de raqueta ni en cada poll', () => {
    const t = toMatch();
    for (let i = 0; i < 300; i++) {
      t.room.receive(0, pad(2), 6000 + i * 33);
      t.room.poll(6000 + i * 33);
    }
    expect(rooms(t.take(), 0)).toEqual([]);
  });

  it('con la autoridad real (ServerMatch): quien saca se corta tras lanzar → pierde al acabar el lanzamiento, pausa y resume', () => {
    const out: Out[] = [];
    let tk = 0;
    const room = new RoomCore({
      cfg,
      code: 'WXYZ',
      mode: 'quick',
      send: (to, msg) => out.push({ to, msg }),
      drop: (to) => out.push({ to, drop: true }),
      newToken: () => `real-${++tk}-abcdef`,
      random: () => 0.3,
    });
    room.join(hello('Ana'), 0);
    room.join(hello('Bea'), 0);
    expect(sent(out, 1, 'start')).toEqual([{ k: 'start', fs: 0, n: 0, wu: 1, g: 0, sc: [0, 0], ns: 0 }]);
    room.receive(0, rdy(1), 1000);
    room.receive(1, rdy(1), 1000);
    room.poll(4000);
    expect(room.phase).toBe('match');
    expect(sent(out, 1, 'start').at(-1)).toEqual({ k: 'start', fs: 0, n: 1, wu: 0, g: 1, sc: [0, 0], ns: 0 });
    out.length = 0;

    room.receive(0, toss(1), 5000);
    expect(sent(out, 1, 'toss')).toEqual([toss(1)]);
    const fallback = room.nextDeadline();
    expect(fallback).toBeGreaterThan(5000);
    expect(fallback).toBeLessThan(Number.POSITIVE_INFINITY);
    room.disconnect(0, 5100);
    expect(room.phase).toBe('match');
    // Ausente: el punto se cierra al acabar el lanzamiento, sin el respaldo de 3 s.
    const end = room.nextDeadline();
    expect(end).toBeLessThan(fallback);
    room.poll(end - 1);
    expect(sent(out, 1, 'pt')).toEqual([]);
    room.poll(end);
    expect(sent(out, 1, 'pt')).toEqual([expect.objectContaining({ n: 1, w: 1, r: 'TOSS_MISSED', sc: [0, 1], go: -1 })]);
    expect(room.phase).toBe('paused');
    expect(lastRoom(out, 1)).toEqual(expect.objectContaining({ ph: 'paused', dk: 'pause', dl: Math.round(5100 + 30000 - end) }));

    room.join(hello('Ana', 'real-1-abcdef'), 8000);
    room.poll(11000);
    expect(room.phase).toBe('match');
    expect(sent(out, 0, 'start')).toEqual([expect.objectContaining({ wu: 0, g: 1, sc: [0, 1], n: 3 })]);
    // Lo tardío del rally cortado no es un rechazo.
    room.receive(0, { k: 'end', n: 2, f: 0 }, 11100);
    expect(room.record.authorities[1].rejected).toEqual([]);
  });

  it('mensajes de lados sin conexión, hello y again repetidos: no hacen nada y no lanzan', () => {
    const t = setup();
    t.room.join(hello('Ana'), 0);
    t.take();
    expect(() => t.room.receive(1, pad(0), 10)).not.toThrow();
    expect(() => t.room.disconnect(1, 10)).not.toThrow();
    t.room.receive(0, hello('Otra'), 20);
    t.room.receive(0, { k: 'again' }, 20);
    t.room.receive(0, rdy(1), 20);
    expect(t.take()).toEqual([]);
    expect(t.room.phase).toBe('waiting');
  });
});
