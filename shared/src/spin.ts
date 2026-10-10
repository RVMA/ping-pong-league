/**
 * Spin relativo a la dirección de vuelo ↔ vector de spin del mundo [§7.1].
 *
 * El estado de la bola guarda ω en el mundo (rad/s de tiempo de simulación). Para diseñar golpes y para
 * leerlos (trail, "¿por qué fallé?", bot) se usa el spin RELATIVO a la dirección horizontal de vuelo:
 *  - top  > 0: topspin (la parte de arriba avanza; Magnus empuja hacia abajo). top < 0: backspin.
 *  - side > 0: lateral que curva la bola hacia la DERECHA de quien la golpeó.
 * Solo + − × ÷ y Math.sqrt (§17.6).
 */
import type { Vec3 } from './types.ts';

export interface RelSpin {
  top: number;
  side: number;
}

export type SpinKind = 'none' | 'top' | 'back' | 'side';

/**
 * ω del mundo a partir del spin relativo y la dirección horizontal de vuelo (dirX, dirZ), normalizada.
 * Eje del topspin = arriba × dirección = (dirZ, 0, −dirX); lateral a la derecha = ω_y negativo.
 */
export function worldSpin(rel: RelSpin, dirX: number, dirZ: number): Vec3 {
  return { x: rel.top * dirZ, y: -rel.side, z: -rel.top * dirX };
}

/**
 * Spin relativo a la velocidad horizontal actual de la bola (sin velocidad horizontal, top = 0). `out`: objeto a
 * rellenar (el render lo reutiliza en cada frame); sin él, uno nuevo.
 */
export function relativeSpin(spin: Vec3, vel: Vec3, out?: RelSpin): RelSpin {
  const h = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const top = h < 1e-6 ? 0 : (spin.x * vel.z - spin.z * vel.x) / h;
  if (!out) return { top, side: -spin.y };
  out.top = top;
  out.side = -spin.y;
  return out;
}

/** Tipo de efecto dominante (para el trail de color y los textos). Por debajo de `minSpin` rad/s, 'none'. */
export function spinKind(rel: RelSpin, minSpin: number): SpinKind {
  const at = rel.top < 0 ? -rel.top : rel.top;
  const as = rel.side < 0 ? -rel.side : rel.side;
  if (at < minSpin && as < minSpin) return 'none';
  if (as > at) return 'side';
  return rel.top > 0 ? 'top' : 'back';
}
