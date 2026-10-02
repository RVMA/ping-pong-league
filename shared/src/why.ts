/**
 * "¿Por qué fallé?" [§2.2]: causa con nombre de un error propio, sacada del desglose de los objetivos del
 * golpe (shot.ts guarda cada objetivo como suma de partes con nombre). Lógica pura y determinista: el cliente
 * solo traduce la causa a texto.
 *
 *  - Red: la parte que más restó al margen sobre la red (pronto, bola baja, potencia, smash bajo…).
 *  - Fuera: si el bote pedido salía por la banda, la parte que más empujó hacia fuera (ángulo al golpear
 *    pronto, borde); si salía por el fondo, la que más alargó (potencia tarde, topspin bloqueado).
 *  - No devuelta: el fallo al aire (pronto, tarde, fuera de la raqueta, fuera de alcance) o que no hubo click.
 */
import type { GameConfig } from './config.ts';
import type { ShotType } from './gesture.ts';
import type { HitEvaluation } from './hit.ts';
import type { PointReason } from './rules.ts';
import type { ShotTargets } from './shot.ts';

export type WhyCause =
  // Red
  | 'EARLY'
  | 'LOW_CONTACT'
  | 'TOPSPIN_LOW'
  | 'TOPSPIN_POWER'
  | 'POWER'
  | 'SLICE_MARGIN'
  | 'CROSS_MARGIN'
  | 'SMASH_LOW'
  | 'SMASH_EARLY'
  | 'BLOCK_EARLY'
  | 'BLOCK_BACKSPIN'
  | 'BLOCK_FAST_LOW'
  | 'EDGE'
  // Fuera por la banda
  | 'CROSS_EARLY'
  | 'SLICE_EARLY'
  | 'SLICE_ANGLE'
  | 'EDGE_WIDE'
  // Fuera por el fondo
  | 'POWER_LATE'
  | 'POWER_LONG'
  | 'BLOCK_TOPSPIN'
  // No devuelta
  | 'WHIFF_EARLY'
  | 'WHIFF_LATE'
  | 'WHIFF_POSITION'
  | 'WHIFF_REACH'
  | 'WHIFF_NO_BALL'
  | 'NO_CLICK'
  | 'UNKNOWN';

export interface WhyResult {
  cause: WhyCause;
  shot: ShotType | null;
  /** Δt del golpe o del fallo (ms), cuando ayuda a entenderlo. */
  dtMs?: number;
  /** Parte inferior de la bola sobre la cinta en el contacto (m), para el smash. */
  aboveTape?: number;
  /** Altura del contacto sobre la mesa (m). */
  contactHeight?: number;
}

export interface WhyInput {
  reason: PointReason;
  /** Último golpe en este punto de quien lo pierde (null si no golpeó). */
  lastHit: { targets: ShotTargets; evaluation: HitEvaluation; contactHeight: number } | null;
  /** Último fallo al aire en este punto de quien lo pierde: su evaluación (null = golpeó sin bola cerca). */
  whiff?: HitEvaluation | null;
  /** Hubo fallo al aire en este punto. */
  whiffed: boolean;
}

/** Diagnostica un punto perdido por error propio. null si el motivo no lo necesita (volea, saque…). */
export function diagnose(inp: WhyInput, cfg: GameConfig): WhyResult | null {
  const last = inp.lastHit;
  if (inp.reason === 'MISSED' || inp.reason === 'DOUBLE_BOUNCE') return diagnoseMissed(inp, cfg);
  if (!last || (inp.reason !== 'NET' && inp.reason !== 'OUT')) return null;
  const t = last.targets;
  const base: WhyResult = { cause: 'UNKNOWN', shot: t.serve ? null : t.type, dtMs: last.evaluation.dtMs, contactHeight: last.contactHeight };
  if (inp.reason === 'NET') return { ...base, cause: netCause(t, last.evaluation), aboveTape: t.aboveTape };
  return { ...base, cause: outCause(t, last.evaluation, cfg) };
}

function netCause(t: ShotTargets, ev: HitEvaluation): WhyCause {
  const c = t.parts.clearance;
  if (t.type === 'BLOCK' && (c.base ?? 0) < 0 && (c.base ?? 0) <= minOf(c.timing, c.blockSpin)) return 'BLOCK_FAST_LOW';
  const candidates: [WhyCause, number | undefined][] = [
    [t.type === 'SMASH' ? 'SMASH_EARLY' : t.type === 'BLOCK' ? 'BLOCK_EARLY' : 'EARLY', c.timing],
    [t.type === 'TOPSPIN' ? 'TOPSPIN_LOW' : 'LOW_CONTACT', c.lowContact],
    [t.type === 'TOPSPIN' ? 'TOPSPIN_POWER' : t.type === 'SLICE' ? 'SLICE_MARGIN' : 'POWER', c.power],
    ['TOPSPIN_POWER', c.topspin],
    ['SLICE_MARGIN', c.slice],
    [t.type === 'SLICE' ? 'SLICE_MARGIN' : 'CROSS_MARGIN', c.angle],
    ['SMASH_LOW', c.smashLow],
    ['BLOCK_BACKSPIN', c.blockSpin],
  ];
  // Varias partes de la misma causa (p. ej. potencia + topspin) se suman.
  const total = new Map<WhyCause, number>();
  for (const [cause, v] of candidates) if (v !== undefined && v < 0) total.set(cause, (total.get(cause) ?? 0) + v);
  let best: WhyCause | null = null;
  let worst = 0;
  for (const [cause, v] of total) {
    if (v < worst) {
      worst = v;
      best = cause;
    }
  }
  if (best) return best;
  return ev.posFrac >= 0.5 ? 'EDGE' : 'UNKNOWN';
}

function minOf(...v: (number | undefined)[]): number {
  let m = 0;
  for (const x of v) if (x !== undefined && x < m) m = x;
  return m;
}

function outCause(t: ShotTargets, ev: HitEvaluation, cfg: GameConfig): WhyCause {
  const halfW = cfg.world.tableWidth / 2;
  const halfL = cfg.world.tableLength / 2;
  if (Math.abs(t.landing.x) > halfW) {
    // Partes que empujaron hacia el lado por el que salió (coordenadas de quien golpea).
    const l = t.parts.lateral;
    const dir = (l.base ?? 0) + (l.aim ?? 0) + (l.angleRisk ?? 0) + (l.edge ?? 0) >= 0 ? 1 : -1;
    const push: [WhyCause, number][] = [
      [t.type === 'SLICE' ? 'SLICE_EARLY' : 'CROSS_EARLY', (l.angleRisk ?? 0) * dir],
      ['EDGE_WIDE', (l.edge ?? 0) * dir],
      ['SLICE_ANGLE', t.type === 'SLICE' ? (l.aim ?? 0) * dir * 0.25 : 0],
    ];
    push.sort((a, b) => b[1] - a[1]);
    return push[0][1] > 0 ? push[0][0] : ev.posFrac >= 0.5 ? 'EDGE_WIDE' : 'UNKNOWN';
  }
  if (Math.abs(t.landing.z) > halfL) {
    const d = t.parts.depth;
    const push: [WhyCause, number][] = [
      ['POWER_LATE', d.powerLate ?? 0],
      ['BLOCK_TOPSPIN', d.blockSpin ?? 0],
      ['POWER_LONG', d.power ?? 0],
    ];
    push.sort((a, b) => b[1] - a[1]);
    return push[0][1] > 0 ? push[0][0] : 'UNKNOWN';
  }
  return ev.posFrac >= 0.5 ? 'EDGE_WIDE' : 'UNKNOWN';
}

function diagnoseMissed(inp: WhyInput, cfg: GameConfig): WhyResult {
  if (!inp.whiffed) return { cause: 'NO_CLICK', shot: null };
  const w = inp.whiff;
  if (!w) return { cause: 'WHIFF_NO_BALL', shot: null };
  if (w.timingTier === 'WHIFF') return { cause: w.dtMs < 0 ? 'WHIFF_EARLY' : 'WHIFF_LATE', shot: null, dtMs: w.dtMs };
  if (w.causes.includes('OUT_OF_REACH')) return { cause: 'WHIFF_REACH', shot: null, contactHeight: w.ballAtIdeal.y - cfg.world.tableHeight };
  return { cause: 'WHIFF_POSITION', shot: null, dtMs: w.dtMs };
}
