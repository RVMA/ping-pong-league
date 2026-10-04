/**
 * Ping de la sala [§15.1]: cada jugador mide su ida y vuelta al servidor cada 2 s y se muestra la media de las
 * últimas 5 medidas, para que el número no salte. Se usa también para frenar la bola que se aleja (§17.2).
 */
import type { GameConfig } from '../config.ts';

export class PingTracker {
  private readonly size: number;
  private readonly ring: number[] = [];
  private next = 0;
  private total = 0;

  constructor(size: number) {
    this.size = Math.max(1, size);
  }

  add(rttMs: number): void {
    if (this.ring.length < this.size) this.ring.push(rttMs);
    else this.ring[this.next] = rttMs;
    this.next = (this.next + 1) % this.size;
    this.total++;
  }

  /** Media de las últimas medidas (null si aún no hay ninguna). */
  get average(): number | null {
    if (!this.ring.length) return null;
    let s = 0;
    for (const v of this.ring) s += v;
    return s / this.ring.length;
  }

  /** Medidas recibidas en total. */
  get count(): number {
    return this.total;
  }
}

export type PingLevel = 'unknown' | 'good' | 'fair' | 'bad';

/** Color del ping: < 60 ms verde, 60–120 amarillo, > 120 rojo con aviso [§15.1]. */
export function pingLevel(ms: number | null, cfg: GameConfig): PingLevel {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < cfg.net.ping.goodBelowMs) return 'good';
  if (ms <= cfg.net.ping.warnAboveMs) return 'fair';
  return 'bad';
}
