/**
 * Calibración de latencia (P7, aprobada por el autor): bolas que llegan al centro de tu raqueta por la
 * misma escena 3D que la partida; haces click cuando llegan. El desfase es la mediana de
 * (click − llegada). Mide todo lo que retrasa tu click respecto a la bola real: pantalla, ratón,
 * navegador y tu propia anticipación. Se juega en tiempo de performance.now(), como los eventos del ratón.
 */
import type { GameConfig, Vec3 } from '@ppp/shared';
import { makeRng } from '@ppp/shared';

interface Trial {
  from: Vec3;
  /** Instante de salida (performance.now()). */
  t0: number;
  /** m/ms */
  speed: number;
  /** Instante en que la bola llega al centro de la raqueta. */
  arrive: number;
  /** Distancia total que recorre (pasa de largo un poco). */
  travel: number;
  clicked: boolean;
}

export interface CalibrationResult {
  /** Desfase aplicado (mediana limitada a [min, max]). */
  offsetMs: number;
  /** Mediana sin limitar. */
  medianMs: number;
  samples: number[];
  misses: number;
  clamped: boolean;
  enough: boolean;
}

export class Calibration {
  readonly sweet: Vec3;
  private readonly cfg: GameConfig['input'];
  private readonly rng: () => number;
  private trial: Trial | null = null;
  private nextAt: number;
  private started = 0;
  readonly samples: number[] = [];
  misses = 0;
  /** Desfase del último click (para enseñarlo junto a la raqueta). */
  lastDelta: number | null = null;

  constructor(cfg: GameConfig, sweet: Vec3, now: number, seed = 7) {
    this.cfg = cfg.input;
    this.sweet = sweet;
    this.rng = makeRng(seed);
    this.nextAt = now + 900;
  }

  get total(): number {
    return this.cfg.calibrationTrials;
  }

  /** Número de bola actual (1-based) para el progreso. */
  get index(): number {
    return Math.min(this.total, this.started);
  }

  get done(): boolean {
    return this.started >= this.total && this.trial === null;
  }

  /** Posición de la bola en `t` (o null si no hay bola en juego). */
  ballAt(t: number): Vec3 | null {
    const tr = this.trial;
    if (!tr || t < tr.t0) return null;
    const d = (t - tr.t0) * tr.speed;
    if (d > tr.travel) return null;
    const dx = this.sweet.x - tr.from.x;
    const dy = this.sweet.y - tr.from.y;
    const dz = this.sweet.z - tr.from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return { x: tr.from.x + (dx / len) * d, y: tr.from.y + (dy / len) * d, z: tr.from.z + (dz / len) * d };
  }

  /** Avanza el programa de bolas. */
  update(now: number): void {
    const tr = this.trial;
    if (tr && now > tr.arrive + this.cfg.calibrationRejectMs && now > tr.t0 + tr.travel / tr.speed) {
      if (!tr.clicked) this.misses += 1;
      this.trial = null;
      this.nextAt = now + 600 + this.rng() * 600;
    }
    if (!this.trial && this.started < this.total && now >= this.nextAt) this.launch(now);
  }

  private launch(now: number): void {
    const from = { x: (this.rng() - 0.5) * 0.7, y: this.sweet.y + 0.02 + this.rng() * 0.08, z: -0.9 };
    const speed = (this.cfg.calibrationBallSpeed * (0.85 + this.rng() * 0.3)) / 1000;
    const dx = this.sweet.x - from.x;
    const dy = this.sweet.y - from.y;
    const dz = this.sweet.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.trial = { from, t0: now, speed, arrive: now + dist / speed, travel: dist + 0.5, clicked: false };
    this.started += 1;
  }

  /** Registra un click (timestamp del evento). Devuelve el desfase o null si no cuenta. */
  click(t: number): number | null {
    const tr = this.trial;
    if (!tr || tr.clicked) return null;
    const delta = t - tr.arrive;
    if (Math.abs(delta) > this.cfg.calibrationRejectMs) return null;
    tr.clicked = true;
    this.samples.push(delta);
    this.lastDelta = delta;
    return delta;
  }

  result(): CalibrationResult {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const n = sorted.length;
    const median = n === 0 ? 0 : n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const offset = Math.max(this.cfg.latencyOffsetMin, Math.min(this.cfg.latencyOffsetMax, median));
    return {
      offsetMs: Math.round(offset),
      medianMs: Math.round(median),
      samples: this.samples,
      misses: this.misses,
      clamped: offset !== median,
      enough: n >= Math.ceil(this.total * 0.66),
    };
  }
}

const STORAGE_KEY = 'ppp.latencyOffsetMs';

/** Desfase guardado en este navegador (por dispositivo, como la latencia), o null si no hay. */
export function loadLatencyOffset(): number | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveLatencyOffset(ms: number | null): void {
  try {
    if (ms === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    // Almacenamiento bloqueado (modo privado): el desfase dura solo esta sesión.
  }
}
