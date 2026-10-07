/**
 * Partida en el servidor [§17.2, §17.3]: la autoridad. Funciona por eventos, sin simular a 120 Hz todo el rato:
 *  - al recibir un golpe, lo valida, lo recalcula con el mismo código que el cliente (resolveHit) y difunde a los dos
 *    el estado de salida oficial del vuelo nuevo;
 *  - conoce el desenlace de cada vuelo sin golpe al crearlo: si el receptor no puede cambiarlo, cierra el punto en el
 *    acto; si puede, espera su golpe o su `end` (su cliente sabe que no golpeó), con un temporizador de respaldo;
 *  - decide puntos, saque, marcador y fin del game, y reenvía la raqueta (sin teclas) y los fallos al rival.
 * Nunca lanza: un mensaje fuera de turno o imposible se descarta y queda registrado.
 */
import { type GameConfig, simDt, tickMs } from '../config.ts';
import type { QualityTier } from '../hit.ts';
import { type BallState, makeEnv, type PhysicsEnv } from '../physics.ts';
import { isGameOver, newRally, type PointReason, type RallyState, serverFor } from '../rules.ts';
import type { ShotType } from '../stroke.ts';
import type { Side } from '../types.ts';
import { evalTick, Flight, type FlightOutcome, strikeRally } from './flight.ts';
import { type C2S, exitFromWire, exitToWire, type HitMsg, type HitWire, hitFromWire, type S2C } from './protocol.ts';
import { resolveHit } from './resolve.ts';
import { validClickTime, validPaddleBounds, validReach } from './validate.ts';

export interface MatchRecord {
  points: { n: number; winner: Side | -1; reason: PointReason | 'LET'; score: [number, number] }[];
  hits: { n: number; f: number; player: Side; tier: QualityTier; type: ShotType; dtMs: number; serve: boolean }[];
  rejected: { from: Side; kind: string; why: string }[];
  /** CPU del servidor por golpe (validar, recalcular y calcular el vuelo nuevo), ms. */
  hitCpuMs: number[];
  winner: Side | null;
}

export interface ServerMatchOptions {
  send: (to: Side, msg: S2C) => void;
  firstServer?: Side;
  log?: (line: string) => void;
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

export class ServerMatch {
  readonly cfg: GameConfig;
  readonly record: MatchRecord = { points: [], hits: [], rejected: [], hitCpuMs: [], winner: null };
  private readonly env: PhysicsEnv;
  private readonly dt: number;
  private readonly tick: number;
  private readonly send: (to: Side, msg: S2C) => void;
  private readonly log: (line: string) => void;
  private readonly firstServer: Side;
  private phase: Phase = 'idle';
  private n = 0;
  private server: Side;
  private sc: [number, number] = [0, 0];
  private rally: RallyState = newRally();
  private flight: Flight | null = null;
  private f = 0;
  /** Tiempo de rally (ms) del índice 0 del vuelo actual. */
  private R = 0;
  /** Cuándo (reloj del servidor) se creó y envió el vuelo actual. */
  private sentAt = 0;
  private readonly pads: [PadRec[], PadRec[]] = [[], []];
  private readonly pings: [number, number] = [-1, -1];
  private readonly whiffs: [{ n: number; f: number; t: number } | null, { n: number; f: number; t: number } | null] = [null, null];

  constructor(cfg: GameConfig, opts: ServerMatchOptions) {
    this.cfg = cfg;
    this.env = makeEnv(cfg);
    this.dt = simDt(cfg);
    this.tick = tickMs(cfg);
    this.send = opts.send;
    this.log = opts.log ?? (() => {});
    this.firstServer = opts.firstServer ?? 0;
    this.server = this.firstServer;
  }

  get score(): [number, number] {
    return [this.sc[0], this.sc[1]];
  }

  get over(): boolean {
    return this.phase === 'over';
  }

  /** Empieza un game: 0-0, saca firstServer. */
  start(now: number): void {
    void now;
    this.phase = 'serveHold';
    this.n = 0;
    this.sc = [0, 0];
    this.server = this.firstServer;
    this.rally = newRally();
    this.flight = null;
    this.record.winner = null;
    this.whiffs[0] = this.whiffs[1] = null;
    this.both({ k: 'start', fs: this.firstServer, n: this.n, wu: 0, g: 1, sc: [0, 0], ns: this.firstServer });
  }

  receive(from: Side, msg: C2S, now: number): void {
    try {
      this.handle(from, msg, now);
    } catch (e) {
      this.reject(from, msg.k, `error: ${(e as Error).message}`);
    }
  }

  /** Temporizador de respaldo: si quien debe golpear calla demasiado, el punto se cierra con el desenlace del vuelo. */
  poll(now: number): void {
    const fl = this.flight;
    if (this.phase !== 'flight' || !fl) return;
    const deadline = this.sentAt + fl.end.i * this.tick + Math.max(0, this.pings[fl.receiver]) + this.cfg.net.timers.fallbackMs;
    if (now > deadline) {
      this.log(`respaldo: rally ${this.n} vuelo ${this.f} sin noticias del lado ${fl.receiver}`);
      this.closePoint(this.f, fl.end.i, fl.end.outcome);
    }
  }

  private both(msg: S2C): void {
    this.send(0, msg);
    this.send(1, msg);
  }

  private reject(from: Side, kind: string, why: string): void {
    this.record.rejected.push({ from, kind, why });
    this.log(`descartado ${kind} del lado ${from}: ${why}`);
  }

  private handle(from: Side, msg: C2S, now: number): void {
    switch (msg.k) {
      case 'ping':
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
        this.onToss(from, msg.n, msg.x / 1000, msg.z / 1000, msg, now);
        return;
      case 'hit':
        this.onHit(from, msg, now);
        return;
      case 'wf':
        if (this.phase === 'flight' && msg.n === this.n && msg.f === this.f && this.flight?.receiver === from) this.whiffs[from] = { n: msg.n, f: msg.f, t: msg.t };
        if (msg.n === this.n) this.send(other(from), { k: 'wf', n: msg.n, f: msg.f, t: msg.t, p: from });
        return;
      case 'end':
        if (this.phase !== 'flight' || !this.flight || msg.n !== this.n || msg.f !== this.f || this.flight.receiver !== from) {
          this.reject(from, 'end', 'stale');
          return;
        }
        this.closePoint(this.f, this.flight.end.i, this.flight.end.outcome);
        return;
      case 'again':
        if (this.phase === 'over') this.start(now);
        return;
      case 'hello':
        return;
    }
  }

  private onToss(from: Side, n: number, x: number, z: number, msg: C2S, now: number): void {
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
    this.rally = newRally();
    this.flight = new Flight(this.cfg, this.env, exit, 'toss', from, this.rally);
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
    if (!validClickTime(input.t, fl.end.i, now - this.sentAt, this.cfg)) return fail('time');
    const w = this.whiffs[from];
    if (w && w.n === this.n && w.f === this.f && input.t < w.t + this.cfg.hit.whiffLockoutMs) return fail('lockout');
    const serve = fl.mode === 'toss';
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
    this.rally = strikeRally(this.rally, from, serve);
    const next = new Flight(this.cfg, this.env, exit, 'rally', from, this.rally);
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
      this.sc[w] += 1;
    }
    const winner = isGameOver(this.sc, this.cfg.rules);
    const ns = serverFor(this.sc, this.firstServer, this.cfg.rules);
    const score: [number, number] = [this.sc[0], this.sc[1]];
    this.record.points.push({ n: this.n, winner: w, reason, score });
    this.both({ k: 'pt', n: this.n, f, i, w, r: reason, sc: score, ns, go: winner ?? -1 });
    this.n += 1;
    this.server = ns;
    this.flight = null;
    this.rally = newRally();
    this.whiffs[0] = this.whiffs[1] = null;
    if (winner !== null) {
      this.phase = 'over';
      this.record.winner = winner;
    } else {
      this.phase = 'serveHold';
    }
  }
}
