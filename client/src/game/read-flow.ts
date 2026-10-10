/**
 * Prueba de lectura en el cliente (§13.1 ✅, Decisión 19): tu raqueta devuelve sola (el piloto automático con
 * `readerProfile`), el rival mezcla golpes y tú nombras cada golpe suyo con 1–5.
 *  - En local (`?read=1`, contra el bot de `bot=`): explicación con «Empezar», la partida contra el bot (si acaba un game
 *    antes de los 30 golpes, sigue con otro) y, a los 30, el resultado con la partida parada.
 *  - En el warm-up de una sala (botón «Prueba de lectura»): la sala manda `rt` y lo para al salir del warm-up (RoomFlow).
 * Los golpes del rival que no son saques abren una pregunta; tu golpe o el fin del punto la cierran. Las teclas 1–5 son
 * solo de este navegador: nunca se envían (§13). Mientras dura no hay aciertos ni fallos por golpe: solo una leyenda.
 */
import { type GameConfig, READ_KEYS, type ReadAnswer, type ReadResult, ReadTest, type SimEvent, type Side } from '@ppp/shared';
import type { Hud } from '../ui/hud.ts';
import { ReadUi } from '../ui/read-ui.ts';

export type ReadWhere = 'local' | 'room';

/** Lo que la prueba necesita del juego (lo da Game). */
export interface ReadHost {
  readonly cfg: GameConfig;
  readonly hud: Hud;
  /** El lector automático mueve tu raqueta (true) o vuelve lo de antes: el ratón o `?autoplay=` (false). */
  setReader(on: boolean): void;
  /** Partida local de la prueba contra el bot: empezarla (o la siguiente, si acabó un game). */
  playLocal(): void;
  /** Parar la partida local (al acabar la prueba). */
  stopLocal(): void;
  /** Volver al lobby. */
  toMenu(): void;
  /** «El bot (Difícil)» para la explicación. */
  rivalLabel(): string;
}

/** Cambio que la sala tiene que saber: la prueba acabó (manda `rt 0`) o se cerró su resultado. */
export type ReadRoomChange = 'done' | 'closed';

export class ReadFlow {
  private readonly host: ReadHost;
  private readonly ui: ReadUi;
  private readonly total: number;
  private test: ReadTest | null = null;
  /** La última prueba (en curso o acabada) y su resultado: para el E2E (debugState().read). */
  private last: ReadTest | null = null;
  private lastResult: ReadResult | null = null;
  private where: ReadWhere | null = null;
  onRoomChange: (c: ReadRoomChange) => void = () => {};

  constructor(host: ReadHost, hudRoot: HTMLElement) {
    this.host = host;
    this.total = host.cfg.presentation.readTest.shots;
    this.ui = new ReadUi(hudRoot, host.hud);
  }

  /** La prueba está en marcha. */
  get running(): boolean {
    return this.test !== null;
  }

  /** La prueba está en marcha en una sala. */
  get inRoom(): boolean {
    return this.test !== null && this.where === 'room';
  }

  /** Se ve el resultado. */
  get resultUp(): boolean {
    return this.ui.resultShown;
  }

  /** `?read=1`: la explicación con «Empezar» (con `autostart`, empieza ya). */
  intro(autostart: boolean): void {
    if (autostart) return this.startLocal();
    this.ui.showIntro(this.host.rivalLabel(), this.total, () => this.startLocal(), () => this.host.toMenu());
  }

  private startLocal(): void {
    this.start('local');
    this.host.playLocal();
  }

  start(where: ReadWhere): void {
    this.test = new ReadTest(this.total);
    this.last = this.test;
    this.lastResult = null;
    this.where = where;
    this.ui.hideResult();
    this.ui.setProgress(0, this.total);
    this.ui.showLegend(true);
    this.host.setReader(true);
  }

  /** Corta la prueba sin resultado (salir del warm-up, volver al lobby). No toca la capa de pantallas. */
  stop(): void {
    if (!this.test) return;
    this.test = null;
    this.where = null;
    this.ui.showLegend(false);
    this.host.setReader(false);
  }

  /** Eventos de la partida que se ve (`me`: el lado local). */
  onEvent(e: SimEvent, me: Side): void {
    const t = this.test;
    if (!t) return;
    if (e.type === 'hit') {
      if (e.player === me) t.close();
      else t.onRivalHit(e.targets.type, e.serve);
    } else if (e.type === 'point' || e.type === 'let') t.close();
    else return;
    this.ui.setProgress(t.asked, t.total);
    this.ui.setChosen(t.given);
    if (t.done) this.finish();
  }

  /** Teclas 1–5 (fila de números o teclado numérico): la respuesta a la pregunta abierta. Solo local. */
  onKey(e: KeyboardEvent): void {
    const t = this.test;
    if (!t || e.target instanceof HTMLInputElement) return;
    const a: ReadAnswer | undefined = READ_KEYS[e.code];
    if (!a) return;
    e.preventDefault();
    t.answer(a);
    this.ui.setChosen(t.given);
  }

  /** Partida local de la prueba que acabó su game antes de los 30 golpes: sigue con otro. */
  onLocalGameOver(): boolean {
    if (!this.test || this.where !== 'local') return false;
    this.host.playLocal();
    return true;
  }

  private finish(): void {
    const t = this.test;
    const where = this.where;
    if (!t) return;
    const r = t.result();
    this.lastResult = r;
    this.stop();
    if (where === 'local') {
      this.host.stopLocal();
      this.ui.showResult(r, { kind: 'local', again: () => this.startLocal(), menu: () => this.host.toMenu() });
      return;
    }
    this.ui.showResult(r, {
      kind: 'room',
      close: () => {
        this.ui.hideResult();
        this.onRoomChange('closed');
      },
    });
    this.onRoomChange('done');
  }

  /** Estado legible para las pruebas automáticas. */
  debug() {
    const t = this.test ?? this.last;
    return {
      active: this.test !== null,
      where: this.where,
      total: this.total,
      asked: t?.asked ?? 0,
      answered: t?.answered ?? 0,
      correct: t?.correct ?? 0,
      open: this.test?.open ?? null,
      given: this.test?.given ?? null,
      result: this.lastResult,
      resultShown: this.ui.resultShown,
    };
  }
}
