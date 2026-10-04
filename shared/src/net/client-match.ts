/**
 * Partida de cliente [§17.2]: la vista de un jugador en red, con la misma forma que la simulación local (SimState,
 * SimEvent, paso de 120 Hz) para que el navegador y el bot la usen igual que a Simulation.
 *
 * «Cada uno golpea en su tiempo» ✅:
 *  - Tu golpe se resuelve en el click con el mismo código que el servidor y el mismo evento ya cuantizado; tu vuelo
 *    nuevo empieza en tu tick de contacto, como en local, sin esperar a la red (predicción local).
 *  - El vuelo del rival empieza para ti cuando recibes su golpe y tu pantalla llega a su contacto: desde ahí lo ves
 *    a velocidad real y tu click se mide en el reloj de ese vuelo, igual que en local.
 *  - La bola que se aleja se frena (DisplayClock) para llegar a la raqueta rival cuando se espera su golpe (tu ping
 *    + el suyo); si su golpe llega antes, se adelanta; si no la devuelve, al saberse el punto vuelve a velocidad real.
 *  - El receptor decide el desenlace del vuelo que le llega (y avisa con `end` si no lo devolvió); quien golpeó solo
 *    predice los desenlaces seguros y para el resto espera al servidor. Si el servidor discrepa, se corrige
 *    suavemente (la bola se funde en blendMs) sin borrar el mensaje que ya se vio.
 *  - La raqueta del rival (30 Hz) se dibuja interpolada en el tiempo que muestra tu pantalla.
 *
 * Sin asignaciones por tick en la ruta normal: estados, eventos y anillos reutilizados.
 */
import { type PaddleSample, settleRef, settleSpeeds } from '../click.ts';
import { type GameConfig, simDt, tickMs } from '../config.ts';
import type { HitEvaluation } from '../hit.ts';
import { stepPaddle } from '../paddle.ts';
import { type BallContact, type BallState, makeEnv, type PhysicsEnv } from '../physics.ts';
import { applyContact, newRally, type PointReason } from '../rules.ts';
import type { PaddleState, PlayerStats, SimEvent, SimState } from '../sim.ts';
import type { ShotType } from '../stroke.ts';
import { type InputIntent, type Side, sideSign, type Vec3 } from '../types.ts';
import { DisplayClock } from './brake.ts';
import { Flight, type FlightOutcome, strikeRally } from './flight.ts';
import { PingTracker } from './ping.ts';
import { type C2S, exitFromWire, exitToWire, type FlightMsg, type HitInput, hitFromWire, hitToWire, maskToKeys, type PointMsg, quantizeHit, type S2C } from './protocol.ts';
import { type ResolvedHit, resolveHit } from './resolve.ts';

export interface NetStats {
  /** Medias de ping (ms) mías y del rival (null sin medir). */
  myPing: number | null;
  rivalPing: number | null;
  /** Veces que el servidor no coincidió con lo predicho, y de qué tipo (exit, rejected, point, orphan). */
  corrections: number;
  correctionKinds: string[];
  /** Frenado de la bola que se aleja, en los vuelos que el rival devolvió: 1 − velocidad media / mínima. */
  brakes: { flights: number; meanSlowdown: number; maxSlowdown: number };
  /** Lo que la bola dibujada se desplaza en un tick por encima de lo que la bola puede moverse (m): un salto. */
  maxRenderJump: number;
  /** Instante (ms de esta partida) del salto mayor, para diagnosticarlo. */
  maxRenderJumpAt: number;
}

interface RivalSwitch {
  f: number;
  j: number;
  flight: Flight;
  serve: boolean;
  shown: ResolvedHit | null;
}

interface MyHit {
  /** Vuelo al que respondía. */
  f: number;
  hit: ResolvedHit;
  official: number[] | null;
  applied: boolean;
}

interface PadSlot {
  n: number;
  r: number;
  x: number;
  z: number;
}

const PAD_RING = 48;
const HIST = 48;

function other(s: Side): Side {
  return s === 0 ? 1 : 0;
}

function newStats(): PlayerStats {
  return { hits: 0, perfect: 0, good: 0, weak: 0, whiffs: 0, maxStreak: 0, netErrors: 0, outErrors: 0, points: 0, types: { NORMAL: 0, TOPSPIN: 0, SLICE: 0, SMASH: 0, BLOCK: 0 } };
}

function mkPaddle(side: Side): PaddleState {
  return { pos: { x: 0, z: sideSign(side) * 1.7 }, vel: { x: 0, z: 0 }, lockUntil: 0, pending: null, lastFire: Number.NEGATIVE_INFINITY };
}

export class ClientMatch {
  readonly cfg: GameConfig;
  readonly env: PhysicsEnv;
  readonly dt: number;
  readonly tickMs: number;
  readonly side: Side;
  readonly rival: Side;
  state: SimState;
  started = false;
  finished = false;
  readonly stats: NetStats = { myPing: null, rivalPing: null, corrections: 0, correctionKinds: [], brakes: { flights: 0, meanSlowdown: 0, maxSlowdown: 0 }, maxRenderJump: 0, maxRenderJumpAt: 0 };
  private readonly send: (msg: C2S) => void;
  private readonly events: SimEvent[] = [];
  private readonly inbox: { msg: S2C; at: number }[] = [];
  private inHead = 0;
  /** Mensajes de un rally que en mi pantalla aún no ha empezado (el rival va por delante): se aplican al empezarlo. */
  private readonly future: S2C[] = [];
  private readonly hist: PaddleSample[] = [];
  private readonly speeds: number[] = [];
  // Rally y vuelo que se muestra.
  private n = 0;
  private f = -1;
  private flight: Flight | null = null;
  private T0 = 0;
  private R = 0;
  private braked = false;
  private brakeP = 0;
  private minSpeedSeen = 1;
  private readonly clock = new DisplayClock();
  private stepIdx = 0;
  private shownIdx = 0;
  private contactCursor = 0;
  private myHit: MyHit | null = null;
  private rivalSwitch: RivalSwitch | null = null;
  private pointMsg: PointMsg | null = null;
  private predicted: { w: Side | -1; r: PointReason | 'LET' } | null = null;
  private waitingServer = false;
  private resumed = false;
  // Raqueta rival (anillo reutilizado).
  private readonly pads: PadSlot[] = Array.from({ length: PAD_RING }, () => ({ n: -1, r: -1, x: 0, z: 0 }));
  private padHead = 0;
  private padCount = 0;
  // Ping.
  private readonly ping: PingTracker;
  private pingI = 0;
  private nextPingAt = 0;
  // Fusión de correcciones y medida de saltos.
  private readonly blend = { x: 0, y: 0, z: 0, start: Number.NEGATIVE_INFINITY };
  private readonly prevRender = { x: 0, y: 0, z: 0 };
  private prevRenderOk = false;
  private prevSpeed = 0;
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };
  private brakeSum = 0;

  constructor(cfg: GameConfig, side: Side, send: (msg: C2S) => void) {
    this.cfg = cfg;
    this.env = makeEnv(cfg);
    this.dt = simDt(cfg);
    this.tickMs = tickMs(cfg);
    this.side = side;
    this.rival = other(side);
    this.send = send;
    this.ping = new PingTracker(cfg.net.ping.average);
    this.state = {
      tick: 0,
      phase: 'serveHold',
      phaseStartMs: 0,
      ball: { pos: { x: 0, y: 1, z: 1.7 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 } },
      paddles: [mkPaddle(0), mkPaddle(1)],
      firstServer: 0,
      server: 0,
      score: [0, 0],
      rally: newRally(),
      streak: [0, 0],
      stats: [newStats(), newStats()],
      lastActivityMs: 0,
      winner: null,
      lastPoint: null,
    };
    this.attachBall();
  }

  /** Instante (ms) del estado actual: tick · tickMs, como Simulation. */
  get now(): number {
    return this.state.tick * this.tickMs;
  }

  /** Mensaje del servidor que llegó en `arrivalMs` (tiempo de esta partida): se aplica en el primer tick que no es anterior. */
  receive(msg: S2C, arrivalMs: number): void {
    this.inbox.push({ msg, at: arrivalMs });
  }

  step(intent: InputIntent): SimEvent[] {
    this.stepInput(intent);
    return this.stepWorld();
  }

  /** Avanza el reloj un tick, mueve tu raqueta y procesa tu click (predicción y envío). */
  stepInput(intent: InputIntent): void {
    this.events.length = 0;
    const s = this.state;
    s.tick += 1;
    const t = this.now;
    this.movePaddle(intent);
    const p = s.paddles[this.side];
    this.hist.push({ t, v: Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z), x: p.pos.x, z: p.pos.z });
    if (this.hist.length > HIST) this.hist.shift();
    const fire = intent.fire;
    if (fire !== undefined && fire > p.lastFire) {
      p.lastFire = fire;
      this.handleClick(fire, intent);
    }
  }

  /** Aplica los mensajes llegados, avanza fases, vuelos, contactos y desenlaces. Devuelve los eventos del tick. */
  stepWorld(): SimEvent[] {
    const s = this.state;
    const t = this.now;
    this.applyInbox(t);
    switch (s.phase) {
      case 'serveHold':
        this.attachBall();
        if (this.started && s.server === this.side && t - s.phaseStartMs >= this.cfg.serve.autoTossMs) this.toss(true);
        break;
      case 'serveToss':
      case 'rally':
        this.liveStep(t);
        break;
      case 'pointOver':
        this.advance(t, false);
        if (this.pointMsg && t - s.phaseStartMs >= this.cfg.rules.pointDelayMs) this.nextPoint(t);
        break;
      case 'gameOver':
        break;
    }
    this.updateRivalPaddle();
    this.sendPaddle(t);
    this.sendPing(t);
    this.trackRender(t);
    return this.events;
  }

  /** Posición de la bola a dibujar: la del vuelo más lo que quede por fundir de una corrección. */
  renderBall(out: Vec3): Vec3 {
    const b = this.state.ball.pos;
    const k = 1 - (this.now - this.blend.start) / this.cfg.net.blendMs;
    if (k > 0 && k <= 1) {
      out.x = b.x + this.blend.x * k;
      out.y = b.y + this.blend.y * k;
      out.z = b.z + this.blend.z * k;
    } else {
      out.x = b.x;
      out.y = b.y;
      out.z = b.z;
    }
    return out;
  }

  // ——— Entrada ———

  private movePaddle(intent: InputIntent): void {
    const s = this.state;
    const pc = this.cfg.paddle;
    const pad = s.paddles[this.side];
    const sgn = sideSign(this.side);
    let tx: number;
    let tz: number;
    if (pad.pending) {
      tx = pad.pending.lockPos.x;
      tz = pad.pending.lockPos.z;
    } else {
      const x = Math.max(-pc.maxLateral, Math.min(pc.maxLateral, intent.target.x));
      let z = Math.max(pc.minDepth, Math.min(pc.maxDepth, intent.target.z));
      let xs = x;
      if ((s.phase === 'serveHold' || s.phase === 'serveToss') && this.side === s.server) {
        z = Math.max(z, pc.serveMinDepth);
        xs = Math.max(-pc.serveMaxLateral, Math.min(pc.serveMaxLateral, x));
      }
      tx = xs * sgn;
      tz = z * sgn;
    }
    stepPaddle(pad, tx, tz, 1 / this.cfg.sim.tickHz, pc, intent.block ? this.cfg.block.paddleSpeedFactor : 1);
  }

  private handleClick(fire: number, intent: InputIntent): void {
    const s = this.state;
    const me = this.side;
    const pad = s.paddles[me];
    if (fire < pad.lockUntil || pad.pending) return;
    if (s.phase === 'serveHold') {
      if (me === s.server && this.started) this.toss(false);
      return;
    }
    if (s.phase === 'serveToss' && me !== s.server) return;
    if (s.phase !== 'serveToss' && s.phase !== 'rally') return;
    const fl = this.flight;
    const swingAtNothing = s.phase === 'rally' && s.rally.lastHitter === me;
    if (!fl || swingAtNothing || fl.receiver !== me) {
      this.whiff(fire, null);
      return;
    }
    const raw: HitInput = {
      t: fire - this.T0,
      pad: { x: pad.pos.x, z: pad.pos.z },
      swingVx: intent.swing.vx,
      keys: intent.modifiers ?? {},
      block: intent.block,
      speeds: [...settleSpeeds(this.hist, fire, this.cfg, this.speeds)],
      ref: settleRef(this.hist, fire, this.cfg),
    };
    // Se predice con el evento tal como lo verá el servidor (cuantizado): mismos bits en los dos lados.
    const res = resolveHit(fl, me, quantizeHit(raw, this.cfg), this.cfg, this.env, this.dt);
    if (res.kind === 'whiff') {
      this.whiff(fire, res.evaluation);
      return;
    }
    const h = res.hit;
    const contactMs = this.T0 + h.contactMs;
    pad.pending = { contactMs, evaluation: h.evaluation, swing: h.swing, type: h.type, serve: h.serve, block: h.block, lockPos: h.hitPos, aimFactor: h.aimFactor };
    pad.lockUntil = contactMs + this.cfg.hit.swingMs;
    this.myHit = { f: this.f, hit: h, official: null, applied: false };
    this.events.push({
      type: 'swing',
      player: me,
      evaluation: h.evaluation,
      contactMs,
      aimFactor: h.aimFactor,
      shot: h.shot,
      power: h.power,
      keys: { ...(intent.modifiers ?? {}) },
      rawSwing: { ...intent.swing },
    });
    this.send({ k: 'hit', n: this.n, f: this.f, ...hitToWire(raw, this.cfg) });
  }

  private whiff(fire: number, evaluation: HitEvaluation | null): void {
    const s = this.state;
    s.paddles[this.side].lockUntil = fire + this.cfg.hit.whiffLockoutMs;
    s.stats[this.side].whiffs += 1;
    s.streak[this.side] = 0;
    this.events.push({ type: 'whiff', player: this.side, evaluation });
    if (this.flight && this.f >= 0) this.send({ k: 'wf', n: this.n, f: this.f, t: Math.max(0, fire - this.T0) });
  }

  private toss(auto: boolean): void {
    const s = this.state;
    const t = this.now;
    const pad = s.paddles[this.side].pos;
    const q = this.cfg.net.quantize.mmDecimals;
    const k = [1, 10, 100, 1000, 10000][q] ?? 1000;
    const xmm = Math.round(pad.x * 1000 * k) / k;
    const zmm = Math.round(pad.z * 1000 * k) / k;
    const exit: BallState = {
      pos: { x: xmm / 1000, y: this.env.tableTop + this.cfg.serve.holdHeight, z: zmm / 1000 },
      vel: { x: 0, y: this.cfg.serve.tossSpeed, z: 0 },
      spin: { x: 0, y: 0, z: 0 },
    };
    s.rally = newRally();
    // Lanzado con click, la bola avanza en este mismo tick; automático (desde la fase), no (como Simulation).
    this.startFlight(new Flight(this.cfg, this.env, exit, 'toss', this.side, s.rally), 0, auto ? t : t - this.tickMs, 0, 0);
    s.phase = 'serveToss';
    s.phaseStartMs = t;
    s.lastActivityMs = t;
    this.events.push({ type: 'toss', server: this.side });
    this.send({ k: 'toss', n: this.n, x: xmm === 0 ? 0 : xmm, z: zmm === 0 ? 0 : zmm, a: auto ? 1 : 0 });
  }

  // ——— Mensajes ———

  private applyInbox(t: number): void {
    while (this.inHead < this.inbox.length && this.inbox[this.inHead].at <= t) {
      const { msg, at } = this.inbox[this.inHead++];
      this.handle(msg, at, t);
    }
    if (this.inHead > 64 && this.inHead * 2 > this.inbox.length) {
      this.inbox.splice(0, this.inHead);
      this.inHead = 0;
    }
  }

  private handle(msg: S2C, at: number, t: number): void {
    const s = this.state;
    if ((msg.k === 'toss' || msg.k === 'fl' || msg.k === 'wf' || msg.k === 'pt') && msg.n > this.n) {
      this.future.push(msg);
      return;
    }
    switch (msg.k) {
      case 'start':
        if (!this.started && !this.finished && this.flight === null && s.score[0] + s.score[1] === 0) {
          this.started = true;
          s.firstServer = msg.fs;
          s.server = msg.fs;
          s.phaseStartMs = Math.max(0, Math.min(at, t));
        } else {
          this.restart(msg.fs, t);
        }
        return;
      case 'toss': {
        if (msg.n !== this.n || s.phase !== 'serveHold' || s.server !== this.rival) return;
        const exit: BallState = {
          pos: { x: msg.x / 1000, y: this.env.tableTop + this.cfg.serve.holdHeight, z: msg.z / 1000 },
          vel: { x: 0, y: this.cfg.serve.tossSpeed, z: 0 },
          spin: { x: 0, y: 0, z: 0 },
        };
        s.rally = newRally();
        this.startFlight(new Flight(this.cfg, this.env, exit, 'toss', this.rival, s.rally), 0, msg.a ? t : t - this.tickMs, 0, msg.a ? -1 : 0);
        s.phase = 'serveToss';
        s.phaseStartMs = t;
        s.lastActivityMs = t;
        this.events.push({ type: 'toss', server: this.rival });
        return;
      }
      case 'fl':
        this.onFlight(msg, t);
        return;
      case 'wf':
        if (msg.n === this.n && msg.p === this.rival) {
          s.stats[this.rival].whiffs += 1;
          s.streak[this.rival] = 0;
          this.events.push({ type: 'whiff', player: this.rival, evaluation: null });
        }
        return;
      case 'pt':
        if (msg.n !== this.n) return;
        this.pointMsg = msg;
        if (s.phase === 'pointOver' && this.predicted) this.confirm(msg);
        // Punto de un saque que no llegué a ver (p. ej. un lanzamiento que acabó antes de que empezara en mi pantalla).
        else if (s.phase === 'serveHold') this.endPoint(t, this.outcomeOf(msg), msg.f, msg.i, false, true);
        return;
      case 'p': {
        const slot = this.pads[this.padHead];
        slot.n = msg.n;
        slot.r = msg.r;
        slot.x = msg.x / 1000;
        slot.z = msg.z / 1000;
        this.padHead = (this.padHead + 1) % PAD_RING;
        if (this.padCount < PAD_RING) this.padCount++;
        return;
      }
      case 'pong':
        this.ping.add(Math.max(0, at - msg.t));
        this.stats.myPing = this.ping.average;
        return;
      case 'pings':
        this.stats.rivalPing = msg.a[this.rival] >= 0 ? msg.a[this.rival] : null;
        return;
      default:
        return;
    }
  }

  private onFlight(msg: FlightMsg, t: number): void {
    if (msg.n !== this.n) return;
    const s = this.state;
    if (msg.p === this.side) {
      const mh = this.myHit;
      if (mh && mh.f === msg.f - 1) {
        if (!mh.applied) mh.official = msg.s;
        else if (this.f === msg.f) this.compareOfficial(msg.s, t);
      } else {
        this.correction('orphan');
      }
      return;
    }
    const prev = this.f === msg.f - 1 ? this.flight : null;
    const serve = msg.f === 1;
    const flight = new Flight(this.cfg, this.env, exitFromWire(msg.s), 'rally', this.rival, strikeRally(s.rally, this.rival, serve));
    let shown: ResolvedHit | null = null;
    if (prev) {
      const r = resolveHit(prev, this.rival, hitFromWire(msg.h), this.cfg, this.env, this.dt);
      if (r.kind === 'hit' && r.hit.targets) shown = r.hit;
    }
    this.rivalSwitch = { f: msg.f, j: msg.j, flight, serve, shown };
    let switchAt = this.T0 + (msg.j + 1) * this.tickMs;
    if (this.braked && prev) {
      // Si mi pantalla aún no llega a su contacto, la bola vuelve a velocidad real (nunca más rápida) hasta él; si ya
      // lo pasó, el vuelo nuevo empieza ya y la diferencia se funde.
      const u = t - this.T0;
      const d = this.clock.at(u);
      const target = msg.j * this.tickMs;
      if (d < target) {
        this.clock.resume(u, this.cfg.net.brake.catchUpMs);
        this.resumed = true;
        switchAt = t + (target - d) + this.tickMs;
      } else switchAt = t;
    }
    if (shown) {
      this.events.push({
        type: 'swing',
        player: this.rival,
        evaluation: shown.evaluation,
        contactMs: Math.max(t, switchAt),
        aimFactor: shown.aimFactor,
        shot: shown.shot,
        power: shown.power,
        keys: maskToKeys(msg.h.q),
        rawSwing: { vx: msg.h.vx, vy: 0 },
      });
    }
  }

  private correction(kind: string): void {
    this.stats.corrections += 1;
    this.stats.correctionKinds.push(kind);
  }

  /** El estado oficial de mi golpe: si no coincide con lo predicho, se adopta y la bola se funde. */
  private compareOfficial(official: number[], t: number): void {
    const fl = this.flight;
    if (!fl) return;
    const mine = exitToWire(fl.exit);
    let same = mine.length === official.length;
    for (let i = 0; same && i < mine.length; i++) same = mine[i] === official[i];
    if (same) return;
    this.correction('exit');
    const before = { ...this.state.ball.pos };
    const next = new Flight(this.cfg, this.env, exitFromWire(official), 'rally', fl.hitter, fl.startRally);
    this.flight = next;
    this.readShown(this.shownIdx);
    this.startBlend(before, t);
  }

  private confirm(pm: PointMsg): void {
    const p = this.predicted;
    const s = this.state;
    if (!p || p.w !== pm.w || p.r !== pm.r || s.score[0] !== pm.sc[0] || s.score[1] !== pm.sc[1]) {
      this.correction('point');
      s.score = [pm.sc[0], pm.sc[1]];
    }
  }

  // ——— Mundo ———

  private startFlight(flight: Flight, f: number, T0: number, R: number, startIdx: number): void {
    this.flight = flight;
    this.f = f;
    this.T0 = T0;
    this.R = R;
    this.braked = false;
    this.clock.reset();
    this.stepIdx = startIdx;
    this.shownIdx = Math.max(0, startIdx);
    this.contactCursor = 0;
    this.waitingServer = false;
    this.resumed = false;
    this.minSpeedSeen = 1;
    flight.readState(0, this.state.ball);
  }

  private liveStep(t: number): void {
    const s = this.state;
    const pad = s.paddles[this.side];
    const pm = this.pointMsg;
    if (pad.pending && pm && pm.f === this.f && this.myHit && this.myHit.hit.j < pm.i) {
      // El servidor cerró este vuelo sin contar mi golpe: rechazado.
      pad.pending = null;
      this.myHit = null;
      this.correction('rejected');
    }
    if (pad.pending && t >= pad.pending.contactMs) this.applyMyHit(t);
    else if (this.rivalSwitch && this.shownIdx >= this.rivalSwitch.j) this.applyRivalSwitch(t);
    if (s.phase !== 'serveToss' && s.phase !== 'rally') return;
    this.advance(t, true);
    if (s.phase === 'serveToss' || s.phase === 'rally') this.checkServerPoint(t);
  }

  private applyMyHit(t: number): void {
    const s = this.state;
    const me = this.side;
    const pad = s.paddles[me];
    pad.pending = null;
    const mh = this.myHit;
    if (!mh || mh.hit.late) return;
    const h = mh.hit;
    if (!h.serve && h.foul) {
      this.endPoint(t, h.foul, this.f, h.j + 1, false);
      return;
    }
    const exit = exitFromWire(exitToWire(h.exit!));
    s.rally = strikeRally(s.rally, me, h.serve);
    const next = new Flight(this.cfg, this.env, exit, 'rally', me, s.rally);
    if (h.serve) s.phase = 'rally';
    s.lastActivityMs = t;
    this.countHit(me, h, h.serve);
    this.startFlight(next, this.f + 1, t - this.tickMs, this.R + h.j * this.tickMs, 0);
    mh.applied = true;
    // Bola que se aleja: frenada si el rival puede devolverla y hay ping.
    const P = (this.stats.myPing ?? 0) + (this.stats.rivalPing ?? 0);
    if (!next.certain && P > 0) {
      const depth = this.rivalDepth();
      const idx = next.expectedContact(depth);
      if (idx > 0) {
        this.clock.planBrake(idx * this.tickMs, P, this.cfg.net.brake);
        this.braked = !this.clock.isIdentity;
        this.brakeP = P;
      }
    }
    this.events.push({
      type: 'hit',
      player: me,
      evaluation: h.evaluation,
      tier: h.evaluation.tier,
      streak: s.streak[me],
      pos: { ...h.contact },
      serve: h.serve,
      targets: h.targets!,
      aimFactor: h.aimFactor,
      incoming: { vel: { ...h.incoming.vel }, spin: { ...h.incoming.spin } },
    });
    if (mh.official) this.compareOfficial(mh.official, t);
  }

  private applyRivalSwitch(t: number): void {
    const s = this.state;
    const sw = this.rivalSwitch!;
    this.rivalSwitch = null;
    const before = { ...s.ball.pos };
    if (this.braked) {
      const u = t - this.tickMs - this.T0;
      const slow = u > 0 ? 1 - (sw.j * this.tickMs) / u : 0;
      const b = this.stats.brakes;
      this.brakeSum += slow;
      b.flights += 1;
      b.meanSlowdown = this.brakeSum / b.flights;
      b.maxSlowdown = Math.max(b.maxSlowdown, 1 - this.minSpeedSeen);
    }
    s.rally = strikeRally(s.rally, this.rival, sw.serve);
    if (sw.serve) s.phase = 'rally';
    s.lastActivityMs = t;
    this.startFlight(sw.flight, sw.f, t - this.tickMs, this.R + sw.j * this.tickMs, 0);
    this.startBlend(before, t);
    const h = sw.shown;
    if (h && h.targets) {
      this.countHit(this.rival, h, sw.serve);
      this.events.push({
        type: 'hit',
        player: this.rival,
        evaluation: h.evaluation,
        tier: h.evaluation.tier,
        streak: s.streak[this.rival],
        pos: { ...h.contact },
        serve: sw.serve,
        targets: h.targets,
        aimFactor: h.aimFactor,
        incoming: { vel: { ...h.incoming.vel }, spin: { ...h.incoming.spin } },
      });
    }
  }

  private countHit(player: Side, h: ResolvedHit, serve: boolean): void {
    const s = this.state;
    const tier = h.evaluation.tier;
    const st = s.stats[player];
    st.hits += 1;
    if (tier === 'PERFECT') {
      st.perfect += 1;
      s.streak[player] += 1;
    } else {
      s.streak[player] = 0;
      if (tier === 'GOOD') st.good += 1;
      else st.weak += 1;
    }
    st.maxStreak = Math.max(st.maxStreak, s.streak[player]);
    if (!serve && h.targets) st.types[h.targets.type as ShotType] += 1;
  }

  /** Profundidad de la raqueta rival que se ve (para el contacto esperado). */
  private rivalDepth(): number {
    const pc = this.cfg.paddle;
    const z = Math.abs(this.state.paddles[this.rival].pos.z);
    return this.padCount ? Math.max(pc.minDepth, Math.min(pc.maxDepth, z)) : this.cfg.net.brake.defaultDepth;
  }

  private readShown(idx: number): void {
    const fl = this.flight!;
    const b = this.state.ball;
    const i0 = Math.floor(idx);
    fl.readState(i0, b);
    const fr = idx - i0;
    if (fr > 1e-12) {
      b.pos.x += (fl.x(i0 + 1) - b.pos.x) * fr;
      b.pos.y += (fl.y(i0 + 1) - b.pos.y) * fr;
      b.pos.z += (fl.z(i0 + 1) - b.pos.z) * fr;
    }
  }

  /** Avanza la bola un tick por el vuelo que se muestra; contactos → eventos y, en juego, reglas y desenlace. */
  private advance(t: number, live: boolean): void {
    const fl = this.flight;
    if (!fl) return;
    let idx: number;
    if (!this.braked) {
      this.stepIdx += 1;
      idx = Math.max(0, this.stepIdx);
      fl.readState(idx, this.state.ball);
    } else {
      const u = t - this.T0;
      idx = this.clock.at(u) / this.tickMs;
      if (idx < this.shownIdx) idx = this.shownIdx;
      this.minSpeedSeen = Math.min(this.minSpeedSeen, this.clock.speedAt(u));
      this.readShown(idx);
    }
    this.shownIdx = idx;
    const upto = Math.floor(idx + 1e-9);
    for (let i = this.contactCursor + 1; i <= upto; i++) {
      this.contactCursor = i;
      const cs = fl.contactsAt(i);
      for (const c of cs) this.emitContact(c);
      if (!live || this.waitingServer) continue;
      const s = this.state;
      if (s.phase !== 'serveToss' && s.phase !== 'rally') return;
      if (i < fl.end.i) {
        if (fl.mode === 'rally') for (const c of cs) applyContact(s.rally, c);
        if (cs.length) s.lastActivityMs = t;
        continue;
      }
      if (i === fl.end.i) {
        if (fl.receiver === this.side || fl.certain) {
          // El servidor cierra solo los desenlaces seguros; los demás los avisa el receptor (yo, si no la devolví).
          const mine = fl.receiver === this.side && !fl.certain;
          this.endPoint(t, fl.end.outcome, this.f, fl.end.i, mine);
          return;
        }
        this.waitingServer = true;
      }
    }
  }

  private emitContact(c: BallContact): void {
    if (c.kind === 'table') this.events.push({ type: 'bounce', pos: c.pos, side: c.side, speed: c.impactSpeed });
    else if (c.kind === 'net') this.events.push({ type: 'net', pos: c.pos, cord: c.cord });
    else this.events.push({ type: 'floor', pos: c.pos });
  }

  /** Punto del servidor para el vuelo que se muestra: se aplica cuando la pantalla llega a su índice. */
  private checkServerPoint(t: number): void {
    const pm = this.pointMsg;
    if (!pm) return;
    if (pm.f < this.f) {
      // Mi vista va por un vuelo que el servidor no reconoce: mi golpe no contó.
      this.correction('rejected');
      this.endPoint(t, this.outcomeOf(pm), pm.f, pm.i, false, true);
      return;
    }
    if (pm.f > this.f) return;
    if (this.shownIdx + 1e-9 >= pm.i) {
      const retro = !this.braked && this.T0 + pm.i * this.tickMs <= t ? this.T0 + pm.i * this.tickMs : t;
      this.endPoint(retro, this.outcomeOf(pm), pm.f, pm.i, false, true);
      return;
    }
    if (this.braked && !this.resumed) {
      // Ya se sabe que el rival no la devuelve: la bola sigue su trayectoria real.
      this.clock.resume(t - this.T0, this.cfg.net.brake.rampBackMs);
      this.resumed = true;
    }
  }

  private outcomeOf(pm: PointMsg): FlightOutcome {
    return pm.w === -1 ? { kind: 'let' } : { kind: 'point', winner: pm.w, reason: pm.r as PointReason };
  }

  private endPoint(at: number, outcome: FlightOutcome, f: number, i: number, sendEnd: boolean, fromServer = false): void {
    const s = this.state;
    s.paddles[this.side].pending = null;
    this.myHit = null;
    this.rivalSwitch = null;
    s.streak = [0, 0];
    s.phase = 'pointOver';
    s.phaseStartMs = at;
    if (outcome.kind === 'let') {
      s.lastPoint = null;
      this.events.push({ type: 'let' });
    } else {
      s.score[outcome.winner] += 1;
      s.stats[outcome.winner].points += 1;
      if (outcome.reason === 'NET') s.stats[other(outcome.winner)].netErrors += 1;
      if (outcome.reason === 'OUT') s.stats[other(outcome.winner)].outErrors += 1;
      s.lastPoint = { winner: outcome.winner, reason: outcome.reason };
      this.events.push({ type: 'point', winner: outcome.winner, reason: outcome.reason, score: [s.score[0], s.score[1]] });
    }
    this.predicted = outcome.kind === 'let' ? { w: -1, r: 'LET' } : { w: outcome.winner, r: outcome.reason };
    if (sendEnd) this.send({ k: 'end', n: this.n, f });
    if (this.pointMsg && this.pointMsg.n === this.n) {
      if (fromServer) {
        const pm = this.pointMsg;
        if (s.score[0] !== pm.sc[0] || s.score[1] !== pm.sc[1]) {
          this.correction('point');
          s.score = [pm.sc[0], pm.sc[1]];
        }
      } else this.confirm(this.pointMsg);
    }
  }

  private nextPoint(t: number): void {
    const s = this.state;
    const pm = this.pointMsg!;
    s.server = pm.ns;
    const go = pm.go;
    if (go !== -1) {
      s.phase = 'gameOver';
      s.winner = go;
      s.phaseStartMs = t;
      this.finished = true;
      this.events.push({ type: 'gameOver', winner: go, score: [s.score[0], s.score[1]] });
      return;
    }
    s.phase = 'serveHold';
    s.phaseStartMs = t;
    s.lastActivityMs = t;
    s.rally = newRally();
    this.n = pm.n + 1;
    this.f = -1;
    this.flight = null;
    this.pointMsg = null;
    this.predicted = null;
    this.attachBall();
    this.events.push({ type: 'serveReady', server: s.server });
    // Lo que el rival ya hizo en este rally mientras yo veía el final del anterior.
    if (this.future.length) {
      const pending = this.future.splice(0, this.future.length);
      for (const m of pending) this.handle(m, t, t);
    }
  }

  private restart(fs: Side, t: number): void {
    const s = this.state;
    const paddles = s.paddles;
    for (const p of paddles) {
      p.pending = null;
      p.lockUntil = 0;
    }
    this.state = {
      tick: s.tick,
      phase: 'serveHold',
      phaseStartMs: t,
      ball: s.ball,
      paddles,
      firstServer: fs,
      server: fs,
      score: [0, 0],
      rally: newRally(),
      streak: [0, 0],
      stats: [newStats(), newStats()],
      lastActivityMs: t,
      winner: null,
      lastPoint: null,
    };
    this.started = true;
    this.finished = false;
    this.n = 0;
    this.f = -1;
    this.flight = null;
    this.myHit = null;
    this.rivalSwitch = null;
    this.pointMsg = null;
    this.predicted = null;
    this.future.length = 0;
    this.attachBall();
    this.events.push({ type: 'serveReady', server: fs });
  }

  private attachBall(): void {
    const s = this.state;
    const pad = s.paddles[s.server].pos;
    const b = s.ball;
    b.pos.x = pad.x;
    b.pos.y = this.env.tableTop + this.cfg.serve.holdHeight;
    b.pos.z = pad.z;
    b.vel.x = b.vel.y = b.vel.z = 0;
    b.spin.x = b.spin.y = b.spin.z = 0;
  }

  private startBlend(before: { x: number; y: number; z: number }, t: number): void {
    const b = this.state.ball.pos;
    const dx = before.x - b.x;
    const dy = before.y - b.y;
    const dz = before.z - b.z;
    if (dx * dx + dy * dy + dz * dz < 1e-12) return;
    this.blend.x = dx;
    this.blend.y = dy;
    this.blend.z = dz;
    this.blend.start = t;
  }

  // ——— Raqueta rival, envíos y medidas ———

  /** Raqueta rival: interpolada en el tiempo de rally que se muestra; si aún no hay muestra, la última. */
  private updateRivalPaddle(): void {
    if (!this.padCount) return;
    const pos = this.state.paddles[this.rival].pos;
    const live = this.flight !== null && (this.state.phase === 'serveToss' || this.state.phase === 'rally');
    const rd = live ? this.R + this.shownIdx * this.tickMs : -1;
    let a: PadSlot | null = null;
    let b: PadSlot | null = null;
    let latest: PadSlot | null = null;
    for (let k = 0; k < this.padCount; k++) {
      const slot = this.pads[(this.padHead - 1 - k + PAD_RING) % PAD_RING];
      if (!latest) latest = slot;
      if (!live || slot.n !== this.n || slot.r < 0) continue;
      if (slot.r <= rd) {
        a = slot;
        break;
      }
      b = slot;
    }
    if (live && a && b && b.r > a.r) {
      const k = (rd - a.r) / (b.r - a.r);
      pos.x = a.x + (b.x - a.x) * k;
      pos.z = a.z + (b.z - a.z) * k;
    } else if (live && a) {
      pos.x = a.x;
      pos.z = a.z;
    } else if (live && b) {
      pos.x = b.x;
      pos.z = b.z;
    } else if (latest) {
      pos.x = latest.x;
      pos.z = latest.z;
    }
  }

  private sendPaddle(t: number): void {
    if (!this.started) return;
    const every = Math.max(1, Math.round(this.cfg.sim.tickHz / this.cfg.net.paddleHz));
    if (this.state.tick % every !== 0) return;
    const p = this.state.paddles[this.side].pos;
    const live = this.flight !== null && (this.state.phase === 'serveToss' || this.state.phase === 'rally');
    const r = live ? Math.max(0, Math.round(this.R + (t - this.T0))) : -1;
    const x = Math.round(p.x * 1000);
    const z = Math.round(p.z * 1000);
    this.send({ k: 'p', n: this.n, r, x: x === 0 ? 0 : x, z: z === 0 ? 0 : z });
  }

  private sendPing(t: number): void {
    if (!this.started || t < this.nextPingAt) return;
    const pc = this.cfg.net.ping;
    const avg = this.ping.average;
    this.send({ k: 'ping', i: this.pingI, t, a: avg === null ? -1 : Math.round(avg * 10) / 10 });
    this.pingI += 1;
    this.nextPingAt = t + (this.pingI < pc.warmup ? pc.warmupEveryMs : pc.everyMs);
  }

  private trackRender(t: number): void {
    const s = this.state;
    const live = s.phase === 'serveToss' || s.phase === 'rally';
    const v = s.ball.vel;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * this.dt;
    const p = this.renderBall(this.tmp);
    if (live && this.prevRenderOk) {
      const dx = p.x - this.prevRender.x;
      const dy = p.y - this.prevRender.y;
      const dz = p.z - this.prevRender.z;
      const excess = Math.sqrt(dx * dx + dy * dy + dz * dz) - Math.max(speed, this.prevSpeed);
      if (excess > this.stats.maxRenderJump) {
        this.stats.maxRenderJump = excess;
        this.stats.maxRenderJumpAt = t;
      }
    }
    this.prevRender.x = p.x;
    this.prevRender.y = p.y;
    this.prevRender.z = p.z;
    this.prevRenderOk = live;
    this.prevSpeed = speed;
  }
}
