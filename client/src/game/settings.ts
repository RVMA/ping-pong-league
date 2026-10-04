/**
 * Ajustes de playtest por URL. Ejemplo: /?speed=0.65&bot=hard&debug=1
 *  - speed: gameSpeed (§24-8)
 *  - radius: radio de juego de la raqueta (m)
 *  - pspeed, paccel: velocidad (m/s) y aceleración (m/s²) máximas de la raqueta
 *  - bot: easy | medium | hard
 *  - debug: 1 muestra el panel de precisión desde el inicio
 *  - autostart: 1 empieza sin menú (para pruebas automáticas)
 *  - seed: semilla del bot
 *  - offset: desfase de latencia en ms (sustituye al calibrado; para pruebas)
 *  - why: 0 / 1 desactiva o activa "¿por qué fallé?" (sustituye a lo guardado)
 *  - reduce: 1 reduce el temblor de cámara y los destellos (sin ráfagas de chispas) [§19]; por defecto sigue la
 *    preferencia «reducir movimiento» del sistema (reduce=0 la ignora)
 *  - online: 1 juega en red contra el bot remoto (V0.3), con latencia simulada:
 *    ping (tu ping en ms, por defecto 0), botping (el del bot, por defecto el mismo que ping) y jitter (variación,
 *    fracción; por defecto 0.1 = ±10 %)
 */
import { type BotDifficulty, type ConfigOverrides, DEFAULT_CONFIG } from '@ppp/shared';

export interface Settings {
  overrides: ConfigOverrides;
  difficulty: BotDifficulty;
  debug: boolean;
  autostart: boolean;
  seed: number;
  /** Desfase de latencia forzado por URL; si no hay, se usa el calibrado guardado. */
  latencyOffset: number | null;
  /** "¿Por qué fallé?" forzado por URL; si no hay, lo guardado o el valor de la config. */
  explain: boolean | null;
  /** Modo en red contra el bot remoto (V0.3) con su latencia simulada, o null para jugar en local. */
  online: { ping: number; botping: number; jitter: number } | null;
}

const EXPLAIN_KEY = 'ppp.explainErrors';
const KEYBAR_KEY = 'ppp.keyBar';

/** Barra de teclas de golpe visible (V0.2b): visible por defecto; Tab la cambia y se guarda en este navegador. */
export function loadKeyBar(): boolean {
  try {
    return localStorage.getItem(KEYBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveKeyBar(on: boolean): void {
  try {
    localStorage.setItem(KEYBAR_KEY, on ? '1' : '0');
  } catch {
    // Sin almacenamiento: solo dura esta sesión.
  }
}

/** Preferencia guardada de "¿por qué fallé?" (por navegador), o null si no hay. */
export function loadExplain(): boolean | null {
  try {
    const v = localStorage.getItem(EXPLAIN_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

export function saveExplain(on: boolean): void {
  try {
    localStorage.setItem(EXPLAIN_KEY, on ? '1' : '0');
  } catch {
    // Sin almacenamiento: solo dura esta sesión.
  }
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
  const paddle: NonNullable<ConfigOverrides['paddle']> = {};
  const radius = num('radius');
  if (radius !== undefined) paddle.radius = Math.max(0.05, Math.min(0.3, radius));
  const pspeed = num('pspeed');
  if (pspeed !== undefined) paddle.maxSpeed = Math.max(1, Math.min(20, pspeed));
  const paccel = num('paccel');
  if (paccel !== undefined) paddle.maxAccel = Math.max(5, Math.min(300, paccel));
  if (Object.keys(paddle).length) overrides.paddle = paddle;
  const reduceParam = q.get('reduce');
  const systemReduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceParam === '1' || (reduceParam !== '0' && systemReduce)) overrides.presentation = { reduceShakeAndFlash: true };
  const offset = num('offset');
  const bot = q.get('bot');
  const difficulty: BotDifficulty = bot === 'easy' || bot === 'hard' || bot === 'medium' ? bot : 'medium';
  return {
    overrides,
    difficulty,
    debug: q.get('debug') === '1',
    autostart: q.get('autostart') === '1',
    seed: num('seed') ?? Math.floor(Math.random() * 1e9),
    latencyOffset: offset ?? null,
    explain: q.get('why') === '0' ? false : q.get('why') === '1' ? true : null,
    online: q.get('online') === '1' ? onlineParams(num) : null,
  };
}

/** Latencia simulada del modo online, dentro de los límites que acepta el servidor (config.net.latency). */
function onlineParams(num: (k: string) => number | undefined): { ping: number; botping: number; jitter: number } {
  const lat = DEFAULT_CONFIG.net.latency;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const ping = clamp(num('ping') ?? 0, lat.maxPingMs);
  return { ping, botping: clamp(num('botping') ?? ping, lat.maxPingMs), jitter: clamp(num('jitter') ?? lat.defaultJitter, lat.maxJitter) };
}
