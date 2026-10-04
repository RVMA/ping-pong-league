/**
 * Una conexión WebSocket en el servidor, con la latencia simulada de ese jugador (V0.3): sus mensajes de entrada se
 * procesan y los de salida se envían con ping/2 de retardo en cada sentido (±variación, sin reordenar). Cuenta los bytes
 * de mensajes en cada sentido (carga + cabecera de la trama WebSocket) y descarta, registrándolos, los mensajes que no
 * se pueden decodificar.
 */
import { type C2S, decodeC2S, encode, LatencyQueue, type S2C } from '@ppp/shared';
import type { WebSocket } from 'ws';

/** Bytes de la cabecera de una trama WebSocket con `len` bytes de carga (+4 de máscara del cliente al servidor). */
export function frameBytes(len: number, masked: boolean): number {
  return len + (len <= 125 ? 2 : len <= 65535 ? 4 : 10) + (masked ? 4 : 0);
}

export class Peer {
  readonly ws: WebSocket;
  bytesIn = 0;
  bytesOut = 0;
  messagesIn = 0;
  messagesOut = 0;
  protoErrors = 0;
  readonly openedAt = performance.now();
  onMessage: (msg: C2S, now: number) => void = () => {};
  onClose: () => void = () => {};
  /** Un mensaje que no se pudo decodificar (ya descartado y contado). */
  onBad: (text: string) => void = () => {};
  private inQ = new LatencyQueue<string>(0, 0, 1);
  private outQ = new LatencyQueue<string>(0, 0, 2);
  private closed = false;
  private readonly log: (line: string) => void;

  constructor(ws: WebSocket, log: (line: string) => void) {
    this.ws = ws;
    this.log = log;
    ws.on('message', (data) => {
      const text = String(data);
      this.bytesIn += frameBytes(Buffer.byteLength(text), true);
      this.messagesIn++;
      this.inQ.push(text, performance.now());
    });
    ws.on('close', () => {
      this.closed = true;
      this.onClose();
    });
    ws.on('error', (e) => this.log(`[peer] ${e.message}`));
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Latencia simulada de esta conexión: ping (ida y vuelta, ms) repartido en los dos sentidos. */
  setLatency(pingMs: number, jitter: number, seed: number): void {
    const now = performance.now();
    const pending = [] as string[];
    for (let m = this.inQ.popDue(Number.POSITIVE_INFINITY); m !== undefined; m = this.inQ.popDue(Number.POSITIVE_INFINITY)) pending.push(m);
    this.inQ = new LatencyQueue<string>(pingMs / 2, jitter, seed * 2 + 1);
    this.outQ = new LatencyQueue<string>(pingMs / 2, jitter, seed * 2 + 2);
    for (const m of pending) this.inQ.push(m, now);
  }

  send(msg: S2C): void {
    if (this.closed) return;
    this.outQ.push(encode(msg), performance.now());
  }

  /** Envía ya, sin latencia (errores de conexión justo antes de cerrar). */
  sendNow(msg: S2C): void {
    if (this.closed) return;
    const text = encode(msg);
    this.bytesOut += frameBytes(Buffer.byteLength(text), false);
    this.messagesOut++;
    this.ws.send(text);
  }

  /** Entrega lo que ya ha cumplido su retardo. */
  pump(now: number): void {
    for (let t = this.outQ.popDue(now); t !== undefined; t = this.outQ.popDue(now)) {
      if (this.closed) break;
      this.bytesOut += frameBytes(Buffer.byteLength(t), false);
      this.messagesOut++;
      this.ws.send(t);
    }
    for (let at = this.inQ.nextAt(); at <= now; at = this.inQ.nextAt()) {
      const text = this.inQ.popDue(now)!;
      const msg = decodeC2S(text);
      if (!msg) {
        this.protoErrors++;
        this.log(`[peer] mensaje descartado: ${text.slice(0, 80)}`);
        this.onBad(text);
        continue;
      }
      this.onMessage(msg, at);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // ya cerrado
    }
  }
}
