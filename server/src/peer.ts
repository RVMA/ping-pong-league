/**
 * Una conexión WebSocket en el servidor, con la latencia simulada de ese jugador (V0.3, con picos de TCP en V0.4): sus
 * mensajes de entrada se procesan y los de salida se envían con ping/2 de retardo en cada sentido (±variación y picos,
 * sin reordenar). El cierre del socket también entra en la cola de entrada: llega detrás de los mensajes que ya venían
 * (como el FIN de TCP), así un `leave` seguido de un cierre nunca se pierde.
 *
 * Cuenta los bytes y los mensajes de cada sentido (carga + cabecera de la trama WebSocket), descarta registrándolos los
 * mensajes que no se pueden decodificar y aplica el límite de ritmo (Decisión 12): quien vacía el cubo recibe `err`
 * `rate` y se le cierra la conexión.
 */
import { type C2S, decodeC2S, encode, type ErrCode, LatencyQueue, type LatencySpike, RateLimiter, type S2C } from '@ppp/shared';
import type { WebSocket } from 'ws';
import { ERR_TEXT } from './policy.ts';

/** Bytes de la cabecera de una trama WebSocket con `len` bytes de carga (+4 de máscara del cliente al servidor). */
export function frameBytes(len: number, masked: boolean): number {
  return len + (len <= 125 ? 2 : len <= 65535 ? 4 : 10) + (masked ? 4 : 0);
}

const INF = Number.POSITIVE_INFINITY;
/** Código de cierre tras un `err` del servidor (violación de la política). */
const POLICY_CLOSE = 1008;
const noop = () => {};

/** Saca todo lo que queda en una cola, en orden. */
function drain<T>(q: LatencyQueue<T>): T[] {
  const out: T[] = [];
  for (let m = q.popDue(INF); m !== undefined; m = q.popDue(INF)) out.push(m);
  return out;
}

export class Peer {
  readonly ws: WebSocket;
  bytesIn = 0;
  bytesOut = 0;
  messagesIn = 0;
  messagesOut = 0;
  protoErrors = 0;
  readonly openedAt = performance.now();
  onMessage: (msg: C2S, at: number) => void = noop;
  /** El socket se cerró; llega en su turno de la cola de entrada, con su instante de llegada. */
  onClose: (at: number) => void = noop;
  /** Un mensaje que no se pudo decodificar (ya descartado, registrado y contado). */
  onBad: (text: string) => void = noop;
  /** `null` = el cierre del socket. */
  private inQ = new LatencyQueue<string | null>(0, 0, 1);
  private outQ = new LatencyQueue<string>(0, 0, 2);
  /** El socket admite envíos. */
  private open = true;
  /** El cierre ya está en la cola de entrada: no entra nada más. */
  private ended = false;
  private readonly limiter: RateLimiter | null;
  private readonly log: (line: string) => void;

  constructor(ws: WebSocket, log: (line: string) => void, rate?: { burst: number; perSecond: number }) {
    this.ws = ws;
    this.log = log;
    this.limiter = rate ? new RateLimiter(rate.burst, rate.perSecond) : null;
    ws.on('message', (data) => {
      if (this.ended) return;
      const now = performance.now();
      const text = String(data);
      this.bytesIn += frameBytes(Buffer.byteLength(text), true);
      this.messagesIn++;
      if (this.limiter && !this.limiter.take(now)) {
        this.log(`[peer] límite de ritmo superado tras ${this.messagesIn} mensajes en ${Math.round(now - this.openedAt)} ms`);
        this.reject('rate');
        return;
      }
      this.inQ.push(text, now);
    });
    ws.on('close', () => {
      this.open = false;
      this.end();
    });
    ws.on('error', (e) => this.log(`[peer] ${e.message}`));
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Mensajes (de los dos sentidos) que sufrieron un pico de TCP simulado. */
  get spikes(): number {
    return this.inQ.spikes + this.outQ.spikes;
  }

  /** Latencia simulada de esta conexión: ping (ida y vuelta, ms) repartido en los dos sentidos, con picos si se piden. */
  setLatency(pingMs: number, jitter: number, seed: number, spike?: LatencySpike): void {
    const now = performance.now();
    const pendingIn = drain(this.inQ);
    const pendingOut = drain(this.outQ);
    this.inQ = new LatencyQueue<string | null>(pingMs / 2, jitter, seed * 2 + 1, spike);
    this.outQ = new LatencyQueue<string>(pingMs / 2, jitter, seed * 2 + 2, spike);
    for (const m of pendingIn) this.inQ.push(m, now);
    for (const m of pendingOut) this.outQ.push(m, now);
  }

  send(msg: S2C): void {
    if (!this.open) return;
    this.outQ.push(encode(msg), performance.now());
  }

  /** Envía ya, sin latencia (errores de conexión justo antes de cerrar). */
  sendNow(msg: S2C): void {
    if (!this.open) return;
    this.write(encode(msg));
  }

  /** `err` con su texto (sin latencia) y cierre. */
  reject(code: ErrCode, text: string = ERR_TEXT[code]): void {
    this.sendNow({ k: 'err', m: code, d: text });
    this.close(POLICY_CLOSE);
  }

  /** Entrega lo que ya ha cumplido su retardo: la salida al socket y la entrada (mensajes y cierre) a los callbacks. */
  pump(now: number): void {
    for (let t = this.outQ.popDue(now); t !== undefined && this.open; t = this.outQ.popDue(now)) this.write(t);
    for (let at = this.inQ.nextAt(); at <= now; at = this.inQ.nextAt()) {
      const text = this.inQ.popDue(now);
      if (text === undefined) break;
      if (text === null) {
        this.onClose(at);
        continue;
      }
      const msg = decodeC2S(text);
      if (!msg) {
        this.protoErrors++;
        this.log(`[peer] mensaje descartado: ${JSON.stringify(text.slice(0, 80))}`);
        this.onBad(text);
        continue;
      }
      this.onMessage(msg, at);
    }
  }

  /** Cierra el socket; el cierre entra en la cola de entrada (onClose llega en su turno). */
  close(code?: number): void {
    this.end();
    if (!this.open) return;
    this.open = false;
    try {
      this.ws.close(code);
    } catch {
      // ya cerrado
    }
  }

  /** Lo que queda por enviar sale ya (sin latencia) y se cierra: el `bye` a una conexión que la sala ya no quiere. */
  flushAndClose(): void {
    for (let t = this.outQ.popDue(INF); t !== undefined && this.open; t = this.outQ.popDue(INF)) this.write(t);
    this.close();
  }

  /** La conexión ya no es de nadie: lo que quede de ella (mensajes, cierre) se ignora. */
  detach(): void {
    this.onMessage = noop;
    this.onClose = noop;
    this.onBad = noop;
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.inQ.push(null, performance.now());
  }

  private write(text: string): void {
    this.bytesOut += frameBytes(Buffer.byteLength(text), false);
    this.messagesOut++;
    this.ws.send(text);
  }
}
