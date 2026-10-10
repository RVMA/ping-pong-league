/**
 * Sesión de juego: de dónde salen el estado y los eventos que el Game dibuja. En local, la simulación completa con el
 * bot en este navegador; en red (online-session.ts), la vista del jugador (ClientMatch) contra el bot remoto. El Game
 * no distingue: lee `sim` (misma forma que Simulation) y avanza un tick con el intento del jugador.
 */
import { Bot, type BotDifficulty, type GameConfig, type InputIntent, type SimEvent, Simulation, type Side, type Vec3 } from '@ppp/shared';

/** Lo que el Game lee de una partida (Simulation en local, ClientMatch en red). */
export type SessionView = Pick<Simulation, 'cfg' | 'env' | 'dt' | 'tickMs' | 'now' | 'state'>;

export interface GameSession {
  readonly online: boolean;
  readonly sim: SessionView;
  /** Ya se puede jugar (online: tras el `start` del servidor). */
  readonly ready: boolean;
  /** Prepara un game nuevo contra el bot de esa dificultad. */
  begin(difficulty: BotDifficulty): void;
  /** Avanza un tick con el intento del jugador; devuelve los eventos del tick. En red no envía el estado: ver flush. */
  tick(intent: InputIntent): SimEvent[];
  /**
   * Tras los ticks de cada frame: en red sale el estado que toque (raqueta, ping), una vez y con el último. Así, tras un
   * tirón (calibrando, pestaña oculta), la puesta al día no manda una ráfaga de mensajes viejos.
   */
  flush(): void;
  /** Posición de la bola a dibujar. */
  renderBall(out: Vec3): Vec3;
  dispose(): void;
}

const HUMAN: Side = 0;
const BOT: Side = 1;

/** Partida local (V0.1–V0.2): Simulation + Bot en este navegador. */
export class LocalSession implements GameSession {
  readonly online = false;
  readonly ready = true;
  readonly sim: Simulation;
  private readonly bot: Bot;
  private readonly cfg: GameConfig;

  constructor(cfg: GameConfig, difficulty: BotDifficulty, seed: number) {
    this.cfg = cfg;
    this.sim = new Simulation(cfg, { firstServer: HUMAN });
    this.bot = new Bot(BOT, cfg.bot.difficulties[difficulty], cfg, seed);
  }

  begin(difficulty: BotDifficulty): void {
    this.bot.setDifficulty(this.cfg.bot.difficulties[difficulty]);
    this.sim.restart(HUMAN);
  }

  tick(intent: InputIntent): SimEvent[] {
    const bot = this.bot.think(this.sim);
    return this.sim.step([intent, bot]);
  }

  flush(): void {}

  renderBall(out: Vec3): Vec3 {
    const b = this.sim.state.ball.pos;
    out.x = b.x;
    out.y = b.y;
    out.z = b.z;
    return out;
  }

  dispose(): void {}
}
