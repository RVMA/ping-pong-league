/**
 * Simulación completa de un game (V0.1): bola, dos raquetas, golpe por click, saque
 * simplificado, reglas y marcador. Paso fijo de 120 Hz. Solo consume InputIntent.
 *
 * Tiempos:
 *  - `tick` avanza 1 por paso; el instante de un estado es tick · tickMs (ms de tiempo real).
 *  - La bola se integra con dt = gameSpeed / 120 s de simulación.
 *  - Las raquetas se mueven con 1/120 s de tiempo real.
 */
import { type GameConfig, simDt, tickMs } from './config.ts';
import { classifyHit, type HitEvaluation, measureClosestApproach, type QualityTier } from './hit.ts';
import { stepPaddle } from './paddle.ts';
import { type BallContact, type BallState, makeEnv, type PathSample, type PhysicsEnv, predictPath, stepBall } from './physics.ts';
import {
  applyContact,
  checkStrike,
  isGameOver,
  newRally,
  type PointReason,
  type RallyState,
  registerStrike,
  type RuleOutcome,
  serverFor,
} from './rules.ts';
import { planShot, type ShotTargets, solveShot } from './shot.ts';
import { type InputIntent, type Side, sideSign, type Vec3 } from './types.ts';

export type SimPhase = 'serveHold' | 'serveToss' | 'rally' | 'pointOver' | 'gameOver';

export interface PendingHit {
  contactMs: number;
  evaluation: HitEvaluation;
  swing: { vx: number; vy: number };
  serve: boolean;
  lockPos: { x: number; z: number };
}

export interface PaddleState {
  pos: { x: number; z: number };
  vel: { x: number; z: number };
  /** Clicks ignorados hasta este instante (whiff / swing en curso). */
  lockUntil: number;
  pending: PendingHit | null;
  lastFire: number;
}

export interface PlayerStats {
  hits: number;
  perfect: number;
  good: number;
  weak: number;
  whiffs: number;
  maxStreak: number;
  netErrors: number;
  points: number;
}

export interface SimState {
  tick: number;
  phase: SimPhase;
  phaseStartMs: number;
  ball: BallState;
  paddles: [PaddleState, PaddleState];
  firstServer: Side;
  server: Side;
  score: [number, number];
  rally: RallyState;
  /** Racha de PERFECT consecutivos dentro del rally [§5.1]. */
  streak: [number, number];
  stats: [PlayerStats, PlayerStats];
  lastActivityMs: number;
  winner: Side | null;
  lastPoint: { winner: Side; reason: PointReason } | null;
}

export type SimEvent =
  | { type: 'serveReady'; server: Side }
  | { type: 'toss'; server: Side }
  | { type: 'swing'; player: Side; evaluation: HitEvaluation; contactMs: number }
  | { type: 'whiff'; player: Side; evaluation: HitEvaluation | null }
  | { type: 'hit'; player: Side; evaluation: HitEvaluation; tier: QualityTier; streak: number; pos: Vec3; serve: boolean; targets: ShotTargets }
  | { type: 'bounce'; pos: Vec3; side: Side; speed: number }
  | { type: 'net'; pos: Vec3; cord: boolean }
  | { type: 'floor'; pos: Vec3 }
  | { type: 'point'; winner: Side; reason: PointReason; score: [number, number] }
  | { type: 'let' }
  | { type: 'gameOver'; winner: Side; score: [number, number] };

function newStats(): PlayerStats {
  return { hits: 0, perfect: 0, good: 0, weak: 0, whiffs: 0, maxStreak: 0, netErrors: 0, points: 0 };
}

function other(s: Side): Side {
  return s === 0 ? 1 : 0;
}

export class Simulation {
  readonly cfg: GameConfig;
  readonly env: PhysicsEnv;
  readonly tickMs: number;
  readonly dt: number;
  state: SimState;
  /** Historial de posiciones de la bola (para clicks tardíos). */
  private history: PathSample[] = [];
  private readonly historyLen: number;

  constructor(cfg: GameConfig, opts: { firstServer?: Side } = {}) {
    this.cfg = cfg;
    this.env = makeEnv(cfg);
    this.tickMs = tickMs(cfg);
    this.dt = simDt(cfg);
    this.historyLen = Math.ceil(cfg.hit.searchWindowMs / this.tickMs) + 2;
    const firstServer = opts.firstServer ?? 0;
    const mkPaddle = (side: Side): PaddleState => ({
      pos: { x: 0, z: sideSign(side) * 1.7 },
      vel: { x: 0, z: 0 },
      lockUntil: 0,
      pending: null,
      lastFire: Number.NEGATIVE_INFINITY,
    });
    this.state = {
      tick: 0,
      phase: 'serveHold',
      phaseStartMs: 0,
      ball: { pos: { x: 0, y: 1, z: 1.7 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 } },
      paddles: [mkPaddle(0), mkPaddle(1)],
      firstServer,
      server: firstServer,
      score: [0, 0],
      rally: newRally(),
      streak: [0, 0],
      stats: [newStats(), newStats()],
      lastActivityMs: 0,
      winner: null,
      lastPoint: null,
    };
    this.attachBallToServer();
  }

  /** Instante (ms) del estado actual. */
  get now(): number {
    return this.state.tick * this.tickMs;
  }

  /** Avanza un tick. `intents[s]` es el intento del lado s. */
  step(intents: [InputIntent, InputIntent]): SimEvent[] {
    const s = this.state;
    const events: SimEvent[] = [];
    s.tick += 1;
    const t = this.now;
    const dtReal = 1 / this.cfg.sim.tickHz;

    // 1. Raquetas.
    for (const side of [0, 1] as Side[]) this.movePaddle(side, intents[side], dtReal);

    // 2. Clicks (antes de integrar: el historial llega hasta t − tick y la predicción cubre el resto).
    for (const side of [0, 1] as Side[]) {
      const fire = intents[side].fire;
      const pad = s.paddles[side];
      if (fire !== undefined && fire > pad.lastFire) {
        pad.lastFire = fire;
        this.handleClick(side, fire, intents[side], events);
      }
    }

    // 3. Fase.
    switch (s.phase) {
      case 'serveHold':
        this.attachBallToServer();
        if (t - s.phaseStartMs >= this.cfg.serve.autoTossMs) this.toss(events);
        break;
      case 'serveToss':
      case 'rally': {
        for (const side of [0, 1] as Side[]) {
          const p = s.paddles[side].pending;
          if (p && t >= p.contactMs && (s.phase === 'rally' || s.phase === 'serveToss')) this.applyHit(side, events);
        }
        if (s.phase !== 'serveToss' && s.phase !== 'rally') break;
        const contacts: BallContact[] = [];
        stepBall(s.ball, this.dt, this.env, contacts);
        for (const c of contacts) {
          this.emitContact(c, events);
          if (s.phase === 'serveToss') {
            if (c.kind !== 'net') this.endPoint({ kind: 'point', winner: other(s.server), reason: 'TOSS_MISSED' }, events);
            break;
          }
          s.lastActivityMs = t;
          const outcome = applyContact(s.rally, c);
          if (outcome) {
            this.endPoint(outcome, events);
            break;
          }
        }
        if (s.phase === 'serveToss' && s.ball.pos.y < this.env.tableTop && !s.paddles[s.server].pending) {
          this.endPoint({ kind: 'point', winner: other(s.server), reason: 'TOSS_MISSED' }, events);
        }
        if (s.phase === 'rally' && t - s.lastActivityMs > this.cfg.rules.rallyTimeoutMs) this.endPoint({ kind: 'let' }, events);
        break;
      }
      case 'pointOver': {
        const contacts: BallContact[] = [];
        stepBall(s.ball, this.dt, this.env, contacts);
        for (const c of contacts) this.emitContact(c, events);
        if (t - s.phaseStartMs >= this.cfg.rules.pointDelayMs) this.nextPoint(events);
        break;
      }
      case 'gameOver':
        break;
    }

    // 4. Historial.
    this.history.push({ t, pos: { x: s.ball.pos.x, y: s.ball.pos.y, z: s.ball.pos.z } });
    if (this.history.length > this.historyLen) this.history.shift();
    return events;
  }

  /** Reinicia el game (marcador 0-0) manteniendo la config. */
  restart(firstServer: Side = this.state.firstServer): void {
    const fresh = new Simulation(this.cfg, { firstServer });
    fresh.state.tick = this.state.tick;
    fresh.state.phaseStartMs = this.now;
    fresh.state.lastActivityMs = this.now;
    fresh.state.paddles = this.state.paddles;
    for (const p of fresh.state.paddles) {
      p.pending = null;
      p.lockUntil = 0;
    }
    this.state = fresh.state;
    this.history = [];
    this.attachBallToServer();
  }

  /** Coordenadas de jugador → mundo para un objetivo de raqueta, con límites. */
  private movePaddle(side: Side, intent: InputIntent, dtReal: number): void {
    const s = this.state;
    const pc = this.cfg.paddle;
    const pad = s.paddles[side];
    const sgn = sideSign(side);
    let tx: number;
    let tz: number;
    if (pad.pending) {
      tx = pad.pending.lockPos.x;
      tz = pad.pending.lockPos.z;
    } else {
      const x = Math.max(-pc.maxLateral, Math.min(pc.maxLateral, intent.target.x));
      let z = Math.max(pc.minDepth, Math.min(pc.maxDepth, intent.target.z));
      if ((s.phase === 'serveHold' || s.phase === 'serveToss') && side === s.server) z = Math.max(z, pc.serveMinDepth);
      tx = x * sgn;
      tz = z * sgn;
    }
    stepPaddle(pad, tx, tz, dtReal, pc);
  }

  private attachBallToServer(): void {
    const s = this.state;
    const pad = s.paddles[s.server];
    s.ball.pos.x = pad.pos.x;
    s.ball.pos.y = this.env.tableTop + this.cfg.serve.holdHeight;
    s.ball.pos.z = pad.pos.z;
    s.ball.vel.x = 0;
    s.ball.vel.y = 0;
    s.ball.vel.z = 0;
  }

  private toss(events: SimEvent[]): void {
    const s = this.state;
    this.attachBallToServer();
    s.ball.vel.y = this.cfg.serve.tossSpeed;
    s.phase = 'serveToss';
    s.phaseStartMs = this.now;
    s.lastActivityMs = this.now;
    this.history = [];
    events.push({ type: 'toss', server: s.server });
  }

  /** Muestras alrededor del click: historial + predicción sin intervención. */
  sampleWindow(): PathSample[] {
    const pred = predictPath(this.state.ball, this.env, this.dt, this.tickMs, this.now, this.cfg.hit.searchWindowMs);
    const hist = this.history.length && this.history[this.history.length - 1].t === this.now ? this.history : [...this.history, { t: this.now, pos: { ...this.state.ball.pos } }];
    return [...hist, ...pred];
  }

  /** Evalúa un click hipotético sin cambiar el estado (usado por el bot y por tests). */
  evaluateClick(side: Side, fire: number, paddlePos: { x: number; z: number } = this.state.paddles[side].pos): HitEvaluation | null {
    const s = this.state;
    const serve = s.phase === 'serveToss';
    const samples = this.sampleWindow().filter((p) => Math.abs(p.t - fire) <= this.cfg.hit.searchWindowMs);
    const m = measureClosestApproach({
      samples,
      sweet: { x: paddlePos.x, y: serve ? this.env.tableTop + this.cfg.serve.idealContactHeight : 0, z: paddlePos.z },
      weightY: serve ? 1 : 0,
      side,
      tClick: fire,
      paddleRadius: this.cfg.paddle.radius,
      reachMinY: this.env.tableTop + this.cfg.paddle.minReachHeight,
      reachMaxY: this.env.tableTop + this.cfg.paddle.maxReachHeight,
      ownSideOnly: !serve,
    });
    return m ? classifyHit(m, this.cfg.hit) : null;
  }

  private handleClick(side: Side, fire: number, intent: InputIntent, events: SimEvent[]): void {
    const s = this.state;
    const pad = s.paddles[side];
    if (fire < pad.lockUntil || pad.pending) return;

    if (s.phase === 'serveHold') {
      if (side === s.server) this.toss(events);
      return;
    }
    if (s.phase === 'serveToss' && side !== s.server) return;
    if (s.phase !== 'serveToss' && s.phase !== 'rally') return;

    const swingAtNothing = s.phase === 'rally' && s.rally.lastHitter === side;
    const evaluation = swingAtNothing ? null : this.evaluateClick(side, fire);
    if (!evaluation || evaluation.tier === 'WHIFF') {
      pad.lockUntil = fire + this.cfg.hit.whiffLockoutMs;
      s.stats[side].whiffs += 1;
      s.streak[side] = 0;
      events.push({ type: 'whiff', player: side, evaluation });
      return;
    }
    const contactMs = Math.max(fire, evaluation.tIdeal);
    pad.pending = {
      contactMs,
      evaluation,
      swing: { vx: intent.swing.vx, vy: intent.swing.vy },
      serve: s.phase === 'serveToss',
      lockPos: { x: pad.pos.x, z: pad.pos.z },
    };
    pad.lockUntil = contactMs + this.cfg.hit.swingMs;
    events.push({ type: 'swing', player: side, evaluation, contactMs });
  }

  private applyHit(side: Side, events: SimEvent[]): void {
    const s = this.state;
    const pad = s.paddles[side];
    const pend = pad.pending;
    if (!pend) return;
    pad.pending = null;
    const serve = pend.serve;
    if (!serve) {
      const foul = checkStrike(s.rally, side);
      if (foul) {
        this.endPoint(foul, events);
        return;
      }
    }
    const contact = { x: s.ball.pos.x, y: s.ball.pos.y, z: s.ball.pos.z };
    const targets = planShot(pend.evaluation, contact, { swing: pend.swing }, side, this.cfg, serve);
    const sol = solveShot(contact, targets, this.env, this.dt, this.cfg);
    s.ball.vel.x = sol.vel.x;
    s.ball.vel.y = sol.vel.y;
    s.ball.vel.z = sol.vel.z;
    registerStrike(s.rally, side, serve);
    if (serve) s.phase = 'rally';
    s.lastActivityMs = this.now;

    const tier = pend.evaluation.tier;
    const st = s.stats[side];
    st.hits += 1;
    if (tier === 'PERFECT') {
      st.perfect += 1;
      s.streak[side] += 1;
    } else {
      s.streak[side] = 0;
      if (tier === 'GOOD') st.good += 1;
      else st.weak += 1;
    }
    st.maxStreak = Math.max(st.maxStreak, s.streak[side]);
    events.push({ type: 'hit', player: side, evaluation: pend.evaluation, tier, streak: s.streak[side], pos: contact, serve, targets });
  }

  private emitContact(c: BallContact, events: SimEvent[]): void {
    if (c.kind === 'table') events.push({ type: 'bounce', pos: c.pos, side: c.side, speed: c.impactSpeed });
    else if (c.kind === 'net') events.push({ type: 'net', pos: c.pos, cord: c.cord });
    else events.push({ type: 'floor', pos: c.pos });
  }

  private endPoint(outcome: RuleOutcome, events: SimEvent[]): void {
    const s = this.state;
    if (!outcome) return;
    s.paddles[0].pending = null;
    s.paddles[1].pending = null;
    s.streak = [0, 0];
    s.phase = 'pointOver';
    s.phaseStartMs = this.now;
    if (outcome.kind === 'let') {
      s.lastPoint = null;
      events.push({ type: 'let' });
      return;
    }
    s.score[outcome.winner] += 1;
    s.stats[outcome.winner].points += 1;
    if (outcome.reason === 'NET') s.stats[other(outcome.winner)].netErrors += 1;
    s.lastPoint = { winner: outcome.winner, reason: outcome.reason };
    events.push({ type: 'point', winner: outcome.winner, reason: outcome.reason, score: [s.score[0], s.score[1]] });
  }

  private nextPoint(events: SimEvent[]): void {
    const s = this.state;
    const w = isGameOver(s.score, this.cfg.rules);
    if (w !== null) {
      s.phase = 'gameOver';
      s.winner = w;
      s.phaseStartMs = this.now;
      events.push({ type: 'gameOver', winner: w, score: [s.score[0], s.score[1]] });
      return;
    }
    s.server = serverFor(s.score, s.firstServer, this.cfg.rules);
    s.phase = 'serveHold';
    s.phaseStartMs = this.now;
    s.lastActivityMs = this.now;
    s.rally = newRally();
    this.history = [];
    this.attachBallToServer();
    events.push({ type: 'serveReady', server: s.server });
  }
}
