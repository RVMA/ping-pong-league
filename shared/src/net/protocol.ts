/**
 * Protocolo de red de V0.3 [§17.2]: mensajes JSON compactos (claves cortas, posiciones de la raqueta en mm) y su
 * validación defensiva. Lo único que viaja de un jugador es su raqueta (30 Hz, sin teclas), sus golpes y fallos (las
 * teclas de golpe solo dentro del golpe, §13 ✅), el fin de un vuelo que no devolvió y el ping. La calidad no viaja:
 * se recalcula. La versión del protocolo se negocia al conectar (`hello` / `welcome`).
 *
 * Unidades en la red: mm (posiciones de raqueta), ms (tiempos de vuelo y de rally), mm/s (velocidades de la raqueta),
 * alturas de pantalla/s (gesto lateral). El estado de salida oficial de un vuelo va en m, m/s y rad/s con todos sus
 * dígitos: JSON lo recupera bit a bit y así cliente, bot y servidor simulan el mismo vuelo.
 *
 * Decodificar nunca lanza: un mensaje que no cumple tipos, rangos y números finitos devuelve null.
 */
import type { BotDifficulty, GameConfig, MatchMode } from '../config.ts';
import type { BallState } from '../physics.ts';
import type { PointReason } from '../rules.ts';
import type { ShotKeys, Side } from '../types.ts';

export const PROTOCOL_VERSION = 2;

export type Role = 'player' | 'bot';

// ——— Cliente → servidor ———

/**
 * Primer mensaje: versión, hash de la config, rol, nombre y parámetros de la partida (latencia simulada, bot, desfase).
 * La sala va en la URL del WebSocket, no aquí. `tk` es el token de reconexión (solo al volver a una sala).
 */
export interface HelloMsg {
  k: 'hello';
  v: number;
  h: string;
  r: Role;
  /** Nombre del jugador (el servidor lo limpia). */
  nm: string;
  tk?: string;
  /** Ping simulado (ms de ida y vuelta) de esta conexión y del bot; variación (fracción). */
  p: number;
  bp: number;
  j: number;
  /** Probabilidad de picos de latencia simulados (0…net.latency.spike.maxProb). */
  sp: number;
  d: BotDifficulty;
  s: number;
  /** Desfase de latencia calibrado que el cliente resta a sus clicks [§3.7]. */
  o: number;
  /** Quién saca primero (opcional, por defecto el jugador): lo usan los partidos de bots para alternarlo. */
  fs?: Side;
}

/** Raqueta (30 Hz): rally `n`, tiempo de rally `r` (ms enteros; −1 sin vuelo), posición del mundo en mm enteros. */
export interface PadMsg {
  k: 'p';
  n: number;
  r: number;
  x: number;
  z: number;
}

/** Lanzamiento del saque desde (x, z) mm; a = 1 si fue automático (la bola no avanza en ese tick, como en local). */
export interface TossMsg {
  k: 'toss';
  n: number;
  x: number;
  z: number;
  a: 0 | 1;
}

/**
 * Campos del evento de golpe [§17.2]: t = click en el reloj del vuelo (ms, ya corregido con el desfase); x, z = raqueta
 * en el click (mm); vx = gesto lateral; q = teclas (1 topspin, 2 slice, 4 smash); b = bloqueo; sv = velocidades de la
 * raqueta entre 270 y 150 ms antes del click (mm/s, regla de «colocado»); sx, sz = la raqueta de antes del gesto.
 */
export interface HitWire {
  t: number;
  x: number;
  z: number;
  vx: number;
  q: number;
  b: 0 | 1;
  sv: number[];
  sx?: number;
  sz?: number;
}

export interface HitMsg extends HitWire {
  k: 'hit';
  n: number;
  /** Vuelo al que responde (0 = lanzamiento del saque). */
  f: number;
}

/** Fallo al aire (lo ve el rival; el servidor lo usa para la recuperación de 300 ms). */
export interface WhiffMsg {
  k: 'wf';
  n: number;
  f: number;
  t: number;
}

/** El vuelo `f` terminó en mi pantalla sin que yo lo devolviera (me tocaba). */
export interface EndMsg {
  k: 'end';
  n: number;
  f: number;
}

/** Ping [§15.1]: i, t = mi reloj; a = mi media de las últimas medidas (−1 si aún no hay). */
export interface PingMsg {
  k: 'ping';
  i: number;
  t: number;
  a: number;
}

export interface AgainMsg {
  k: 'again';
}

/** Listo (1) / no listo (0) en la sala. */
export interface ReadyMsg {
  k: 'rdy';
  on: 0 | 1;
}

/** Activa o desactiva la prueba de lectura del servicio rival. */
export interface ReadTestMsg {
  k: 'rt';
  on: 0 | 1;
}

/** Salir de la sala a propósito. */
export interface LeaveMsg {
  k: 'leave';
}

export type C2S = HelloMsg | PadMsg | TossMsg | HitMsg | WhiffMsg | EndMsg | PingMsg | AgainMsg | ReadyMsg | ReadTestMsg | LeaveMsg;

// ——— Servidor → cliente ———

export interface WelcomeMsg {
  k: 'welcome';
  v: number;
  side: Side;
  room: string;
  /** Token de reconexión. */
  tk: string;
  md: MatchMode | 'bot';
}

export type ErrCode = 'version' | 'config' | 'params' | 'room' | 'full' | 'proto' | 'rate' | 'route';

export interface ErrMsg {
  k: 'err';
  m: ErrCode;
  d: string;
}

/** Empieza (o se reanuda) un game: fs = primer saque; n = rally con el que empieza; wu = warm-up; g = game (0 en warm-up); sc, ns = marcador y saque. */
export interface StartMsg {
  k: 'start';
  fs: Side;
  n: number;
  wu: 0 | 1;
  g: number;
  sc: [number, number];
  ns: Side;
}

export type TossRelay = TossMsg;

/**
 * Vuelo nuevo oficial: rally n, vuelo f, quién golpeó (p), índice del contacto en el vuelo f − 1 (j), el evento de
 * golpe reenviado (para que el rival vea el golpe) y el estado de salida [px, py, pz, vx, vy, vz, wx, wy, wz].
 */
export interface FlightMsg {
  k: 'fl';
  n: number;
  f: number;
  p: Side;
  j: number;
  h: HitWire;
  s: number[];
}

export interface WhiffRelay {
  k: 'wf';
  n: number;
  f: number;
  t: number;
  p: Side;
}

/**
 * Fin del rally n: el vuelo f acabó en su índice i (aplícalo cuando tu pantalla llegue ahí). w = ganador (−1 = let),
 * marcador, quién saca después (ns) y ganador del game (go, −1 si sigue).
 */
export interface PointMsg {
  k: 'pt';
  n: number;
  f: number;
  i: number;
  w: Side | -1;
  r: PointReason | 'LET';
  sc: [number, number];
  ns: Side;
  go: Side | -1;
}

export interface PongMsg {
  k: 'pong';
  i: number;
  t: number;
}

/** Media del ping de los dos jugadores (−1 = sin medir). */
export interface PingsMsg {
  k: 'pings';
  a: [number, number];
}

export interface ByeMsg {
  k: 'bye';
  m: string;
}

export type RoomPhase = 'waiting' | 'warmup' | 'countdown' | 'match' | 'between' | 'paused';

/** Jugador en la sala: nombre, conectado, listo, prueba de lectura. */
export interface RoomPlayerWire {
  nm: string;
  c: 0 | 1;
  r: 0 | 1;
  rt: 0 | 1;
}

/** Estado de la sala; dl = ms hasta el plazo vigente al enviar (−1 sin plazo); dk = qué plazo es. */
export interface RoomMsg {
  k: 'room';
  code: string;
  md: MatchMode;
  ph: RoomPhase;
  pl: [RoomPlayerWire | null, RoomPlayerWire | null];
  gw: [number, number];
  dl: number;
  dk: '' | 'ready' | 'count' | 'between' | 'pause';
}

export interface PlayerStatsWire {
  pf: number;
  ms: number;
  ne: number;
  pts: number;
}

/** Fin del partido: ganador, motivo, games ganados, estadísticas y puntos de la prueba de lectura (rj). */
export interface MatchEndMsg {
  k: 'mend';
  w: Side;
  why: 'score' | 'abandon';
  gw: [number, number];
  st: [PlayerStatsWire, PlayerStatsWire];
  rj: [number, number];
}

export type S2C = WelcomeMsg | ErrMsg | StartMsg | PadMsg | TossRelay | FlightMsg | WhiffRelay | PointMsg | PongMsg | PingsMsg | ByeMsg | RoomMsg | MatchEndMsg;

/** Mensaje a texto. La raqueta (el mensaje frecuente) va como array [n, r, x, z]. */
export function encode(msg: C2S | S2C): string {
  if (msg.k === 'p') return `[${msg.n},${msg.r},${msg.x},${msg.z}]`;
  return JSON.stringify(msg);
}

// ——— Validación ———

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function int(v: unknown, min: number, max: number): v is number {
  return num(v, min, max) && Number.isInteger(v);
}

function bit(v: unknown): v is 0 | 1 {
  return v === 0 || v === 1;
}

function side(v: unknown): v is Side {
  return v === 0 || v === 1;
}

function str(v: unknown, re: RegExp): v is string {
  return typeof v === 'string' && re.test(v);
}

const MAX_RALLY = 1e6;
const MAX_FLIGHT = 500;
const MAX_FLIGHT_MS = 60000;
const MAX_MM = 5000;
const MAX_SPEED_MM_S = 100000;
const MAX_SWING = 100;
const MAX_SAMPLES = 64;
const CODE_RE = /^[A-Za-z0-9-]{1,16}$/;
const TOKEN_RE = /^[A-Za-z0-9-]{8,64}$/;
const NAME_RE = /^[\s\S]{0,64}$/;
const HASH_RE = /^[0-9a-f]{8}$/;
const TEXT_RE = /^[\s\S]{0,200}$/;
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const REASONS = ['NET', 'OUT', 'OWN_SIDE', 'DOUBLE_BOUNCE', 'MISSED', 'VOLLEY', 'SERVE_FAULT', 'TOSS_MISSED', 'SIDE', 'LET'];
const ERR_CODES = ['version', 'config', 'params', 'room', 'full', 'proto', 'rate', 'route'];
const MODES = ['quick', 'standard', 'full'];
const PHASES = ['waiting', 'warmup', 'countdown', 'match', 'between', 'paused'];
const DEADLINES = ['', 'ready', 'count', 'between', 'pause'];
/** Cota de forma del campo `sp`; el límite real (net.latency.spike.maxProb) lo aplica validHello. */
const MAX_SPIKE_PROB = 1;

/** Dos enteros en [min, max]. */
function pair(v: unknown, min: number, max: number): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && int(v[0], min, max) && int(v[1], min, max);
}

/** Jugador de la sala; null = hueco libre; undefined = no válido. */
function roomPlayer(v: unknown): RoomPlayerWire | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !str(v.nm, NAME_RE) || !bit(v.c) || !bit(v.r) || !bit(v.rt)) return undefined;
  return { nm: v.nm, c: v.c, r: v.r, rt: v.rt };
}

function stats(v: unknown): PlayerStatsWire | null {
  if (!isObj(v) || !num(v.pf, 0, 100) || !int(v.ms, 0, 999) || !int(v.ne, 0, 999) || !int(v.pts, 0, 999)) return null;
  return { pf: v.pf, ms: v.ms, ne: v.ne, pts: v.pts };
}

function parse(text: string): unknown {
  if (typeof text !== 'string' || text.length === 0 || text.length > 8192) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function pad(v: unknown): PadMsg | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [n, r, x, z] = v;
  if (!int(n, 0, MAX_RALLY) || !int(r, -1, 1e7) || !int(x, -MAX_MM, MAX_MM) || !int(z, -MAX_MM, MAX_MM)) return null;
  return { k: 'p', n, r, x, z };
}

function toss(o: Obj): TossMsg | null {
  if (!int(o.n, 0, MAX_RALLY) || !num(o.x, -MAX_MM, MAX_MM) || !num(o.z, -MAX_MM, MAX_MM) || !bit(o.a)) return null;
  return { k: 'toss', n: o.n, x: o.x, z: o.z, a: o.a };
}

function hitWire(o: unknown): HitWire | null {
  if (!isObj(o)) return null;
  const { t, x, z, vx, q, b, sv, sx, sz } = o;
  if (!num(t, 0, MAX_FLIGHT_MS) || !num(x, -MAX_MM, MAX_MM) || !num(z, -MAX_MM, MAX_MM) || !num(vx, -MAX_SWING, MAX_SWING)) return null;
  if (!int(q, 0, 7) || !bit(b) || !Array.isArray(sv) || sv.length > MAX_SAMPLES) return null;
  const speeds: number[] = [];
  for (const s of sv) {
    if (!num(s, 0, MAX_SPEED_MM_S)) return null;
    speeds.push(s);
  }
  const w: HitWire = { t, x, z, vx, q, b, sv: speeds };
  if (speeds.length) {
    if (!num(sx, -MAX_MM, MAX_MM) || !num(sz, -MAX_MM, MAX_MM)) return null;
    w.sx = sx;
    w.sz = sz;
  }
  return w;
}

/** Decodifica y valida un mensaje del cliente. null si no es válido (nunca lanza). */
export function decodeC2S(text: string): C2S | null {
  const v = parse(text);
  if (Array.isArray(v)) return pad(v);
  if (!isObj(v)) return null;
  const o = v;
  switch (o.k) {
    case 'hello': {
      if (!int(o.v, 0, 1000) || !str(o.h, HASH_RE) || (o.r !== 'player' && o.r !== 'bot')) return null;
      if (!str(o.nm, NAME_RE) || (o.tk !== undefined && !str(o.tk, TOKEN_RE))) return null;
      if (!num(o.p, 0, 10000) || !num(o.bp, 0, 10000) || !num(o.j, 0, 1) || !num(o.sp, 0, MAX_SPIKE_PROB) || typeof o.d !== 'string' || !DIFFICULTIES.includes(o.d)) return null;
      if (!int(o.s, -4294967296, 4294967296) || !num(o.o, -1000, 1000)) return null;
      if (o.fs !== undefined && !side(o.fs)) return null;
      const m: HelloMsg = { k: 'hello', v: o.v, h: o.h, r: o.r, nm: o.nm, p: o.p, bp: o.bp, j: o.j, sp: o.sp, d: o.d as BotDifficulty, s: o.s, o: o.o };
      if (o.tk !== undefined) m.tk = o.tk;
      if (o.fs !== undefined) m.fs = o.fs;
      return m;
    }
    case 'toss':
      return toss(o);
    case 'hit': {
      if (!int(o.n, 0, MAX_RALLY) || !int(o.f, 0, MAX_FLIGHT)) return null;
      const w = hitWire(o);
      return w ? { k: 'hit', n: o.n, f: o.f, ...w } : null;
    }
    case 'wf':
      if (!int(o.n, 0, MAX_RALLY) || !int(o.f, 0, MAX_FLIGHT) || !num(o.t, 0, MAX_FLIGHT_MS)) return null;
      return { k: 'wf', n: o.n, f: o.f, t: o.t };
    case 'end':
      if (!int(o.n, 0, MAX_RALLY) || !int(o.f, 0, MAX_FLIGHT)) return null;
      return { k: 'end', n: o.n, f: o.f };
    case 'ping':
      if (!int(o.i, 0, 1e9) || !num(o.t, -1e13, 1e13) || !num(o.a, -1, 10000)) return null;
      return { k: 'ping', i: o.i, t: o.t, a: o.a };
    case 'again':
      return { k: 'again' };
    case 'rdy':
      return bit(o.on) ? { k: 'rdy', on: o.on } : null;
    case 'rt':
      return bit(o.on) ? { k: 'rt', on: o.on } : null;
    case 'leave':
      return { k: 'leave' };
    default:
      return null;
  }
}

/** Decodifica y valida un mensaje del servidor. null si no es válido (nunca lanza). */
export function decodeS2C(text: string): S2C | null {
  const v = parse(text);
  if (Array.isArray(v)) return pad(v);
  if (!isObj(v)) return null;
  const o = v;
  switch (o.k) {
    case 'welcome':
      if (!int(o.v, 0, 1000) || !side(o.side) || !str(o.room, CODE_RE) || !str(o.tk, TOKEN_RE)) return null;
      if (o.md !== 'bot' && !(typeof o.md === 'string' && MODES.includes(o.md))) return null;
      return { k: 'welcome', v: o.v, side: o.side, room: o.room, tk: o.tk, md: o.md as MatchMode | 'bot' };
    case 'err':
      if (typeof o.m !== 'string' || !ERR_CODES.includes(o.m) || !str(o.d, TEXT_RE)) return null;
      return { k: 'err', m: o.m as ErrCode, d: o.d };
    case 'start':
      if (!side(o.fs) || !int(o.n, 0, MAX_RALLY) || !bit(o.wu) || !int(o.g, 0, 9) || !side(o.ns) || !pair(o.sc, 0, 99)) return null;
      return { k: 'start', fs: o.fs, n: o.n, wu: o.wu, g: o.g, sc: [o.sc[0], o.sc[1]], ns: o.ns };
    case 'toss':
      return toss(o);
    case 'fl': {
      if (!int(o.n, 0, MAX_RALLY) || !int(o.f, 1, MAX_FLIGHT) || !side(o.p) || !int(o.j, 0, 100000)) return null;
      const h = hitWire(o.h);
      if (!h || !Array.isArray(o.s) || o.s.length !== 9) return null;
      const s: number[] = [];
      for (const x of o.s) {
        if (!num(x, -1e4, 1e4)) return null;
        s.push(x);
      }
      return { k: 'fl', n: o.n, f: o.f, p: o.p, j: o.j, h, s };
    }
    case 'wf':
      if (!int(o.n, 0, MAX_RALLY) || !int(o.f, 0, MAX_FLIGHT) || !num(o.t, 0, MAX_FLIGHT_MS) || !side(o.p)) return null;
      return { k: 'wf', n: o.n, f: o.f, t: o.t, p: o.p };
    case 'pt': {
      if (!int(o.n, 0, MAX_RALLY) || !int(o.f, 0, MAX_FLIGHT) || !int(o.i, 0, 1e6)) return null;
      if (!(o.w === -1 || side(o.w)) || typeof o.r !== 'string' || !REASONS.includes(o.r)) return null;
      if (!Array.isArray(o.sc) || o.sc.length !== 2 || !int(o.sc[0], 0, 999) || !int(o.sc[1], 0, 999)) return null;
      if (!side(o.ns) || !(o.go === -1 || side(o.go))) return null;
      return { k: 'pt', n: o.n, f: o.f, i: o.i, w: o.w, r: o.r as PointReason | 'LET', sc: [o.sc[0], o.sc[1]], ns: o.ns, go: o.go };
    }
    case 'pong':
      if (!int(o.i, 0, 1e9) || !num(o.t, -1e13, 1e13)) return null;
      return { k: 'pong', i: o.i, t: o.t };
    case 'pings':
      if (!Array.isArray(o.a) || o.a.length !== 2 || !num(o.a[0], -1, 10000) || !num(o.a[1], -1, 10000)) return null;
      return { k: 'pings', a: [o.a[0], o.a[1]] };
    case 'bye':
      if (!str(o.m, TEXT_RE)) return null;
      return { k: 'bye', m: o.m };
    case 'room': {
      if (!str(o.code, CODE_RE) || typeof o.md !== 'string' || !MODES.includes(o.md) || typeof o.ph !== 'string' || !PHASES.includes(o.ph)) return null;
      if (!Array.isArray(o.pl) || o.pl.length !== 2 || !pair(o.gw, 0, 99) || !int(o.dl, -1, 600000) || typeof o.dk !== 'string' || !DEADLINES.includes(o.dk)) return null;
      const a = roomPlayer(o.pl[0]);
      const b = roomPlayer(o.pl[1]);
      if (a === undefined || b === undefined) return null;
      return { k: 'room', code: o.code, md: o.md as MatchMode, ph: o.ph as RoomPhase, pl: [a, b], gw: [o.gw[0], o.gw[1]], dl: o.dl, dk: o.dk as RoomMsg['dk'] };
    }
    case 'mend': {
      if (!side(o.w) || (o.why !== 'score' && o.why !== 'abandon') || !pair(o.gw, 0, 99) || !pair(o.rj, 0, 1e6)) return null;
      if (!Array.isArray(o.st) || o.st.length !== 2) return null;
      const a = stats(o.st[0]);
      const b = stats(o.st[1]);
      if (!a || !b) return null;
      return { k: 'mend', w: o.w, why: o.why, gw: [o.gw[0], o.gw[1]], st: [a, b], rj: [o.rj[0], o.rj[1]] };
    }
    default:
      return null;
  }
}

// ——— Evento de golpe en unidades internas ———

/** Evento de golpe en unidades internas: t (ms del vuelo), raqueta en m, velocidades en m/s. */
export interface HitInput {
  t: number;
  pad: { x: number; z: number };
  swingVx: number;
  keys: ShotKeys;
  block: boolean;
  speeds: number[];
  ref: { x: number; z: number } | null;
}

const POW10 = [1, 10, 100, 1000, 10000, 100000, 1000000];

/** Redondeo a `d` decimales (sin Math.pow) y sin cero negativo (JSON no lo distingue). */
function round(v: number, d: number): number {
  const k = POW10[d] ?? 1000;
  const r = Math.round(v * k) / k;
  return r === 0 ? 0 : r;
}

export function keysToMask(k: ShotKeys): number {
  return (k.topspin ? 1 : 0) | (k.slice ? 2 : 0) | (k.smash ? 4 : 0);
}

export function maskToKeys(q: number): ShotKeys {
  const k: ShotKeys = {};
  if (q & 1) k.topspin = true;
  if (q & 2) k.slice = true;
  if (q & 4) k.smash = true;
  return k;
}

/** Evento interno → red (cuantizado: §17.2, decisión 7 del plan). */
export function hitToWire(h: HitInput, cfg: GameConfig): HitWire {
  const q = cfg.net.quantize;
  const w: HitWire = {
    t: round(h.t, q.msDecimals),
    x: round(h.pad.x * 1000, q.mmDecimals),
    z: round(h.pad.z * 1000, q.mmDecimals),
    vx: round(h.swingVx, q.swingDecimals),
    q: keysToMask(h.keys),
    b: h.block ? 1 : 0,
    sv: h.speeds.map((v) => round(v * 1000, q.speedDecimals)),
  };
  if (h.speeds.length && h.ref) {
    w.sx = round(h.ref.x * 1000, q.mmDecimals);
    w.sz = round(h.ref.z * 1000, q.mmDecimals);
  }
  return w;
}

/** Red → evento interno. */
export function hitFromWire(w: HitWire): HitInput {
  return {
    t: w.t,
    pad: { x: w.x / 1000, z: w.z / 1000 },
    swingVx: w.vx,
    keys: maskToKeys(w.q),
    block: w.b === 1,
    speeds: w.sv.map((v) => v / 1000),
    ref: w.sv.length && w.sx !== undefined && w.sz !== undefined ? { x: w.sx / 1000, z: w.sz / 1000 } : null,
  };
}

/** El evento tal como lo verá el servidor: quien golpea predice con esto (mismos bits en los dos lados). */
export function quantizeHit(h: HitInput, cfg: GameConfig): HitInput {
  return hitFromWire(hitToWire(h, cfg));
}

const z0 = (v: number): number => (v === 0 ? 0 : v);

/** Estado de salida → [px, py, pz, vx, vy, vz, wx, wy, wz] (sin cero negativo: JSON no lo conserva). */
export function exitToWire(b: BallState): number[] {
  return [z0(b.pos.x), z0(b.pos.y), z0(b.pos.z), z0(b.vel.x), z0(b.vel.y), z0(b.vel.z), z0(b.spin.x), z0(b.spin.y), z0(b.spin.z)];
}

export function exitFromWire(s: readonly number[]): BallState {
  return { pos: { x: s[0], y: s[1], z: s[2] }, vel: { x: s[3], y: s[4], z: s[5] }, spin: { x: s[6], y: s[7], z: s[8] } };
}
