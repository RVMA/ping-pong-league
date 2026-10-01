/**
 * Estadísticas de precisión de los últimos golpes del jugador (panel D).
 * Responden a las preguntas del playtest: ¿tiendo a pronto o a tarde? ¿fallo PERFECT por timing o por posición?
 */
import { type HitEvaluation, TIER_RANK } from '@ppp/shared';

export interface SwingSample {
  evaluation: HitEvaluation;
  aimFactor: number | null;
}

/** Clicks muy lejos de la bola (por ejemplo +284 ms) no son un sesgo de latencia: se excluyen de la media. */
const BIAS_LIMIT_MS = 200;

export class PrecisionStats {
  private readonly samples: SwingSample[] = [];
  private readonly size: number;

  constructor(size = 20) {
    this.size = size;
  }

  add(s: SwingSample): void {
    this.samples.push(s);
    if (this.samples.length > this.size) this.samples.shift();
  }

  get last(): SwingSample | null {
    return this.samples.length ? this.samples[this.samples.length - 1] : null;
  }

  rows(): [string, string][] {
    const n = this.samples.length;
    if (n === 0) return [[`Últimos ${this.size}`, 'sin golpes todavía']];
    const evals = this.samples.map((s) => s.evaluation);
    const perfect = evals.filter((e) => e.tier === 'PERFECT').length;
    const near = evals.filter((e) => Math.abs(e.dtMs) <= BIAS_LIMIT_MS);
    const mean = near.length ? near.reduce((a, e) => a + e.dtMs, 0) / near.length : 0;
    const bias = mean > 10 ? 'tiendes a tarde' : mean < -10 ? 'tiendes a pronto' : 'centrado';
    const early = near.filter((e) => e.timingTier !== 'PERFECT' && e.dtMs < 0).length;
    const late = near.filter((e) => e.timingTier !== 'PERFECT' && e.dtMs > 0).length;
    let byTiming = 0;
    let byPosition = 0;
    let both = 0;
    for (const e of evals) {
      if (e.tier === 'PERFECT') continue;
      const t = TIER_RANK[e.timingTier];
      const p = TIER_RANK[e.positionTier];
      if (t < TIER_RANK.PERFECT && p < TIER_RANK.PERFECT) both++;
      else if (t < TIER_RANK.PERFECT) byTiming++;
      else byPosition++;
    }
    const meanPos = evals.reduce((a, e) => a + e.posFrac, 0) / n;
    const fmt = (v: number) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0));
    return [
      [`Últimos ${n}`, `PERFECT ${Math.round((100 * perfect) / n)} %`],
      ['Δt medio', near.length ? `${fmt(mean)} ms (${bias})` : '—'],
      ['Pronto / tarde', `${early} / ${late}`],
      ['Sin PERFECT por', `timing ${byTiming}, posición ${byPosition}, ambos ${both}`],
      ['Posición media', `${Math.round(meanPos * 100)} % del radio`],
    ];
  }
}
