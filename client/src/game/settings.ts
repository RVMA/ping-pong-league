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
 *  - online: 1 juega en red contra el bot remoto (V0.3, solo el servidor de desarrollo), con latencia simulada:
 *    ping (tu ping en ms, por defecto 0), botping (el del bot, por defecto el mismo que ping), jitter (variación,
 *    fracción; por defecto 0.1 = ±10 %) y spike (probabilidad de picos de TCP; por defecto 0)
 *  - room: código de la sala a la que entrar (minúsculas valen); tras crear una, la URL pasa a ?room=<código>
 *  - create: quick | standard | full crea una sala nada más abrir (para pruebas; el lobby lo hace con botones)
 *  - name: nombre del jugador (si no, el guardado o el del lobby)
 *  - autoplay: easy | medium | hard, el bot mueve tu raqueta (Task 12)
 *  - read: 1 prueba de lectura contra el bot en local (Task 12)
 *  - En una sala, ping, jitter y spike simulan latencia en tu conexión (solo el servidor de desarrollo: el publicado
 *    rechaza una conexión con latencia simulada)
 */
import { type BotDifficulty, type ConfigOverrides, DEFAULT_CONFIG, cleanName, type MatchMode, normalizeCode } from '@ppp/shared';

/** Latencia simulada de una conexión (la aplica el servidor de desarrollo). */
export interface SimulatedLatency {
  ping: number;
  botping: number;
  jitter: number;
  spike: number;
}

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
  online: SimulatedLatency | null;
  /** Sala a la que entrar (código normalizado), o null. */
  room: string | null;
  /** Crear una sala de ese modo nada más abrir, o null. */
  create: MatchMode | null;
  /** Nombre del jugador por URL (limpio), o null. */
  name: string | null;
  /** Piloto automático (Task 12), o null. */
  autoplay: BotDifficulty | null;
  /** Prueba de lectura contra el bot en local (Task 12). */
  read: boolean;
  /** Latencia simulada de tu conexión en una sala (todo 0 salvo que la URL diga otra cosa). */
  latency: SimulatedLatency;
}

const EXPLAIN_KEY = 'ppp.explainErrors';
const KEYBAR_KEY = 'ppp.keyBar';
const NAME_KEY = 'ppp.name';

/** Nombre guardado en este navegador (lobby), o '' si no hay. */
export function loadName(): string {
  try {
    return cleanName(localStorage.getItem(NAME_KEY) ?? '', '', DEFAULT_CONFIG);
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Sin almacenamiento: solo dura esta sesión.
  }
}

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
  const difficulty = difficultyOf(q.get('bot')) ?? 'medium';
  const roomParam = q.get('room');
  const createParam = q.get('create');
  const createMode = createParam?.trim().toLowerCase();
  const name = cleanName(q.get('name') ?? '', '', DEFAULT_CONFIG);
  return {
    overrides,
    difficulty,
    debug: q.get('debug') === '1',
    autostart: q.get('autostart') === '1',
    seed: num('seed') ?? Math.floor(Math.random() * 1e9),
    latencyOffset: offset ?? null,
    explain: q.get('why') === '0' ? false : q.get('why') === '1' ? true : null,
    online: q.get('online') === '1' ? latencyParams(num, true) : null,
    room: roomParam === null ? null : normalizeCode(roomParam, DEFAULT_CONFIG),
    // Como la ruta del servidor: `?create=` vacío es el modo por defecto.
    create: createMode === undefined ? null : createMode === '' ? DEFAULT_CONFIG.room.defaultMode : Object.hasOwn(DEFAULT_CONFIG.room.gamesToWin, createMode) ? (createMode as MatchMode) : null,
    name: name || null,
    autoplay: difficultyOf(q.get('autoplay')),
    read: q.get('read') === '1',
    latency: latencyParams(num, false),
  };
}

function difficultyOf(v: string | null): BotDifficulty | null {
  return v === 'easy' || v === 'medium' || v === 'hard' ? v : null;
}

/**
 * Latencia simulada, dentro de los límites que acepta el servidor (config.net.latency). Contra el bot remoto la
 * variación por defecto es ±10 %; en una sala, 0 salvo que haya ping (el servidor publicado exige todo a 0).
 */
function latencyParams(num: (k: string) => number | undefined, bot: boolean): SimulatedLatency {
  const lat = DEFAULT_CONFIG.net.latency;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const ping = clamp(num('ping') ?? 0, lat.maxPingMs);
  return {
    ping,
    botping: bot ? clamp(num('botping') ?? ping, lat.maxPingMs) : 0,
    jitter: clamp(num('jitter') ?? (bot || ping > 0 ? lat.defaultJitter : 0), lat.maxJitter),
    spike: clamp(num('spike') ?? 0, lat.spike.maxProb),
  };
}
