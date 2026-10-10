/**
 * Pantallas de la prueba de lectura (§13.1): la leyenda discreta mientras dura (las teclas, cuántos golpes van y la tecla
 * que ya diste para el golpe en vuelo: solo que se registró, nunca si acierta), la explicación antes de empezar en local
 * y el resultado (aciertos sobre las respondidas, las que faltaron y la tabla de confusiones).
 * La leyenda se construye una vez y solo se toca cuando cambia algo (un golpe, una tecla); textos siempre como texto.
 */
import { READ_ANSWERS, type ReadAnswer, type ReadResult } from '@ppp/shared';
import { button, el, type Hud, setHidden, setText } from './hud.ts';
import { READ_LEGEND, readConfusions, readSummary, SHOT_LABEL } from './texts.ts';

/** Botones del resultado: en local, repetir o volver al lobby; en la sala, seguir con el calentamiento. */
export type ReadResultActions = { kind: 'local'; again(): void; menu(): void } | { kind: 'room'; close(): void };

export class ReadUi {
  private readonly root: HTMLElement;
  private readonly hud: Hud;
  private readonly legend = el('div', 'read-legend');
  private readonly progress = el('span', 'read-progress');
  private readonly chips = new Map<ReadAnswer, HTMLElement>();
  private chosen: ReadAnswer | null = null;
  private readonly intro = el('div', 'panel read-panel');
  private readonly result = el('div', 'panel read-panel');

  constructor(hudRoot: HTMLElement, hud: Hud) {
    this.root = hudRoot;
    this.hud = hud;
    this.legend.append(el('span', 'read-title', 'Prueba de lectura'), this.progress);
    for (const [key, label, a] of READ_LEGEND) {
      const chip = el('span', 'kb read-key');
      chip.append(el('kbd', '', key), el('span', '', label));
      this.chips.set(a, chip);
      this.legend.append(chip);
    }
    this.legend.hidden = true;
    hudRoot.append(this.legend);
  }

  /** Leyenda visible (mientras dura la prueba); la barra de teclas de golpe se oculta (CSS: #hud.reading). */
  showLegend(on: boolean): void {
    setHidden(this.legend, !on);
    this.root.classList.toggle('reading', on);
    if (!on) this.setChosen(null);
  }

  /** «12 / 30»: golpes del rival que ya contaron. */
  setProgress(asked: number, total: number): void {
    setText(this.progress, `${asked} / ${total}`);
  }

  /** Tecla ya dada para el golpe en vuelo (solo que se registró), o null. */
  setChosen(a: ReadAnswer | null): void {
    if (a === this.chosen) return;
    if (this.chosen) this.chips.get(this.chosen)?.classList.remove('on');
    if (a) this.chips.get(a)?.classList.add('on');
    this.chosen = a;
  }

  /** Antes de la prueba local: qué hacer, con «Empezar» (el click también deja sonar el audio). */
  showIntro(rival: string, total: number, onStart: () => void, onMenu: () => void): void {
    const how = el('ul', 'how');
    for (const line of [
      `Mientras la bola del rival viene hacia ti, pulsa ${READ_LEGEND.map(([k, label]) => `${k} ${label}`).join(' · ')}. Cuenta la primera tecla.`,
      'Léelo en la bola: el color de la estela, cómo gira, el sonido del golpe y su ritmo.',
      `${total} golpes (los saques no cuentan). No verás si aciertas hasta el final.`,
    ])
      how.append(el('li', '', line));
    const row = el('div', 'diff');
    row.append(button('Empezar', true, onStart, 'read-start'), button('Volver al lobby', false, onMenu, 'menu'));
    this.intro.replaceChildren(el('h1', 'result', 'Prueba de lectura'), el('p', 'lead', `Tu raqueta devuelve sola. ${rival} mezcla golpes: nombra cada golpe suyo.`), how, row);
    this.hud.showPanel(this.intro);
  }

  /** Resultado de la prueba (se construye una vez por prueba). */
  showResult(r: ReadResult, actions: ReadResultActions): void {
    const s = readSummary(r);
    const score = el('div', 'read-score');
    score.append(el('span', 'read-pct', s.pct), el('span', 'read-pct-label', 'de aciertos'));
    const row = el('div', 'diff');
    if (actions.kind === 'local') row.append(button('Repetir la prueba', true, actions.again, 'read-again'), button('Volver al lobby', false, actions.menu, 'menu'));
    else row.append(button('Seguir', true, actions.close, 'read-close'));
    const confusions = readConfusions(r);
    const list = el('ul', 'how');
    for (const c of confusions) list.append(el('li', '', c));
    this.result.replaceChildren(
      el('h1', 'result', 'Prueba de lectura'),
      score,
      el('p', 'lead', s.line),
      this.table(r),
      el('h2', '', 'En qué te confundes'),
      confusions.length ? list : el('p', 'latency-text', r.answered ? 'Sin confusiones en los golpes que nombraste.' : 'Sin respuestas no hay confusiones que mostrar.'),
      row,
    );
    this.hud.showPanel(this.result);
  }

  /** Tabla de confusiones: una fila por golpe del rival que salió (golpe real → tu respuesta o «sin respuesta»). */
  private table(r: ReadResult): HTMLElement {
    const table = el('table', 'read-table');
    const head = el('tr');
    head.append(el('th', 'k', 'Golpe del rival'));
    READ_ANSWERS.forEach((a, i) => head.append(el('th', '', `${i + 1} ${SHOT_LABEL[a]}`)));
    head.append(el('th', '', 'Sin resp.'));
    table.append(head);
    for (const real of READ_ANSWERS) {
      const cells = r.confusion[real];
      let total = cells.NONE;
      for (const a of READ_ANSWERS) total += cells[a];
      if (!total) continue;
      const tr = el('tr');
      tr.append(el('td', 'k', `${SHOT_LABEL[real]} (${total})`));
      for (const said of READ_ANSWERS) {
        const n = cells[said];
        tr.append(el('td', n === 0 ? 'zero' : said === real ? 'ok' : 'bad', n === 0 ? '·' : String(n)));
      }
      tr.append(el('td', cells.NONE ? 'none' : 'zero', cells.NONE ? String(cells.NONE) : '·'));
      table.append(tr);
    }
    return table;
  }

  /** ¿Se ve el resultado? (la sala lo tapa con sus pantallas si cambia de fase) */
  get resultShown(): boolean {
    return this.hud.isShowing(this.result);
  }

  hideResult(): void {
    if (this.resultShown) this.hud.hideOverlay();
  }
}
