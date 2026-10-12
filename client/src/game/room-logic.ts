/**
 * Piezas puras del flujo de sala en el cliente (V0.4), sin DOM ni red, para poder probarlas sueltas: la vista de la
 * sala que sale de cada `room`, el calendario de reintentos (Decisión 10), el Listo con Shift mantenido, los relojes
 * («0:27») y los textos de la sala. Los nombres son texto del servidor: quien los pinte, siempre con textContent.
 */
import type { GameConfig, MatchEndMsg, MatchMode, RoomMsg, RoomPhase, RoomPlayerWire, Side } from '@ppp/shared';

/** Lo que el cliente sabe de su sala: el último `room`, su lado y el último fin de partido. */
export interface RoomView {
  code: string;
  side: Side;
  mode: MatchMode;
  phase: RoomPhase;
  players: [RoomPlayerWire | null, RoomPlayerWire | null];
  gamesWon: [number, number];
  /** performance.now() del plazo (−1 sin plazo). */
  deadlineAt: number;
  deadlineKind: RoomMsg['dk'];
  lastEnd: MatchEndMsg | null;
}

/** `room` llegado en `arrival` (performance.now()) → vista. El plazo viaja como «ms que faltan al enviarlo». */
export function toRoomView(msg: RoomMsg, side: Side, arrival: number, lastEnd: MatchEndMsg | null): RoomView {
  return {
    code: msg.code,
    side,
    mode: msg.md,
    phase: msg.ph,
    players: [msg.pl[0], msg.pl[1]],
    gamesWon: [msg.gw[0], msg.gw[1]],
    deadlineAt: msg.dl < 0 ? -1 : arrival + msg.dl,
    deadlineKind: msg.dk,
    lastEnd,
  };
}

export const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);

// ——— Reintentos (Decisión 10) ———

/** Espera antes del reintento número `attempt` (0, 1, 2…): 0.5, 1, 2, 4, 4, 4… s. */
export function retryDelayMs(attempt: number): number {
  return attempt <= 0 ? 500 : attempt === 1 ? 1000 : attempt === 2 ? 2000 : 4000;
}

/** Cuándo toca el siguiente reintento, o null si ya caería fuera de la ventana de `windowMs` desde el corte. */
export function nextRetryAt(cutAt: number, attempt: number, now: number, windowMs: number): number | null {
  const at = now + retryDelayMs(attempt);
  return at - cutAt < windowMs ? at : null;
}

// ——— Mensajes que cuestan (plan gratuito de Cloudflare: 1 petición por cada 20 mensajes entrantes) ———

/**
 * La raqueta no se envía en la sala de espera (ClientMatch.setQuiet): nadie la ve, y tras irse el rival la vista sigue
 * en marcha (el último `start`). A 30 Hz serían ~5 400 peticiones por hora de pestaña abierta; el ping sigue (~90).
 */
export function paddleQuiet(phase: RoomPhase): boolean {
  return phase === 'waiting';
}

/**
 * Toca un ping de keepalive si nada salió por el socket en `everyMs`: antes del primer `start`, con la raqueta callada
 * o con la pestaña oculta (sin frames no sale nada), para que un proxy no cierre el socket por inactivo.
 */
export function keepAliveDue(now: number, lastSentAt: number, everyMs: number): boolean {
  return now - lastSentAt >= everyMs;
}

// ——— Listo con Shift mantenido ———

/**
 * Mantener una tecla `holdMs` para cambiar el Listo: soltar antes lo cancela; al completarse dispara una vez y no
 * vuelve a disparar hasta soltar y mantener otra vez (así la segunda pulsación larga lo quita).
 */
export class ReadyHold {
  private readonly holdMs: number;
  /** performance.now() del inicio de la pulsación (−1 sin pulsar). */
  private since = -1;
  private fired = false;

  constructor(holdMs: number) {
    this.holdMs = holdMs;
  }

  get holding(): boolean {
    return this.since >= 0;
  }

  /** Tecla pulsada (las repeticiones del teclado no reinician la cuenta). */
  down(now: number): void {
    if (this.since >= 0) return;
    this.since = now;
    this.fired = false;
  }

  /** Tecla soltada (o ventana sin foco): se cancela lo que faltara. */
  up(): void {
    this.since = -1;
    this.fired = false;
  }

  /** true una sola vez por pulsación, al llegar a holdMs. */
  poll(now: number): boolean {
    if (this.since < 0 || this.fired || now - this.since < this.holdMs) return false;
    this.fired = true;
    return true;
  }

  /** Cuánto se ha llenado el anillo (0…1; lleno tras disparar hasta soltar). */
  progress(now: number): number {
    if (this.since < 0) return 0;
    if (this.fired) return 1;
    return Math.max(0, Math.min(1, (now - this.since) / this.holdMs));
  }
}

// ——— Relojes ———

/** Segundos enteros que faltan hasta el plazo (hacia arriba: «0:01» hasta que vence); 0 si no hay o ya pasó. */
export function secondsLeft(deadlineAt: number, now: number): number {
  if (deadlineAt < 0) return 0;
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

/** 27 → «0:27»; 150 → «2:30». */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Cifra de la cuenta atrás que toca enseñar: 3, 2, 1… y 0 = GO (ya venció). */
export function countdownStep(deadlineAt: number, now: number): number {
  return Math.min(9, secondsLeft(deadlineAt, now));
}

// ——— Lobby ———

/**
 * Lo que queda en el campo del código mientras escribes o pegas: sin espacios (el código no tiene), en mayúsculas y
 * como mucho `codeLength` letras. El campo admite más caracteres que el código (pegar « tkjv» no debe quedarse en «TKJ»).
 */
export function codeFieldText(raw: string, codeLength: number): string {
  return raw.replace(/\s+/g, '').toUpperCase().slice(0, codeLength);
}

// ——— Textos ———

/** «Estándar · al mejor de 3 games». */
export function modeText(mode: MatchMode, cfg: GameConfig): string {
  const n = cfg.room.gamesToWin[mode];
  const name = mode === 'quick' ? 'Rápido' : mode === 'standard' ? 'Estándar' : 'Completo';
  return n <= 1 ? `${name} · 1 game a ${cfg.rules.pointsToWin}` : `${name} · al mejor de ${2 * n - 1} games`;
}

/** Nombre de un lado (o «el rival» si el hueco está vacío). */
export function nameOf(view: RoomView, s: Side): string {
  return view.players[s]?.nm ?? (s === view.side ? 'Tú' : 'el rival');
}

/**
 * Entre games: «Game 1 para Ana · 11-7 · Games 1-0». Marcador y games desde el ganador del game; sin el marcador
 * (p. ej. al volver tras un corte), «Game 1 para Ana · Games 1-0».
 */
export function betweenText(game: number, winner: string, score: [number, number] | null, games: [number, number]): string {
  const sc = score ? ` · ${score[0]}-${score[1]}` : '';
  return `Game ${game} para ${winner}${sc} · Games ${games[0]}-${games[1]}`;
}

/**
 * Línea del marcador en el partido: «Game 2 · Games 1-0», con los games como [yo, rival] (como las tarjetas: «Tú» a la
 * izquierda); sin «Games» en un partido de un solo game.
 */
export function gamesLine(gamesWon: readonly [number, number], me: Side, showGames: boolean): string {
  const game = `Game ${gamesWon[0] + gamesWon[1] + 1}`;
  return showGames ? `${game} · Games ${gamesWon[me]}-${gamesWon[otherSide(me)]}` : game;
}

/** Pausa por desconexión: «Esperando a Beto… 0:27». */
export function pauseText(name: string, seconds: number): string {
  return `Esperando a ${name}… ${clockText(seconds)}`;
}

/**
 * Aviso del timeout del Listo (§14.2): al que no está listo y al que espera. Con la prueba de lectura en marcha
 * (`reading`) el Listo está bloqueado: al que no está listo se le pide dejarla primero.
 */
export function readyWarnText(iAmLate: boolean, lateName: string, seconds: number, reading = false): string {
  if (!iAmLate) return `${lateName} tiene ${clockText(seconds)} para dar a Listo`;
  return `${reading ? 'Deja la prueba y da' : 'Da'} a Listo en ${clockText(seconds)} o saldrás de la sala`;
}

// ——— Prueba de lectura (§13.1) ———

/**
 * La sala deja empezar la prueba: en el warm-up, con el rival conectado, sin tu Listo (mientras dura no hay Listo) y
 * sin el suyo: con un solo Listo corre el plazo de 3 min (§14.2 ✅), que la prueba no para, y te sacaría de la sala.
 */
export function readTestOpen(view: RoomView): boolean {
  if (view.phase !== 'warmup') return false;
  const rival = view.players[otherSide(view.side)];
  return !!rival && rival.c === 1 && rival.r !== 1 && view.players[view.side]?.r !== 1;
}

/** Aviso al rival de quien hace la prueba: le pide que mezcle golpes. */
export function readNoticeText(name: string): string {
  return `${name} está haciendo la prueba de lectura: mezcla golpes`;
}

/**
 * El aviso `rt` que toca mandar (o null): el que quieres (`want`, la prueba en marcha) si la sala muestra otro (`has`) y
 * no se mandó ya en esta conexión (`sent`; null tras cada `welcome`: la sala lo borra al volver). Solo en el warm-up: en
 * las demás fases la sala lo ignora.
 */
export function readFlagToSend(want: boolean, has: boolean, sent: boolean | null, phase: RoomPhase): boolean | null {
  if (phase !== 'warmup' || want === has || sent === want) return null;
  return want;
}
