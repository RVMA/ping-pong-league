/**
 * Sesión online (V0.3): el jugador contra el bot remoto, por WebSocket al servidor de juego en el mismo origen (/ws,
 * proxy de Vite). La lógica es la de ClientMatch (shared/src/net): aquí solo se conecta, se envía y se reciben mensajes,
 * estampados con su llegada en el reloj de la partida (el mismo que usa el traductor de entrada para los clicks).
 */
import {
  type BotDifficulty,
  type C2S,
  ClientMatch,
  configHash,
  decodeS2C,
  encode,
  type GameConfig,
  type InputIntent,
  type NetStats,
  PROTOCOL_VERSION,
  type S2C,
  type SimEvent,
  type Vec3,
} from '@ppp/shared';
import type { InputClock } from '../input/mouse.ts';
import type { GameSession, SessionView } from '../game/session.ts';

export type NetStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'lost' | 'error';

export interface OnlineParams {
  /** Ping simulado del jugador y del bot (ms de ida y vuelta) y variación (fracción). */
  ping: number;
  botping: number;
  jitter: number;
  seed: number;
}

/** Bytes de la cabecera de una trama WebSocket (+4 de máscara del cliente al servidor). */
function frameBytes(len: number, masked: boolean): number {
  return len + (len <= 125 ? 2 : len <= 65535 ? 4 : 10) + (masked ? 4 : 0);
}

export class OnlineSession implements GameSession {
  readonly online = true;
  status: NetStatus = 'idle';
  /** Texto del último error (servidor o conexión). */
  detail = '';
  bytesIn = 0;
  bytesOut = 0;
  /** performance.now() del `start`: para medir bytes por segundo. */
  startedAt = 0;
  onStatus: (status: NetStatus, detail: string) => void = () => {};
  private match: ClientMatch;
  private ws: WebSocket | null = null;
  private readonly cfg: GameConfig;
  private readonly params: OnlineParams;
  private readonly clock: InputClock;
  private latencyOffset = 0;
  private difficulty: BotDifficulty = 'medium';

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

  /** Desfase de latencia calibrado que se declara al servidor (los clicks ya llegan corregidos). */
  setLatencyOffset(ms: number): void {
    this.latencyOffset = ms;
  }

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
    this.connect(difficulty);
  }

  private setStatus(s: NetStatus, detail = ''): void {
    this.status = s;
    this.detail = detail;
    this.onStatus(s, detail);
  }

  private connect(difficulty: BotDifficulty): void {
    this.difficulty = difficulty;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws?bot=${encodeURIComponent(difficulty)}`);
    } catch (e) {
      this.setStatus('error', `No se pudo conectar: ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    this.match = new ClientMatch(this.cfg, 0, () => {});
    this.setStatus('connecting');
    ws.onopen = () => {
      const p = this.params;
      this.send({ k: 'hello', v: PROTOCOL_VERSION, h: configHash(this.cfg), r: 'player', nm: 'Jugador', p: p.ping, bp: p.botping, j: p.jitter, sp: 0, d: difficulty, s: p.seed, o: this.latencyOffset });
    };
    ws.onmessage = (ev) => {
      const text = String(ev.data);
      this.bytesIn += frameBytes(text.length, false);
      const msg = decodeS2C(text);
      if (msg) this.onServer(msg, performance.now());
      else console.warn('[red] mensaje del servidor descartado', text.slice(0, 80));
    };
    ws.onerror = () => {
      if (this.status === 'connecting') this.setStatus('error', 'No se pudo conectar con el servidor de juego. ¿Está arrancado (npm run dev)?');
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.status === 'playing' || this.status === 'waiting') this.setStatus('lost', 'Conexión perdida');
      else if (this.status === 'connecting') this.setStatus('error', 'No se pudo conectar con el servidor de juego. ¿Está arrancado (npm run dev)?');
    };
  }

  private onServer(msg: S2C, perf: number): void {
    switch (msg.k) {
      case 'welcome':
        this.setStatus('waiting');
        return;
      case 'start':
        if (this.status !== 'playing') {
          // Primer `start`: empieza el reloj de la partida (el del traductor de entrada) y la vista.
          this.clock.epoch = perf;
          this.startedAt = perf;
          this.bytesIn = 0;
          this.bytesOut = 0;
          this.match = new ClientMatch(this.cfg, 0, (m) => this.send(m));
          this.match.receive(msg, 0);
          this.setStatus('playing');
        } else this.match.receive(msg, perf - this.clock.epoch);
        return;
      case 'err':
        this.setStatus('error', msg.d);
        this.ws?.close();
        return;
      case 'bye':
        this.setStatus('lost', 'Conexión perdida: el bot se desconectó');
        this.ws?.close();
        return;
      default:
        if (this.status === 'playing') this.match.receive(msg, perf - this.clock.epoch);
    }
  }

  private send(msg: C2S): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // El ping sale con la hora real de envío (los ticks se procesan por frames): así mide la ida y vuelta de verdad.
    if (msg.k === 'ping') msg.t = performance.now() - this.clock.epoch;
    const text = encode(msg);
    this.bytesOut += frameBytes(text.length, true);
    ws.send(text);
  }

  tick(intent: InputIntent): SimEvent[] {
    return this.match.step(intent);
  }

  renderBall(out: Vec3): Vec3 {
    return this.match.renderBall(out);
  }

  dispose(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.status = 'idle';
  }
}
