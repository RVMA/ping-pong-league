/**
 * Bot remoto [§17.5]: un cliente WebSocket más, con su ClientMatch y el mismo Bot que en local, que piensa sobre la
 * vista de su cliente. El servidor arranca uno por cada jugador (rol `bot`, con su propia latencia simulada); el script
 * de partidos por la red lo usa también como jugador (rol `player`).
 */
import { Bot, type BotDifficulty, type C2S, ClientMatch, configHash, decodeS2C, encode, type GameConfig, PROTOCOL_VERSION, type Role, type S2C, type SimEvent } from '@ppp/shared';
import { WebSocket } from 'ws';
import { frameBytes } from './peer.ts';
import { ticker } from './ticker.ts';

export interface BotClientOptions {
  url: string;
  role: Role;
  room?: string;
  difficulty: BotDifficulty;
  seed: number;
  /** Ping simulado (ms de ida y vuelta) de esta conexión y, si es el jugador, del bot que pide. */
  ping: number;
  botping: number;
  jitter: number;
  cfg: GameConfig;
  /** Semilla que se pide para el bot remoto (rol `player`); por defecto, la propia. */
  botSeed?: number;
  /** Quién saca primero (rol `player`); por defecto el jugador. */
  firstServer?: 0 | 1;
}

export class BotClient {
  readonly opts: BotClientOptions;
  match: ClientMatch | null = null;
  room: string | null = null;
  stopped = false;
  bytesIn = 0;
  bytesOut = 0;
  /** Momento (performance.now) en que empezó la partida (`start`). */
  startedAt = 0;
  onMessage: (msg: S2C) => void = () => {};
  onEvent: (e: SimEvent, c: BotClient) => void = () => {};
  readonly done: Promise<void>;
  private resolveDone: () => void = () => {};
  private ws: WebSocket | null = null;
  private bot: Bot | null = null;
  private epoch = 0;

  constructor(opts: BotClientOptions) {
    this.opts = opts;
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  start(): void {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.on('open', () => {
      const o = this.opts;
      this.send({ k: 'hello', v: PROTOCOL_VERSION, h: configHash(o.cfg), r: o.role, ...(o.room ? { room: o.room } : {}), p: o.ping, bp: o.botping, j: o.jitter, d: o.difficulty, s: o.botSeed ?? o.seed, o: 0, ...(o.firstServer !== undefined ? { fs: o.firstServer } : {}) });
    });
    ws.on('message', (data) => {
      const text = String(data);
      this.bytesIn += frameBytes(Buffer.byteLength(text), false);
      const msg = decodeS2C(text);
      if (msg) this.onServer(msg);
    });
    ws.on('close', () => this.stop());
    ws.on('error', () => this.stop());
  }

  private send(msg: C2S): void {
    // El ping sale con la hora real de envío (los ticks se ponen al día por tandas).
    if (msg.k === 'ping') msg.t = performance.now() - this.epoch;
    this.sendRaw(encode(msg));
  }

  /** Envía un texto tal cual (para probar mensajes inválidos). */
  sendRaw(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.bytesOut += frameBytes(Buffer.byteLength(text), true);
    this.ws.send(text);
  }

  private onServer(msg: S2C): void {
    this.onMessage(msg);
    const now = performance.now();
    switch (msg.k) {
      case 'welcome':
        this.room = msg.room;
        this.epoch = now;
        this.match = new ClientMatch(this.opts.cfg, msg.side, (m) => this.send(m));
        this.bot = new Bot(msg.side, this.opts.cfg.bot.difficulties[this.opts.difficulty], this.opts.cfg, this.opts.seed);
        ticker.add(this.tick);
        return;
      case 'err':
      case 'bye':
        this.stop();
        return;
      case 'start':
        if (!this.startedAt) this.startedAt = now;
        this.match?.receive(msg, now - this.epoch);
        return;
      default:
        this.match?.receive(msg, now - this.epoch);
    }
  }

  private readonly tick = (now: number): void => {
    const m = this.match;
    const bot = this.bot;
    if (!m || !bot || this.stopped) return;
    const gameNow = now - this.epoch;
    // Tirón largo del proceso: se descarta el tiempo en lugar de acelerar (como el bucle del navegador).
    if (gameNow - m.now > 250) this.epoch += gameNow - m.now - m.tickMs;
    while (m.now + m.tickMs <= now - this.epoch) {
      const events = m.step(bot.think(m));
      for (const e of events) this.onEvent(e, this);
    }
  };

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    ticker.remove(this.tick);
    try {
      this.ws?.close();
    } catch {
      // ya cerrado
    }
    this.resolveDone();
  }
}
