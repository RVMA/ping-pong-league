/**
 * Bot [§17.5]: predice la intercepción con la MISMA física compartida (Magnus y bote con spin incluidos) y
 * produce InputIntent como un jugador humano (objetivo de raqueta, gesto lateral para cruzar, teclas de golpe,
 * Space e instante de click). La "humanidad" sale de: retardo de reacción, error de posición, una distribución de
 * calidades de golpe y una mezcla de golpes por dificultad (V0.2). V0.2b: pide el golpe con las mismas teclas que
 * un humano (`modifiers`); la potencia y el resto los decide el mismo código que al humano: sale de la calidad que
 * saque, y si llega persiguiendo la bola, a la mitad (regla de "colocado") y sin cruzar.
 */
import type { BotDifficultyConfig, GameConfig } from './config.ts';
import type { ShotType } from './stroke.ts';
import { type BallContact, type BallState, cloneBall, type PhysicsEnv, stepBall } from './physics.ts';
import type { SimPhase } from './sim.ts';
import { relativeSpin } from './spin.ts';
import { type InputIntent, neutralIntent, type ShotKeys, type Side, sideSign } from './types.ts';

/** PRNG determinista (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tier = 'perfect' | 'good' | 'weak' | 'whiff';

/**
 * Lo único que el bot lee de la partida: así juega igual contra la simulación local (Simulation) y en red, donde
 * lee la vista de su cliente (ClientMatch), que muestra los vuelos con su propio reloj [§17.2, §17.5].
 */
export interface BotView {
  readonly now: number;
  readonly tickMs: number;
  readonly dt: number;
  readonly env: PhysicsEnv;
  readonly state: {
    readonly phase: SimPhase;
    readonly server: Side;
    readonly ball: BallState;
    readonly paddles: readonly [{ readonly pos: { x: number; z: number } }, { readonly pos: { x: number; z: number } }];
    readonly rally: { readonly lastHitter: Side | null; readonly hits: number; readonly isServe: boolean; readonly bounces: readonly Side[] };
  };
}

interface Plan {
  shotId: number;
  skip: boolean;
  target: { x: number; z: number };
  clickMs: number;
  fired: boolean;
  swing: { vx: number; vy: number };
  /** Teclas de golpe que mantiene hasta el click (V0.2b). */
  keys: ShotKeys;
  block: boolean;
  shot: ShotType;
  tier: Tier;
}

/** Punto candidato de intercepción tras el bote. */
interface Intercept {
  t: number;
  x: number;
  z: number;
  /** Parte inferior de la bola sobre la cinta (m). */
  aboveTape: number;
  vh: number;
  top: number;
  score: number;
}

export class Bot {
  readonly side: Side;
  private diff: BotDifficultyConfig;
  private readonly cfg: GameConfig;
  private rng: () => number;
  private plan: Plan | null = null;
  private seenShotId = -1;
  private seenAt = 0;
  private serveTossAt: number | null = null;
  private serveX = 0;
  private ready = { x: 0, z: 1.7 };
  /** Calidad y golpe que el bot intentó en su último golpe (para depuración / tests). */
  lastIntendedTier: Tier | null = null;
  lastIntendedShot: ShotType | null = null;

  constructor(side: Side, diff: BotDifficultyConfig, cfg: GameConfig, seed = 1) {
    this.side = side;
    this.diff = diff;
    this.cfg = cfg;
    this.rng = makeRng(seed);
    this.ready = { x: 0, z: cfg.bot.readyDepth };
  }

  setDifficulty(diff: BotDifficultyConfig): void {
    this.diff = diff;
  }

  private rand(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }

  private sign(): 1 | -1 {
    return this.rng() < 0.5 ? -1 : 1;
  }

  private pickTier(): Tier {
    const q = this.diff.quality;
    const r = this.rng();
    if (r < q.perfect) return 'perfect';
    if (r < q.perfect + q.good) return 'good';
    if (r < q.perfect + q.good + q.weak) return 'weak';
    return 'whiff';
  }

  /** Error de timing (ms) y de posición (fracción del radio) para una calidad. */
  private sampleError(tier: Tier): { dtMs: number; pos: number } {
    const band = this.cfg.bot.bands[tier];
    // En GOOD el error puede venir del timing o de la posición, no de ambos al máximo.
    if (tier === 'good' && this.rng() < 0.5) {
      return { dtMs: this.sign() * this.rand(0, 18), pos: this.rand(band.pos[0], band.pos[1]) };
    }
    if (tier === 'good') return { dtMs: this.sign() * this.rand(band.dtMs[0], band.dtMs[1]), pos: this.rand(0, 0.15) };
    return { dtMs: this.sign() * this.rand(band.dtMs[0], band.dtMs[1]), pos: this.rand(band.pos[0], band.pos[1]) };
  }

  private aim(): number {
    // Velocidad de gesto lateral que produce un objetivo en [−spread, +spread] de la mesa (cruce de §4.5).
    const s = this.cfg.shot;
    const maxSwing = (this.cfg.world.tableWidth / 2) / s.aimSwingGain;
    const v = this.rand(-1, 1) * this.diff.aimSpread * maxSwing;
    return v === 0 ? 0 : v + Math.sign(v) * s.aimSwingDeadZone;
  }

  /**
   * Teclas y gesto lateral para un golpe (V0.2b): la tecla elige el tipo y el gesto lateral cruza la bola (en el
   * slice, la mitad de las veces sin cruce: entonces curva hacia fuera desde el lado donde golpea).
   */
  private stroke(shot: ShotType): { swing: { vx: number; vy: number }; keys: ShotKeys } {
    switch (shot) {
      case 'TOPSPIN':
        return { swing: { vx: this.aim(), vy: 0 }, keys: { topspin: true } };
      case 'SMASH':
        return { swing: { vx: this.aim() * 0.5, vy: 0 }, keys: { smash: true } };
      case 'SLICE':
        return { swing: { vx: this.rng() < 0.5 ? this.aim() : 0, vy: 0 }, keys: { slice: true } };
      case 'BLOCK':
        return { swing: { vx: 0, vy: 0 }, keys: {} };
      default:
        return { swing: { vx: this.aim(), vy: 0 }, keys: {} };
    }
  }

  /** Elige el golpe según la bola que llega y la mezcla de su dificultad. */
  private pickShot(ic: Intercept, high: boolean): ShotType {
    const sh = this.diff.shots;
    const bc = this.cfg.bot;
    if ((ic.vh > bc.blockMinSpeed || Math.abs(ic.top) > bc.blockMinSpin) && this.rng() < sh.block) return 'BLOCK';
    if (high && this.rng() < sh.smash) return 'SMASH';
    if (!high && this.rng() < sh.badSmash) return 'SMASH';
    const r = this.rng();
    if (r < sh.topspin) return 'TOPSPIN';
    if (r < sh.topspin + sh.slice) return 'SLICE';
    return 'NORMAL';
  }

  think(sim: BotView): InputIntent {
    const s = sim.state;
    const sgn = sideSign(this.side);
    const now = sim.now;
    const tNext = now + sim.tickMs;
    const intent = neutralIntent(this.ready.z);
    intent.target = { ...this.ready };

    if (s.phase === 'serveHold' || s.phase === 'pointOver' || s.phase === 'gameOver') {
      this.plan = null;
      if (s.phase !== 'serveHold') this.serveTossAt = null;
    }

    if (s.phase === 'serveHold' && s.server === this.side) {
      if (this.serveTossAt === null) {
        this.serveTossAt = now + this.rand(350, 800);
        this.serveX = this.rand(-0.35, 0.35);
      }
      intent.target = { x: this.serveX, z: 1.6 };
      if (tNext >= this.serveTossAt) {
        intent.fire = this.serveTossAt;
        this.serveTossAt = Number.POSITIVE_INFINITY;
      }
      return intent;
    }

    if (s.phase === 'serveToss' && s.server === this.side) {
      this.serveTossAt = null;
      if (!this.plan) this.plan = this.planServe(sim);
    } else if (s.phase === 'rally') {
      const incoming = s.rally.lastHitter !== null && s.rally.lastHitter !== this.side;
      if (incoming && this.seenShotId !== s.rally.hits) {
        this.seenShotId = s.rally.hits;
        this.seenAt = now;
        this.plan = null;
      }
      if (incoming && !this.plan && now - this.seenAt >= this.diff.reactionMs) this.plan = this.planReturn(sim);
      if (!incoming) {
        this.plan = null;
        // Volver a la posición de espera, algo desplazado hacia donde va la bola.
        const ballRel = s.ball.pos.x * sgn;
        intent.target = { x: Math.max(-0.4, Math.min(0.4, ballRel * 0.4)), z: this.ready.z };
        return intent;
      }
    }

    const plan = this.plan;
    if (plan && !plan.skip) {
      intent.target = { ...plan.target };
      intent.swing = { ...plan.swing };
      // Las teclas de golpe se mantienen hasta el click, como haría una persona.
      if (!plan.fired) intent.modifiers = { ...plan.keys };
      // Space solo en el último tramo: mientras se mantiene, la raqueta va más despacio [§8].
      intent.block = plan.block && !plan.fired && tNext >= plan.clickMs - this.cfg.bot.blockHoldMs;
      if (!plan.fired && tNext >= plan.clickMs) {
        intent.fire = plan.clickMs;
        plan.fired = true;
        this.lastIntendedTier = plan.tier;
        this.lastIntendedShot = plan.shot;
      }
    }
    return intent;
  }

  private planServe(sim: BotView): Plan {
    const s = sim.state;
    const sgn = sideSign(this.side);
    const yIdeal = sim.env.tableTop + this.cfg.serve.idealContactHeight;
    const b = cloneBall(s.ball);
    let t = sim.now;
    let tIdeal = t;
    for (let i = 0; i < 400; i++) {
      const py = b.pos.y;
      stepBall(b, sim.dt, sim.env);
      t += sim.tickMs;
      if (b.vel.y < 0 && py >= yIdeal && b.pos.y < yIdeal) {
        tIdeal = t - sim.tickMs + (sim.tickMs * (py - yIdeal)) / (py - b.pos.y);
        break;
      }
    }
    const tier = this.pickTier();
    const err = this.sampleError(tier);
    const pad = s.paddles[this.side].pos;
    return {
      shotId: -1,
      skip: false,
      target: { x: pad.x * sgn + this.sign() * err.pos * this.cfg.paddle.radius, z: pad.z * sgn },
      clickMs: tIdeal + err.dtMs,
      fired: false,
      swing: { vx: this.aim(), vy: 0 },
      keys: {},
      block: false,
      shot: 'NORMAL',
      tier,
    };
  }

  private planReturn(sim: BotView): Plan {
    const s = sim.state;
    const sgn = sideSign(this.side);
    const env = sim.env;
    const pc = this.cfg.paddle;
    const b = cloneBall(s.ball);
    const contacts: BallContact[] = [];
    let t = sim.now;
    let bounced = false;
    // En el saque, el primer bote es en el campo de quien saca: no cuenta.
    let serverBouncePending = s.rally.isServe && s.rally.bounces.length === 0;
    let best: Intercept | null = null;
    let bestHigh: Intercept | null = null;
    /** Para bloquear: el punto más alto cerca de su profundidad preferida (bloquear bajo una bola rápida = red). */
    let bestBlock: Intercept | null = null;
    const smashFrom = this.cfg.shotTypes.smash.minAboveTape + this.cfg.bot.smashMargin;
    for (let i = 0; i < 600; i++) {
      contacts.length = 0;
      stepBall(b, sim.dt, env, contacts);
      t += sim.tickMs;
      for (const c of contacts) {
        if (c.kind === 'table' && serverBouncePending && c.side !== this.side) {
          serverBouncePending = false;
        } else if (c.kind === 'table' && !bounced) {
          if (c.side !== this.side) return this.skipPlan(s.rally.hits);
          bounced = true;
        } else if (c.kind === 'table' || c.kind === 'floor') {
          i = 600;
        }
      }
      if (i >= 600) break;
      if (!bounced) continue;
      const depth = b.pos.z * sgn;
      const h = b.pos.y - env.tableTop;
      if (depth < pc.minDepth || depth > pc.maxDepth || h < pc.minReachHeight + 0.04 || h > pc.maxReachHeight) continue;
      const score = Math.abs(depth - this.diff.preferredDepth);
      const aboveTape = b.pos.y - env.r - env.netTop;
      const ic: Intercept = { t, x: b.pos.x * sgn, z: depth, aboveTape, vh: Math.hypot(b.vel.x, b.vel.z), top: relativeSpin(b.spin, b.vel).top, score };
      if (!best || score < best.score) best = ic;
      if (aboveTape >= smashFrom && (!bestHigh || score < bestHigh.score)) bestHigh = ic;
      if (score < 0.6 && (!bestBlock || aboveTape > bestBlock.aboveTape)) bestBlock = ic;
    }
    if (!best) return this.skipPlan(s.rally.hits);
    let shot = this.pickShot(best, bestHigh !== null);
    // Para el smash espera la bola alta (otro punto de la trayectoria) si la hay.
    const at = shot === 'SMASH' && bestHigh ? bestHigh : shot === 'BLOCK' && bestBlock ? bestBlock : best;
    if (shot === 'SMASH' && !bestHigh && this.diff.shots.badSmash === 0) shot = 'NORMAL';
    const tier = this.pickTier();
    const err = this.sampleError(tier);
    const { swing, keys } = this.stroke(shot);
    return {
      shotId: s.rally.hits,
      skip: false,
      target: { x: at.x + this.sign() * err.pos * pc.radius, z: at.z },
      clickMs: at.t + err.dtMs,
      fired: false,
      swing,
      keys,
      block: shot === 'BLOCK',
      shot,
      tier,
    };
  }

  private skipPlan(shotId: number): Plan {
    return {
      shotId,
      skip: true,
      target: { ...this.ready },
      clickMs: Number.POSITIVE_INFINITY,
      fired: true,
      swing: { vx: 0, vy: 0 },
      keys: {},
      block: false,
      shot: 'NORMAL',
      tier: 'whiff',
    };
  }
}
