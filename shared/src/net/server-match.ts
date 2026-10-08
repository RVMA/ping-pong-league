/**
 * Partida en el servidor [§17.2, §17.3]: la autoridad de un game (o del warm-up). Funciona por eventos, sin simular a
 * 120 Hz todo el rato:
 *  - al recibir un golpe, lo valida, lo recalcula con el mismo código que el cliente (resolveHit) y difunde a los dos
 *    el estado de salida oficial del vuelo nuevo;
 *  - conoce el desenlace de cada vuelo sin golpe al crearlo: si el receptor no puede cambiarlo, cierra el punto en el
 *    acto; si puede, espera su golpe o su `end` (su cliente sabe que no golpeó), con un temporizador de respaldo;
 *  - decide puntos, saque, marcador y fin del game, y reenvía la raqueta (sin teclas) y los fallos al rival.
 *
 * En una sala (V0.4, §14) es la `GameAuthority` que maneja la sala:
 *  - práctica (warm-up, §14.2): el punto no suma, saca quien perdió la bola (en un let, el mismo) y nunca acaba;
 *  - número de rally monótono: empieza en `n0` y nunca vuelve atrás; lo de un rally anterior a `n0` o cortado por la
 *    pausa es pasado y se ignora sin contar como rechazo (lo tardío de un rally que acabó en punto aquí sí lo es);
 *  - pausa: corta el rally en juego sin punto y descarta lanzamientos, golpes y `end` hasta reanudar; al reanudar
 *    manda `start` con el marcador, el saque y el número de rally actuales;
 *  - receptor ausente (§14.4, P56): el punto se cierra al acabar el vuelo que le llega, sin el respaldo de 3 s;
 *  - plazos: `nextDeadline()` dice cuándo hay que llamar a `poll` (un solo temporizador en el servidor).
 * Sin `GameStart`, `start` es el modo bot de V0.3: un game desde el rally 0, y contesta `ping` y `again`.
 * Nunca lanza: un mensaje fuera de turno o imposible se descarta y queda registrado.
 */
import { type GameConfig, simDt, tickMs } from '../config.ts';
import type { QualityTier } from '../hit.ts';
import { type BallState, makeEnv, type PhysicsEnv } from '../physics.ts';
import { isGameOver, newRally, type PointReason, type RallyState, serverFor } from '../rules.ts';
import type { ShotType } from '../stroke.ts';
import type { Side } from '../types.ts';
import { evalTick, Flight, type FlightOutcome, strikeRally } from './flight.ts';
import { type C2S, exitFromWire, exitToWire, type HitMsg, type HitWire, hitFromWire, type PointMsg, type S2C } from './protocol.ts';
import { resolveHit } from './resolve.ts';
import { validClickTime, validPaddleBounds, validReach } from './validate.ts';

export interface MatchRecord {
  points: { n: number; winner: Side | -1; reason: PointReason | 'LET'; score: [number, number] }[];
  hits: { n: number; f: number; player: Side; tier: QualityTier; type: ShotType; dtMs: number; serve: boolean }[];
  rejected: { from: Side; kind: string; why: string }[];
  /**
   * Descartados sin culpa del jugador, que no son rechazos ni discrepancias: llegaron con la partida en pausa
   * ('paused') o son de un rally pasado que no acabó en punto aquí, uno anterior a `n0` o uno cortado por la pausa
   * ('past'). Lo tardío de un rally que sí acabó en punto en esta autoridad es un rechazo ('stale').
   */
  ignored: { from: Side; kind: string; why: 'paused' | 'past' }[];
  /** CPU del servidor por golpe (validar, recalcular y calcular el vuelo nuevo), ms. */
  hitCpuMs: number[];
  winner: Side | null;
}

export interface ServerMatchOptions {
  send: (to: Side, msg: S2C) => void;
  /** Primer saque del modo bot de V0.3 (`start` sin GameStart). */
  firstServer?: Side;
  log?: (line: string) => void;
}

/** Cómo empieza un game (o el warm-up) en una sala. */
export interface GameStart {
  /** Quién sacó primero en este game: la alternancia del saque (§9.3) se cuenta desde él. */
  firstServer: Side;
  /** Número del primer rally: el siguiente al último de la sala (nunca vuelve a 0). */
  n0: number;
  /** Warm-up: sin marcador, saca quien perdió la bola y el game nunca acaba. */
  practice: boolean;
  /** Game (1, 2, 3…). En práctica no cuenta: el `start` lleva g 0. */
  game: number;
  /** Marcador con que empieza (por defecto 0-0; en práctica no hay marcador). */
  score?: [number, number];
  /** Quién saca el primer rally (por defecto: en práctica, firstServer; en un game, el que toca con el marcador). */
  server?: Side;
}

/** Lo que la sala usa de la autoridad de cada game (en los tests de la sala, un falso). */
export interface GameAuthority {
  /** Manda `start` (v2) a los dos; sin `g`, el modo bot de V0.3. */
  start(now: number, g?: GameStart): void;
  /** p, toss, hit, wf, end (y ping/again en el modo bot de V0.3). Antes atiende los plazos vencidos. */
  receive(from: Side, msg: C2S, now: number): void;
  /** Cierra el punto si venció su plazo (respaldo, o fin del vuelo con el receptor ausente). */
  poll(now: number): void;
  /** Corta el rally en juego sin punto (su n queda pasado) y descarta toss/hit/end ('paused') hasta resume. */
  pause(): void;
  /**
   * Manda `start` con el marcador, el saque y el n actuales (si no estaba en pausa, corta antes el rally en juego). Con
   * el game ya acabado solo quita la pausa.
   */
  resume(now: number): void;
  /** Receptor ausente: el punto se cierra al acabar el vuelo que le llega. */
  setAbsent(side: Side, absent: boolean): void;
  /** Media del ping de ese lado (ms), para el temporizador de respaldo. */
  setPing(side: Side, ms: number): void;
  /** Cuándo hay que llamar a `poll` (Infinity sin plazo). */
  nextDeadline(): number;
  /** Hay un vuelo en juego: el marcador aún puede cambiar. */
  readonly busy: boolean;
  /** n del próximo rally, el primero que nadie ha usado: con un vuelo en juego, el siguiente al suyo. */
  readonly rally: number;
  readonly score: [number, number];
  readonly record: MatchRecord;
  /** Tras cada punto (también los let), ya con el estado del siguiente rally. */
  onPoint: (pm: PointMsg) => void;
  /** Una vez, al acabar el game (nunca en práctica). */
  onGameOver: (winner: Side, score: [number, number]) => void;
}

interface PadRec {
  n: number;
  r: number;
  x: number;
  z: number;
}

type Phase = 'idle' | 'serveHold' | 'flight' | 'over';

const PAD_RING = 64;

function other(s: Side): Side {
  return s === 0 ? 1 : 0;
}

const perf = (globalThis as { performance?: { now(): number } }).performance;
const cpuNow = (): number => (perf ? perf.now() : Date.now());

export class ServerMatch implements GameAuthority {
  readonly cfg: GameConfig;
  readonly record: MatchRecord = { points: [], hits: [], rejected: [], ignored: [], hitCpuMs: [], winner: null };
  onPoint: (pm: PointMsg) => void = () => {};
  onGameOver: (winner: Side, score: [number, number]) => void = () => {};
  private readonly env: PhysicsEnv;
  private readonly dt: number;
  private readonly tick: number;
  private readonly send: (to: Side, msg: S2C) => void;
  private readonly log: (line: string) => void;
  private readonly botFirstServer: Side;
  /** Empezó con GameStart: los ping los contesta la sala y no hay `again`. */
  private inRoom = false;
  private practice = false;
  private game = 1;
  private firstServer: Side;
  private phase: Phase = 'idle';
  private paused = false;
  private n = 0;
  /** Primer rally de este game: lo anterior es de otra autoridad (pasado). */
  private n0 = 0;
  /** Rallies cortados por la pausa sin punto: lo que llegue de ellos también es pasado. */
  private readonly cut = new Set<number>();
  private server: Side;
  private sc: [number, number] = [0, 0];
  private rallyState: RallyState = newRally();
  private flight: Flight | null = null;
  private f = 0;
  /** Tiempo de rally (ms) del índice 0 del vuelo actual. */
  private R = 0;
  /** Cuándo (reloj del servidor) se creó y envió el vuelo actual. */
  private sentAt = 0;
  private readonly pads: [PadRec[], PadRec[]] = [[], []];
  private readonly pings: [number, number] = [-1, -1];
  private readonly absent: [boolean, boolean] = [false, false];
  private readonly whiffs: [{ n: number; f: number; t: number } | null, { n: number; f: number; t: number } | null] = [null, null];

  constructor(cfg: GameConfig, opts: ServerMatchOptions) {
    this.cfg = cfg;
    this.env = makeEnv(cfg);
    this.dt = simDt(cfg);
    this.tick = tickMs(cfg);
    this.send = opts.send;
    this.log = opts.log ?? (() => {});
    this.botFirstServer = opts.firstServer ?? 0;
    this.firstServer = this.botFirstServer;
    this.server = this.firstServer;
  }

  get score(): [number, number] {
    return [this.sc[0], this.sc[1]];
  }

  get over(): boolean {
    return this.phase === 'over';
  }

  get busy(): boolean {
    return this.phase === 'flight';
  }

  get rally(): number {
    return this.phase === 'flight' ? this.n + 1 : this.n;
  }

  /** Empieza un game: con `g`, el que dice la sala; sin él, el modo bot de V0.3 (0-0 desde el rally 0). */
  start(now: number, g?: GameStart): void {
    void now;
    if (g) {
      this.inRoom = true;
      this.practice = g.practice;
      this.game = g.practice ? 0 : g.game;
      this.firstServer = g.firstServer;
      this.n = g.n0;
      this.sc = g.practice || !g.score ? [0, 0] : [g.score[0], g.score[1]];
      this.server = g.server ?? (g.practice ? g.firstServer : serverFor(this.sc, g.firstServer, this.cfg.rules));
    } else {
      this.inRoom = false;
      this.practice = false;
      this.game = 1;
      this.firstServer = this.botFirstServer;
      this.n = 0;
      this.sc = [0, 0];
      this.server = this.botFirstServer;
    }
    this.n0 = this.n;
    this.cut.clear();
    this.paused = false;
    this.record.winner = null;
    this.toServeHold();
    this.sendStart();
  }

  receive(from: Side, msg: C2S, now: number): void {
    try {
      // Un plazo vencido va antes que lo que llega después (el temporizador del servidor puede dispararse tarde).
      this.poll(now);
      this.handle(from, msg, now);
    } catch (e) {
      this.reject(from, msg.k, `error: ${(e as Error).message}`);
    }
  }

  /** Si quien debe golpear calla demasiado (o está ausente y su vuelo acabó), el punto se cierra con el desenlace del vuelo. */
  poll(now: number): void {
    const fl = this.flight;
    if (this.phase !== 'flight' || !fl || now < this.deadline(fl)) return;
    this.log(`${this.absent[fl.receiver] ? 'ausente' : 'respaldo'}: rally ${this.n} vuelo ${this.f} sin noticias del lado ${fl.receiver}`);
    this.closePoint(this.f, fl.end.i, fl.end.outcome);
  }

  nextDeadline(): number {
    const fl = this.flight;
    return this.phase === 'flight' && fl ? this.deadline(fl) : Number.POSITIVE_INFINITY;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.phase !== 'serveHold' && this.phase !== 'flight') return;
    // El rally en juego (o el que iba a empezar) se corta sin punto: lo que llegue de él ya es pasado.
    if (this.phase === 'flight') this.log(`pausa: rally ${this.n} cortado en el vuelo ${this.f}`);
    this.cut.add(this.n);
    this.n += 1;
    this.toServeHold();
  }

  resume(now: number): void {
    void now;
    if (this.phase !== 'serveHold' && this.phase !== 'flight') {
      this.paused = false;
      return;
    }
    if (!this.paused) this.pause();
    this.paused = false;
    this.sendStart();
  }

  setAbsent(side: Side, absent: boolean): void {
    this.absent[side] = absent;
  }

  setPing(side: Side, ms: number): void {
    if (Number.isFinite(ms)) this.pings[side] = ms;
  }

  /** Fin del vuelo si el receptor está ausente; si no, fin del vuelo + su ping + el respaldo. */
  private deadline(fl: Flight): number {
    const end = this.sentAt + fl.end.i * this.tick;
    if (this.absent[fl.receiver]) return end;
    return end + Math.max(0, this.pings[fl.receiver]) + this.cfg.net.timers.fallbackMs;
  }

  private toServeHold(): void {
    this.phase = 'serveHold';
    this.flight = null;
    this.rallyState = newRally();
    this.whiffs[0] = this.whiffs[1] = null;
  }

  private sendStart(): void {
    this.both({ k: 'start', fs: this.firstServer, n: this.n, wu: this.practice ? 1 : 0, g: this.game, sc: [this.sc[0], this.sc[1]], ns: this.server });
  }

  private both(msg: S2C): void {
    this.send(0, msg);
    this.send(1, msg);
  }

  private reject(from: Side, kind: string, why: string): void {
    this.record.rejected.push({ from, kind, why });
    this.log(`descartado ${kind} del lado ${from}: ${why}`);
  }

  /**
   * Lanzamiento, golpe o `end` que no llega a la autoridad, sin contar como rechazo: con la partida en pausa, o de un
   * rally pasado que no acabó en punto aquí (anterior a `n0`, o cortado por la pausa). Devuelve si se descartó.
   */
  private ignored(from: Side, kind: string, n: number): boolean {
    let why: 'paused' | 'past';
    if (this.paused) why = 'paused';
    else if (n < this.n0 || this.cut.has(n)) why = 'past';
    else return false;
    this.record.ignored.push({ from, kind, why });
    return true;
  }

  private handle(from: Side, msg: C2S, now: number): void {
    switch (msg.k) {
      case 'ping':
        // En una sala los contesta la sala, que pasa la media con setPing.
        if (this.inRoom) return;
        this.send(from, { k: 'pong', i: msg.i, t: msg.t });
        if (msg.a >= 0) {
          this.pings[from] = msg.a;
          this.both({ k: 'pings', a: [this.pings[0], this.pings[1]] });
        }
        return;
      case 'p': {
        const ring = this.pads[from];
        ring.push({ n: msg.n, r: msg.r, x: msg.x / 1000, z: msg.z / 1000 });
        if (ring.length > PAD_RING) ring.shift();
        this.send(other(from), msg);
        return;
      }
      case 'toss':
        if (this.ignored(from, 'toss', msg.n)) return;
        this.onToss(from, msg.n, msg.x / 1000, msg.z / 1000, msg, now);
        return;
      case 'hit':
        if (this.ignored(from, 'hit', msg.n)) return;
        this.onHit(from, msg, now);
        return;
      case 'wf':
        if (this.paused) return;
        if (this.phase === 'flight' && msg.n === this.n && msg.f === this.f && this.flight?.receiver === from) this.whiffs[from] = { n: msg.n, f: msg.f, t: msg.t };
        if (msg.n === this.n) this.send(other(from), { k: 'wf', n: msg.n, f: msg.f, t: msg.t, p: from });
        return;
      case 'end':
        if (this.ignored(from, 'end', msg.n)) return;
        // Lo tardío de un rally que acabó en punto aquí sí es un rechazo: el receptor y el servidor no coincidieron.
        if (this.phase !== 'flight' || !this.flight || msg.n !== this.n || msg.f !== this.f || this.flight.receiver !== from) {
          this.reject(from, 'end', 'stale');
          return;
        }
        this.closePoint(this.f, this.flight.end.i, this.flight.end.outcome);
        return;
      case 'again':
        if (!this.inRoom && this.phase === 'over') this.start(now);
        return;
      case 'hello':
      case 'rdy':
      case 'rt':
      case 'leave':
        return;
    }
  }

  private onToss(from: Side, n: number, x: number, z: number, msg: C2S, now: number): void {
    if (n < this.n) {
      this.reject(from, 'toss', 'stale');
      return;
    }
    if (this.phase !== 'serveHold' || n !== this.n || from !== this.server) {
      this.reject(from, 'toss', 'turn');
      return;
    }
    if (!validPaddleBounds({ x, z }, from, true, this.cfg)) {
      this.reject(from, 'toss', 'bounds');
      return;
    }
    const exit: BallState = {
      pos: { x, y: this.env.tableTop + this.cfg.serve.holdHeight, z },
      vel: { x: 0, y: this.cfg.serve.tossSpeed, z: 0 },
      spin: { x: 0, y: 0, z: 0 },
    };
    this.rallyState = newRally();
    this.flight = new Flight(this.cfg, this.env, exit, 'toss', from, this.rallyState);
    this.f = 0;
    this.R = 0;
    this.sentAt = now;
    this.phase = 'flight';
    this.whiffs[0] = this.whiffs[1] = null;
    this.send(other(from), msg as S2C);
  }

  private lastPad(side: Side, n: number, r: number): PadRec | null {
    const ring = this.pads[side];
    for (let i = ring.length - 1; i >= 0; i--) {
      const p = ring[i];
      if (p.n === n && p.r >= 0 && p.r <= r) return p;
    }
    return null;
  }

  private onHit(from: Side, msg: HitMsg, now: number): void {
    const fl = this.flight;
    if (this.phase !== 'flight' || !fl || msg.n !== this.n || msg.f !== this.f) {
      this.reject(from, 'hit', 'stale');
      return;
    }
    // Un golpe de quien no debe golpear este vuelo no es del receptor: se descarta sin tocar su punto.
    if (fl.receiver !== from) {
      this.reject(from, 'hit', 'turn');
      return;
    }
    // A partir de aquí el golpe es del vuelo actual: si no vale, el punto acaba como si no lo hubiera devuelto.
    const fail = (why: string) => {
      this.reject(from, 'hit', why);
      this.closePoint(this.f, fl.end.i, fl.end.outcome);
    };
    const input = hitFromWire(msg);
    const serve = fl.mode === 'toss';
    // «No más tarde de lo que pudo verse» solo vale para los vuelos que manda el servidor. El lanzamiento lo empieza el
    // cliente que saca, y el servidor solo sabe cuándo le llegó el `toss`: un pico de TCP lo retrasa y el golpe llega
    // justo detrás (FIFO), así que entre los dos parecen pasar menos ms que los que el cliente midió desde su lanzamiento.
    const seenMs = serve ? Number.POSITIVE_INFINITY : now - this.sentAt;
    if (!validClickTime(input.t, fl.end.i, seenMs, this.cfg)) return fail('time');
    const w = this.whiffs[from];
    if (w && w.n === this.n && w.f === this.f && input.t < w.t + this.cfg.hit.whiffLockoutMs) return fail('lockout');
    if (!validPaddleBounds(input.pad, from, serve, this.cfg)) return fail('bounds');
    // La raqueta del evento es la del tick en que se procesó el click (hasta un tick después del click).
    const r = this.R + evalTick(input.t, this.tick) * this.tick;
    if (!validReach(this.lastPad(from, this.n, r), { r, x: input.pad.x, z: input.pad.z }, this.cfg)) return fail('reach');

    const t0 = cpuNow();
    const res = resolveHit(fl, from, input, this.cfg, this.env, this.dt);
    if (res.kind === 'whiff') {
      this.record.hitCpuMs.push(cpuNow() - t0);
      return fail('eval');
    }
    const h = res.hit;
    if (h.late) {
      this.record.hitCpuMs.push(cpuNow() - t0);
      this.closePoint(this.f, fl.end.i, fl.end.outcome);
      return;
    }
    if (h.foul) {
      this.record.hitCpuMs.push(cpuNow() - t0);
      this.closePoint(this.f, h.j + 1, h.foul);
      return;
    }
    const exit = exitFromWire(exitToWire(h.exit!));
    this.rallyState = strikeRally(this.rallyState, from, serve);
    const next = new Flight(this.cfg, this.env, exit, 'rally', from, this.rallyState);
    this.record.hitCpuMs.push(cpuNow() - t0);
    this.record.hits.push({ n: this.n, f: this.f, player: from, tier: h.evaluation.tier, type: h.shot, dtMs: h.evaluation.dtMs, serve });
    this.R += h.j * this.tick;
    this.f += 1;
    this.flight = next;
    this.sentAt = now;
    const hw: HitWire = { t: msg.t, x: msg.x, z: msg.z, vx: msg.vx, q: msg.q, b: msg.b, sv: msg.sv };
    if (msg.sx !== undefined && msg.sz !== undefined) {
      hw.sx = msg.sx;
      hw.sz = msg.sz;
    }
    this.both({ k: 'fl', n: this.n, f: this.f, p: from, j: h.j, h: hw, s: exitToWire(exit) });
    if (next.certain) this.closePoint(this.f, next.end.i, next.end.outcome);
  }

  private closePoint(f: number, i: number, outcome: FlightOutcome): void {
    let w: Side | -1 = -1;
    let reason: PointReason | 'LET' = 'LET';
    if (outcome.kind === 'point') {
      w = outcome.winner;
      reason = outcome.reason;
      if (!this.practice) this.sc[w] += 1;
    }
    // En práctica no hay marcador ni fin, y saca quien perdió la bola (en un let, el mismo).
    const winner = this.practice ? null : isGameOver(this.sc, this.cfg.rules);
    const ns = this.practice ? (w === -1 ? this.server : other(w)) : serverFor(this.sc, this.firstServer, this.cfg.rules);
    const score: [number, number] = [this.sc[0], this.sc[1]];
    this.record.points.push({ n: this.n, winner: w, reason, score: [score[0], score[1]] });
    const pm: PointMsg = { k: 'pt', n: this.n, f, i, w, r: reason, sc: score, ns, go: winner ?? -1 };
    this.both(pm);
    this.n += 1;
    this.server = ns;
    this.toServeHold();
    if (winner !== null) {
      this.phase = 'over';
      this.record.winner = winner;
    }
    this.onPoint(pm);
    if (winner !== null) this.onGameOver(winner, [score[0], score[1]]);
  }
}
