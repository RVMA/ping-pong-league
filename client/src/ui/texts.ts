/**
 * Textos de fin de punto desde el punto de vista del jugador humano (lado 0).
 * Incluye una versión mínima de "¿por qué fallé?" para los errores propios en la red.
 */
import type { HitEvaluation, PointReason, Side } from '@ppp/shared';

export interface LastHumanHit {
  evaluation: HitEvaluation;
  /** Altura del contacto sobre la mesa (m). */
  contactHeight: number;
}

export function pointText(winner: Side, reason: PointReason, last: LastHumanHit | null, lowContactRef: number, whiffed: boolean): string {
  const mine = winner === 0;
  switch (reason) {
    case 'NET':
      return mine ? 'Punto. El bot la dejó en la red.' : `Red. ${whyNet(last, lowContactRef)}`.trim();
    case 'OUT':
      return mine ? 'Punto. La bola del bot salió fuera.' : `Fuera. ${last?.evaluation.causes.includes('EDGE') ? 'Golpe con el borde: se desvió.' : ''}`.trim();
    case 'OWN_SIDE':
      return mine ? 'Punto. El bot botó en su propio campo.' : 'La bola botó en tu campo.';
    case 'DOUBLE_BOUNCE':
      return mine ? 'Punto. Doble bote en el campo del bot.' : 'Doble bote en tu campo.';
    case 'MISSED':
      return mine ? 'Punto. El bot no la devolvió.' : whiffed ? 'Fallaste el golpe.' : 'No llegaste a golpearla.';
    case 'VOLLEY':
      return mine ? 'Punto. El bot golpeó antes del bote.' : 'Golpeaste antes de que botara en tu campo.';
    case 'SERVE_FAULT':
      return mine ? 'Punto. Falta de saque del bot.' : 'Falta de saque.';
    case 'TOSS_MISSED':
      return mine ? 'Punto. El bot no golpeó su saque.' : 'No golpeaste el saque.';
  }
}

function whyNet(last: LastHumanHit | null, lowContactRef: number): string {
  if (!last) return '';
  const c = last.evaluation.causes;
  if (c.includes('EARLY')) return 'Golpeaste pronto: la bola sale más baja.';
  if (last.contactHeight < lowContactRef) return 'La cogiste muy baja: poco margen sobre la red.';
  if (c.includes('EDGE')) return 'Golpe con el borde.';
  return '';
}
