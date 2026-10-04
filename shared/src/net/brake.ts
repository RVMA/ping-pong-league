/**
 * Reloj de visualización de un vuelo [§17.2]: qué instante del vuelo (d, ms) se dibuja cuando han pasado u ms reales
 * desde que empezó para este jugador. Para el vuelo que te llega es la identidad (lo ves y lo mides a velocidad real).
 * Para la bola que se aleja, se frena poco a poco: normal cerca de ti y más lenta hacia el rival, para llegar a su
 * zona de golpe cuando se espera su golpe (tu ping + el suyo). El freno tiene un límite (`minSpeed`).
 *
 * Tramos de velocidad lineal en u: d(u) = d0 + s0·(u − u0) + a·(u − u0)²/2. El último tramo no acaba. Solo + − × ÷;
 * no asigna memoria al consultarlo (se dibuja cada frame).
 */

export interface BrakeConfig {
  startFrac: number;
  minSpeed: number;
  catchUpMs: number;
  rampBackMs: number;
}

const MAX_SEGMENTS = 8;
/** Campos por tramo: u0, d0, s0, a, u1. */
const F = 5;

export class DisplayClock {
  private readonly seg = new Float64Array(MAX_SEGMENTS * F);
  private n = 0;
  private identity = true;

  constructor() {
    this.reset();
  }

  /** Identidad: velocidad real. */
  reset(): void {
    this.n = 0;
    this.add(0, 0, 1, 0, Number.POSITIVE_INFINITY);
    this.identity = true;
  }

  get isIdentity(): boolean {
    return this.identity;
  }

  private add(u0: number, d0: number, s0: number, a: number, u1: number): void {
    if (this.n >= MAX_SEGMENTS) {
      // Sin hueco: se funde con el último (nunca ocurre con los usos previstos: plan + 2 cambios).
      this.n = MAX_SEGMENTS - 1;
    }
    const o = this.n * F;
    this.seg[o] = u0;
    this.seg[o + 1] = d0;
    this.seg[o + 2] = s0;
    this.seg[o + 3] = a;
    this.seg[o + 4] = u1;
    this.n++;
  }

  private find(u: number): number {
    for (let i = 0; i < this.n; i++) if (u < this.seg[i * F + 4]) return i;
    return this.n - 1;
  }

  /** Instante del vuelo que se dibuja en u (ms reales desde que empezó). */
  at(u: number): number {
    if (u <= 0) return u;
    const o = this.find(u) * F;
    const du = u - this.seg[o];
    return this.seg[o + 1] + this.seg[o + 2] * du + this.seg[o + 3] * du * du * 0.5;
  }

  /** Velocidad de la visualización (ms de vuelo por ms real) en u. */
  speedAt(u: number): number {
    if (u <= 0) return this.seg[2];
    const o = this.find(u) * F;
    return this.seg[o + 2] + this.seg[o + 3] * (u - this.seg[o]);
  }

  /** Velocidad más baja de lo planificado (para medir el frenado). */
  minPlannedSpeed(): number {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.n; i++) {
      const o = i * F;
      const s0 = this.seg[o + 2];
      const len = this.seg[o + 4] - this.seg[o];
      const s1 = Number.isFinite(len) ? s0 + this.seg[o + 3] * len : s0;
      min = Math.min(min, s0, s1);
    }
    return min;
  }

  /** Corta el plan en u: el tramo que contiene u acaba ahí y se borran los siguientes. Devuelve (d, s) en u. */
  private cut(u: number): { d: number; s: number } {
    const d = this.at(u);
    const s = this.speedAt(u);
    const i = this.find(u);
    this.n = i + 1;
    this.seg[i * F + 4] = u;
    if (this.seg[i * F] >= u) this.n = i; // el tramo empezaba justo en u: se sustituye entero
    if (this.n === 0) {
      // Antes del primer tramo (u ≤ 0): se parte de la identidad.
      return { d: u, s: 1 };
    }
    return { d, s };
  }

  /**
   * Plan de frenado desde el inicio del vuelo: llegar a `tExpMs` (contacto esperado del rival) en `tExpMs + extraMs`.
   * Velocidad 1 hasta startFrac·tExp; después baja linealmente. Si haría falta bajar de minSpeed, baja hasta
   * minSpeed (a mitad del camino que queda) y la mantiene: llega antes. Tras el contacto esperado, sostiene la
   * velocidad final hasta que llegue el golpe o el punto.
   */
  planBrake(tExpMs: number, extraMs: number, cfg: BrakeConfig): void {
    this.reset();
    if (!(extraMs > 0) || !(tExpMs > 0)) return;
    this.identity = false;
    const u1 = cfg.startFrac * tExpMs;
    const U = tExpMs + extraMs;
    const dist = tExpMs - u1;
    const sEnd = (2 * dist) / (U - u1) - 1;
    this.n = 0;
    this.add(0, 0, 1, 0, u1);
    if (sEnd >= cfg.minSpeed) {
      this.add(u1, u1, 1, (sEnd - 1) / (U - u1), U);
      this.add(U, tExpMs, sEnd, 0, Number.POSITIVE_INFINITY);
      return;
    }
    const m = cfg.minSpeed;
    const R = dist / (1 + m);
    this.add(u1, u1, 1, (m - 1) / R, u1 + R);
    this.add(u1 + R, u1 + ((1 + m) / 2) * R, m, 0, Number.POSITIVE_INFINITY);
  }

  /**
   * Desde el estado en u, llegar a mostrar `dTarget` en `uTarget` con la velocidad cambiando linealmente (si eso
   * exigiera velocidad negativa, a velocidad constante). Después sigue a la velocidad final.
   */
  retarget(u: number, dTarget: number, uTarget: number): void {
    const { d, s } = this.cut(u);
    this.identity = false;
    const span = uTarget - u;
    const gap = dTarget - d;
    if (!(span > 1e-6) || !(gap > 0)) {
      this.add(u, d, s, 0, Number.POSITIVE_INFINITY);
      return;
    }
    const s1 = (2 * gap) / span - s;
    if (s1 >= 0) {
      this.add(u, d, s, (s1 - s) / span, uTarget);
      this.add(uTarget, dTarget, s1, 0, Number.POSITIVE_INFINITY);
    } else {
      const v = gap / span;
      this.add(u, d, v, 0, uTarget);
      this.add(uTarget, dTarget, v, 0, Number.POSITIVE_INFINITY);
    }
  }

  /** Vuelve a velocidad real (1) en `rampMs` desde u, sin salto. */
  resume(u: number, rampMs: number): void {
    const { d, s } = this.cut(u);
    if (!(rampMs > 0)) {
      this.add(u, d, 1, 0, Number.POSITIVE_INFINITY);
      return;
    }
    this.add(u, d, s, (1 - s) / rampMs, u + rampMs);
    this.add(u + rampMs, d + ((s + 1) / 2) * rampMs, 1, 0, Number.POSITIVE_INFINITY);
  }
}
