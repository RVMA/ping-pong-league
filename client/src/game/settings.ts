/**
 * Ajustes de playtest por URL. Ejemplo: /?speed=0.65&bot=hard&debug=1
 *  - speed: gameSpeed (§24-8)
 *  - radius: radio de juego de la raqueta (m)
 *  - bot: easy | medium | hard
 *  - debug: 1 muestra el panel de precisión desde el inicio
 *  - autostart: 1 empieza sin menú (para pruebas automáticas)
 *  - seed: semilla del bot
 */
import type { BotDifficulty, ConfigOverrides } from '@ppp/shared';

export interface Settings {
  overrides: ConfigOverrides;
  difficulty: BotDifficulty;
  debug: boolean;
  autostart: boolean;
  seed: number;
}

export function readSettings(search = window.location.search): Settings {
  const q = new URLSearchParams(search);
  const num = (k: string): number | undefined => {
    const v = q.get(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const overrides: ConfigOverrides = {};
  const speed = num('speed');
  if (speed !== undefined) overrides.sim = { gameSpeed: Math.max(0.2, Math.min(1.5, speed)) };
  const radius = num('radius');
  if (radius !== undefined) overrides.paddle = { radius: Math.max(0.05, Math.min(0.3, radius)) };
  const bot = q.get('bot');
  const difficulty: BotDifficulty = bot === 'easy' || bot === 'hard' || bot === 'medium' ? bot : 'medium';
  return {
    overrides,
    difficulty,
    debug: q.get('debug') === '1',
    autostart: q.get('autostart') === '1',
    seed: num('seed') ?? Math.floor(Math.random() * 1e9),
  };
}
