/**
 * Manifiesto ÚNICO de assets [§18]. Rutas fijas relativas a esta carpeta (client/src/assets/).
 *
 * Para sustituir un asset basta con reemplazar el archivo con el mismo nombre: no se toca código.
 * Para añadir un sonido, deja `sfx/<nombre>.ogg` (o `.mp3`) con uno de los nombres de SFX_NAMES;
 * si no existe, el juego lo sintetiza con WebAudio.
 *
 * Los archivos se descubren en compilación con import.meta.glob, así que nunca se pide al
 * servidor un archivo que no existe.
 */

const files = import.meta.glob('./**/*.{png,jpg,jpeg,webp,ogg,mp3,wav}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** URL servible de un asset por su ruta del manifiesto, o null si el archivo no existe. */
export function assetUrl(path: string): string | null {
  return files[`./${path}`] ?? null;
}

export type CharacterId = 'power' | 'defender';

export interface CharacterAssets {
  name: string;
  /** Color de acento (hex) [§18.1 `characters/<id>/color`]. */
  color: string;
  portrait: string;
  select: string;
  paddle: string;
}

export const CHARACTERS: Record<CharacterId, CharacterAssets> = {
  power: {
    name: 'Power',
    color: '#E4572E',
    portrait: 'characters/power/portrait.png',
    select: 'characters/power/select.png',
    paddle: 'characters/power/paddle.png',
  },
  defender: {
    name: 'Defender',
    color: '#2F9C95',
    portrait: 'characters/defender/portrait.png',
    select: 'characters/defender/select.png',
    paddle: 'characters/defender/paddle.png',
  },
};

export const UI_ASSETS = {
  logo: 'ui/logo.png',
};

export const ARENA_ASSETS = {
  background: 'arena/background.jpg',
};

/** Sonidos de §16. Archivo esperado: `sfx/<nombre>.ogg` con `sfx/<nombre>.mp3` como alternativa. */
export const SFX_NAMES = [
  'bounce_table',
  'hit_normal',
  'hit_good',
  'hit_perfect',
  // V0.2: un sonido por tipo de golpe (se suma al de la calidad), para distinguirlos también de oído.
  'hit_topspin',
  'hit_slice',
  'hit_smash',
  'hit_block',
  'streak_1',
  'streak_2',
  'streak_3',
  'streak_4',
  'net',
  'whiff',
  'edge',
  'point_win',
  'point_lose',
  'countdown',
  'go',
  'special_ready',
  'special_activate',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export function sfxUrl(name: SfxName): string | null {
  return assetUrl(`sfx/${name}.ogg`) ?? assetUrl(`sfx/${name}.mp3`);
}
