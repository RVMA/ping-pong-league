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

/** Pausa por desconexión: «Esperando a Beto… 0:27». */
export function pauseText(name: string, seconds: number): string {
  return `Esperando a ${name}… ${clockText(seconds)}`;
}

/** Aviso del timeout del Listo (§14.2): al que no está listo y al que espera. */
export function readyWarnText(iAmLate: boolean, lateName: string, seconds: number): string {
  return iAmLate ? `Da a Listo en ${clockText(seconds)} o saldrás de la sala` : `${lateName} tiene ${clockText(seconds)} para dar a Listo`;
}
