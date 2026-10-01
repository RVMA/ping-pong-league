/**
 * Controlador del cliente: bucle de paso fijo (120 Hz) + render interpolado.
 * Traduce los eventos de la simulación a feedback (texto, sonido, destello, temblor).
 * La lógica del juego vive en @ppp/shared; aquí solo hay presentación y entrada.
 */
import {
  Bot,
  type BotDifficulty,
  type GameConfig,
  type HitEvaluation,
  makeConfig,
  type PathSample,
  predictPath,
  type Side,
  Simulation,
  type SimEvent,
  sideSign,
  type BallContact,
} from '@ppp/shared';
import { AudioManager } from '../audio/audio.ts';
import type { CharacterId } from '../assets/manifest.ts';
import { MouseTranslator } from '../input/mouse.ts';
import { type PaddleFrame, type RenderFrame, World } from '../render/world.ts';
import { type FeedbackKind, Hud } from '../ui/hud.ts';
import { PrecisionStats } from '../ui/precision-stats.ts';
import { type LastHumanHit, pointText } from '../ui/texts.ts';
import type { Settings } from './settings.ts';

const CHARACTERS: [CharacterId, CharacterId] = ['power', 'defender'];
const HUMAN: Side = 0;
const BOT: Side = 1;

interface Snapshot {
  ball: { x: number; y: number; z: number };
  paddles: [{ x: number; z: number }, { x: number; z: number }];
}

interface PaddleFx {
  height: number;
  swingStart: number;
  reach: { x: number; y: number; z: number };
  flash: number;
}

export interface EventLogEntry {
  t: number;
  e: SimEvent;
}

export class Game {
  readonly cfg: GameConfig;
  readonly sim: Simulation;
  readonly world: World;
  readonly hud: Hud;
  readonly audio = new AudioManager();
  readonly input: MouseTranslator;
  private bot: Bot;
  private difficulty: BotDifficulty;
  private readonly clock = { epoch: 0 };
  private running = false;
  private paused = false;
  private prev: Snapshot;
  private curr: Snapshot;
  private fx: [PaddleFx, PaddleFx];
  private predicted: PathSample[] = [];
  private bounceMarker: { x: number; z: number; alpha: number; landed: boolean } | null = null;
  private shake = { amp: 0, until: 0 };
  private lastFrame = 0;
  private lastHumanHit: LastHumanHit | null = null;
  private lastHumanEval: HitEvaluation | null = null;
  private lastHumanAim: number | null = null;
  private readonly precision = new PrecisionStats(20);
  private humanWhiffedThisRally = false;
  private fps = 0;
  /** Registro de eventos recientes (para depurar y para las pruebas automáticas). */
  readonly log: EventLogEntry[] = [];

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, settings: Settings) {
    this.cfg = makeConfig(settings.overrides);
    this.difficulty = settings.difficulty;
    this.sim = new Simulation(this.cfg, { firstServer: HUMAN });
    this.bot = new Bot(BOT, this.cfg.bot.difficulties[this.difficulty], this.cfg, settings.seed);
    this.world = new World(canvas, this.cfg, CHARACTERS);
    this.hud = new Hud(hudRoot, CHARACTERS);
    this.input = new MouseTranslator(canvas, this.world.camera, this.cfg.world.tableHeight + this.cfg.presentation.cursorPlaneHeight, this.clock, HUMAN);
    this.curr = this.snapshot();
    this.prev = this.snapshot();
    const rest = this.cfg.world.tableHeight + this.cfg.paddle.restHeight;
    const mkFx = (): PaddleFx => ({ height: rest, swingStart: Number.NEGATIVE_INFINITY, reach: { x: 0, y: 0, z: 0 }, flash: 0 });
    this.fx = [mkFx(), mkFx()];
    this.hud.setDebug(settings.debug ? [] : null);
    this.hud.setBotDifficulty(this.cfg.bot.difficulties[this.difficulty].label);
    this.hud.setScore(this.sim.state.score, this.sim.state.server);

    const resize = () => this.world.resize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', resize);
    resize();
    window.addEventListener('keydown', (e) => this.onKey(e));
    // El audio solo puede arrancar tras un gesto del usuario (también con ?autostart=1).
    canvas.addEventListener('pointerdown', () => void this.audio.unlock());
    window.addEventListener('blur', () => this.running && !this.paused && this.pause());

    if (settings.autostart) this.start(this.difficulty);
    else this.hud.showStart(this.difficulty, this.labels(), (d) => this.start(d));
    requestAnimationFrame(this.frame);
  }

  private labels(): Record<BotDifficulty, string> {
    const d = this.cfg.bot.difficulties;
    return { easy: d.easy.label, medium: d.medium.label, hard: d.hard.label };
  }

  start(difficulty: BotDifficulty): void {
    void this.audio.unlock();
    this.difficulty = difficulty;
    this.bot.setDifficulty(this.cfg.bot.difficulties[difficulty]);
    this.hud.setBotDifficulty(this.cfg.bot.difficulties[difficulty].label);
    this.sim.restart(HUMAN);
    this.hud.setScore(this.sim.state.score, this.sim.state.server);
    this.hud.hideOverlay();
    this.input.clearFires();
    this.running = true;
    this.paused = false;
    this.clock.epoch = performance.now() - this.sim.now;
    this.onServeReady(this.sim.state.server);
  }

  private pause(): void {
    this.paused = true;
    this.hud.showPause(() => this.resume());
  }

  private resume(): void {
    this.paused = false;
    this.hud.hideOverlay();
    this.input.clearFires();
    this.clock.epoch = performance.now() - this.sim.now;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.running) {
      if (this.paused) this.resume();
      else this.pause();
    } else if (e.key === 'd' || e.key === 'D') {
      this.hud.setDebug(this.hud.debugVisible ? null : []);
    }
  }

  // ——— Bucle ———

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dtFrame = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dtFrame, 1e-3)) * 0.05;
    let alpha = 1;
    if (this.running && !this.paused) {
      const tick = this.sim.tickMs;
      let gameNow = now - this.clock.epoch;
      // Tirón (pestaña oculta, GC largo): se descarta el tiempo en lugar de acelerar.
      if (gameNow - this.sim.now > 250) {
        this.clock.epoch += gameNow - this.sim.now - tick;
        gameNow = now - this.clock.epoch;
      }
      while (this.sim.now + tick <= gameNow) this.tick();
      alpha = Math.max(0, Math.min(1, (gameNow - this.sim.now) / tick));
    }
    this.render(alpha, dtFrame);
  };

  private tick(): void {
    const tickEnd = this.sim.now + this.sim.tickMs;
    const human = this.input.intentFor(tickEnd);
    const bot = this.bot.think(this.sim);
    this.prev = this.curr;
    const events = this.sim.step([human, bot]);
    this.curr = this.snapshot();
    for (const e of events) this.onEvent(e);
  }

  private snapshot(): Snapshot {
    const s = this.sim.state;
    return {
      ball: { ...s.ball.pos },
      paddles: [{ ...s.paddles[0].pos }, { ...s.paddles[1].pos }],
    };
  }

  // ——— Eventos de la simulación ———

  private onEvent(e: SimEvent): void {
    const now = this.sim.now;
    this.log.push({ t: now, e });
    if (this.log.length > 400) this.log.shift();
    const fb = this.cfg.feedback;
    switch (e.type) {
      case 'serveReady':
        this.onServeReady(e.server);
        this.hud.setScore(this.sim.state.score, e.server);
        break;
      case 'toss':
        this.refreshPrediction();
        break;
      case 'swing': {
        const fx = this.fx[e.player];
        fx.swingStart = Math.max(now, e.contactMs - this.cfg.hit.swingMs / 2);
        if (e.player === HUMAN) {
          this.lastHumanEval = e.evaluation;
          this.lastHumanAim = e.aimFactor;
          this.precision.add({ evaluation: e.evaluation, aimFactor: e.aimFactor });
        }
        break;
      }
      case 'whiff':
        this.fx[e.player].swingStart = now;
        this.audio.play('whiff', { volume: e.player === HUMAN ? 0.8 : 0.45, pan: this.pan(e.player) });
        this.message(e.player, fb.whiffText, 'label');
        if (e.player === HUMAN) {
          this.lastHumanEval = e.evaluation;
          this.lastHumanAim = null;
          if (e.evaluation) this.precision.add({ evaluation: e.evaluation, aimFactor: null });
          this.humanWhiffedThisRally = true;
        }
        break;
      case 'hit':
        this.onHit(e);
        break;
      case 'bounce':
        this.audio.play('bounce_table', { volume: Math.min(1, 0.25 + e.speed / 5), pan: e.pos.x });
        if (this.bounceMarker && !this.bounceMarker.landed && e.side === HUMAN) this.bounceMarker.landed = true;
        this.refreshPrediction();
        break;
      case 'net':
        this.audio.play('net', { volume: 0.9, pan: e.pos.x });
        this.refreshPrediction();
        break;
      case 'floor':
        break;
      case 'point': {
        const mine = e.winner === HUMAN;
        this.audio.play(mine ? 'point_win' : 'point_lose', { volume: 0.7 });
        const text = pointText(e.winner, e.reason, this.lastHumanHit, this.cfg.shot.lowContactRefHeight, this.humanWhiffedThisRally);
        this.hud.showToast(text, mine ? 'win' : 'lose', this.cfg.rules.pointDelayMs);
        this.hud.setScore(e.score, this.sim.state.server);
        this.bounceMarker = null;
        break;
      }
      case 'let':
        this.hud.showToast('Let: la bola tocó la red. Se repite el saque.', 'neutral', this.cfg.rules.pointDelayMs);
        this.bounceMarker = null;
        break;
      case 'gameOver':
        this.onGameOver(e.winner, e.score);
        break;
    }
  }

  private onServeReady(server: Side): void {
    this.lastHumanHit = null;
    this.humanWhiffedThisRally = false;
    this.hud.setHint(
      server === HUMAN ? 'Tu saque. Click para lanzar la bola y otro click cuando baje.' : 'Saca el bot. Coloca la raqueta donde vaya a llegar la bola.',
    );
  }

  private onHit(e: Extract<SimEvent, { type: 'hit' }>): void {
    const fb = this.cfg.feedback;
    const fx = this.fx[e.player];
    const pad = this.sim.state.paddles[e.player].pos;
    fx.reach = { x: e.pos.x - pad.x, y: e.pos.y - fx.height, z: e.pos.z - pad.z };
    const own = e.player === HUMAN;
    const pan = this.pan(e.player);
    const volume = own ? 1 : 0.6;
    const reduce = this.cfg.presentation.reduceShakeAndFlash;

    if (e.tier === 'PERFECT') {
      const level = Math.min(e.streak, 4);
      this.audio.play('hit_perfect', { volume, pan });
      this.audio.play(`streak_${level}` as 'streak_1', { volume: own ? 0.9 : 0.5, pan });
      this.message(e.player, fb.streakTexts[level - 1], `perfect-${level}` as FeedbackKind);
      if (!reduce) {
        fx.flash = 1;
        if (own) this.shake = { amp: this.cfg.presentation.shakeOnPerfect * (0.7 + 0.1 * level), until: performance.now() + this.cfg.presentation.shakeMs };
      }
    } else if (e.tier === 'GOOD') {
      this.audio.play('hit_good', { volume, pan });
      this.message(e.player, fb.goodText, 'good');
    } else {
      this.audio.play('hit_normal', { volume, pan });
      const labels: string[] = [];
      if (e.evaluation.causes.includes('EARLY')) labels.push(fb.earlyText);
      if (e.evaluation.causes.includes('LATE')) labels.push(fb.lateText);
      if (e.evaluation.causes.includes('EDGE')) labels.push(fb.edgeText);
      this.message(e.player, labels.join(' + ') || fb.goodText, 'label');
    }

    if (e.serve || this.sim.state.rally.hits <= 2) this.hud.setHint('');
    if (own) {
      this.lastHumanHit = { evaluation: e.evaluation, contactHeight: e.pos.y - this.cfg.world.tableHeight };
      this.bounceMarker = null;
    }
    this.refreshPrediction();
    if (!own && this.cfg.presentation.bounceMarker) this.placeBounceMarker(e.serve);
  }

  private placeBounceMarker(serve: boolean): void {
    const contacts: BallContact[] = [];
    predictPath(this.sim.state.ball, this.sim.env, this.sim.dt, this.sim.tickMs, this.sim.now, 2000, contacts);
    const tables = contacts.filter((c) => c.kind === 'table');
    const target = serve ? tables[1] : tables[0];
    if (target && target.kind === 'table' && target.side === HUMAN) this.bounceMarker = { x: target.pos.x, z: target.pos.z, alpha: 1, landed: false };
  }

  private onGameOver(winner: Side, score: [number, number]): void {
    const st = this.sim.state.stats[HUMAN];
    this.running = false;
    this.hud.setHint('');
    this.hud.showGameOver(
      {
        won: winner === HUMAN,
        score,
        perfectPct: st.hits ? (100 * st.perfect) / st.hits : 0,
        maxStreak: st.maxStreak,
        netErrors: st.netErrors,
        hits: st.hits,
      },
      this.difficulty,
      this.labels(),
      (d) => this.start(d),
    );
  }

  private message(player: Side, text: string, kind: FeedbackKind): void {
    const pad = this.sim.state.paddles[player].pos;
    const own = player === HUMAN;
    // Junto a la raqueta, a su lado exterior: nunca en el centro de la pantalla [§5.2].
    const p = this.world.project(pad.x + (own ? 0.24 : -0.2) * sideSign(player), this.fx[player].height + 0.16, pad.z);
    const scale = own ? 1 : this.cfg.feedback.opponentScale;
    this.hud.feedback(text, kind, p.x, p.y, scale, kind.startsWith('perfect-4') ? this.cfg.feedback.messageMs * 1.4 : this.cfg.feedback.messageMs);
  }

  private pan(player: Side): number {
    return Math.max(-0.8, Math.min(0.8, this.sim.state.paddles[player].pos.x));
  }

  private refreshPrediction(): void {
    this.predicted = predictPath(this.sim.state.ball, this.sim.env, this.sim.dt, this.sim.tickMs, this.sim.now, 1500);
  }

  // ——— Render ———

  /** Altura automática de la raqueta (visual): la de la bola cuando cruce su profundidad. */
  private targetHeight(side: Side, padZ: number): number {
    const s = this.sim.state;
    const top = this.cfg.world.tableHeight;
    const pc = this.cfg.paddle;
    if ((s.phase === 'serveHold' || s.phase === 'serveToss') && side === s.server) return top + this.cfg.serve.idealContactHeight;
    const incoming =
      (s.phase === 'rally' && s.rally.lastHitter !== null && s.rally.lastHitter !== side) || (s.phase === 'serveToss' && side !== s.server);
    if (incoming) {
      const sgn = sideSign(side);
      for (const p of this.predicted) {
        if (p.t < this.sim.now) continue;
        if (p.pos.z * sgn >= padZ * sgn) return Math.max(top + pc.minReachHeight, Math.min(top + pc.maxReachHeight, p.pos.y));
      }
    }
    return top + pc.restHeight;
  }

  private render(alpha: number, dt: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const s = this.sim.state;
    const now = this.sim.now + alpha * this.sim.tickMs;
    const paddles: PaddleFrame[] = [];
    for (const side of [0, 1] as Side[]) {
      const fx = this.fx[side];
      const x = lerp(this.prev.paddles[side].x, this.curr.paddles[side].x);
      const z = lerp(this.prev.paddles[side].z, this.curr.paddles[side].z);
      const k = 1 - Math.exp(-dt * 14);
      fx.height += (this.targetHeight(side, z) - fx.height) * k;
      const decay = Math.exp(-dt / 0.12);
      fx.reach.x *= decay;
      fx.reach.y *= decay;
      fx.reach.z *= decay;
      fx.flash *= Math.exp(-dt / 0.12);
      const sw = (now - fx.swingStart) / this.cfg.hit.swingMs;
      paddles.push({ x, y: fx.height, z, swing: sw >= 0 && sw <= 1 ? sw : null, reach: fx.reach, flash: fx.flash });
    }

    let target: { x: number; z: number } | null = null;
    if (this.running && !this.paused) {
      const t = this.input.currentTarget;
      const pc = this.cfg.paddle;
      target = { x: Math.max(-pc.maxLateral, Math.min(pc.maxLateral, t.x)), z: Math.max(pc.minDepth, Math.min(pc.maxDepth, t.z)) };
    }

    if (this.bounceMarker?.landed) {
      this.bounceMarker.alpha -= dt / 0.35;
      if (this.bounceMarker.alpha <= 0) this.bounceMarker = null;
    }

    let shake = { x: 0, y: 0 };
    const pnow = performance.now();
    if (pnow < this.shake.until) {
      const a = this.shake.amp * ((this.shake.until - pnow) / this.cfg.presentation.shakeMs);
      shake = { x: Math.sin(pnow * 0.09) * a, y: Math.cos(pnow * 0.11) * a };
    }

    const frame: RenderFrame = {
      ball: {
        x: lerp(this.prev.ball.x, this.curr.ball.x),
        y: lerp(this.prev.ball.y, this.curr.ball.y),
        z: lerp(this.prev.ball.z, this.curr.ball.z),
        visible: s.phase !== 'gameOver' && !(s.phase === 'pointOver' && this.sim.now - s.phaseStartMs > this.cfg.rules.pointDelayMs * 0.75),
      },
      paddles: paddles as [PaddleFrame, PaddleFrame],
      target,
      bounceMarker: this.bounceMarker,
      shake,
    };
    this.world.render(frame);
    if (this.hud.debugVisible) this.updateDebug();
  }

  private updateDebug(): void {
    const e = this.lastHumanEval;
    const aim = this.lastHumanAim;
    const fmt = (n: number) => (n > 0 ? `+${n.toFixed(0)}` : n.toFixed(0));
    const aimText = aim === null ? '—' : aim >= 0.99 ? 'activa (colocado)' : aim <= 0.01 ? 'recta (persiguiendo)' : `${Math.round(aim * 100)} %`;
    this.hud.setDebug([
      ['Último golpe', e ? (e.tier === 'WHIFF' ? 'fallo (fuera de ventana)' : e.tier) : '—'],
      ['Timing', e ? `${fmt(e.dtMs)} ms (${e.timingTier})` : '—'],
      ['Posición', e ? `${Math.round(e.posFrac * 100)} % (${e.positionTier})` : '—'],
      ['Puntería', aimText],
      ...this.precision.rows(),
      ['gameSpeed', String(this.cfg.sim.gameSpeed)],
      ['FPS', this.fps.toFixed(0)],
    ]);
  }

  /** Estado legible para pruebas automáticas (Playwright). */
  debugState() {
    const s = this.sim.state;
    return {
      running: this.running,
      paused: this.paused,
      phase: s.phase,
      score: [...s.score],
      server: s.server,
      now: this.sim.now,
      ball: { ...s.ball.pos },
      vel: { ...s.ball.vel },
      paddles: s.paddles.map((p) => ({ ...p.pos })),
      rally: { ...s.rally, bounces: [...s.rally.bounces] },
      stats: s.stats.map((x) => ({ ...x })),
      difficulty: this.difficulty,
    };
  }
}
