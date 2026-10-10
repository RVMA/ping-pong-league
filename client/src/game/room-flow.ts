/**
 * Flujo de sala en el cliente (V0.4) [§14, §15 «Sala»]: el puente entre la sesión en red (OnlineSession), la interfaz
 * (Lobby, RoomUi y el marcador del Hud) y el juego (Game, a través de RoomHost).
 *  - Arranque por URL: `?create=` o `?room=` con un nombre (por URL o guardado) entran directamente; sin nombre, se pide.
 *  - Decide qué pantalla o aviso se ve según la conexión y la fase de la sala, y cómo está el juego: 'play' (se juega),
 *    'hold' (fases sin juego: la raqueta se mueve, no hay golpes y la vista no saca) u 'off' (pantalla encima).
 *  - Listo con Shift: mantener room.readyHoldMs con un anillo que se llena; soltar antes lo cancela; otra pulsación larga
 *    lo quita (también en la cuenta atrás, que así se cancela). O el botón.
 *  - Cuenta atrás 3-2-1-GO con sus sonidos (`countdown`, `go`) y «Reanudando» si es tras una pausa; en la del inicio el
 *    rally del warm-up, ya cortado por el servidor, no se ve ni se oye.
 *  - Estadísticas del partido encima del warm-up hasta «Seguir», después de ver el último punto.
 * La interfaz solo se toca cuando cambia algo: render() corre con cada mensaje de sala o cambio de conexión; update() corre
 * en cada frame, sin crear objetos, y solo escribe cuando cambia un segundo de un reloj, una cifra o un paso del anillo.
 */
import type { BotDifficulty, GameConfig, MatchEndMsg, RoomPhase, Side } from '@ppp/shared';
import type { AudioManager } from '../audio/audio.ts';
import type { InputClock } from '../input/mouse.ts';
import { OnlineSession, type RoomView, type SessionRoute, setRoomInUrl } from '../net/online-session.ts';
import type { Hud } from '../ui/hud.ts';
import { Lobby } from '../ui/lobby.ts';
import { type EndInfo, type ReadyChip, RoomUi } from '../ui/room-ui.ts';
import { betweenText, clockText, countdownStep, modeText, nameOf, otherSide, pauseText, ReadyHold, readyWarnText, secondsLeft } from './room-logic.ts';
import { loadName, saveName, type Settings } from './settings.ts';

/** Cómo está el juego: se juega, se mueve la raqueta sin golpear, o hay una pantalla encima. */
export type PlayMode = 'off' | 'hold' | 'play';

/** Lo que enseña el lobby del estado del juego. */
export interface LobbyInfo {
  offsetMs: number | null;
  explain: boolean;
  labels: Record<BotDifficulty, string>;
  difficulty: BotDifficulty;
  setExplain(on: boolean): void;
}

/** Lo que el flujo de sala necesita del juego (lo implementa Game). */
export interface RoomHost {
  readonly cfg: GameConfig;
  readonly hud: Hud;
  readonly audio: AudioManager;
  readonly clock: InputClock;
  readonly calibrating: boolean;
  lobbyInfo(): LobbyInfo;
  /** La sesión en red de la sala pasa a ser la del juego (null: vuelve la local). */
  useNet(session: OnlineSession | null): void;
  setPlay(mode: PlayMode): void;
  /** Partida local contra el bot. */
  start(difficulty: BotDifficulty): void;
  startCalibration(): void;
  cancelCalibration(): void;
}

type Stage = 'off' | 'lobby' | 'name' | 'room';

/** GO se queda en pantalla este tiempo tras empezar el game. */
const GO_MS = 700;
/** Si la vista no enseña el fin del game (p. ej. al volver tras un corte), el texto de entre games sale igual a los… */
const BETWEEN_FALLBACK_MS = 2500;
/** …y las estadísticas del partido, a los… */
const END_FALLBACK_MS = 4000;

interface PendingEnd {
  msg: MatchEndMsg;
  names: [string, string];
  side: Side;
  at: number;
  /** Ya se puede enseñar (la vista enseñó el último punto, abandono o venció la espera). */
  ready: boolean;
}

export class RoomFlow {
  private readonly host: RoomHost;
  private readonly cfg: GameConfig;
  private readonly settings: Settings;
  private readonly ui: RoomUi;
  private readonly lobby: Lobby;
  /** Shift mantenido para el Listo. */
  private readonly shift: ReadyHold;
  private session: OnlineSession | null = null;
  private stage: Stage = 'off';
  private route: SessionRoute | null = null;
  private name: string;
  private view: RoomView | null = null;
  /** La cuenta atrás en curso es la de reanudar (tras una pausa o al volver), no la del inicio del partido. */
  private resume = false;
  /** Aviso del lobby o de la sala («Código de sala no válido», «Beto ha salido de la sala»). */
  private notice = '';
  private playMode: PlayMode | null = null;
  // Cuenta atrás.
  private digit = -1;
  private goUntil = 0;
  // Entre games.
  private betweenAt = 0;
  private gameShown = false;
  // Fin del partido.
  private endSeen: MatchEndMsg | null = null;
  private end: PendingEnd | null = null;
  private endUp = false;
  // Reloj de texto activo (uno a la vez): plazo y texto a rehacer cuando cambia el segundo.
  private tickDeadline = -1;
  private tickSecond = -1;
  private tickText: ((seconds: number) => void) | null = null;

  constructor(host: RoomHost, settings: Settings) {
    this.host = host;
    this.cfg = host.cfg;
    this.settings = settings;
    this.name = settings.name ?? loadName();
    this.shift = new ReadyHold(this.cfg.room.readyHoldMs);
    this.lobby = new Lobby(this.cfg, {
      onCreate: (mode, name) => this.enter({ kind: 'create', mode }, name, true),
      onJoin: (code, name) => this.enter({ kind: 'join', code }, name, true),
      onCalibrate: () => this.host.startCalibration(),
      onLocal: (d) => this.playLocal(d),
      onExplain: (on) => this.host.lobbyInfo().setExplain(on),
      onName: (name) => {
        this.name = name;
        saveName(name);
      },
    });
    this.ui = new RoomUi(host.hud.root, host.hud, {
      onReady: () => {
        void this.host.audio.unlock();
        this.toggleReady();
      },
      onReadTest: () => {},
      onLeave: () => this.leave(),
      onCalibrate: () => this.host.startCalibration(),
      onContinue: () => {
        this.end = null;
        this.render();
      },
      onLobby: () => this.toLobby(''),
    });
    // Sin foco en la ventana no llega el keyup de Shift: la pulsación se cancela.
    window.addEventListener('blur', () => this.shift.up());
  }

  /** En una sala (conectando, dentro o con su error en pantalla). */
  get active(): boolean {
    return this.stage === 'room';
  }

  /** Cuenta atrás del inicio: el rally del warm-up ya está cortado; ni se dibuja la bola ni suenan sus eventos. */
  get muted(): boolean {
    return this.stage === 'room' && this.view?.phase === 'countdown' && !this.resume;
  }

  /** Primera pantalla según la URL: entrar en una sala (pidiendo el nombre si falta) o el lobby. */
  boot(): void {
    const s = this.settings;
    const route: SessionRoute | null = s.create ? { kind: 'create', mode: s.create } : s.room ? { kind: 'join', code: s.room } : null;
    if (!route && new URLSearchParams(location.search).has('room')) {
      this.notice = 'Código de sala no válido';
      setRoomInUrl(null);
    }
    if (route && this.name) return this.enter(route, this.name, false);
    this.stage = route ? 'name' : 'lobby';
    this.route = route;
    this.render();
  }

  /** Vuelta a la pantalla de fuera del juego (tras calibrar o al dejar la partida local): el lobby o la sala. */
  home(): void {
    this.host.hud.hideOverlay();
    this.playMode = null;
    if (this.stage === 'off') this.stage = 'lobby';
    this.render();
  }

  /** Teclado (keydown y keyup): Shift mantenido para el Listo. */
  onKey(e: KeyboardEvent): void {
    if (e.key !== 'Shift') return;
    if (e.type === 'keyup') {
      this.shift.up();
      return;
    }
    if (e.repeat || e.target instanceof HTMLInputElement || !this.readyAllowed()) return;
    void this.host.audio.unlock();
    this.shift.down(performance.now());
  }

  /** La vista enseñó el fin de un game (evento `gameOver` de la sesión). */
  onGameOver(): void {
    this.gameShown = true;
    if (this.end) this.end.ready = true;
    this.render();
  }

  /** Cada frame: relojes, cifras de la cuenta atrás y anillo. Sin crear objetos; escribe solo si algo cambia. */
  update(now: number): void {
    if (this.stage !== 'room') return;
    const allowed = this.readyAllowed();
    if (this.shift.poll(now) && allowed) this.toggleReady();
    this.ui.setRing(allowed ? this.shift.progress(now) : 0);
    const v = this.view;
    if (v && v.phase === 'countdown' && !this.blocked()) {
      const d = countdownStep(v.deadlineAt, now);
      if (d !== this.digit) this.showDigit(d, now);
    } else if (this.goUntil && now >= this.goUntil) {
      this.goUntil = 0;
      this.render();
    }
    // Una sola vez: tras él, gameShown (aunque un corte o un error tapen el texto de entre games).
    if (v && v.phase === 'between' && !this.gameShown && now - this.betweenAt >= BETWEEN_FALLBACK_MS) {
      this.gameShown = true;
      this.render();
    }
    if (this.end && !this.end.ready && now - this.end.at >= END_FALLBACK_MS) {
      this.end.ready = true;
      this.render();
    }
    if (this.tickText) {
      const sec = secondsLeft(this.tickDeadline, now);
      if (sec !== this.tickSecond) {
        this.tickSecond = sec;
        this.tickText(sec);
      }
    }
  }

  /** Estado legible para las pruebas automáticas. */
  debug() {
    const v = this.view;
    return {
      stage: this.stage,
      status: this.session?.status ?? 'idle',
      end: this.session?.end?.kind ?? null,
      code: v?.code ?? null,
      side: v?.side ?? null,
      phase: v?.phase ?? null,
      names: v ? v.players.map((p) => p?.nm ?? null) : null,
      ready: v ? v.players.map((p) => (p ? p.r === 1 : null)) : null,
      gamesWon: v ? [...v.gamesWon] : null,
      deadlineKind: v?.deadlineKind ?? null,
      resume: this.resume,
      digit: this.digit,
      matchEnd: this.endUp,
      notice: this.notice,
      playMode: this.playMode,
    };
  }

  // ——— Entrar y salir ———

  private net(): OnlineSession {
    if (this.session) return this.session;
    const s = new OnlineSession(this.cfg, { ...this.settings.latency, seed: this.settings.seed }, this.host.clock);
    s.onStatus = () => this.render();
    s.onRoom = (v) => this.onRoom(v);
    this.session = s;
    return s;
  }

  /** Entra en la sala; `gesture`: lo pidió un click o una tecla (solo entonces puede arrancar el audio). */
  private enter(route: SessionRoute, name: string, gesture: boolean): void {
    if (gesture) void this.host.audio.unlock();
    this.name = name;
    this.route = route;
    this.stage = 'room';
    this.view = null;
    this.notice = '';
    this.end = null;
    this.endSeen = null;
    this.digit = -1;
    this.goUntil = 0;
    this.playMode = null;
    const s = this.net();
    this.host.useNet(s);
    s.connect(route, name);
  }

  private leave(): void {
    this.session?.leave();
    this.toLobby('');
  }

  private toLobby(notice: string): void {
    this.session?.dispose();
    setRoomInUrl(null);
    this.host.useNet(null);
    this.shift.up();
    this.stage = 'lobby';
    this.view = null;
    this.end = null;
    this.notice = notice;
    this.playMode = null;
    this.tickText = null;
    const hud = this.host.hud;
    const info = this.host.lobbyInfo();
    hud.setNames(['Tú', 'Bot'], ['', info.labels[info.difficulty]]);
    hud.setScoreVisible(true);
    hud.setGames('');
    hud.setPings(null, ['unknown', 'unknown']);
    this.render();
  }

  private playLocal(d: BotDifficulty): void {
    this.stage = 'off';
    this.notice = '';
    this.ui.hideAll();
    this.playMode = null;
    this.host.start(d);
  }

  // ——— Mensajes de la sala ———

  private onRoom(v: RoomView): void {
    const prev = this.view;
    this.view = v;
    const now = performance.now();
    if (v.lastEnd && v.lastEnd !== this.endSeen) {
      this.endSeen = v.lastEnd;
      const names: [string, string] = [nameOf(v, 0), nameOf(v, 1)];
      this.end = { msg: v.lastEnd, names, side: v.side, at: now, ready: v.lastEnd.why === 'abandon' };
    }
    const rival = otherSide(v.side);
    const gone = prev?.players[rival];
    if (gone && !v.players[rival]) this.notice = `${gone.nm} ha salido de la sala`;
    else if (v.players[rival]) this.notice = '';
    if (!prev || prev.phase !== v.phase) this.onPhase(prev?.phase ?? null, v.phase, now);
    // Llegó el rival mientras calibrabas: la calibración se corta (no se calibra en el warm-up, §3.7) y se vuelve aquí.
    if (this.host.calibrating && v.phase !== 'waiting') this.host.cancelCalibration();
    else this.render();
  }

  private onPhase(prev: RoomPhase | null, next: RoomPhase, now: number): void {
    if (next === 'countdown') {
      // Sin fase anterior (al volver a la sala) solo puede ser la de reanudar: la del inicio exige tu Listo.
      this.resume = prev !== 'warmup';
      this.digit = -1;
    } else if (prev === 'countdown') {
      if (next === 'match' && this.digit !== 0) {
        this.host.audio.play('go', { volume: 0.8 });
        this.digit = 0;
      }
      this.goUntil = next === 'match' ? now + GO_MS : 0;
      if (next !== 'match') this.digit = -1;
    }
    if (next === 'between') {
      this.betweenAt = now;
      this.gameShown = false;
    }
  }

  // ——— Listo ———

  /** Se puede cambiar el Listo: en el warm-up y en la cuenta atrás del inicio (para quitarlo), sin pantallas encima. */
  private readyAllowed(): boolean {
    const v = this.view;
    if (this.stage !== 'room' || !v || this.blocked() || this.endUp) return false;
    return v.phase === 'warmup' || (v.phase === 'countdown' && !this.resume);
  }

  private toggleReady(): void {
    const v = this.view;
    const s = this.session;
    if (!v || !s || !this.readyAllowed()) return;
    s.sendReady(v.players[v.side]?.r !== 1);
  }

  // ——— Pantallas ———

  /** Hay algo que tapa la sala: calibrando, conectando, reconectando o un error. */
  private blocked(): boolean {
    const s = this.session;
    return this.host.calibrating || !s || s.end !== null || s.status === 'connecting' || s.status === 'reconnecting' || this.view === null;
  }

  /**
   * Cómo está el juego. La vista solo saca (sola o con click) cuando se juega: en las fases sin juego y con una pantalla
   * encima (sala de espera, estadísticas del partido, errores) se queda quieta (OnlineSession.hold). Se fija en cada
   * render, así que no depende del orden de los mensajes (`room` antes que `start`) ni lo cambia un `start`.
   */
  private play(mode: PlayMode): void {
    this.session?.hold(mode !== 'play');
    if (mode === this.playMode) return;
    this.playMode = mode;
    this.host.setPlay(mode);
  }

  /** Reloj de texto activo: `text(segundos)` se llama ahora y cada vez que cambia el segundo que falta para `deadline`. */
  private ticker(deadline: number, text: ((seconds: number) => void) | null): void {
    this.tickText = text;
    this.tickDeadline = deadline;
    this.tickSecond = text ? secondsLeft(deadline, performance.now()) : -1;
    text?.(this.tickSecond);
  }

  private render(): void {
    const ui = this.ui;
    const hud = this.host.hud;
    if (this.stage === 'off') return;
    if (this.host.calibrating) {
      ui.hideAll();
      this.ticker(-1, null);
      return;
    }
    if (this.stage === 'lobby' || this.stage === 'name') {
      ui.hideAll();
      this.ticker(-1, null);
      this.play('off');
      if (this.stage === 'lobby') {
        hud.showPanel(this.lobby.show({ ...this.host.lobbyInfo(), name: this.name, notice: this.notice }));
        return;
      }
      const r = this.route;
      const title = r?.kind === 'join' ? `Entrar en la sala ${r.code}` : `Crear una sala ${r?.kind === 'create' ? modeText(r.mode, this.cfg).split(' · ')[0] : ''}`;
      const wasShown = hud.isShowing(this.lobby.prompt);
      hud.showPanel(
        this.lobby.showPrompt(
          title,
          this.name,
          '',
          (name) => {
            this.name = name;
            saveName(name);
            if (r) this.enter(r, name, true);
          },
          () => this.toLobby(''),
        ),
      );
      if (!wasShown) this.lobby.focusPrompt();
      return;
    }
    this.renderRoom();
  }

  private renderRoom(): void {
    const ui = this.ui;
    const s = this.session;
    const v = this.view;
    if (!s) return;
    this.scoreboard(v);
    this.endUp = false;
    if (s.end && s.end.kind !== 'left') {
      ui.setStrip(false);
      ui.setCenter('', '', 'info');
      this.ticker(-1, null);
      const [title, text] = this.failure(s);
      ui.showMessage(title, text, 'lobby');
      this.play('off');
      return;
    }
    if (s.status === 'reconnecting') {
      ui.hidePanel();
      ui.setStrip(false);
      // Las dos líneas juntas: cada reintento vuelve a pintar, y así no borra la línea del reloj para reescribirla.
      this.ticker(s.cutAt + this.cfg.room.reconnectMs, (sec) => ui.setCenter('Conexión perdida', `Reconectando… ${clockText(sec)}`, 'info'));
      this.play('off');
      return;
    }
    if (s.status === 'connecting' || !v) {
      ui.setStrip(false);
      ui.setCenter('', '', 'info');
      this.ticker(-1, null);
      const r = this.route;
      ui.showMessage('Conectando…', r?.kind === 'join' ? `Entrando en la sala ${r.code}.` : 'Creando la sala.', 'cancel');
      this.play('off');
      return;
    }
    const end = this.end;
    if (end?.ready) {
      ui.setStrip(false);
      ui.setCenter('', '', 'info');
      this.ticker(-1, null);
      ui.showEnd(end, () => this.endInfo(end));
      this.endUp = true;
      this.play('off');
      return;
    }
    this.renderPhase(s, v);
  }

  private renderPhase(s: OnlineSession, v: RoomView): void {
    const ui = this.ui;
    const me = v.side;
    const rival = otherSide(me);
    const away = v.players[rival] && v.players[rival].c === 0 ? rival : null;
    const awayName = away === null ? '' : nameOf(v, away);
    switch (v.phase) {
      case 'waiting':
        ui.setStrip(false);
        ui.setCenter('', '', 'info');
        this.ticker(-1, null);
        ui.showWaiting(v.code, modeText(v.mode, this.cfg), `${location.origin}${location.pathname}?room=${v.code}`, this.notice);
        this.play('off');
        return;
      case 'warmup':
      case 'countdown': {
        ui.hidePanel();
        const counting = v.phase === 'countdown';
        // La franja con los Listos: en el warm-up y en la cuenta atrás del inicio (para poder quitarlo).
        ui.setStrip(!counting || !this.resume, counting ? 'Cuenta atrás · mantén Shift para quitar el Listo' : 'Calentamiento · mantén Shift para Listo');
        ui.setChips(this.chip(v, 0), this.chip(v, 1));
        if (counting) {
          ui.setWarn('');
          this.ticker(-1, null);
          const now = performance.now();
          this.showDigit(countdownStep(v.deadlineAt, now), now);
          this.play('hold');
          return;
        }
        if (v.deadlineKind === 'ready') {
          const lateSide: Side = v.players[0]?.r === 1 ? 1 : 0;
          const lateName = nameOf(v, lateSide);
          ui.setCenter('', '', 'info');
          this.ticker(v.deadlineAt, (sec) => ui.setWarn(readyWarnText(lateSide === me, lateName, sec)));
        } else if (away !== null) {
          ui.setWarn('');
          this.ticker(v.deadlineAt, (sec) => ui.setCenter(pauseText(awayName, sec), '', 'info'));
        } else {
          ui.setWarn('');
          ui.setCenter('', '', 'info');
          this.ticker(-1, null);
        }
        this.play(away === null && s.ready ? 'play' : 'hold');
        return;
      }
      case 'match':
        ui.hidePanel();
        ui.setStrip(false);
        this.ticker(-1, null);
        if (this.goUntil) ui.setCenter('GO', '', 'count');
        else ui.setCenter(s.ready ? '' : 'Volviendo a la partida…', '', 'info');
        this.play(s.ready ? 'play' : 'hold');
        return;
      case 'between': {
        ui.hidePanel();
        ui.setStrip(false);
        this.play('hold');
        if (!this.gameShown) {
          ui.setCenter('', '', 'info');
          this.ticker(-1, null);
          return;
        }
        const done = v.gamesWon[0] + v.gamesWon[1];
        const lg = s.lastGame && s.lastGame.game === done ? s.lastGame : null;
        const w: Side | null = lg ? lg.winner : null;
        const games: [number, number] = w === null ? [v.gamesWon[0], v.gamesWon[1]] : [v.gamesWon[w], v.gamesWon[otherSide(w)]];
        const score: [number, number] | null = lg && w !== null ? [lg.score[w], lg.score[otherSide(w)]] : null;
        const text = w === null ? `Game ${done} · Games ${games[0]}-${games[1]}` : betweenText(done, nameOf(v, w), score, games);
        this.ticker(v.deadlineAt, (sec) => ui.setCenter(text, `Game ${done + 1} en ${clockText(sec)}`, 'info'));
        return;
      }
      case 'paused': {
        ui.hidePanel();
        ui.setStrip(false);
        const name = away === null ? 'el rival' : awayName;
        this.ticker(v.deadlineAt, (sec) => ui.setCenter(pauseText(name, sec), '', 'info'));
        this.play('hold');
        return;
      }
    }
  }

  /** Cifra de la cuenta atrás (o GO) en el centro; suena solo cuando cambia. */
  private showDigit(d: number, now: number): void {
    const changed = d !== this.digit;
    this.digit = d;
    if (d > 0) {
      this.ui.setCenter(String(d), this.resume ? 'Reanudando' : '', 'count');
      if (changed) this.host.audio.play('countdown', { volume: 0.7 });
      return;
    }
    this.ui.setCenter('GO', '', 'count');
    if (!changed) return;
    this.host.audio.play('go', { volume: 0.8 });
    this.goUntil = now + GO_MS;
  }

  private chip(v: RoomView, s: Side): ReadyChip {
    const p = v.players[s];
    return { name: p ? p.nm : '…', ready: p?.r === 1, me: s === v.side, away: !!p && p.c === 0 };
  }

  /** Marcador del Hud en la sala: nombres por lado (texto) con «tú» / «rival», tarjetas solo en el partido, game y games. */
  private scoreboard(v: RoomView | null): void {
    const hud = this.host.hud;
    if (!v) return;
    const me = v.side;
    hud.setNames([v.players[0]?.nm ?? '…', v.players[1]?.nm ?? '…'], [me === 0 ? 'tú' : 'rival', me === 1 ? 'tú' : 'rival']);
    const inMatch = v.phase === 'match' || v.phase === 'between' || v.phase === 'paused' || (v.phase === 'countdown' && this.resume);
    hud.setScoreVisible(inMatch);
    const gw = v.gamesWon;
    const games = this.cfg.room.gamesToWin[v.mode] > 1 ? ` · Games ${gw[0]}-${gw[1]}` : '';
    // Entre games lo dice el aviso del centro (desde el ganador): la línea del marcador (por lado) se oculta.
    hud.setGames(!inMatch || v.phase === 'between' ? '' : `Game ${gw[0] + gw[1] + 1}${games}`);
  }

  private endInfo(end: PendingEnd): EndInfo {
    const m = end.msg;
    const w = m.w;
    const l = otherSide(w);
    const title = w === end.side ? 'Has ganado' : `Ha ganado ${end.names[w]}`;
    const abandon = m.why === 'abandon' ? ` · ${end.names[l]} abandonó el partido` : '';
    return { title, sub: `Games ${m.gw[w]}-${m.gw[l]}${abandon}`, names: end.names, st: m.st };
  }

  /** Título y texto del error que cierra la sala. */
  private failure(s: OnlineSession): [string, string] {
    const e = s.end;
    if (e?.kind === 'err') {
      if (e.code === 'room') return [s.detail, 'Comprueba el código o crea una sala nueva.'];
      if (e.code === 'full') return [s.detail, 'Ya hay dos jugadores en esta sala.'];
      if (e.code === 'route') return [s.detail, 'El código son 4 letras (sin I ni O).'];
      return [this.view ? 'No se pudo seguir en la sala' : 'No se pudo entrar en la sala', s.detail];
    }
    if (e?.kind === 'bye') return ['Fuera de la sala', s.detail];
    return ['Conexión perdida', s.detail];
  }
}
