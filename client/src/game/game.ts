/**
 * Controlador del cliente: bucle de paso fijo (120 Hz) + render interpolado.
 * Traduce los eventos de la simulación a feedback (texto, sonido, destello, temblor).
 * La lógica del juego vive en @ppp/shared; aquí solo hay presentación y entrada.
 */
import {
  type BotDifficulty,
  describeStroke,
  diagnose,
  type GameConfig,
  type HitEvaluation,
  makeConfig,
  type PathSample,
  predictPath,
  powerLevel,
  relativeSpin,
  type ShotKeys,
  shotFromKeys,
  type ShotTargets,
  type ShotType,
  type PingLevel,
  pingLevel,
  type Side,
  type SimEvent,
  sideSign,
  spinKind,
  type BallContact,
  type Vec3,
} from '@ppp/shared';
import { AudioManager } from '../audio/audio.ts';
import type { CharacterId } from '../assets/manifest.ts';
import { type FireRecord, KEY_NOTE_MS, MouseTranslator, SHOT_KEY_LABEL } from '../input/mouse.ts';
import { newRenderFrame, World } from '../render/world.ts';
import { type FeedbackKind, Hud } from '../ui/hud.ts';
import { PrecisionStats } from '../ui/precision-stats.ts';
import { keyMissText, pointText, powerLevelText, SHOT_LABEL, strokeText } from '../ui/texts.ts';
import { type NetStatus, OnlineSession } from '../net/online-session.ts';
import { Calibration, loadLatencyOffset, saveLatencyOffset } from './calibration.ts';
import { type LobbyInfo, type PlayMode, type RoomHost, RoomFlow } from './room-flow.ts';
import { type GameSession, LocalSession, type SessionView } from './session.ts';
import { loadExplain, loadKeyBar, saveExplain, saveKeyBar, type Settings } from './settings.ts';
import { bounceMarkerShown, tickBudget } from './view-side.ts';

const CHARACTERS: [CharacterId, CharacterId] = ['power', 'defender'];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Snapshot {
  ball: { x: number; y: number; z: number };
  paddles: [{ x: number; z: number }, { x: number; z: number }];
}

/** Último golpe del humano en el punto (para "¿por qué fallé?"). */
interface LastHumanHit {
  targets: ShotTargets;
  evaluation: HitEvaluation;
  contactHeight: number;
}

/** Último click del humano (panel D). */
interface LastSwing {
  shot: ShotType;
  power: number;
  keys: ShotKeys;
  raw: { vx: number; vy: number };
  aimFactor: number;
}

/** Mensaje del último golpe propio, para completarlo si la tecla llega justo después del click (V0.2b). */
interface OwnHitMessage {
  node: HTMLElement;
  click: FireRecord | null;
  type: ShotType;
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

export class Game implements RoomHost {
  readonly cfg: GameConfig;
  readonly world: World;
  readonly hud: Hud;
  readonly audio = new AudioManager();
  readonly input: MouseTranslator;
  /** La sesión en red: la del bot remoto (V0.3) o la de la sala (V0.4); null en local. */
  private online: OnlineSession | null;
  private readonly local: LocalSession;
  /** Lobby, sala y su flujo (V0.4). */
  readonly roomFlow: RoomFlow;
  private readonly onlineParams: Settings['online'];
  private difficulty: BotDifficulty;
  readonly clock = { epoch: 0 };
  /** Lado del jugador local: el de la sesión (en una sala, el del `welcome`; si no, 0). */
  private me: Side = 0;
  /** Lo que se dibuja en cada frame: objetos reutilizados (sin memoria nueva por frame). */
  private readonly rf = newRenderFrame();
  private readonly cursorOut = { x: 0, z: 0 };
  private readonly trailOut = { color: '', alpha: 0 };
  private readonly relOut = { top: 0, side: 0 };
  private readonly outlineOut = { color: '' };
  /** Pings por lado para el marcador (reutilizados: sin memoria nueva por frame). */
  private readonly pingVals: [number | null, number | null] = [null, null];
  private readonly pingLvls: [PingLevel, PingLevel] = ['unknown', 'unknown'];
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
  private lastHumanWhiff: HitEvaluation | null = null;
  private lastSwing: LastSwing | null = null;
  private lastHumanShot: ShotTargets | null = null;
  /** Último golpe del bot en el punto: contexto de "no la devolviste" y panel D. */
  private lastBotShot: ShotType | null = null;
  private readonly precision = new PrecisionStats(20);
  private humanWhiffedThisRally = false;
  /** "¿Por qué fallé?" activado [§2.2: desactivable]. */
  private explain: boolean;
  private calibration: Calibration | null = null;
  /** Desfase de latencia calibrado (ms) o null si este jugador no ha calibrado. */
  private latencyOffset: number | null = null;
  private fps = 0;
  /** Barra de teclas de golpe visible (Tab; se guarda en este navegador). */
  private keyBarOn = loadKeyBar();
  /** Click del humano que produjo el último evento 'swing' (teclas en su instante). */
  private humanClick: FireRecord | null = null;
  private ownHit: OwnHitMessage | null = null;
  /** Segunda línea del último mensaje de golpe propio (para pruebas automáticas). */
  private lastStrokeText: string | null = null;
  /** Registro de eventos recientes (para depurar y para las pruebas automáticas). */
  readonly log: EventLogEntry[] = [];
  /** Mayor desplazamiento de la bola dibujada entre dos frames durante el juego (m): para medir saltos. */
  private ballStep = { max: 0, prev: { x: 0, y: 0, z: 0 }, ok: false };

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, settings: Settings) {
    this.cfg = makeConfig(settings.overrides);
    this.difficulty = settings.difficulty;
    this.onlineParams = settings.online;
    this.local = new LocalSession(this.cfg, this.difficulty, settings.seed);
    this.online = settings.online ? new OnlineSession(this.cfg, { ...settings.online, seed: settings.seed }, this.clock) : null;
    if (this.online) this.online.onStatus = (s, d) => this.onNetStatus(s, d);
    this.world = new World(canvas, this.cfg, CHARACTERS);
    this.hud = new Hud(hudRoot, CHARACTERS);
    this.input = new MouseTranslator(canvas, this.world.camera, this.cfg.world.tableHeight + this.cfg.presentation.cursorPlaneHeight, this.clock, 0);
    this.roomFlow = new RoomFlow(this, settings);
    this.curr = this.snapshot(this.emptySnapshot());
    this.prev = this.snapshot(this.emptySnapshot());
    const rest = this.cfg.world.tableHeight + this.cfg.paddle.restHeight;
    const mkFx = (): PaddleFx => ({ height: rest, swingStart: Number.NEGATIVE_INFINITY, reach: { x: 0, y: 0, z: 0 }, flash: 0 });
    this.fx = [mkFx(), mkFx()];
    this.hud.setDebug(settings.debug ? [] : null);
    this.hud.setBotDifficulty(this.cfg.bot.difficulties[this.difficulty].label);
    this.hud.setScore(this.sim.state.score, this.sim.state.server);
    this.hud.setPings(this.online ? [null, null] : null, ['unknown', 'unknown']);

    const resize = () => this.world.resize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', resize);
    resize();
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.roomFlow.onKey(e));
    // El audio solo puede arrancar tras un gesto del usuario (también con ?autostart=1).
    canvas.addEventListener('pointerdown', (e) => {
      void this.audio.unlock();
      if (this.calibration && e.button === 0) this.onCalibrationClick(e.timeStamp);
    });
    // En red no hay pausa: el servidor y el rival siguen.
    window.addEventListener('blur', () => this.running && !this.paused && !this.online && this.pause());

    this.explain = settings.explain ?? loadExplain() ?? this.cfg.presentation.explainErrors;

    const stored = settings.latencyOffset ?? loadLatencyOffset();
    const { latencyOffsetMin, latencyOffsetMax } = this.cfg.input;
    this.latencyOffset = stored === null ? null : Math.max(latencyOffsetMin, Math.min(latencyOffsetMax, stored));
    this.input.latencyOffsetMs = this.latencyOffset ?? 0;
    this.online?.setLatencyOffset(this.latencyOffset ?? 0);
    this.input.onShotKeyDown = (key, perf) => this.onShotKeyDown(key, perf);

    if (settings.autostart) this.start(this.difficulty);
    else if (this.onlineParams) this.showMenu();
    else this.roomFlow.boot();
    requestAnimationFrame(this.frame);
  }

  /** De dónde sale la partida: simulación local o vista en red (bot remoto de V0.3 o sala). */
  get session(): GameSession {
    return this.online ?? this.local;
  }

  /** Fuera del juego: el lobby o la sala (V0.4); con ?online=1, la pantalla de inicio de V0.3 contra el bot remoto. */
  private showMenu(): void {
    if (!this.onlineParams) return this.roomFlow.home();
    this.setPlay('off');
    const info = this.lobbyInfo();
    this.hud.showStart(this.difficulty, info.labels, (d) => this.start(d), { offsetMs: this.latencyOffset, onCalibrate: () => this.startCalibration() }, { on: info.explain, onToggle: info.setExplain }, this.onlineInfo());
  }

  /** Lo que enseña el lobby (V0.4). */
  lobbyInfo(): LobbyInfo {
    const setExplain = (on: boolean) => {
      this.explain = on;
      saveExplain(on);
    };
    return { offsetMs: this.latencyOffset, explain: this.explain, labels: this.labels(), difficulty: this.difficulty, setExplain };
  }

  /** La sesión en red de la sala pasa a ser la del juego (null: vuelve la local). */
  useNet(session: OnlineSession | null): void {
    this.online = session;
    session?.setLatencyOffset(this.latencyOffset ?? 0);
  }

  /** Se juega ('play'), se mueve la raqueta sin golpear ('hold', fases de sala sin juego) o hay una pantalla encima. */
  setPlay(mode: PlayMode): void {
    this.running = mode !== 'off';
    this.paused = false;
    this.input.captureKeys = this.running;
    this.input.enabled = mode === 'play';
    this.input.clearFires();
    this.hud.showKeyBar(this.running && this.keyBarOn);
    if (mode !== 'play') this.hud.setHint('');
  }

  /** Línea del menú en el modo online (undefined en local). */
  private onlineInfo(): string | undefined {
    const o = this.onlineParams;
    if (!o) return undefined;
    return `Online contra el bot remoto · tu ping simulado ${o.ping} ms · el del bot ${o.botping} ms · variación ±${Math.round(o.jitter * 100)} %`;
  }

  /** Cambios de la conexión (modo online). */
  private onNetStatus(status: NetStatus, detail: string): void {
    if (status === 'waiting') this.hud.showConnection('Conectando…', 'Esperando al bot remoto.');
    else if (status === 'playing') this.beginPlay();
    else if (status === 'lost' || status === 'error') {
      this.setPlay('off');
      this.hud.showConnection(status === 'lost' ? 'Conexión perdida' : 'No se pudo jugar online', detail, () => this.showMenu());
    }
  }

  // ——— Calibración de latencia (P7) ———

  startCalibration(): void {
    void this.audio.unlock();
    this.running = false;
    this.hud.hideOverlay();
    this.hud.showKeyBar(false);
    this.hud.setHint('');
    const top = this.cfg.world.tableHeight;
    this.calibration = new Calibration(this.cfg, { x: 0, y: top + 0.25, z: 1.6 }, performance.now(), Math.floor(Math.random() * 1e9));
    this.updateCalibrationBanner();
  }

  private updateCalibrationBanner(): void {
    const c = this.calibration;
    if (!c) return;
    this.hud.setBanner('Haz click justo cuando la bola llegue al centro de tu raqueta', `Bola ${Math.max(1, c.index)} de ${c.total}. Esc para salir.`);
  }

  private onCalibrationClick(t: number): void {
    const c = this.calibration;
    if (!c) return;
    const delta = c.click(t);
    if (delta === null) return;
    this.audio.play('hit_good', { volume: 0.7 });
    this.fx[0].flash = 0.8;
    const p = this.world.project(c.sweet.x + 0.24, c.sweet.y + 0.16, c.sweet.z);
    const ms = Math.round(delta);
    this.hud.feedback(`${ms > 0 ? '+' : ''}${ms} ms`, 'label', p.x, p.y, 1, 700);
  }

  private finishCalibration(): void {
    const c = this.calibration;
    if (!c) return;
    this.calibration = null;
    this.hud.setBanner(null);
    const r = c.result();
    this.hud.showCalibrationResult(
      r,
      () => {
        this.latencyOffset = r.offsetMs;
        this.input.latencyOffsetMs = r.offsetMs;
        this.online?.setLatencyOffset(r.offsetMs);
        saveLatencyOffset(r.offsetMs);
        this.showMenu();
      },
      () => this.startCalibration(),
      () => this.showMenu(),
    );
  }

  get calibrating(): boolean {
    return this.calibration !== null;
  }

  cancelCalibration(): void {
    this.calibration = null;
    this.hud.setBanner(null);
    this.showMenu();
  }

  private labels(): Record<BotDifficulty, string> {
    const d = this.cfg.bot.difficulties;
    return { easy: d.easy.label, medium: d.medium.label, hard: d.hard.label };
  }

  start(difficulty: BotDifficulty): void {
    void this.audio.unlock();
    this.difficulty = difficulty;
    this.hud.setBotDifficulty(this.cfg.bot.difficulties[difficulty].label);
    this.session.begin(difficulty);
    if (this.online && !this.online.ready) {
      this.running = false;
      this.hud.showConnection('Conectando…', 'Preparando la partida contra el bot remoto.');
      return;
    }
    this.beginPlay();
  }

  /** Empieza a jugar con la sesión lista (en red, tras el `start` del servidor). */
  private beginPlay(): void {
    this.hud.setScore(this.sim.state.score, this.sim.state.server);
    this.hud.hideOverlay();
    this.setPlay('play');
    // En local el reloj sigue a la simulación; en red lo fija el `start` del servidor (OnlineSession).
    if (!this.online) this.clock.epoch = performance.now() - this.sim.now;
    this.onServeReady(this.sim.state.server);
  }

  /** La partida que se dibuja (Simulation en local, ClientMatch en red). */
  get sim(): SessionView {
    return this.session.sim;
  }

  private pause(): void {
    this.paused = true;
    this.input.captureKeys = false;
    this.hud.showKeyBar(false);
    this.hud.showPause(
      () => this.resume(),
      () => this.showMenu(),
    );
  }

  private resume(): void {
    this.paused = false;
    this.input.captureKeys = true;
    this.hud.showKeyBar(this.keyBarOn);
    this.hud.hideOverlay();
    this.input.clearFires();
    this.clock.epoch = performance.now() - this.sim.now;
  }

  private onKey(e: KeyboardEvent): void {
    this.roomFlow.onKey(e);
    // Escribiendo en el lobby (nombre, código) las letras no son atajos.
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape' && this.calibration) {
      this.cancelCalibration();
    } else if (e.key === 'Escape' && this.running && !this.online) {
      if (this.paused) this.resume();
      else this.pause();
    } else if (e.key === 'd' || e.key === 'D') {
      this.hud.setDebug(this.hud.debugVisible ? null : []);
    } else if (e.key === 'Tab' && this.running && !this.paused) {
      // Durante la partida, Tab muestra u oculta la barra de teclas y no mueve el foco de la página.
      e.preventDefault();
      this.keyBarOn = !this.keyBarOn;
      saveKeyBar(this.keyBarOn);
      this.hud.showKeyBar(this.keyBarOn);
    }
  }

  /**
   * Tecla de golpe pulsada justo DESPUÉS de un click sin tecla (V0.2b): si el mensaje de ese golpe aún se ve, se
   * completa con el motivo («pulsaste W después del click»). Si el golpe aún no ha llegado, lo dirá al llegar.
   */
  private onShotKeyDown(key: string, perf: number): void {
    const h = this.ownHit;
    if (!h || !h.click || h.type !== 'NORMAL' || Object.keys(h.click.keys).length) return;
    const ms = perf - h.click.perf;
    if (ms < 0 || ms > KEY_NOTE_MS) return;
    const sub = strokeText('NORMAL', { level: null, notes: [] }, keyMissText({ key, after: true }));
    if (sub) {
      // El mensaje ya se está desvaneciendo: se alarga para que dé tiempo a leer el motivo.
      this.hud.setFeedbackSub(h.node, sub, this.cfg.feedback.messageMs * 2);
      this.lastStrokeText = sub;
    }
  }

  // ——— Bucle ———

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    this.roomFlow.update(now);
    this.syncSide();
    const dtFrame = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dtFrame, 1e-3)) * 0.05;
    if (this.calibration) {
      this.calibration.update(now);
      this.updateCalibrationBanner();
      this.renderCalibration(now, dtFrame);
      if (this.calibration.done) this.finishCalibration();
      return;
    }
    let alpha = 1;
    // En red la partida avanza siempre que la sesión esté lista (también con el fin del game en pantalla).
    const live = this.online ? this.online.ready : this.running && !this.paused;
    if (live) {
      const tick = this.sim.tickMs;
      let gameNow = now - this.clock.epoch;
      // Tirón (pestaña oculta, GC largo): en local se descarta el tiempo en lugar de acelerar; en red no se puede
      // (el servidor y el rival siguen), así que se recupera: más de 2 s atrás, por tramos de 240 ticks por frame.
      if (!this.online && gameNow - this.sim.now > 250) {
        this.clock.epoch += gameNow - this.sim.now - tick;
        gameNow = now - this.clock.epoch;
      }
      let budget = tickBudget(this.online !== null, gameNow - this.sim.now);
      while (budget-- > 0 && this.sim.now + tick <= gameNow) this.tick();
      // En red, lo que se envía del estado (raqueta, ping) sale una vez por frame, con el último tick: tras un tirón, sin ráfaga.
      this.session.flush();
      alpha = Math.max(0, Math.min(1, (gameNow - this.sim.now) / tick));
    }
    this.render(alpha, dtFrame);
  };

  /**
   * El lado local sale de la sesión (cambia con cada `welcome`): la cámara, el ratón y el marcador lo siguen. Calibrando,
   * la mesa se ve siempre desde el lado 0 (la bola de la calibración llega a esa raqueta). Solo hace algo si cambia.
   */
  private syncSide(): void {
    const side = this.session.side;
    const view: Side = this.calibration ? 0 : side;
    if (side === this.me && view === this.world.viewSide) return;
    if (side !== this.me) {
      this.me = side;
      this.hud.setLocalSide(side);
      this.bounceMarker = null;
    }
    this.world.setViewSide(view);
    // Tras la cámara: el cursor se vuelve a proyectar con ella.
    this.input.setSide(side);
  }

  private tick(): void {
    const tickEnd = this.sim.now + this.sim.tickMs;
    const human = this.input.intentFor(tickEnd);
    const events = this.session.tick(human);
    // Instantáneas reutilizadas (sin asignar memoria por tick): la anterior pasa a ser la actual.
    const old = this.prev;
    this.prev = this.curr;
    this.curr = this.snapshot(old);
    // En la cuenta atrás del inicio el rally del warm-up ya no cuenta: ni se oye ni se ve.
    if (!this.roomFlow.muted) for (const e of events) this.onEvent(e);
  }

  private emptySnapshot(): Snapshot {
    return { ball: { x: 0, y: 0, z: 0 }, paddles: [{ x: 0, z: 0 }, { x: 0, z: 0 }] };
  }

  private snapshot(out: Snapshot): Snapshot {
    const s = this.sim.state;
    this.session.renderBall(out.ball as Vec3);
    for (const i of [0, 1] as const) {
      out.paddles[i].x = s.paddles[i].pos.x;
      out.paddles[i].z = s.paddles[i].pos.z;
    }
    return out;
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
        if (e.player === this.me) {
          this.lastHumanEval = e.evaluation;
          this.lastHumanAim = e.aimFactor;
          this.lastSwing = { shot: e.shot, power: e.power, keys: e.keys, raw: e.rawSwing, aimFactor: e.aimFactor };
          this.humanClick = this.input.lastFire;
          this.precision.add({ evaluation: e.evaluation, aimFactor: e.aimFactor });
        }
        break;
      }
      case 'whiff':
        this.fx[e.player].swingStart = now;
        this.audio.play('whiff', { volume: e.player === this.me ? 0.8 : 0.45, pan: this.pan(this.sim.state.paddles[e.player].pos.x) });
        this.message(e.player, fb.whiffText, 'label');
        if (e.player === this.me) {
          this.lastHumanEval = e.evaluation;
          this.lastHumanAim = null;
          this.lastHumanWhiff = e.evaluation;
          if (e.evaluation) this.precision.add({ evaluation: e.evaluation, aimFactor: null });
          this.humanWhiffedThisRally = true;
        }
        break;
      case 'hit':
        this.onHit(e);
        break;
      case 'bounce':
        this.audio.play('bounce_table', { volume: Math.min(1, 0.25 + e.speed / 5), pan: this.pan(e.pos.x) });
        if (this.bounceMarker && !this.bounceMarker.landed && e.side === this.me) this.bounceMarker.landed = true;
        if (e.edge) {
          this.audio.play('edge', { volume: 0.8, pan: this.pan(e.pos.x) });
          const q = this.world.project(e.pos.x, e.pos.y + 0.1, e.pos.z);
          this.hud.feedback('¡Canto!', 'label', q.x, q.y, 1, 900);
        }
        this.refreshPrediction();
        break;
      case 'tableSide':
        this.audio.play('edge', { volume: 0.7, pan: this.pan(e.pos.x) });
        break;
      case 'net':
        this.audio.play('net', { volume: 0.9, pan: this.pan(e.pos.x) });
        this.refreshPrediction();
        break;
      case 'floor':
        break;
      case 'point': {
        const mine = e.winner === this.me;
        this.audio.play(mine ? 'point_win' : 'point_lose', { volume: 0.7 });
        const why =
          !mine && this.explain
            ? diagnose({ reason: e.reason, lastHit: this.lastHumanHit, whiff: this.lastHumanWhiff, whiffed: this.humanWhiffedThisRally }, this.cfg)
            : null;
        const rival = this.roomFlow.active ? 'rival' : 'bot';
        const text = pointText({ mine, reason: e.reason, why, rivalShot: this.lastBotShot, smashMinAboveTape: this.cfg.shotTypes.smash.minAboveTape, rival });
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
        if (this.roomFlow.active) this.roomFlow.onGameOver();
        else this.onGameOver(e.winner, e.score);
        break;
    }
  }

  private onServeReady(server: Side): void {
    this.lastHumanHit = null;
    this.lastHumanWhiff = null;
    this.lastBotShot = null;
    this.humanWhiffedThisRally = false;
    const rival = this.roomFlow.active ? 'el rival' : 'el bot';
    this.hud.setHint(
      !this.running ? '' : server === this.me ? 'Tu saque. Click para lanzar la bola y otro click cuando baje.' : `Saca ${rival}. Coloca la raqueta donde vaya a llegar la bola.`,
    );
  }

  private onHit(e: Extract<SimEvent, { type: 'hit' }>): void {
    const fb = this.cfg.feedback;
    const fx = this.fx[e.player];
    const pad = this.sim.state.paddles[e.player].pos;
    fx.reach = { x: e.pos.x - pad.x, y: e.pos.y - fx.height, z: e.pos.z - pad.z };
    const own = e.player === this.me;
    const pan = this.pan(pad.x);
    const volume = own ? 1 : 0.6;
    const reduce = this.cfg.presentation.reduceShakeAndFlash;

    // Tipo de golpe: sonido propio (también el del rival: se oye qué viene) y etiqueta solo en los golpes propios
    // (el del rival hay que leerlo en la bola: criterio de V0.2). V0.2b: la etiqueta dice qué salió y con qué fuerza
    // y, si salió distinto de lo pedido, por qué.
    const type = e.serve ? 'NORMAL' : e.targets.type;
    if (type !== 'NORMAL') this.audio.play(`hit_${type.toLowerCase()}` as 'hit_topspin', { volume: volume * 0.8, pan });
    let sub: string | undefined;
    if (own && !e.serve) {
      const click = this.humanClick;
      const miss = type === 'NORMAL' && click ? (click.pressedAfter ? { key: click.pressedAfter.key, after: true } : click.releasedBefore ? { key: click.releasedBefore.key, after: false } : null) : null;
      sub = strokeText(type, describeStroke(e.targets, e.aimFactor, this.cfg), miss ? keyMissText(miss) : null);
      this.lastStrokeText = sub ?? null;
    }

    // Ráfaga de chispas del golpe (V0.2b): más cuanto mejor; la del débil, gris. La ve también el rival.
    const sp = this.cfg.presentation.sparks;
    if (!reduce) {
      const tier = e.tier === 'PERFECT' ? 'PERFECT' : e.tier === 'GOOD' ? 'GOOD' : 'WEAK';
      this.world.burst(e.player, tier === 'WEAK' ? sp.weakColor : this.shotColor(type), sp.burst[tier]);
    }

    let node: HTMLElement;
    if (e.tier === 'PERFECT') {
      const level = Math.min(e.streak, 4);
      this.audio.play('hit_perfect', { volume, pan });
      this.audio.play(`streak_${level}` as 'streak_1', { volume: own ? 0.9 : 0.5, pan });
      node = this.message(e.player, fb.streakTexts[level - 1], `perfect-${level}` as FeedbackKind, sub);
      if (!reduce) {
        fx.flash = 1;
        if (own) this.shake = { amp: this.cfg.presentation.shakeOnPerfect * (0.7 + 0.1 * level), until: performance.now() + this.cfg.presentation.shakeMs };
      }
    } else if (e.tier === 'GOOD') {
      this.audio.play('hit_good', { volume, pan });
      node = this.message(e.player, fb.goodText, 'good', sub);
    } else {
      this.audio.play('hit_normal', { volume, pan });
      const labels: string[] = [];
      if (e.evaluation.causes.includes('EARLY')) labels.push(fb.earlyText);
      if (e.evaluation.causes.includes('LATE')) labels.push(fb.lateText);
      if (e.evaluation.causes.includes('EDGE')) labels.push(fb.edgeText);
      node = this.message(e.player, labels.join(' + ') || fb.goodText, 'label', sub);
    }
    if (own) this.ownHit = e.serve ? null : { node, click: this.humanClick, type };

    if (e.serve || this.sim.state.rally.hits <= 2) this.hud.setHint('');
    if (own) {
      this.lastHumanHit = { targets: e.targets, evaluation: e.evaluation, contactHeight: e.pos.y - this.cfg.world.tableHeight };
      this.lastHumanShot = e.targets;
      this.bounceMarker = null;
    } else {
      this.lastBotShot = e.serve ? null : e.targets.type;
    }
    this.refreshPrediction();
    if (!own && this.markerShown()) this.placeBounceMarker(e.serve);
  }

  /** Marcador de bote (§2.2): en local y contra el bot remoto; en una sala, solo en el warm-up (no en su cuenta atrás). */
  private markerShown(): boolean {
    return this.cfg.presentation.bounceMarker && !this.roomFlow.muted && bounceMarkerShown(this.roomFlow.active, this.online?.practice ?? false);
  }

  private placeBounceMarker(serve: boolean): void {
    const contacts: BallContact[] = [];
    predictPath(this.sim.state.ball, this.sim.env, this.sim.dt, this.sim.tickMs, this.sim.now, 2000, contacts);
    const tables = contacts.filter((c) => c.kind === 'table');
    const target = serve ? tables[1] : tables[0];
    if (target && target.kind === 'table' && target.side === this.me) this.bounceMarker = { x: target.pos.x, z: target.pos.z, alpha: 1, landed: false };
  }

  private onGameOver(winner: Side, score: [number, number]): void {
    const st = this.sim.state.stats[this.me];
    this.setPlay('off');
    this.hud.showGameOver(
      {
        won: winner === this.me,
        score,
        perfectPct: st.hits ? (100 * st.perfect) / st.hits : 0,
        maxStreak: st.maxStreak,
        netErrors: st.netErrors,
        outErrors: st.outErrors,
        hits: st.hits,
        shots: (['TOPSPIN', 'SLICE', 'SMASH', 'BLOCK'] as ShotType[]).map((t) => `${SHOT_LABEL[t]} ${st.types[t]}`).join(' · '),
      },
      this.difficulty,
      this.labels(),
      (d) => this.start(d),
      () => this.showMenu(),
    );
  }

  private message(player: Side, text: string, kind: FeedbackKind, sub?: string): HTMLElement {
    const pad = this.sim.state.paddles[player].pos;
    const own = player === this.me;
    // Junto a la raqueta, a su lado exterior: nunca en el centro de la pantalla [§5.2]. Las dos a la derecha de su
    // raqueta en la pantalla, también desde el lado 1.
    const p = this.world.project(pad.x + (own ? 0.24 : -0.2) * sideSign(player), this.fx[player].height + 0.16, pad.z);
    const scale = own ? 1 : this.cfg.feedback.opponentScale;
    const dur = kind.startsWith('perfect-4') ? this.cfg.feedback.messageMs * 1.4 : this.cfg.feedback.messageMs;
    // Con la etiqueta del golpe el mensaje dura algo más para poder leerla (más si explica algo).
    const factor = !sub ? 1 : sub.includes(' · ') ? 2 : 1.5;
    return this.hud.feedback(text, kind, p.x, p.y, scale, dur * factor, sub);
  }

  /** Color de las chispas de un golpe: el del trail de su efecto; el golpe normal, dorado. */
  private shotColor(type: ShotType): string {
    const p = this.cfg.presentation;
    switch (type) {
      case 'TOPSPIN':
        return p.trailColors.top;
      case 'SLICE':
        return p.trailColors.side;
      case 'SMASH':
        return p.trailColors.none;
      case 'BLOCK':
        return p.trailColors.back;
      default:
        return p.sparks.normalColor;
    }
  }

  /** Golpe que saldría ahora con las teclas mantenidas (Space = bloqueo), o null si ninguna. */
  private heldShot(): ShotType | null {
    if (this.input.blocking) return 'BLOCK';
    const t = shotFromKeys(this.input.heldNow);
    return t === 'NORMAL' ? null : t;
  }

  /** Panorámica de un sonido en `x` (mundo): según TU pantalla (desde el lado 1, la x del mundo va al revés). */
  private pan(x: number): number {
    return Math.max(-0.8, Math.min(0.8, x * sideSign(this.me)));
  }

  private refreshPrediction(): void {
    this.predicted = predictPath(this.sim.state.ball, this.sim.env, this.sim.dt, this.sim.tickMs, this.sim.now, 1500);
  }

  // ——— Render ———

  private renderCalibration(now: number, dt: number): void {
    const c = this.calibration;
    if (!c) return;
    // Mismo retraso de dibujo que la partida: el render interpolado va un tick por detrás del tiempo real. Se ve desde el
    // lado 0 (syncSide): la bola llega a la raqueta 0 y la 1 se queda donde esté.
    const ball = c.ballAt(now - this.sim.tickMs);
    const fx = this.fx[0];
    fx.flash *= Math.exp(-dt / 0.12);
    fx.height = c.sweet.y;
    const bot = this.sim.state.paddles[1].pos;
    const still = { x: 0, y: 0, z: 0 };
    this.world.render({
      ball: ball ? { ...ball, visible: true } : { x: 0, y: -1, z: 0, visible: false },
      paddles: [
        { x: c.sweet.x, y: c.sweet.y, z: c.sweet.z, swing: null, reach: still, flash: fx.flash },
        { x: bot.x, y: this.fx[1].height, z: bot.z, swing: null, reach: still, flash: 0 },
      ],
      target: null,
      bounceMarker: null,
      shake: { x: 0, y: 0 },
    });
  }

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
    const s = this.sim.state;
    const now = this.sim.now + alpha * this.sim.tickMs;
    const frame = this.rf;
    const k = 1 - Math.exp(-dt * 14);
    const decay = Math.exp(-dt / 0.12);
    for (let i = 0; i < 2; i++) {
      const side = i as Side;
      const fx = this.fx[side];
      const p = frame.paddles[side];
      p.x = lerp(this.prev.paddles[side].x, this.curr.paddles[side].x, alpha);
      p.z = lerp(this.prev.paddles[side].z, this.curr.paddles[side].z, alpha);
      fx.height += (this.targetHeight(side, p.z) - fx.height) * k;
      fx.reach.x *= decay;
      fx.reach.y *= decay;
      fx.reach.z *= decay;
      fx.flash *= decay;
      const sw = (now - fx.swingStart) / this.cfg.hit.swingMs;
      p.y = fx.height;
      p.swing = sw >= 0 && sw <= 1 ? sw : null;
      p.reach = fx.reach;
      p.flash = fx.flash;
    }

    // Marcador del cursor: el objetivo va en coordenadas del jugador local; se dibuja en las del mundo.
    frame.target = null;
    if (this.running && !this.paused) {
      const t = this.input.currentTarget;
      const pc = this.cfg.paddle;
      const sg = sideSign(this.me);
      this.cursorOut.x = Math.max(-pc.maxLateral, Math.min(pc.maxLateral, t.x)) * sg;
      this.cursorOut.z = Math.max(pc.minDepth, Math.min(pc.maxDepth, t.z)) * sg;
      frame.target = this.cursorOut;
    }

    if (this.bounceMarker && !this.markerShown()) this.bounceMarker = null;
    if (this.bounceMarker?.landed) {
      this.bounceMarker.alpha -= dt / 0.35;
      if (this.bounceMarker.alpha <= 0) this.bounceMarker = null;
    }
    frame.bounceMarker = this.bounceMarker;

    frame.shake.x = 0;
    frame.shake.y = 0;
    const pnow = performance.now();
    if (pnow < this.shake.until) {
      const a = this.shake.amp * ((this.shake.until - pnow) / this.cfg.presentation.shakeMs);
      frame.shake.x = Math.sin(pnow * 0.09) * a;
      frame.shake.y = Math.cos(pnow * 0.11) * a;
    }

    const inPlay = s.phase === 'rally' || s.phase === 'serveToss' || s.phase === 'pointOver';
    // Tecla de golpe mantenida (V0.2b): se ilumina en la barra y el contorno de TU raqueta toma el color del golpe.
    // Solo el jugador local la ve: en multijugador el rival no debe recibir esta señal antes del golpe (§13).
    const held = this.running && !this.paused ? this.heldShot() : null;
    this.hud.setKeyBarActive(held);
    const b = frame.ball;
    b.x = lerp(this.prev.ball.x, this.curr.ball.x, alpha);
    b.y = lerp(this.prev.ball.y, this.curr.ball.y, alpha);
    b.z = lerp(this.prev.ball.z, this.curr.ball.z, alpha);
    b.visible = s.phase !== 'gameOver' && !this.roomFlow.muted && !(s.phase === 'pointOver' && this.sim.now - s.phaseStartMs > this.cfg.rules.pointDelayMs * 0.75);
    b.spin = s.ball.spin;
    b.trail = inPlay ? this.trailStyle() : null;
    frame.dt = dt;
    if (held) this.outlineOut.color = this.shotColor(held);
    frame.heldOutline = held ? this.outlineOut : null;
    this.world.render(frame);
    const o = this.online;
    if (o) {
      // Por lado, como los nombres del marcador; ocultos hasta que hay partida.
      const st = o.stats;
      const rival = o.side === 0 ? 1 : 0;
      this.pingVals[o.side] = st.myPing;
      this.pingVals[rival] = st.rivalPing;
      this.pingLvls[o.side] = pingLevel(st.myPing, this.cfg);
      this.pingLvls[rival] = pingLevel(st.rivalPing, this.cfg);
      this.hud.setPings(o.ready ? this.pingVals : null, this.pingLvls);
    }
    // Salto de la bola: mayor desplazamiento entre dos frames mientras está en juego.
    const bs = this.ballStep;
    if (s.phase === 'rally' || s.phase === 'serveToss') {
      if (bs.ok) bs.max = Math.max(bs.max, Math.hypot(frame.ball.x - bs.prev.x, frame.ball.y - bs.prev.y, frame.ball.z - bs.prev.z));
      bs.prev.x = frame.ball.x;
      bs.prev.y = frame.ball.y;
      bs.prev.z = frame.ball.z;
      bs.ok = true;
    } else bs.ok = false;
    if (this.hud.debugVisible) this.updateDebug();
  }

  /** Trail de la bola: color por tipo de efecto (spin relativo a su vuelo) e intensidad [§2.2] (objeto reutilizado). */
  private trailStyle(): { color: string; alpha: number } {
    const b = this.sim.state.ball;
    const p = this.cfg.presentation;
    const out = this.trailOut;
    const rel = relativeSpin(b.spin, b.vel, this.relOut);
    const kind = spinKind(rel, p.trailMinSpin);
    if (kind === 'none') {
      // Sin efecto: solo se marca una bola muy rápida (el smash), en blanco.
      const real = Math.hypot(b.vel.x, b.vel.z) * this.cfg.sim.gameSpeed;
      out.color = p.trailColors.none;
      out.alpha = Math.max(0, Math.min(0.55, (real - 6.5) / 6));
      return out;
    }
    const mag = Math.max(Math.abs(rel.top), Math.abs(rel.side));
    out.color = p.trailColors[kind];
    out.alpha = Math.max(0.35, Math.min(0.9, 0.25 + mag / 450));
    return out;
  }

  private updateDebug(): void {
    const e = this.lastHumanEval;
    const aim = this.lastHumanAim;
    const fmt = (n: number) => (n > 0 ? `+${n.toFixed(0)}` : n.toFixed(0));
    const sw = this.lastSwing;
    const aimText =
      aim === null ? '—' : sw?.shot === 'BLOCK' ? 'recta (bloqueo)' : aim >= 0.99 ? 'activa (colocado)' : aim <= 0.01 ? 'recta (persiguiendo)' : `${Math.round(aim * 100)} %`;
    const shot = this.lastHumanShot;
    const shotText = sw
      ? `${SHOT_LABEL[sw.shot]}${sw.power > 0 ? ` · potencia ${Math.round(sw.power * 100)} % (${powerLevelText(powerLevel(sw.power, this.cfg))})` : ''}`
      : '—';
    const spinText = shot ? `top ${Math.round(shot.spinRel.top)} · lateral ${Math.round(shot.spinRel.side)} rad/s` : '—';
    const keysText = sw ? (Object.keys(sw.keys) as (keyof ShotKeys)[]).filter((k) => sw.keys[k]).map((k) => SHOT_KEY_LABEL[k]).join(' + ') || 'ninguna' : '—';
    const gestureText = sw ? `vx ${sw.raw.vx.toFixed(1)} alt/s` : '—';
    this.hud.setDebug([
      ['Último golpe', e ? (e.tier === 'WHIFF' ? 'fallo (fuera de ventana)' : e.tier) : '—'],
      ['Timing', e ? `${fmt(e.dtMs)} ms (${e.timingTier})` : '—'],
      ['Posición', e ? `${Math.round(e.posFrac * 100)} % (${e.positionTier})` : '—'],
      ['Puntería', aimText],
      ['Tipo', shotText],
      ['Teclas en el click', keysText],
      ['Gesto lateral (cruce)', gestureText],
      ['Spin de salida', spinText],
      ['Bloqueo (Espacio)', this.input.blocking ? 'mantenido' : '—'],
      ['Rival: último golpe', this.lastBotShot ? SHOT_LABEL[this.lastBotShot] : '—'],
      ['Calibración', this.latencyOffset === null ? 'sin calibrar' : `${this.latencyOffset > 0 ? '+' : ''}${this.latencyOffset} ms`],
      ...this.precision.rows(),
      ['gameSpeed', String(this.cfg.sim.gameSpeed)],
      ...this.netRows(),
      ['FPS', this.fps.toFixed(0)],
    ]);
  }

  /** Filas del panel D en red: ping de los dos, frenado de la bola que se aleja y correcciones del servidor. */
  private netRows(): [string, string][] {
    const o = this.online;
    if (!o) return [];
    const st = o.stats;
    const ms = (v: number | null) => (v === null ? '…' : `${Math.round(v)} ms`);
    return [
      ['Ping (tú / rival)', `${ms(st.myPing)} / ${ms(st.rivalPing)}`],
      ['Frenado bola que se aleja', st.brakes.flights ? `media ${Math.round(st.brakes.meanSlowdown * 100)} % · máx ${Math.round(st.brakes.maxSlowdown * 100)} %` : '—'],
      ['Correcciones del servidor', String(st.corrections)],
    ];
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
      spin: { ...s.ball.spin },
      lastSwing: this.lastSwing,
      lastBotShot: this.lastBotShot,
      lastStrokeText: this.lastStrokeText,
      keyBar: { visible: this.hud.keyBarVisible, active: this.hud.keyBarActive, saved: this.keyBarOn },
      sparks: { outline: this.world.heldOutlineVisible, alive: this.world.sparkCount },
      explain: this.explain,
      paddles: s.paddles.map((p) => ({ ...p.pos })),
      rally: { ...s.rally, bounces: [...s.rally.bounces] },
      stats: s.stats.map((x) => ({ ...x })),
      difficulty: this.difficulty,
      fps: this.fps,
      maxBallStep: this.ballStep.max,
      /** Lado del jugador local y lado desde el que se ve la mesa (el 0 calibrando). */
      side: this.me,
      viewSide: this.world.viewSide,
      room: this.roomFlow.debug(),
      net: this.online
        ? {
            side: this.online.side,
            status: this.online.status,
            detail: this.online.detail,
            pings: [this.online.stats.myPing, this.online.stats.rivalPing],
            corrections: this.online.stats.corrections,
            correctionKinds: [...this.online.stats.correctionKinds],
            brakes: { ...this.online.stats.brakes },
            maxRenderJump: this.online.stats.maxRenderJump,
            bytesIn: this.online.bytesIn,
            bytesOut: this.online.bytesOut,
            seconds: this.online.startedAt ? (performance.now() - this.online.startedAt) / 1000 : 0,
          }
        : null,
    };
  }

  /** Reinicia las medidas de red y de saltos (pruebas automáticas). */
  resetMetrics(): void {
    this.ballStep.max = 0;
  }
}
