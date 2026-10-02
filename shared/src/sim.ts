/**
 * Simulación completa de un game: bola con spin, dos raquetas, golpe por click con tipo de golpe por
 * gesto (V0.2), bloqueo, saque simplificado, reglas y marcador. Paso fijo de 120 Hz. Solo consume InputIntent.
 *
 * Tiempos:
 *  - `tick` avanza 1 por paso; el instante de un estado es tick · tickMs (ms de tiempo real).
 *  - La bola se integra con dt = gameSpeed / 120 s de simulación.
 *  - Las raquetas se mueven con 1/120 s de tiempo real.
 */
import { type GameConfig, simDt, tickMs } from './config.ts';
import { classifyGesture, type ShotType } from './gesture.ts';
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

interface PaddleSample {
  t: number;
  v: number;
  x: number;
  z: number;
}

export type SimPhase = 'serveHold' | 'serveToss' | 'rally' | 'pointOver' | 'gameOver';

export interface PendingHit {
  contactMs: number;
  evaluation: HitEvaluation;
  /** Gesto efectivo: el del intento × aimFactor (persiguiendo, se anula: golpe normal y recto). */
  swing: { vx: number; vy: number };
  serve: boolean;
  /** Click con Space mantenido [§8]. */
  block: boolean;
  lockPos: { x: number; z: number };
  /** 0 = persiguiendo (la bola sale recta y normal), 1 = colocado (el gesto apunta y elige golpe del todo). */
  aimFactor: number;
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
  outErrors: number;
  points: number;
  /** Golpes por tipo (sin contar el saque). */
  types: Record<ShotType, number>;
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
  | {
      type: 'swing';
      player: Side;
      evaluation: HitEvaluation;
      contactMs: number;
      aimFactor: number;
      /** Tipo de golpe según el gesto efectivo (el umbral del smash se comprueba en el contacto). */
      shot: ShotType;
      power: number;
      /** Gesto del intento sin escalar (para el panel de precisión). */
      rawSwing: { vx: number; vy: number };
    }
  | { type: 'whiff'; player: Side; evaluation: HitEvaluation | null }
  | {
      type: 'hit';
      player: Side;
      evaluation: HitEvaluation;
      tier: QualityTier;
      streak: number;
      pos: Vec3;
      serve: boolean;
      targets: ShotTargets;
      aimFactor: number;
      /** Bola que llegaba (velocidad y spin del mundo) justo antes del contacto. */
      incoming: { vel: Vec3; spin: Vec3 };
    }
  | { type: 'bounce'; pos: Vec3; side: Side; speed: number }
  | { type: 'net'; pos: Vec3; cord: boolean }
  | { type: 'floor'; pos: Vec3 }
  | { type: 'point'; winner: Side; reason: PointReason; score: [number, number] }
  | { type: 'let' }
  | { type: 'gameOver'; winner: Side; score: [number, number] };

function newStats(): PlayerStats {
  return {
    hits: 0,
    perfect: 0,
    good: 0,
    weak: 0,
    whiffs: 0,
    maxStreak: 0,
    netErrors: 0,
    outErrors: 0,
    points: 0,
    types: { NORMAL: 0, TOPSPIN: 0, SLICE: 0, SMASH: 0, BLOCK: 0 },
  };
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
  /** Velocidad de cada raqueta por tick (para saber si estaba colocada antes del gesto). */
  private paddleSpeedHist: [PaddleSample[], PaddleSample[]] = [[], []];

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
    for (const side of [0, 1] as Side[]) {
      this.movePaddle(side, intents[side], dtReal);
      const v = s.paddles[side].vel;
      const hist = this.paddleSpeedHist[side];
      hist.push({ t, v: Math.sqrt(v.x * v.x + v.z * v.z), x: s.paddles[side].pos.x, z: s.paddles[side].pos.z });
      if (hist.length > 48) hist.shift();
    }

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
    this.paddleSpeedHist = [[], []];
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
      let xs = x;
      if ((s.phase === 'serveHold' || s.phase === 'serveToss') && side === s.server) {
        z = Math.max(z, pc.serveMinDepth);
        xs = Math.max(-pc.serveMaxLateral, Math.min(pc.serveMaxLateral, x));
      }
      tx = xs * sgn;
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
    s.ball.spin.x = 0;
    s.ball.spin.y = 0;
    s.ball.spin.z = 0;
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
      descendingOnly: serve,
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
    const serve = s.phase === 'serveToss';
    const block = intent.block && !serve;
    const aimFactor = block ? 0 : this.aimFactor(side, fire);
    const swing = { vx: intent.swing.vx * aimFactor, vy: intent.swing.vy * aimFactor };
    const hitPos = this.clickPaddlePos(side, fire, swing, aimFactor);
    const evaluation = swingAtNothing ? null : this.evaluateClick(side, fire, hitPos);
    if (!evaluation || evaluation.tier === 'WHIFF') {
      pad.lockUntil = fire + this.cfg.hit.whiffLockoutMs;
      s.stats[side].whiffs += 1;
      s.streak[side] = 0;
      events.push({ type: 'whiff', player: side, evaluation });
      return;
    }
    const contactMs = Math.max(fire, evaluation.tIdeal);
    pad.pending = { contactMs, evaluation, swing, serve, block, lockPos: hitPos, aimFactor };
    pad.lockUntil = contactMs + this.cfg.hit.swingMs;
    const g = serve ? { type: 'NORMAL' as const, power: 0 } : block ? { type: 'BLOCK' as const, power: 0 } : classifyGesture(swing, this.cfg);
    events.push({ type: 'swing', player: side, evaluation, contactMs, aimFactor, shot: g.type, power: g.power, rawSwing: { ...intent.swing } });
  }

  /**
   * Puntería solo si estás colocado: velocidad máxima de la raqueta antes de la ventana del gesto.
   * Persiguiendo la bola → 0 (sale recta); quieta → 1 (el gesto lateral apunta).
   */
  aimFactor(side: Side, fire: number): number {
    const sc = this.cfg.shot;
    let vmax = 0;
    for (const h of this.paddleSpeedHist[side]) {
      if (h.t >= fire - sc.aimSettleFromMs && h.t <= fire - sc.aimSettleToMs && h.v > vmax) vmax = h.v;
    }
    const f = (sc.aimChasingSpeed - vmax) / (sc.aimChasingSpeed - sc.aimSettledSpeed);
    return f <= 0 ? 0 : f >= 1 ? 1 : f;
  }

  /**
   * Posición de la raqueta con la que se mide el golpe. Si estabas colocado y el gesto es un golpe seco
   * (por encima de la zona muerta, en CUALQUIER dirección: §4.6), el gesto es swing, no recolocación: se usa
   * la raqueta de antes del gesto (click − aimSettleToMs), mezclada según lo colocado que estuvieras. Así
   * cruzar o elegir golpe no cuesta posición; su riesgo está en el ángulo, el margen y la potencia (shot.ts).
   * `swing` es el gesto efectivo (ya × aimFactor).
   */
  clickPaddlePos(side: Side, fire: number, swing: { vx: number; vy: number }, aimFactor: number): { x: number; z: number } {
    const pad = this.state.paddles[side].pos;
    const mag = Math.sqrt(swing.vx * swing.vx + swing.vy * swing.vy);
    if (aimFactor <= 0 || mag <= this.cfg.shot.aimSwingDeadZone) return { x: pad.x, z: pad.z };
    const tRef = fire - this.cfg.shot.aimSettleToMs;
    let ref: { x: number; z: number } | null = null;
    for (const h of this.paddleSpeedHist[side]) if (h.t <= tRef) ref = { x: h.x, z: h.z };
    if (!ref) return { x: pad.x, z: pad.z };
    return { x: pad.x + (ref.x - pad.x) * aimFactor, z: pad.z + (ref.z - pad.z) * aimFactor };
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
    const incoming = { vel: { ...s.ball.vel }, spin: { ...s.ball.spin } };
    const targets = planShot(pend.evaluation, contact, { swing: pend.swing }, side, this.cfg, serve, { block: pend.block, incoming });
    const sol = solveShot(contact, targets, this.env, this.dt, this.cfg);
    s.ball.vel.x = sol.vel.x;
    s.ball.vel.y = sol.vel.y;
    s.ball.vel.z = sol.vel.z;
    // El golpe fija el spin de salida (el solver ya lo ha tenido en cuenta).
    s.ball.spin.x = targets.spin.x;
    s.ball.spin.y = targets.spin.y;
    s.ball.spin.z = targets.spin.z;
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
    if (!serve) st.types[targets.type] += 1;
    events.push({ type: 'hit', player: side, evaluation: pend.evaluation, tier, streak: s.streak[side], pos: contact, serve, targets, aimFactor: pend.aimFactor, incoming });
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
    if (outcome.reason === 'OUT') s.stats[other(outcome.winner)].outErrors += 1;
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
