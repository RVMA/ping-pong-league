/**
 * Piloto automático [§17.5, V0.4]: el mismo `Bot` de @ppp/shared mueve la raqueta del jugador LOCAL. Produce el
 * InputIntent del tick en coordenadas de ese jugador (como el ratón y como el bot remoto en el lado 1), así que pasa por
 * el mismo camino que la entrada humana: la misma sesión, los mismos mensajes. Sus clicks salen con su instante exacto en
 * tiempo de partida, sin desfase de latencia (el de la calibración es del ratón, no de este piloto).
 *  - `?autoplay=<dificultad>`: juega con el perfil de esa dificultad (pruebas E2E y demostraciones).
 *  - Prueba de lectura (§13.1): `readerProfile` — tu raqueta devuelve sola, con golpes normales.
 * Si la vista cambia (otra conexión de la sala: una ClientMatch nueva) o su reloj va hacia atrás, el Bot empieza de cero:
 * sus planes e instantes eran del reloj de la vista anterior.
 */
import { Bot, type BotDifficulty, type BotDifficultyConfig, type BotView, type GameConfig, type InputIntent, type Side } from '@ppp/shared';

export class AutoPlayer {
  readonly side: Side;
  readonly profile: BotDifficultyConfig;
  private readonly cfg: GameConfig;
  private readonly seed: number;
  private bot: Bot;
  private view: BotView | null = null;
  private lastNow = Number.NEGATIVE_INFINITY;
  /** Veces que el Bot empezó de cero (cada una con otra semilla). */
  private resets = 0;

  constructor(side: Side, profile: BotDifficultyConfig, cfg: GameConfig, seed: number) {
    this.side = side;
    this.profile = profile;
    this.cfg = cfg;
    this.seed = seed;
    this.bot = new Bot(side, profile, cfg, seed);
  }

  /** El intento del jugador local en este tick (sustituye al del ratón). Se llama antes de avanzar la vista. */
  intent(view: BotView): InputIntent {
    if (view !== this.view || view.now < this.lastNow) {
      if (this.view !== null) this.bot = new Bot(this.side, this.profile, this.cfg, (this.seed + 7919 * ++this.resets) >>> 0);
      this.view = view;
    }
    this.lastNow = view.now;
    return this.bot.think(view);
  }
}

/**
 * Quién mueve tu raqueta: el lector de la prueba de lectura mientras dura, si no el piloto de `?autoplay=` (perfil de esa
 * dificultad) y, sin ninguno, el ratón (null). Un piloto nuevo solo cuando cambian el perfil o tu lado (el del `welcome`).
 */
export class PilotSeat {
  private readonly cfg: GameConfig;
  private readonly autoplay: BotDifficultyConfig | null;
  private readonly reader: BotDifficultyConfig;
  private readonly seed: number;
  private side: Side = 0;
  private reading = false;
  private current: AutoPlayer | null = null;

  constructor(cfg: GameConfig, autoplay: BotDifficulty | null, seed: number) {
    this.cfg = cfg;
    this.autoplay = autoplay ? cfg.bot.difficulties[autoplay] : null;
    this.reader = readerProfile(cfg);
    this.seed = seed;
    this.refresh();
  }

  get pilot(): AutoPlayer | null {
    return this.current;
  }

  /** Hay `?autoplay=` (aunque ahora conduzca el lector). */
  get autoplaying(): boolean {
    return this.autoplay !== null;
  }

  setSide(side: Side): void {
    this.side = side;
    this.refresh();
  }

  setReading(on: boolean): void {
    this.reading = on;
    this.refresh();
  }

  private refresh(): void {
    const profile = this.reading ? this.reader : this.autoplay;
    if (!profile) this.current = null;
    else if (this.current?.side !== this.side || this.current.profile !== profile) this.current = new AutoPlayer(this.side, profile, this.cfg, this.seed);
  }
}

/**
 * Devolución de la prueba de lectura (§13.1): solo golpes normales (topspin, slice, smash y bloqueo a 0); calidad de
 * presentation.readTest.autoReturn (el débil, siempre tarde: una bola alta para que el rival pueda hacer smash); reacción,
 * puntería y profundidad de «Difícil». Sin fallos de click (whiff 0).
 */
export function readerProfile(cfg: GameConfig): BotDifficultyConfig {
  const hard = cfg.bot.difficulties.hard;
  const q = cfg.presentation.readTest.autoReturn;
  return {
    label: 'Prueba de lectura',
    reactionMs: hard.reactionMs,
    quality: { perfect: q.perfect, good: q.good, weak: q.weakLate, whiff: 0 },
    aimSpread: hard.aimSpread,
    preferredDepth: hard.preferredDepth,
    shots: { topspin: 0, slice: 0, smash: 0, badSmash: 0, block: 0 },
    lateWeak: true,
  };
}
