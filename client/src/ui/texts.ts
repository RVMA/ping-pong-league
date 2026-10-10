/**
 * Textos de fin de punto desde el punto de vista del jugador local (sea cual sea su lado) y "¿por qué fallé?" completo
 * [§2.2]: la causa la diagnostica @ppp/shared (why.ts) a partir del desglose del golpe; aquí solo se redacta,
 * con números cuando ayudan a entenderla (ms de timing, cm sobre la cinta). El rival es «el bot» (en local y contra el
 * bot remoto) o «el rival» (en una sala, V0.4).
 */
import { type PointReason, type PowerLevel, type ShotType, SIDE_TEXT, type StrokeNote, type WhyResult } from '@ppp/shared';

/** Cómo se nombra al rival en los textos: «el bot» o «el rival» (los dos con «el»: «del bot», «del rival»). */
export type RivalNoun = 'bot' | 'rival';

const ms = (v: number | undefined) => (v === undefined ? '' : ` (${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))} ms)`);
const cm = (m: number | undefined) => (m === undefined ? '?' : `${Math.max(0, Math.round(m * 100))}`);

/** Frase de la causa (sin el "Red." / "Fuera." inicial). */
export function whyText(w: WhyResult, smashMinAboveTape: number): string {
  switch (w.cause) {
    case 'EARLY':
      return `Golpeaste pronto${ms(w.dtMs)}: la bola sale más baja.`;
    case 'LOW_CONTACT':
      return `La cogiste muy baja (${cm(w.contactHeight)} cm sobre la mesa): poco margen sobre la red.`;
    case 'TOPSPIN_LOW':
      return `Topspin desde una bola muy baja (${cm(w.contactHeight)} cm sobre la mesa): la bola cae antes.`;
    case 'TOPSPIN_POWER':
      return 'Topspin demasiado fuerte: la bola bajó antes de la red.';
    case 'POWER':
      return 'Golpe demasiado fuerte: menos margen sobre la red.';
    case 'SLICE_MARGIN':
      return 'Slice con poco margen sobre la red.';
    case 'CROSS_MARGIN':
      return 'Cruzar a tope resta margen sobre la red.';
    case 'SMASH_LOW':
      return (w.aboveTape ?? 0) < 0.005
        ? `Smash con la bola por debajo de la cinta (hacen falta ${cm(smashMinAboveTape)} cm por encima).`
        : `Smash con la bola baja: ${cm(w.aboveTape)} cm sobre la cinta (hacen falta ${cm(smashMinAboveTape)}).`;
    case 'SMASH_EARLY':
      return `Smash pronto${ms(w.dtMs)}: bajó demasiado empinado.`;
    case 'BLOCK_EARLY':
      return `Bloqueaste pronto${ms(w.dtMs)}: la bola salió corta y baja.`;
    case 'BLOCK_BACKSPIN':
      return 'Bloqueaste una bola cortada (backspin) sin absorberla: se hundió.';
    case 'BLOCK_FAST_LOW':
      return 'Bloqueaste una bola muy rápida cogiéndola baja: no pasó.';
    case 'EDGE':
      return 'Golpe con el borde.';
    case 'CROSS_EARLY':
      return 'Cruzaste golpeando pronto: te pasaste de ángulo.';
    case 'SLICE_EARLY':
      return `Slice pronto${ms(w.dtMs)}: te pasaste de ángulo.`;
    case 'SLICE_ANGLE':
      return 'Slice demasiado abierto: se fue por la banda.';
    case 'EDGE_WIDE':
      return 'Golpe con el borde: se desvió.';
    case 'POWER_LATE':
      return w.shot === 'TOPSPIN' ? `Topspin tarde${ms(w.dtMs)}: se te fue largo.` : `Golpe fuerte y tarde${ms(w.dtMs)}: se te fue largo.`;
    case 'POWER_LONG':
      return 'Demasiada potencia: se fue largo.';
    case 'BLOCK_TOPSPIN':
      return 'Bloqueaste un topspin sin absorberlo: se fue largo.';
    case 'WHIFF_EARLY':
      return `Fallaste el golpe: click ${Math.round(Math.abs(w.dtMs ?? 0))} ms pronto.`;
    case 'WHIFF_LATE':
      return `Fallaste el golpe: click ${Math.round(Math.abs(w.dtMs ?? 0))} ms tarde.`;
    case 'WHIFF_POSITION':
      return 'Fallaste el golpe: la bola pasó fuera de tu raqueta.';
    case 'WHIFF_REACH':
      return 'Fallaste el golpe: la bola iba fuera de tu alcance (demasiado alta o baja).';
    case 'WHIFF_NO_BALL':
      return 'Fallaste el golpe: hiciste click sin la bola cerca.';
    case 'NO_CLICK':
      return 'No llegaste a golpearla.';
    case 'TABLE_SIDE':
      return SIDE_TEXT;
    case 'UNKNOWN':
      return '';
  }
}

/** Contexto de "no la devolviste": qué hizo la bola del rival. */
function rivalShotText(shot: ShotType | null, rival: RivalNoun): string {
  switch (shot) {
    case 'SMASH':
      return ` Smash del ${rival}: muy rápido.`;
    case 'TOPSPIN':
      return ` Topspin del ${rival}: tras botar sale más rápida y baja.`;
    case 'SLICE':
      return ` Slice del ${rival}: curva al botar.`;
    default:
      return '';
  }
}

export interface PointTextInput {
  /** El punto es del jugador local. */
  mine: boolean;
  reason: PointReason;
  /** Diagnóstico del error propio (null si no aplica o si "¿por qué fallé?" está desactivado). */
  why: WhyResult | null;
  /** Último golpe del rival en el punto (contexto de "no la devolviste"). */
  rivalShot: ShotType | null;
  smashMinAboveTape: number;
  /** «el bot» (por defecto) o «el rival» (en una sala). */
  rival?: RivalNoun;
}

export function pointText(p: PointTextInput): string {
  const mine = p.mine;
  const r = p.rival ?? 'bot';
  const El = `El ${r}`;
  const why = p.why ? whyText(p.why, p.smashMinAboveTape) : '';
  switch (p.reason) {
    case 'NET':
      return mine ? `Punto. ${El} la dejó en la red.` : `Red. ${why}`.trim();
    case 'OUT':
      return mine ? `Punto. La bola del ${r} salió fuera.` : `Fuera. ${why}`.trim();
    case 'OWN_SIDE':
      return mine ? `Punto. ${El} botó en su propio campo.` : `La bola botó en tu campo. ${why}`.trim();
    case 'DOUBLE_BOUNCE':
      return mine ? `Punto. Doble bote en el campo del ${r}.` : `Doble bote en tu campo. ${p.why ? why + rivalShotText(p.rivalShot, r) : ''}`.trim();
    case 'MISSED':
      if (mine) return `Punto. ${El} no la devolvió.`;
      if (!p.why) return 'No la devolviste.';
      return `${why}${p.why.cause === 'NO_CLICK' ? rivalShotText(p.rivalShot, r) : ''}`.trim();
    case 'VOLLEY':
      return mine ? `Punto. ${El} golpeó antes del bote.` : 'Golpeaste antes de que botara en tu campo.';
    case 'SERVE_FAULT':
      return mine ? `Punto. Falta de saque del ${r}.` : 'Falta de saque.';
    case 'SIDE':
      return mine ? `Punto. La bola del ${r} tocó el lateral de la mesa.` : why || SIDE_TEXT;
    case 'TOSS_MISSED':
      return mine ? `Punto. ${El} no golpeó su saque.` : 'No golpeaste el saque.';
  }
}

const LEVEL_TEXT: Record<PowerLevel, string> = { FULL: 'completo', REDUCED: 'reducido', WEAK: 'flojo' };
const NOTE_TEXT: Record<StrokeNote, string> = { CHASING: 'persiguiendo', SMASH_LOW: 'bola baja para el smash' };
const SHOT_UPPER: Record<ShotType, string> = { NORMAL: 'NORMAL', TOPSPIN: 'TOPSPIN', SLICE: 'SLICE', SMASH: 'SMASH', BLOCK: 'BLOQUEO' };

export function powerLevelText(level: PowerLevel): string {
  return LEVEL_TEXT[level];
}

/**
 * Segunda línea del mensaje del golpe propio (V0.2b): qué salió y con qué fuerza, y por qué salió distinto de lo
 * pedido. «TOPSPIN completo», «SLICE reducido · persiguiendo», «SMASH completo · bola baja para el smash»,
 * «NORMAL · pulsaste W después del click». Sin nada que contar (golpe normal), undefined.
 */
export function strokeText(type: ShotType, d: { level: PowerLevel | null; notes: StrokeNote[] }, keyNote?: string | null): string | undefined {
  if (type === 'BLOCK') return SHOT_UPPER.BLOCK;
  if (type === 'NORMAL') return keyNote ? `NORMAL · ${keyNote}` : undefined;
  const head = d.level ? `${SHOT_UPPER[type]} ${LEVEL_TEXT[d.level]}` : SHOT_UPPER[type];
  return [head, ...d.notes.map((n) => NOTE_TEXT[n])].join(' · ');
}

/** Aviso de la tecla de golpe que no estaba pulsada en el instante del click. */
export function keyMissText(k: { key: string; after: boolean }): string {
  return k.after ? `pulsaste ${k.key} después del click` : `soltaste ${k.key} antes del click`;
}

/** Nombre corto del tipo de golpe para la etiqueta junto a la raqueta y el panel D. */
export const SHOT_LABEL: Record<ShotType, string> = {
  NORMAL: 'Normal',
  TOPSPIN: 'Topspin',
  SLICE: 'Slice',
  SMASH: 'Smash',
  BLOCK: 'Bloqueo',
};
