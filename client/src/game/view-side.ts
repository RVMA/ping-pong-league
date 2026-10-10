/**
 * El lado del jugador local en la presentación (V0.4, §2.1 P59) y la puesta al día en red. Piezas puras, sin DOM ni
 * Three.js, para poder probarlas sueltas:
 *  - el lado 1 ve la mesa desde su extremo: el mundo girado 180° sobre el eje vertical (x y z cambian de signo), no
 *    reflejado, así que los textos se leen bien y el slice curva hacia el mismo lado físico en las dos pantallas;
 *  - en el marcador «Tú» va siempre a la izquierda: la casilla 0 es la del jugador local, la 1 la del rival (§15);
 *  - el marcador de bote se ve en práctica (contra el bot, en local o en red, y en el warm-up de una sala), nunca en el
 *    partido (§2.2);
 *  - en red, tras un tirón largo (pestaña que vuelve a verse) la vista se pone al día por tramos.
 */
import type { Side } from '@ppp/shared';

/** Un punto del mundo visto desde el lado `side`: el del lado 1, girado 180° sobre el eje vertical (x y z con otro signo). */
export function viewPoint(side: Side, p: readonly [number, number, number]): [number, number, number] {
  const flip = (v: number) => (side === 0 || v === 0 ? v : -v);
  return [flip(p[0]), p[1], flip(p[2])];
}

/** Casilla del marcador de un lado: 0 (izquierda) la del jugador local, 1 (derecha) la del rival. */
export function seatOf(side: Side, me: Side): 0 | 1 {
  return side === me ? 0 : 1;
}

/** El lado que se dibuja en la casilla `seat` (la inversa de seatOf). */
export function sideAt(seat: 0 | 1, me: Side): Side {
  return seat === 0 ? me : me === 0 ? 1 : 0;
}

/** Un par por lado como [yo, rival] (para tablas y listas de la sala; no se usa en cada frame). */
export function mineFirst<T>(pair: readonly [T, T], me: Side): [T, T] {
  return [pair[me], pair[me === 0 ? 1 : 0]];
}

/** Marcador de bote (§2.2): fuera de una sala, siempre; en una sala, solo en el warm-up (la vista en práctica). */
export function bounceMarkerShown(inRoom: boolean, practice: boolean): boolean {
  return !inRoom || practice;
}

/** En red, más atrás que esto (ms) la vista se pone al día por tramos… */
export const CATCH_UP_GAP_MS = 2000;
/** …de como mucho estos ticks por frame (2 s de partida a 120 Hz). */
export const CATCH_UP_TICKS = 240;

/**
 * Ticks que puede avanzar la vista en este frame, yendo `behindMs` por detrás del reloj de la partida. En red, si va
 * más de 2 s atrás (la pestaña estuvo oculta y el bucle parado), como mucho 240: así ningún frame se congela y la vista
 * llega al presente en unos pocos frames. Si no, todos los que falten (en local el tirón ya se descartó).
 */
export function tickBudget(online: boolean, behindMs: number): number {
  return online && behindMs > CATCH_UP_GAP_MS ? CATCH_UP_TICKS : Number.POSITIVE_INFINITY;
}
