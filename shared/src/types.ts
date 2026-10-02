/**
 * Tipos compartidos entre cliente, (futuro) servidor y bot.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 0 = jugador en el lado +z (abajo en su pantalla), 1 = jugador en el lado −z. */
export type Side = 0 | 1;

/**
 * Intento de golpe [§3.1]. Es lo ÚNICO que la lógica del juego consume de un dispositivo.
 *
 * Coordenadas relativas al jugador (así el mismo intento sirve para ambos lados y el mundo espejado):
 *  - target.x: lateral en metros, positivo = a la derecha del jugador.
 *  - target.z: profundidad en metros desde la red, positivo = hacia el jugador.
 *  - swing: velocidad del gesto en los últimos ~150 ms, en alturas de pantalla por segundo
 *           (vx positivo = derecha, vy positivo = arriba / hacia la red). Desde V0.2b solo cuenta vx: cruzar la bola.
 *  - fire: instante del disparo (click) en ms de tiempo de juego.
 *  - modifiers: teclas de tipo de golpe mantenidas EN EL INSTANTE DEL CLICK (V0.2b).
 */
/**
 * Teclas de tipo de golpe mantenidas (V0.2b): W topspin, S slice, E smash. Las traduce cada dispositivo
 * (ratón + teclado; en V0.7, botones táctiles). Con ninguna, el golpe es normal.
 */
export interface ShotKeys {
  topspin?: boolean;
  slice?: boolean;
  smash?: boolean;
}

export interface InputIntent {
  target: { x: number; z: number };
  swing: { vx: number; vy: number };
  fire?: number;
  block: boolean;
  special?: number;
  specialServe: boolean;
  modifiers?: ShotKeys;
}

export function neutralIntent(depth = 1.6): InputIntent {
  return { target: { x: 0, z: depth }, swing: { vx: 0, vy: 0 }, block: false, specialServe: false };
}

/** +1 para el lado 0 (mira hacia −z), −1 para el lado 1. Convierte coordenadas de jugador ↔ mundo. */
export function sideSign(side: Side): 1 | -1 {
  return side === 0 ? 1 : -1;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function copyVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}
