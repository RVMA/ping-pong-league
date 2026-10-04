/**
 * Hash de la config [§17.1, §17.6]: cliente y servidor deben simular con exactamente los mismos valores. El cliente
 * lo envía al conectarse y el servidor rechaza la conexión si no coincide. Se excluyen las secciones que solo
 * afectan a la presentación (`presentation`, `feedback`): cambiarlas no cambia el juego.
 */
import type { GameConfig } from '../config.ts';

const PRESENTATION_ONLY = new Set(['presentation', 'feedback']);

/** JSON con las claves de cada objeto ordenadas (los arrays conservan su orden). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a de 32 bits sobre el JSON canónico de las secciones de juego, en 8 caracteres hexadecimales. */
export function configHash(cfg: GameConfig): string {
  const game: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) if (!PRESENTATION_ONLY.has(k)) game[k] = v;
  const text = canonicalJson(game);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
