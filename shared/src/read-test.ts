/**
 * Prueba de lectura (§13.1 ✅, Decisión 19): mide si el jugador nombra el golpe del rival sin mezclarlo con devolver la
 * bola. Tu raqueta devuelve sola; cada golpe del rival que no es un saque abre una pregunta, y la primera tecla
 * (1 normal · 2 topspin · 3 slice · 4 smash · 5 bloqueo) es la respuesta. La pregunta se cierra cuando tu raqueta
 * devuelve la bola o acaba el punto; sin tecla, «sin respuesta». Al final: el % de aciertos sobre las respondidas, las
 * que faltaron y la tabla de confusiones (golpe real → respuesta). Sin aciertos ni fallos por golpe mientras dura: esta
 * pieza solo cuenta, y las respuestas no salen nunca de este navegador (las teclas de golpe solo viajan en el golpe, §13).
 * Pura: sin DOM ni red.
 */
import type { ShotType } from './stroke.ts';

export type ReadAnswer = 'NORMAL' | 'TOPSPIN' | 'SLICE' | 'SMASH' | 'BLOCK';

/** Respuestas en el orden de sus teclas: 1 normal · 2 topspin · 3 slice · 4 smash · 5 bloqueo. */
export const READ_ANSWERS: readonly ReadAnswer[] = Object.freeze(['NORMAL', 'TOPSPIN', 'SLICE', 'SMASH', 'BLOCK'] as const);

/** Teclas físicas (KeyboardEvent.code): Digit1–5 y Numpad1–5. */
export const READ_KEYS: Readonly<Record<string, ReadAnswer>> = Object.freeze(
  Object.fromEntries(READ_ANSWERS.flatMap((a, i) => [[`Digit${i + 1}`, a] as const, [`Numpad${i + 1}`, a] as const])),
);

export type ReadConfusion = Record<ReadAnswer, Record<ReadAnswer | 'NONE', number>>;

export interface ReadResult {
  /** Preguntas abiertas (golpes del rival que no son saques). */
  asked: number;
  answered: number;
  correct: number;
  /** Aciertos sobre las respondidas, en % (0 si no hay respuestas). */
  pct: number;
  /** Filas: el golpe real del rival; columnas: la respuesta o NONE (sin respuesta). */
  confusion: ReadConfusion;
}

function emptyConfusion(): ReadConfusion {
  const row = (): Record<ReadAnswer | 'NONE', number> => ({ NORMAL: 0, TOPSPIN: 0, SLICE: 0, SMASH: 0, BLOCK: 0, NONE: 0 });
  return { NORMAL: row(), TOPSPIN: row(), SLICE: row(), SMASH: row(), BLOCK: row() };
}

export class ReadTest {
  readonly total: number;
  private n = 0;
  private nAnswered = 0;
  private nCorrect = 0;
  private openShot: ShotType | null = null;
  private openAnswer: ReadAnswer | null = null;
  private readonly table = emptyConfusion();

  constructor(total: number) {
    this.total = Math.max(1, Math.floor(total));
  }

  /** Golpe del rival (los saques no cuentan): abre una pregunta. Si había otra abierta, se cierra antes (sin respuesta si no la hubo). */
  onRivalHit(type: ShotType, serve: boolean): void {
    if (serve) return;
    this.close();
    if (this.n >= this.total) return;
    this.n += 1;
    this.openShot = type;
    this.openAnswer = null;
  }

  /** Primera respuesta de la pregunta abierta (las siguientes se ignoran; sin pregunta abierta, también). */
  answer(a: ReadAnswer): void {
    if (this.openShot === null || this.openAnswer !== null) return;
    this.openAnswer = a;
    this.nAnswered += 1;
    if (a === this.openShot) this.nCorrect += 1;
    this.table[this.openShot][a] += 1;
  }

  /** Mi raqueta devolvió la bola o acabó el punto: cierra la pregunta (sin respuesta si no la hubo). */
  close(): void {
    if (this.openShot === null) return;
    if (this.openAnswer === null) this.table[this.openShot].NONE += 1;
    this.openShot = null;
    this.openAnswer = null;
  }

  /** Ya se nombraron (o pasaron) los `total` golpes y no queda ninguno abierto. */
  get done(): boolean {
    return this.n >= this.total && this.openShot === null;
  }

  get asked(): number {
    return this.n;
  }

  get answered(): number {
    return this.nAnswered;
  }

  get correct(): number {
    return this.nCorrect;
  }

  /** Golpe de la pregunta abierta (null sin pregunta). */
  get open(): ShotType | null {
    return this.openShot;
  }

  /** Respuesta ya dada a la pregunta abierta (null si aún no hay). */
  get given(): ReadAnswer | null {
    return this.openAnswer;
  }

  /** Resultado (una copia). Con una pregunta abierta sin respuesta, cuenta en `asked` pero aún no como NONE. */
  result(): ReadResult {
    const confusion = emptyConfusion();
    for (const row of READ_ANSWERS) Object.assign(confusion[row], this.table[row]);
    return {
      asked: this.n,
      answered: this.nAnswered,
      correct: this.nCorrect,
      pct: this.nAnswered ? (100 * this.nCorrect) / this.nAnswered : 0,
      confusion,
    };
  }
}
