/**
 * Sesión en red por WebSocket al servidor de juego en el mismo origen (/ws; en desarrollo, el proxy de Vite).
 *  - Sala (V0.4): la ruta va en la URL del socket (`?create=<modo>`, `?room=<código>`). El `welcome` da el lado y el
 *    token de reconexión, que se guarda por pestaña (sessionStorage `ppp.room.<CÓDIGO>` = { tk, side }); los `room`
 *    dan la vista de la sala (RoomView) y `mend`, el fin del partido. Si el socket se cierra solo, se reintenta con el
 *    token a los 0.5, 1, 2, 4, 4… s mientras no pasen 30 s desde el corte (Decisión 10); después, «Conexión perdida».
 *    Un `err` o un `bye` no se reintentan.
 *  - Contra el bot remoto (V0.3, `?bot=<dificultad>`, solo el servidor de desarrollo): igual que en V0.3.
 * La partida es la de ClientMatch (shared/src/net): aquí solo se conecta, se envía y se reciben mensajes, estampados con
 * su llegada en el reloj de la partida (el mismo que usa el traductor de entrada para los clicks).
 */
import {
  type BotDifficulty,
  type C2S,
  ClientMatch,
  configHash,
  decodeS2C,
  encode,
  type ErrCode,
  type GameConfig,
  type HelloMsg,
  type InputIntent,
  type MatchEndMsg,
  type MatchMode,
  type NetStats,
  PROTOCOL_VERSION,
  type S2C,
  type Side,
  type SimEvent,
  type Vec3,
} from '@ppp/shared';
import { keepAliveDue, nextRetryAt, paddleQuiet, type RoomView, toRoomView } from '../game/room-logic.ts';
import type { GameSession, SessionView } from '../game/session.ts';
import type { InputClock } from '../input/mouse.ts';

export type { RoomView } from '../game/room-logic.ts';

export type NetStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'lost' | 'error';

export type SessionRoute = { kind: 'create'; mode: MatchMode } | { kind: 'join'; code: string } | { kind: 'bot' };

/** Por qué acabó la conexión: `err` del servidor, `bye`, la red (sin llegar a entrar o sin poder volver) o `leave`. */
export type SessionEnd = { kind: 'err'; code: ErrCode } | { kind: 'bye' } | { kind: 'net' } | { kind: 'left' };

export interface OnlineParams {
  /** Latencia simulada (solo el servidor de desarrollo): ping propio y del bot (ms), variación (fracción) y picos. */
  ping: number;
  botping: number;
  jitter: number;
  spike: number;
  seed: number;
}

const NO_SERVER = 'No se pudo conectar con el servidor de juego. ¿Está arrancado (npm run dev)?';
/** Un reintento sin `welcome` en este tiempo se da por fallido (con la red caída el socket puede tardar en avisar). */
const ATTEMPT_MS = 5000;
/**
 * Si nada sale por el socket en este tiempo (antes del primer `start`, en la sala de espera con la raqueta callada o con
 * la pestaña oculta), un ping lo mantiene vivo: un proxy puede cerrar un socket inactivo. Se mira 4 veces por intervalo:
 * así el silencio no pasa de 1.25 intervalos aunque el temporizador llegue un poco antes o después.
 */
const KEEPALIVE_MS = 20000;
const TOKEN_KEY = 'ppp.room.';
const TOKEN_RE = /^[A-Za-z0-9-]{8,64}$/;
/** Errores tras los que la sala no sirve (no existe, está llena, el código o los parámetros no valen): su token se olvida. */
const FATAL: readonly ErrCode[] = ['room', 'full', 'route', 'version', 'config', 'params'];

/** Bytes de la cabecera de una trama WebSocket (+4 de máscara del cliente al servidor). */
function frameBytes(len: number, masked: boolean): number {
  return len + (len <= 125 ? 2 : len <= 65535 ? 4 : 10) + (masked ? 4 : 0);
}

// ——— Token por pestaña y URL ———

export function loadRoomToken(code: string): { tk: string; side: Side } | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY + code);
    if (!raw) return null;
    const v = JSON.parse(raw) as { tk?: unknown; side?: unknown };
    return typeof v.tk === 'string' && TOKEN_RE.test(v.tk) && (v.side === 0 || v.side === 1) ? { tk: v.tk, side: v.side } : null;
  } catch {
    return null;
  }
}

export function saveRoomToken(code: string, tk: string, side: Side): void {
  try {
    sessionStorage.setItem(TOKEN_KEY + code, JSON.stringify({ tk, side }));
  } catch {
    // Sin almacenamiento: recargar la pestaña no podrá volver a la sala.
  }
}

export function clearRoomToken(code: string): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY + code);
  } catch {
    // Sin almacenamiento: nada que borrar.
  }
}

/**
 * Pone `?room=<código>` en la URL sin recargar (así recargar la pestaña vuelve a la sala), o lo quita con null. Quita
 * `create` y conserva los demás parámetros (name, offset, autoplay, debug…).
 */
export function setRoomInUrl(code: string | null): void {
  try {
    const q = new URLSearchParams(location.search);
    q.delete('create');
    q.delete('room');
    const rest = q.toString();
    const search = code ? `?room=${encodeURIComponent(code)}${rest ? `&${rest}` : ''}` : rest ? `?${rest}` : '';
    if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  } catch {
    // Sin history (p. ej. un documento aislado): la URL se queda como estaba.
  }
}

export class OnlineSession implements GameSession {
  readonly online = true;
  status: NetStatus = 'idle';
  /** Texto del último error (servidor o conexión). */
  detail = '';
  /** Cómo acabó (null mientras sigue o reintenta). */
  end: SessionEnd | null = null;
  bytesIn = 0;
  bytesOut = 0;
  /** performance.now() del `start`: para medir bytes por segundo. */
  startedAt = 0;
  onStatus: (status: NetStatus, detail: string) => void = () => {};
  /** Cada `room` y cada `mend` (vista nueva, nunca la misma mutada). */
  onRoom: (view: RoomView) => void = () => {};
  /** Vista de la sala (null fuera de una sala o antes del primer `room`). */
  room: RoomView | null = null;
  /** Último game acabado según el servidor (al llegar su último `pt`): «Game 1 para Ana · 11-7». */
  lastGame: { game: number; winner: Side; score: [number, number] } | null = null;
  /** Mi lado (el del último `welcome`; antes del primero, el guardado de esta pestaña para esa sala, o 0). */
  side: Side = 0;
  /** performance.now() del corte de la conexión (−1 sin corte). */
  cutAt = -1;
  private match: ClientMatch;
  private ws: WebSocket | null = null;
  private readonly cfg: GameConfig;
  private readonly params: OnlineParams;
  private readonly clock: InputClock;
  private latencyOffset = 0;
  private difficulty: BotDifficulty = 'medium';
  private route: SessionRoute | null = null;
  private name = 'Jugador';
  /** Sala y token (tras el `welcome`; antes, el código y el token guardado al unirse). */
  private code: string | null = null;
  private token: string | null = null;
  /** Ya entró en la sala en esta sesión: solo entonces un corte se reintenta. */
  private welcomed = false;
  private lastEnd: MatchEndMsg | null = null;
  private attempt = 0;
  private retryTimer = 0;
  private attemptTimer = 0;
  private keepTimer = 0;
  private keepI = 0;
  /** La vista no saca (ClientMatch.held): se aplica también a las vistas nuevas (cada `welcome` crea una). */
  private held = false;
  /** La raqueta callada (ClientMatch.setQuiet): la sala espera rival. Como `held`, también en las vistas nuevas. */
  private quiet = false;
  /** performance.now() del último mensaje enviado (keepalive). */
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(cfg: GameConfig, params: OnlineParams, clock: InputClock) {
    this.cfg = cfg;
    this.params = params;
    this.clock = clock;
    // Vista vacía hasta el primer `start` (el menú y la escena la leen antes de conectar).
    this.match = new ClientMatch(cfg, 0, () => {});
  }

  get sim(): SessionView {
    return this.match;
  }

  get ready(): boolean {
    return this.status === 'playing';
  }

  get stats(): NetStats {
    return this.match.stats;
  }

  get finished(): boolean {
    return this.match.finished;
  }

  /** La vista está en práctica (el warm-up de una sala: sin marcador). */
  get practice(): boolean {
    return this.match.practice;
  }

  /** Desfase de latencia calibrado que se declara al servidor (los clicks ya llegan corregidos). */
  setLatencyOffset(ms: number): void {
    this.latencyOffset = ms;
  }

  /** Contra el bot remoto (V0.3): conecta, o pide otro game al mismo bot. */
  begin(difficulty: BotDifficulty): void {
    if (this.status === 'playing' && this.match.finished) {
      // Otra partida contra el mismo bot; con otra dificultad hace falta otro bot (nueva conexión).
      if (difficulty === this.difficulty) {
        this.send({ k: 'again' });
        return;
      }
      this.dispose();
    }
    if (this.status === 'connecting' || this.status === 'waiting' || this.status === 'playing') return;
    this.difficulty = difficulty;
    this.connect({ kind: 'bot' }, 'Jugador');
  }

  /** Crear una sala, unirse a una (con el token guardado de esta pestaña, si lo hay) o jugar contra el bot remoto. */
  connect(route: SessionRoute, name: string): void {
    this.dispose();
    this.route = route;
    this.name = name;
    this.end = null;
    this.room = null;
    this.lastEnd = null;
    this.lastGame = null;
    this.quiet = false;
    this.code = route.kind === 'join' ? route.code : null;
    const saved = route.kind === 'join' ? loadRoomToken(route.code) : null;
    this.token = saved?.tk ?? null;
    // Hasta el `welcome`, el lado guardado de esta pestaña (al recargar, la mesa ya se ve desde su extremo) o el 0.
    this.side = saved?.side ?? 0;
    this.open();
  }

  /** Listo (Shift mantenido o botón). */
  sendReady(on: boolean): void {
    this.send({ k: 'rdy', on: on ? 1 : 0 });
  }

  /** Prueba de lectura (Task 12). */
  sendReadTest(on: boolean): void {
    this.send({ k: 'rt', on: on ? 1 : 0 });
  }

  /** Salir de la sala a propósito: sin reserva del hueco (en el partido es abandono) y sin token. */
  leave(): void {
    const code = this.code;
    if (this.route?.kind !== 'bot') this.send({ k: 'leave' });
    this.dispose();
    this.end = { kind: 'left' };
    if (code) clearRoomToken(code);
    setRoomInUrl(null);
  }

  /** La vista no saca (fase de sala sin juego o pantalla encima) o vuelve a sacar (ClientMatch.hold); lo decide la sala. */
  hold(on: boolean): void {
    this.held = on;
    // En el reloj de la partida de ahora, no en el de la vista: tras un tirón (calibrando) la vista va atrasada y su
    // puesta al día no debe sacar con el tiempo pasado.
    this.match.hold(on, this.ready ? performance.now() - this.clock.epoch : this.match.now);
  }

  private setStatus(s: NetStatus, detail = ''): void {
    this.status = s;
    this.detail = detail;
    this.onStatus(s, detail);
  }

  private open(): void {
    const r = this.route;
    if (!r) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = r.kind === 'create' ? `create=${r.mode}` : r.kind === 'join' ? `room=${encodeURIComponent(r.code)}` : `bot=${encodeURIComponent(this.difficulty)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    } catch (e) {
      this.fail({ kind: 'net' }, `No se pudo conectar: ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    if (this.cutAt < 0) {
      this.match = new ClientMatch(this.cfg, 0, () => {});
      this.match.hold(this.held);
      this.match.setQuiet(this.quiet);
      this.setStatus('connecting');
    } else {
      this.attemptTimer = window.setTimeout(() => this.lose(ws), ATTEMPT_MS);
    }
    ws.onopen = () => {
      if (this.ws === ws) this.sendHello();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      const text = String(ev.data);
      this.bytesIn += frameBytes(text.length, false);
      const msg = decodeS2C(text);
      if (msg) this.onServer(msg, performance.now());
      else console.warn('[red] mensaje del servidor descartado', text.slice(0, 80));
    };
    // Tras un error siempre llega el cierre: lo atiende onclose.
    ws.onclose = () => this.lose(ws);
  }

  private sendHello(): void {
    const p = this.params;
    const bot = this.route?.kind === 'bot';
    // En una sala la latencia simulada es solo la de esta conexión (el servidor publicado exige todo a 0).
    const hello: HelloMsg = { k: 'hello', v: PROTOCOL_VERSION, h: configHash(this.cfg), r: 'player', nm: this.name, p: p.ping, bp: bot ? p.botping : 0, j: p.jitter, sp: p.spike, d: this.difficulty, s: p.seed, o: this.latencyOffset };
    if (this.token && !bot) hello.tk = this.token;
    this.send(hello);
  }

  /** El socket `ws` se cerró (o su intento caducó): según el caso, error, conexión perdida o el siguiente reintento. */
  private lose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    window.clearTimeout(this.attemptTimer);
    try {
      ws.close();
    } catch {
      // ya cerrado
    }
    if (this.end) return;
    if (this.route?.kind === 'bot') {
      if (this.status === 'playing' || this.status === 'waiting') this.setStatus('lost', 'Conexión perdida');
      else if (this.status === 'connecting') this.setStatus('error', NO_SERVER);
      return;
    }
    if (!this.welcomed) {
      this.fail({ kind: 'net' }, NO_SERVER);
      return;
    }
    const now = performance.now();
    if (this.cutAt < 0) {
      this.cutAt = now;
      this.attempt = 0;
    }
    const at = nextRetryAt(this.cutAt, this.attempt, now, this.cfg.room.reconnectMs);
    if (at === null) {
      this.forget();
      this.fail({ kind: 'net' }, 'No se pudo volver a conectar en 30 s.');
      return;
    }
    this.attempt += 1;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.open(), at - now);
    this.setStatus('reconnecting');
  }

  /** Fin sin reintentos: `err`, `bye` o la red. */
  private fail(end: SessionEnd, detail: string): void {
    this.end = end;
    window.clearInterval(this.keepTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus(end.kind === 'err' || (end.kind === 'net' && !this.welcomed) ? 'error' : 'lost', detail);
  }

  /** Olvida el token de la sala (ya no sirve para volver). */
  private forget(): void {
    if (this.code) clearRoomToken(this.code);
  }

  private onServer(msg: S2C, perf: number): void {
    switch (msg.k) {
      case 'welcome':
        window.clearTimeout(this.attemptTimer);
        this.side = msg.side;
        this.match = new ClientMatch(this.cfg, msg.side, (m) => this.send(m));
        this.match.hold(this.held);
        this.match.setQuiet(this.quiet);
        this.cutAt = -1;
        this.attempt = 0;
        if (this.route?.kind !== 'bot') {
          this.welcomed = true;
          this.code = msg.room;
          this.token = msg.tk;
          // Los reintentos vuelven a esta sala (también tras crearla).
          this.route = { kind: 'join', code: msg.room };
          saveRoomToken(msg.room, msg.tk, msg.side);
          setRoomInUrl(msg.room);
          window.clearInterval(this.keepTimer);
          this.keepTimer = window.setInterval(() => this.keepAlive(), KEEPALIVE_MS / 4);
        }
        this.setStatus('waiting');
        return;
      case 'room':
        // Esperando rival (también tras irse el que había) la raqueta no sale: nadie la ve y cada mensaje cuesta.
        this.quiet = paddleQuiet(msg.ph);
        this.match.setQuiet(this.quiet);
        this.room = toRoomView(msg, this.side, perf, this.lastEnd);
        this.onRoom(this.room);
        return;
      case 'mend':
        this.lastEnd = msg;
        if (this.room) {
          this.room = { ...this.room, lastEnd: msg };
          this.onRoom(this.room);
        }
        return;
      case 'start':
        if (this.status !== 'playing') {
          // Primer `start` de esta conexión: empieza el reloj de la partida (el del traductor de entrada) y la vista.
          this.clock.epoch = perf;
          this.startedAt = perf;
          this.bytesIn = 0;
          this.bytesOut = 0;
          this.match.receive(msg, 0);
          this.setStatus('playing');
        } else this.match.receive(msg, perf - this.clock.epoch);
        return;
      case 'err':
        if (FATAL.includes(msg.m)) this.forget();
        this.fail({ kind: 'err', code: msg.m }, msg.d);
        return;
      case 'bye':
        this.forget();
        this.fail({ kind: 'bye' }, this.route?.kind === 'bot' ? 'Conexión perdida: el bot se desconectó' : msg.m);
        return;
      case 'pt':
        if (msg.go !== -1 && !this.match.practice) this.lastGame = { game: this.match.game, winner: msg.go, score: [msg.sc[0], msg.sc[1]] };
        if (this.status === 'playing') this.match.receive(msg, perf - this.clock.epoch);
        return;
      default:
        if (this.status === 'playing') this.match.receive(msg, perf - this.clock.epoch);
    }
  }

  /** Ping suelto si nada ha salido por el socket en KEEPALIVE_MS (con `a` −1 la sala no toca el ping conocido). */
  private keepAlive(): void {
    if (!keepAliveDue(performance.now(), this.lastSentAt, KEEPALIVE_MS)) return;
    this.send({ k: 'ping', i: 1e8 + this.keepI++, t: 0, a: -1 });
  }

  private send(msg: C2S): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // El ping sale con la hora real de envío (los ticks se procesan por frames): así mide la ida y vuelta de verdad.
    if (msg.k === 'ping') msg.t = performance.now() - this.clock.epoch;
    const text = encode(msg);
    this.bytesOut += frameBytes(text.length, true);
    ws.send(text);
    this.lastSentAt = performance.now();
  }

  tick(intent: InputIntent): SimEvent[] {
    return this.match.step(intent, true);
  }

  flush(): void {
    this.match.flushSends();
  }

  renderBall(out: Vec3): Vec3 {
    return this.match.renderBall(out);
  }

  /** Cierra sin reintentos ni avisos (cambio de sala, vuelta al lobby). */
  dispose(): void {
    const ws = this.ws;
    this.ws = null;
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.attemptTimer);
    window.clearInterval(this.keepTimer);
    ws?.close();
    this.status = 'idle';
    this.route = null;
    this.room = null;
    this.welcomed = false;
    this.cutAt = -1;
    this.attempt = 0;
  }
}
