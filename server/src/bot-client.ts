/**
 * Bot por la red [§17.5]: un cliente WebSocket más, con su ClientMatch y el mismo Bot que en local, que piensa sobre la
 * vista de su cliente. Solo necesita la URL del WebSocket y la ruta, así que vale contra cualquier servidor (el Node, el
 * de `wrangler dev` o el publicado):
 *  - el servidor Node arranca uno por cada jugador de `?bot=` (rol `bot`, ruta `?room=b-<n>`, con su latencia simulada);
 *  - el script de partidos por la red (V0.3) lo usa como jugador de `?bot=`;
 *  - en una sala (`?create=<modo>` o `?room=<código>`) juega el warm-up, da a Listo tras `warmupPoints` puntos y juega
 *    el partido; guarda el `mend` en `lastEnd`.
 * Cuenta bytes y mensajes de cada sentido y guarda cada ping medido (`pings`); las correcciones, la media del ping y el
 * frenado están en `match.stats`.
 */
import { Bot, type BotDifficulty, type ByeMsg, type C2S, ClientMatch, configHash, decodeS2C, encode, type ErrMsg, type GameConfig, type MatchEndMsg, type MatchMode, neutralIntent, PROTOCOL_VERSION, type Role, type RoomMsg, type S2C, type Side, type SimEvent } from '@ppp/shared';
import { WebSocket } from 'ws';
import { frameBytes } from './peer.ts';
import { ticker } from './ticker.ts';

export interface BotClientOptions {
  /** URL del WebSocket, sin ruta (p. ej. `ws://127.0.0.1:5180/ws`). */
  url: string;
  /** Ruta (Decisión 1): `?create=standard`, `?room=ABCD`, `?bot=medium`. */
  route: string;
  role: Role;
  /** Nombre en la sala (por defecto «Bot» o «Jugador»). */
  name?: string;
  /** Token de reconexión: vuelve al mismo lado de la sala (o sustituye a la conexión que lo tenga). */
  token?: string;
  difficulty: BotDifficulty;
  seed: number;
  /** Ping simulado (ms de ida y vuelta) de esta conexión y, en `?bot=`, del bot que pide. */
  ping: number;
  botping: number;
  jitter: number;
  /** Probabilidad de picos de TCP simulados en esta conexión (solo el servidor Node). */
  spike?: number;
  cfg: GameConfig;
  /** Puntos de warm-up antes de dar a Listo (por defecto 2; Infinity = nunca). Una vez: no pide la revancha. */
  warmupPoints?: number;
  /** Semilla que se pide para el bot remoto (`?bot=`); por defecto, la propia. */
  botSeed?: number;
  /** Quién saca primero (`?bot=`); por defecto el jugador. */
  firstServer?: Side;
}

export class BotClient {
  readonly opts: BotClientOptions;
  match: ClientMatch | null = null;
  /** Del `welcome`: código de la sala (o id `b-<n>`), lado, token de reconexión y modo. */
  code: string | null = null;
  side: Side | null = null;
  token: string | null = null;
  mode: MatchMode | 'bot' | null = null;
  /** Último `room` recibido. */
  lastRoom: RoomMsg | null = null;
  /** Fin del último partido de la sala. */
  lastEnd: MatchEndMsg | null = null;
  /** El `err` o el `bye` con que el servidor cerró la conexión. */
  closedBy: ErrMsg | ByeMsg | null = null;
  /** Código de cierre del socket (1009: mensaje demasiado grande); null mientras sigue abierto. */
  closeCode: number | null = null;
  /** Ya mandó su Listo. */
  readySent = false;
  stopped = false;
  bytesIn = 0;
  bytesOut = 0;
  messagesIn = 0;
  messagesOut = 0;
  /** Cada ping medido (ms de ida y vuelta, como lo mide su ClientMatch), para las estadísticas de los scripts. */
  readonly pings: number[] = [];
  /** Momento (performance.now) del primer `start`. */
  startedAt = 0;
  onMessage: (msg: S2C) => void = () => {};
  onEvent: (e: SimEvent, c: BotClient) => void = () => {};
  onRoom: (msg: RoomMsg, c: BotClient) => void = () => {};
  readonly done: Promise<void>;
  private resolveDone: () => void = () => {};
  private ws: WebSocket | null = null;
  private bot: Bot | null = null;
  private epoch = 0;
  /** Puntos (y lets) del warm-up vistos. */
  private warmupSeen = 0;

  constructor(opts: BotClientOptions) {
    this.opts = opts;
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  start(): void {
    const ws = new WebSocket(`${this.opts.url}${this.opts.route}`);
    this.ws = ws;
    ws.on('open', () => {
      const o = this.opts;
      this.send({
        k: 'hello',
        v: PROTOCOL_VERSION,
        h: configHash(o.cfg),
        r: o.role,
        nm: o.name ?? (o.role === 'bot' ? 'Bot' : 'Jugador'),
        ...(o.token !== undefined ? { tk: o.token } : {}),
        p: o.ping,
        bp: o.botping,
        j: o.jitter,
        sp: o.spike ?? 0,
        d: o.difficulty,
        s: o.botSeed ?? o.seed,
        o: 0,
        ...(o.firstServer !== undefined ? { fs: o.firstServer } : {}),
      });
    });
    ws.on('message', (data) => {
      const text = String(data);
      this.bytesIn += frameBytes(Buffer.byteLength(text), false);
      this.messagesIn++;
      const msg = decodeS2C(text);
      if (msg) this.onServer(msg);
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      this.stop();
    });
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
    this.messagesOut++;
    this.ws.send(text);
  }

  private onServer(msg: S2C): void {
    this.onMessage(msg);
    const now = performance.now();
    switch (msg.k) {
      case 'welcome':
        this.code = msg.room;
        this.side = msg.side;
        this.token = msg.tk;
        this.mode = msg.md;
        if (this.match) return;
        this.epoch = now;
        this.match = new ClientMatch(this.opts.cfg, msg.side, (m) => this.send(m));
        this.bot = new Bot(msg.side, this.opts.cfg.bot.difficulties[this.opts.difficulty], this.opts.cfg, this.opts.seed);
        ticker.add(this.tick);
        return;
      case 'room':
        this.lastRoom = msg;
        this.onRoom(msg, this);
        return;
      case 'mend':
        this.lastEnd = msg;
        return;
      case 'err':
      case 'bye':
        this.closedBy = msg;
        this.stop();
        return;
      case 'start':
        if (!this.startedAt) this.startedAt = now;
        this.match?.receive(msg, now - this.epoch);
        return;
      case 'pong':
        if (this.match) this.pings.push(Math.max(0, now - this.epoch - msg.t));
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
      // Esperando rival no hay partida: la raqueta queda quieta en su sitio.
      const events = m.step(m.started ? bot.think(m) : neutralIntent(this.opts.cfg.bot.readyDepth));
      for (const e of events) {
        if (m.practice && (e.type === 'point' || e.type === 'let')) this.warmupSeen++;
        this.onEvent(e, this);
      }
      this.maybeReady(m);
    }
  };

  /** Listo tras `warmupPoints` puntos del warm-up (una vez). */
  private maybeReady(m: ClientMatch): void {
    if (this.readySent || this.mode === 'bot' || !m.started || !m.practice) return;
    if (this.warmupSeen < (this.opts.warmupPoints ?? 2)) return;
    this.readySent = true;
    this.send({ k: 'rdy', on: 1 });
  }

  /** Sale de la sala a propósito (sin reserva del hueco) y cierra. */
  leave(): void {
    this.send({ k: 'leave' });
    this.stop();
  }

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
