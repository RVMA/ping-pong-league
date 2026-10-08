/**
 * Límite de ritmo por conexión (V0.4, Decisión 12 del plan): un cubo de fichas. Empieza lleno (`burst` mensajes) y se
 * rellena a `perSecond` fichas por segundo sin pasar de `burst`; cada mensaje gasta una. Un cliente normal manda ~32
 * mensajes/s y nunca lo vacía; quien lo vacía recibe `err` `rate` y se le cierra la conexión (eso lo hace el servidor).
 * El reloj llega de fuera (`now`, ms): puro y sin temporizadores.
 */
export class RateLimiter {
  private readonly burst: number;
  private readonly perMs: number;
  private tokens: number;
  private last = Number.NaN;

  constructor(burst: number, perSecond: number) {
    this.burst = burst;
    this.perMs = perSecond / 1000;
    this.tokens = burst;
  }

  /** Gasta una ficha si la hay. Un reloj que va hacia atrás no rellena nada. */
  take(now: number): boolean {
    const dt = now - this.last;
    if (dt > 0) this.tokens = Math.min(this.burst, this.tokens + dt * this.perMs);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
