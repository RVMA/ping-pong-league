/**
 * El Durable Object de una sala (producción en Cloudflare; Decisión 15 del plan, §17.7): uno por código, con la
 * RoomCore de `shared/` (toda la lógica) y la conexión de cada lado. Es el gemelo de `room-host.ts` del servidor Node.
 *
 * Sin hibernación (`accept()`): la sala vive en memoria mientras haya alguien, y nada se guarda en disco. Un solo
 * `setTimeout`, al plazo más cercano (`nextDeadline()` de la sala o el `hello` de una conexión que aún no se ha
 * presentado), reprogramado tras cada evento; ninguno si no hay plazo. Reloj: `Date.now()`, que en un Worker es el
 * instante en que empezó el evento (la llegada del mensaje). Si la sala se rompe (`pollRoom`: un fallo en `poll` o un
 * plazo que no avanza), se cierra con un `err` a los dos en vez de reprogramar a 0 ms sin fin.
 *
 * Contrato conexión ↔ lado de `RoomCore.join` (el mismo que el servidor Node y la red en memoria de los tests):
 *  - durante `join`, lo que la sala manda a un lado sin conexión va a la conexión que está entrando;
 *  - `drop` cierra la conexión del lado y la olvida en el acto: lo que llegue después de ella (mensajes o su cierre)
 *    ya no va a la sala;
 *  - el cierre de una conexión registrada (sin `drop`) es `disconnect`.
 *
 * Lo que la sala no hace y hace aquí: `validHello` antes de `join`, sin latencia simulada ni bot remoto (Decisiones 14
 * y 20), 16 KB por mensaje, límite de ritmo por conexión (Decisión 12), plazo para el `hello`, y descartar la sala si
 * quien la crea no llega a entrar (si no, el código quedaría ocupado sin nadie dentro). Registro: una línea por evento
 * de sala, nunca por mensaje, con un tope de líneas por sala (lo que sobra se cuenta).
 */
import { DurableObject } from 'cloudflare:workers';
import { type C2S, decodeC2S, encode, type ErrCode, type JoinResult, type MatchMode, makeConfig, RateLimiter, RoomCore, type RoomRetain, type S2C, type Side, validHello } from '@ppp/shared';
import { cryptoRandom, ERR_TEXT, pollRoom, ROOM_BROKEN_TEXT, WORKER_TEXT } from '../policy.ts';
import { messageBytes, POLICY_CLOSE, rejectSocket, sendErr, TOO_BIG_CLOSE } from './sockets.ts';

const cfg = makeConfig();
const INF = Number.POSITIVE_INFINITY;
const SIDES: readonly Side[] = [0, 1];
/** Plazo para el primer mensaje (`hello`) de una conexión: si no llega, se cierra (y si creaba la sala, se descarta). */
export const HELLO_TIMEOUT_MS = 10_000;
/** La sala puede vivir horas: su registro se queda con lo reciente y con lo que piden las estadísticas del partido. */
const RETAIN: RoomRetain = { events: 64, matches: 16, perGame: 100 };
/** Registro de cada sala: ráfaga y ritmo de líneas (un partido normal escribe unas pocas por minuto). */
const LOG_BURST = 30;
const LOG_PER_SECOND = 0.5;

/** Una conexión de la sala: sin lado hasta que entra con su `hello`. */
interface Conn {
  readonly ws: WebSocket;
  readonly limiter: RateLimiter;
  /** Es la conexión que crea la sala: si no entra, la sala se descarta. */
  readonly creator: boolean;
  /** Hasta cuándo puede tardar su `hello` (Infinity después). */
  helloBy: number;
  side: Side | null;
  /** Cerrada, rechazada o soltada por la sala: lo que llegue de ella ya no cuenta. */
  done: boolean;
  /** Mensajes inválidos descartados (se registran una vez, al cerrarse). */
  bad: number;
}

export class RoomDO extends DurableObject<Env> {
  private core: RoomCore | null = null;
  private code = '';
  /** La conexión de cada lado (null sin conexión, también con el hueco reservado). */
  private readonly socks: [Conn | null, Conn | null] = [null, null];
  /** Conexiones que aún no han mandado su `hello`. */
  private readonly pending = new Set<Conn>();
  /** La conexión que está entrando (solo durante `join`). */
  private joining: Conn | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = INF;
  private readonly logBudget = new RateLimiter(LOG_BURST, LOG_PER_SECOND);
  private logSkipped = 0;

  /** El Worker pasa `?code=` y, al crear, `&create=<modo>`: 409 si este código ya tiene sala. */
  override fetch(req: Request): Response {
    const q = new URL(req.url).searchParams;
    const mode = q.get('create');
    if (mode !== null) {
      if (this.core) return new Response('Sala ocupada', { status: 409 });
      if (!Object.hasOwn(cfg.room.gamesToWin, mode)) return new Response('Modo no válido', { status: 400 });
      this.code = q.get('code') ?? '';
      this.core = this.newCore(mode as MatchMode);
      this.log(`[${this.code}] sala nueva (${mode})`);
    } else if (!this.core || this.core.players === 0) {
      // Unirse nunca crea una sala (tampoco entra en una cuyo creador aún no se ha presentado).
      return rejectSocket('room');
    }
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    const c: Conn = { ws, limiter: new RateLimiter(cfg.room.rate.burst, cfg.room.rate.perSecond), creator: mode !== null, helloBy: Date.now() + HELLO_TIMEOUT_MS, side: null, done: false, bad: 0 };
    this.pending.add(c);
    ws.addEventListener('message', (ev) => this.onMessage(c, ev.data));
    ws.addEventListener('close', () => this.onClose(c));
    ws.addEventListener('error', () => this.onClose(c));
    this.settle();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private newCore(mode: MatchMode): RoomCore {
    return new RoomCore({
      cfg,
      code: this.code,
      mode,
      send: (to, msg) => this.deliver(to, msg),
      drop: (to) => this.drop(to),
      newToken: () => crypto.randomUUID(),
      random: cryptoRandom,
      log: (line) => this.log(line),
      retain: RETAIN,
    });
  }

  // ——— Eventos de las conexiones ———

  private onMessage(c: Conn, data: string | ArrayBuffer): void {
    if (c.done) return;
    const now = Date.now();
    if (messageBytes(data, cfg.room.maxMessageBytes) > cfg.room.maxMessageBytes) this.end(c, 'proto', WORKER_TEXT.tooBig, now, TOO_BIG_CLOSE);
    else if (!c.limiter.take(now)) this.end(c, 'rate', ERR_TEXT.rate, now);
    else this.onData(c, typeof data === 'string' ? decodeC2S(data) : null, now);
    // También tras un cierre: la reserva del hueco (o descartar la sala) necesita su plazo.
    this.settle();
  }

  private onData(c: Conn, msg: C2S | null, now: number): void {
    const side = c.side;
    if (side === null) this.onHello(c, msg, now);
    else if (!msg) c.bad += 1;
    else if (this.socks[side] === c) this.safely(() => this.core?.receive(side, msg, now));
  }

  /** El primer mensaje: tiene que ser un `hello` válido y de producción; luego, `join`. */
  private onHello(c: Conn, msg: C2S | null, now: number): void {
    this.pending.delete(c);
    c.helloBy = INF;
    if (!msg || msg.k !== 'hello') return this.end(c, 'proto', ERR_TEXT.proto, now);
    const err = validHello(msg, cfg);
    if (err) return this.end(c, err, ERR_TEXT[err], now);
    if (msg.p !== 0 || msg.bp !== 0 || msg.j !== 0 || msg.sp !== 0) return this.end(c, 'params', WORKER_TEXT.latency, now);
    if (msg.r === 'bot') return this.end(c, 'params', WORKER_TEXT.bot, now);
    const core = this.core;
    if (!core) return this.end(c, 'room', ERR_TEXT.room, now);
    this.joining = c;
    let res: JoinResult;
    try {
      res = core.join(msg, now);
    } catch (e) {
      this.log(`[${this.code}] join falló: ${(e as Error).message}`);
      res = { ok: false, err: 'room' };
    } finally {
      this.joining = null;
    }
    if (!res.ok) return this.end(c, res.err, ERR_TEXT[res.err], now);
    c.side = res.side;
    this.socks[res.side] = c;
  }

  private onClose(c: Conn): void {
    if (c.done) return;
    c.done = true;
    this.pending.delete(c);
    this.release(c, Date.now());
    if (c.bad) this.log(`[${this.code}] ${c.bad} mensajes inválidos descartados del lado ${c.side}`);
    try {
      // Completa el cierre si el runtime no contesta solo al del cliente.
      c.ws.close();
    } catch {
      // ya cerrado
    }
    this.settle();
  }

  /** `err` y cierre; si la conexión tenía lado, la sala lo ve como una desconexión (reserva del hueco). */
  private end(c: Conn, code: ErrCode, text: string, now: number, closeCode = POLICY_CLOSE): void {
    c.done = true;
    this.pending.delete(c);
    this.release(c, now);
    sendErr(c.ws, code, text, closeCode);
    this.log(`[${this.code}] conexión cerrada: ${code}${c.side === null ? '' : ` (lado ${c.side})`}`);
  }

  private release(c: Conn, now: number): void {
    const s = c.side;
    if (s === null || this.socks[s] !== c) return;
    this.socks[s] = null;
    this.safely(() => this.core?.disconnect(s, now));
  }

  // ——— Lo que pide la sala ———

  private deliver(to: Side, msg: S2C): void {
    const c = this.socks[to] ?? this.joining;
    if (!c) return;
    try {
      c.ws.send(encode(msg));
    } catch {
      // Socket cerrándose: su cierre llega como evento (y es `disconnect`).
    }
  }

  private drop(to: Side): void {
    const c = this.socks[to];
    if (!c) return;
    this.socks[to] = null;
    c.done = true;
    try {
      c.ws.close(1000, 'bye');
    } catch {
      // ya cerrado
    }
  }

  // ——— Plazos y vida de la sala ———

  /** Tras cada evento: libera la sala vacía (o la de un creador que no entró) y reprograma el temporizador. */
  private settle(): void {
    const core = this.core;
    if (core && core.players === 0 && !this.creatorPending()) {
      this.log(`[${this.code}] ${core.closed ? 'sala cerrada' : 'sala descartada: quien la creaba no entró'}`);
      this.core = null;
    }
    let at = INF;
    try {
      if (this.core) at = this.core.nextDeadline();
    } catch {
      // Plazo roto: el temporizador salta ya y onTimer (pollRoom) cierra la sala.
      at = 0;
    }
    for (const c of this.pending) at = Math.min(at, c.helloBy);
    if (at === this.timerAt) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = at;
    if (at < INF) this.timer = setTimeout(() => this.onTimer(), Math.max(0, at - Date.now()));
  }

  private onTimer(): void {
    this.timer = null;
    this.timerAt = INF;
    const now = Date.now();
    for (const c of [...this.pending]) if (c.helloBy <= now) this.end(c, 'proto', WORKER_TEXT.helloLate, now);
    const core = this.core;
    if (core && !pollRoom(core, now, (line) => this.log(`[${this.code}] ${line}`))) this.abort();
    this.settle();
  }

  /**
   * Sala rota (pollRoom): `err` a quien siga conectado y cierre, y la sala se olvida (el código queda libre; quien vuelva
   * con él lee «Sala inexistente»). Cerrar y no esperar: el plazo roto se volvería a atender con cada mensaje.
   */
  private abort(): void {
    for (const s of SIDES) {
      const c = this.socks[s];
      this.socks[s] = null;
      if (!c) continue;
      c.done = true;
      sendErr(c.ws, 'room', ROOM_BROKEN_TEXT);
    }
    this.core = null;
    this.log(`[${this.code}] sala rota: cerrada`);
  }

  private creatorPending(): boolean {
    for (const c of this.pending) if (c.creator) return true;
    return false;
  }

  // ——— Registro ———

  /** Última red de seguridad: la sala no lanza con mensajes decodificados, pero un fallo no debe tumbar el objeto. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.log(`[${this.code}] error: ${(e as Error).stack ?? e}`);
    }
  }

  private log(line: string): void {
    if (!this.logBudget.take(Date.now())) {
      this.logSkipped += 1;
      return;
    }
    if (this.logSkipped) console.log(`[${this.code}] (${this.logSkipped} líneas de registro omitidas)`);
    this.logSkipped = 0;
    console.log(line);
  }
}
