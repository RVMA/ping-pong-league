/**
 * Rutas y textos de la sala (V0.4): la query de la URL del WebSocket decide qué se hace (`?create=standard`,
 * `?room=abcd`, `?bot=medium`), el código de sala se teclea y se genera aquí, y el nombre del jugador se limpia
 * antes de usarlo. Todo puro y sin lanzar.
 */
import type { BotDifficulty, GameConfig, MatchMode } from '../config.ts';

export type Route = { kind: 'create'; mode: MatchMode } | { kind: 'join'; code: string } | { kind: 'bot'; difficulty: BotDifficulty } | { kind: 'bad'; why: string };

const BOT_ROOM_RE = /^b-[0-9]{1,9}$/;
// Los separadores de línea (U+2028, U+2029) caen en la clase de espacios y se colapsan con los demás.
// biome-ignore lint/suspicious/noControlCharactersInRegex: se quitan a propósito
const STRIP_RE = /[\x00-\x1f\x7f-\x9f<>]/g;

/** Query (`?a=1&b=2`) → mapa; sin lanzar con porcentajes mal formados (ese par se ignora). */
function parseQuery(search: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = typeof search === 'string' ? (search.startsWith('?') ? search.slice(1) : search) : '';
  for (const part of text.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const val = eq < 0 ? '' : part.slice(eq + 1);
    try {
      const k = decodeURIComponent(key.split('+').join(' '));
      if (!out.has(k)) out.set(k, decodeURIComponent(val.split('+').join(' ')));
    } catch {
      // porcentaje mal formado
    }
  }
  return out;
}

function isMode(v: string, cfg: GameConfig): v is MatchMode {
  return Object.hasOwn(cfg.room.gamesToWin, v);
}

/** De la query de la URL del WebSocket (`?create=standard`, `?room=abcd`, `?bot=medium`). Nunca lanza. */
export function parseRoute(search: string, cfg: GameConfig): Route {
  const q = parseQuery(search);
  const create = q.get('create');
  if (create !== undefined) {
    const m = create.trim().toLowerCase();
    if (m === '') return { kind: 'create', mode: cfg.room.defaultMode };
    return isMode(m, cfg) ? { kind: 'create', mode: m } : { kind: 'bad', why: 'modo' };
  }
  const room = q.get('room');
  if (room !== undefined) {
    const code = normalizeCode(room, cfg);
    return code ? { kind: 'join', code } : { kind: 'bad', why: 'código' };
  }
  const bot = q.get('bot');
  if (bot !== undefined) {
    const d = bot.trim().toLowerCase();
    return Object.hasOwn(cfg.bot.difficulties, d) ? { kind: 'bot', difficulty: d as BotDifficulty } : { kind: 'bad', why: 'dificultad' };
  }
  return { kind: 'bad', why: 'sin ruta' };
}

/** Código tecleado → canónico (mayúsculas, sin espacios), o null si no es un código posible. Acepta también los ids de sala de bot `b-<n>`. */
export function normalizeCode(raw: string, cfg: GameConfig): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, '');
  if (BOT_ROOM_RE.test(t)) return t;
  const up = t.toUpperCase();
  if (up.length !== cfg.room.codeLength) return null;
  for (const ch of up) if (!cfg.room.codeAlphabet.includes(ch)) return null;
  return up;
}

export function newRoomCode(random: () => number, cfg: GameConfig): string {
  const a = cfg.room.codeAlphabet;
  let code = '';
  for (let i = 0; i < cfg.room.codeLength; i++) code += a[Math.min(a.length - 1, Math.floor(random() * a.length))];
  return code;
}

/** Nombre limpio: sin caracteres de control ni `<>`, espacios colapsados, recortado a nameMaxLength code points (sin partir pares sustitutos); vacío → fallback. */
export function cleanName(raw: string, fallback: string, cfg: GameConfig): string {
  const t = typeof raw === 'string' ? raw.replace(STRIP_RE, ' ').replace(/\s+/g, ' ').trim() : '';
  const cut = Array.from(t).slice(0, cfg.room.nameMaxLength).join('').trim();
  return cut || fallback;
}
