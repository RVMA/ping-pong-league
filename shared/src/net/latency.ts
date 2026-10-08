/**
 * Latencia simulada (V0.3): retrasa los mensajes de una conexión en un sentido. Retardo = oneWay·(1 + jitter·(2r − 1))
 * con r de un PRNG con semilla (mulberry32), y entrega FIFO: un mensaje nunca adelanta al anterior (como TCP), así
 * que la variación no reordena.
 *
 * Picos de TCP (V0.4, `spike`): con probabilidad `prob`, un mensaje se retrasa además U(minMs, maxMs) (una
 * retransmisión). Por ser FIFO, los que vienen detrás esperan a que llegue (bloqueo de cabeza de línea). Sin `spike`, o
 * con `prob` 0, no se gasta azar de más: las entregas son las de V0.3 con la misma semilla.
 */
import { makeRng } from '../bot.ts';

export interface LatencySpike {
  /** Probabilidad de que un mensaje sufra un pico (0…1; quien lo configura la limita con net.latency.spike.maxProb). */
  prob: number;
  minMs: number;
  maxMs: number;
}

export class LatencyQueue<T> {
  private readonly oneWay: number;
  private readonly jitter: number;
  private readonly rng: () => number;
  private readonly spikeProb: number;
  private readonly spikeMin: number;
  private readonly spikeMax: number;
  private readonly items: { at: number; item: T }[] = [];
  private head = 0;
  private last = Number.NEGATIVE_INFINITY;
  private spikeCount = 0;

  constructor(oneWayMs: number, jitter: number, seed: number, spike?: LatencySpike) {
    this.oneWay = Math.max(0, oneWayMs);
    this.jitter = Math.max(0, Math.min(1, jitter));
    this.rng = makeRng(seed);
    const prob = spike?.prob ?? 0;
    this.spikeProb = prob > 0 ? Math.min(1, prob) : 0;
    this.spikeMin = Math.max(0, spike?.minMs ?? 0);
    this.spikeMax = Math.max(this.spikeMin, spike?.maxMs ?? 0);
  }

  /** Encola un mensaje enviado en `now`; devuelve cuándo se entrega. */
  push(item: T, now: number): number {
    let delay = this.oneWay > 0 ? this.oneWay * (1 + this.jitter * (2 * this.rng() - 1)) : 0;
    if (this.spikeProb > 0 && this.rng() < this.spikeProb) {
      delay += this.spikeMin + (this.spikeMax - this.spikeMin) * this.rng();
      this.spikeCount += 1;
    }
    const at = Math.max(this.last, now + delay);
    this.last = at;
    this.items.push({ at, item });
    return at;
  }

  /** El siguiente mensaje ya entregado en `now`, o undefined. */
  popDue(now: number): T | undefined {
    if (this.head >= this.items.length || this.items[this.head].at > now) return undefined;
    const it = this.items[this.head++].item;
    if (this.head > 64 && this.head * 2 > this.items.length) {
      this.items.splice(0, this.head);
      this.head = 0;
    }
    return it;
  }

  /** Instante de la próxima entrega (Infinity si no hay nada). */
  nextAt(): number {
    return this.head < this.items.length ? this.items[this.head].at : Number.POSITIVE_INFINITY;
  }

  get size(): number {
    return this.items.length - this.head;
  }

  /** Mensajes que han sufrido un pico (para medir). */
  get spikes(): number {
    return this.spikeCount;
  }
}
