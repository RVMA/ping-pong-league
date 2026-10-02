/**
 * Textos de fin de punto desde el punto de vista del jugador humano (lado 0) y "¿por qué fallé?" completo
 * [§2.2]: la causa la diagnostica @ppp/shared (why.ts) a partir del desglose del golpe; aquí solo se redacta,
 * con números cuando ayudan a entenderla (ms de timing, cm sobre la cinta).
 */
import type { PointReason, ShotType, Side, WhyResult } from '@ppp/shared';

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
      return `Golpe fuerte y tarde${ms(w.dtMs)}: se te fue largo.`;
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
    case 'UNKNOWN':
      return '';
  }
}

/** Contexto de "no la devolviste": qué hizo la bola del rival. */
function rivalShotText(shot: ShotType | null): string {
  switch (shot) {
    case 'SMASH':
      return ' Smash del bot: muy rápido.';
    case 'TOPSPIN':
      return ' Topspin del bot: tras botar sale más rápida y baja.';
    case 'SLICE':
      return ' Slice del bot: curva al botar.';
    default:
      return '';
  }
}

export interface PointTextInput {
  winner: Side;
  reason: PointReason;
  /** Diagnóstico del error propio (null si no aplica o si "¿por qué fallé?" está desactivado). */
  why: WhyResult | null;
  /** Último golpe del bot en el punto (contexto de "no la devolviste"). */
  rivalShot: ShotType | null;
  smashMinAboveTape: number;
}

export function pointText(p: PointTextInput): string {
  const mine = p.winner === 0;
  const why = p.why ? whyText(p.why, p.smashMinAboveTape) : '';
  switch (p.reason) {
    case 'NET':
      return mine ? 'Punto. El bot la dejó en la red.' : `Red. ${why}`.trim();
    case 'OUT':
      return mine ? 'Punto. La bola del bot salió fuera.' : `Fuera. ${why}`.trim();
    case 'OWN_SIDE':
      return mine ? 'Punto. El bot botó en su propio campo.' : `La bola botó en tu campo. ${why}`.trim();
    case 'DOUBLE_BOUNCE':
      return mine ? 'Punto. Doble bote en el campo del bot.' : `Doble bote en tu campo. ${p.why ? why + rivalShotText(p.rivalShot) : ''}`.trim();
    case 'MISSED':
      if (mine) return 'Punto. El bot no la devolvió.';
      if (!p.why) return 'No la devolviste.';
      return `${why}${p.why.cause === 'NO_CLICK' ? rivalShotText(p.rivalShot) : ''}`.trim();
    case 'VOLLEY':
      return mine ? 'Punto. El bot golpeó antes del bote.' : 'Golpeaste antes de que botara en tu campo.';
    case 'SERVE_FAULT':
      return mine ? 'Punto. Falta de saque del bot.' : 'Falta de saque.';
    case 'TOSS_MISSED':
      return mine ? 'Punto. El bot no golpeó su saque.' : 'No golpeaste el saque.';
  }
}

/** Nombre corto del tipo de golpe para la etiqueta junto a la raqueta y el panel D. */
export const SHOT_LABEL: Record<ShotType, string> = {
  NORMAL: 'Normal',
  TOPSPIN: 'Topspin',
  SLICE: 'Slice',
  SMASH: 'Smash',
  BLOCK: 'Bloqueo',
};
