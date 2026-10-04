/**
 * Latencia simulada (V0.3): retrasa los mensajes de una conexión en un sentido. Retardo = oneWay·(1 + jitter·(2r − 1))
 * con r de un PRNG con semilla (mulberry32), y entrega FIFO: un mensaje nunca adelanta al anterior (como TCP), así
 * que la variación no reordena.
 */
import { makeRng } from '../bot.ts';

export class LatencyQueue<T> {
  private readonly oneWay: number;
  private readonly jitter: number;
  private readonly rng: () => number;
  private readonly items: { at: number; item: T }[] = [];
  private head = 0;
  private last = Number.NEGATIVE_INFINITY;

  constructor(oneWayMs: number, jitter: number, seed: number) {
    this.oneWay = Math.max(0, oneWayMs);
    this.jitter = Math.max(0, Math.min(1, jitter));
    this.rng = makeRng(seed);
  }

  /** Encola un mensaje enviado en `now`; devuelve cuándo se entrega. */
  push(item: T, now: number): number {
    const delay = this.oneWay > 0 ? this.oneWay * (1 + this.jitter * (2 * this.rng() - 1)) : 0;
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
}
