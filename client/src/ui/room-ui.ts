/**
 * Pantallas y avisos de la sala (V0.4) [§14, §15 «Sala»]: la sala esperando rival (código grande y enlace), la franja
 * del calentamiento (el Listo de cada uno, el anillo de Shift y el aviso del timeout), la cuenta atrás, entre games, la
 * pausa por desconexión, el fin del partido con sus estadísticas y los errores. Qué se ve lo decide RoomFlow.
 *
 * Cada elemento se construye una vez y cada método compara con lo último que pintó: la interfaz solo toca el DOM cuando
 * cambia algo. Los nombres y los textos del servidor van siempre como texto (textContent), nunca como HTML.
 */
import type { PlayerStatsWire } from '@ppp/shared';
import { button, el, type Hud, setHidden, setText } from './hud.ts';

export interface RoomUiHandlers {
  onReady(): void;
  /** «Prueba de lectura» / «Dejar la prueba» (§13.1). */
  onReadTest(): void;
  onLeave(): void;
  onCalibrate(): void;
  /** «Seguir» tras las estadísticas del partido. */
  onContinue(): void;
  /** «Volver al lobby» (error) o «Cancelar» (conectando). */
  onLobby(): void;
}

/** El Listo de un jugador en la franja. */
export interface ReadyChip {
  name: string;
  ready: boolean;
  me: boolean;
  away: boolean;
}

export interface EndInfo {
  /** «Has ganado» / «Ha ganado Ana». */
  title: string;
  /** «Games 2-1», con el abandono si lo hubo. */
  sub: string;
  names: [string, string];
  st: [PlayerStatsWire, PlayerStatsWire];
}

/** Pasos del anillo de Shift (cuántas veces cambia como mucho mientras se llena). */
const RING_STEPS = 24;
/** Valores de --p ya formateados: el anillo no crea textos nuevos en cada frame. */
const RING_VALUES = Array.from({ length: RING_STEPS + 1 }, (_, i) => (i / RING_STEPS).toFixed(3));

interface ChipNodes {
  root: HTMLElement;
  mark: HTMLElement;
  name: HTMLElement;
  state: HTMLElement;
}

export class RoomUi {
  private readonly hud: Hud;
  private readonly handlers: RoomUiHandlers;
  // Sala esperando rival.
  private readonly waiting = el('div', 'panel room-panel');
  private readonly codeEl = el('div', 'room-code');
  private readonly modeEl = el('p', 'lead');
  private readonly linkEl = el('span', 'room-link');
  private readonly copyNote = el('p', 'latency-text copy-note');
  private readonly waitNotice = el('p', 'room-notice');
  // Conectando / error.
  private readonly message = el('div', 'panel compact room-panel');
  private readonly msgTitle = el('h2', '');
  private readonly msgText = el('p', 'lead');
  private readonly msgButton: HTMLButtonElement;
  // Fin del partido.
  private readonly end = el('div', 'panel room-panel');
  private endKey: object | null = null;
  // Franja del calentamiento.
  private readonly strip = el('div', 'room-strip');
  private readonly stripTitle = el('div', 'strip-title');
  private readonly chips: [ChipNodes, ChipNodes];
  private readonly warn = el('div', 'strip-warn');
  /** Aviso de la prueba de lectura del rival (§13.1): «Ana está haciendo la prueba de lectura: mezcla golpes». */
  private readonly readNote = el('div', 'strip-read');
  private readonly ring = el('span', 'ready-ring');
  private readonly readyBtn: HTMLButtonElement;
  private readonly readTestBtn: HTMLButtonElement;
  // Centro: cuenta atrás, entre games, pausa, reconexión.
  private readonly center = el('div', 'room-center');
  private readonly big = el('div', 'center-big');
  private readonly sub = el('div', 'center-sub');
  private centerKind = '';
  private ringStep = -1;

  constructor(hudRoot: HTMLElement, hud: Hud, handlers: RoomUiHandlers) {
    this.hud = hud;
    this.handlers = handlers;

    const linkRow = el('div', 'link-row');
    linkRow.append(this.linkEl, button('Copiar enlace', true, () => this.copyLink(), 'copy'));
    const actions = el('div', 'diff');
    actions.append(button('Calibrar latencia', false, () => handlers.onCalibrate(), 'calibrate'), button('Salir de la sala', false, () => handlers.onLeave(), 'leave'));
    this.copyNote.hidden = true;
    this.waitNotice.hidden = true;
    this.waiting.append(el('div', 'room-label', 'Sala'), this.codeEl, this.modeEl, el('p', 'latency-text', 'Pasa este enlace a tu rival (o el código):'), linkRow, this.copyNote, el('p', 'room-wait', 'Esperando rival…'), this.waitNotice, actions);

    this.msgButton = button('Volver al lobby', false, () => handlers.onLobby(), 'lobby');
    const msgRow = el('div', 'diff');
    msgRow.append(this.msgButton);
    this.message.append(this.msgTitle, this.msgText, msgRow);

    const chip = (): ChipNodes => {
      const root = el('span', 'ready-chip');
      const mark = el('span', 'ready-mark');
      const name = el('span', 'ready-name');
      const state = el('span', 'ready-state');
      root.append(mark, name, state);
      return { root, mark, name, state };
    };
    this.chips = [chip(), chip()];
    const players = el('div', 'strip-players');
    players.append(this.chips[0].root, this.chips[1].root);
    this.readyBtn = this.stripButton('Listo', true, () => handlers.onReady(), 'ready');
    this.readTestBtn = this.stripButton('Prueba de lectura', false, () => handlers.onReadTest(), 'read-test');
    this.readTestBtn.hidden = true;
    this.readNote.hidden = true;
    const stripActions = el('div', 'strip-actions');
    stripActions.append(this.ring, this.readyBtn, this.readTestBtn, this.stripButton('Salir', false, () => handlers.onLeave(), 'leave'));
    this.warn.hidden = true;
    this.strip.append(this.stripTitle, players, this.warn, this.readNote, stripActions);
    this.strip.hidden = true;
    this.center.append(this.big, this.sub);
    this.center.hidden = true;
    hudRoot.append(this.strip, this.center);
  }

  /** Botón de la franja: suelta el foco al pulsarlo (si no, Espacio, que es el bloqueo, lo volvería a pulsar). */
  private stripButton(text: string, primary: boolean, onClick: () => void, action: string): HTMLButtonElement {
    const b = button(
      text,
      primary,
      () => {
        b.blur();
        onClick();
      },
      action,
    );
    b.classList.add('small');
    return b;
  }

  // ——— Paneles (capa de pantallas) ———

  showWaiting(code: string, mode: string, link: string, notice: string): void {
    setText(this.codeEl, code);
    setText(this.modeEl, mode);
    if (this.linkEl.textContent !== link) {
      this.linkEl.textContent = link;
      this.copyNote.hidden = true;
    }
    setText(this.waitNotice, notice);
    setHidden(this.waitNotice, notice === '');
    this.hud.showPanel(this.waiting);
  }

  /** Conectando (con «Cancelar») o un error (con «Volver al lobby»). */
  showMessage(title: string, text: string, action: 'cancel' | 'lobby'): void {
    setText(this.msgTitle, title);
    setText(this.msgText, text);
    setHidden(this.msgText, text === '');
    setText(this.msgButton, action === 'cancel' ? 'Cancelar' : 'Volver al lobby');
    const cls = action === 'cancel' ? 'btn' : 'btn primary';
    if (this.msgButton.className !== cls) this.msgButton.className = cls;
    this.hud.showPanel(this.message);
  }

  /** Estadísticas del fin de partido `key` (se construyen una vez por partido: un `mend` es raro). */
  showEnd(key: object, info: () => EndInfo): void {
    if (this.endKey !== key) {
      this.endKey = key;
      this.buildEnd(info());
    }
    this.hud.showPanel(this.end);
  }

  private buildEnd(info: EndInfo): void {
    const table = el('table', 'match-stats');
    const head = el('tr');
    head.append(el('th'), el('th', '', info.names[0]), el('th', '', info.names[1]));
    table.append(head);
    const rows: [string, (s: PlayerStatsWire) => string][] = [
      ['Golpes PERFECT', (s) => `${Math.round(s.pf)} %`],
      ['Racha máxima', (s) => String(s.ms)],
      ['Errores en la red', (s) => String(s.ne)],
      ['Puntos', (s) => String(s.pts)],
    ];
    for (const [label, value] of rows) {
      const tr = el('tr');
      tr.append(el('td', 'k', label), el('td', '', value(info.st[0])), el('td', '', value(info.st[1])));
      table.append(tr);
    }
    const row = el('div', 'diff');
    row.append(button('Seguir', true, () => this.handlers.onContinue(), 'continue'));
    this.end.replaceChildren(el('h1', 'result', info.title), el('p', 'lead', info.sub), table, row);
  }

  /** Quita el panel de la sala que se vea (los ajenos, como el resultado de la calibración, se quedan). */
  hidePanel(): void {
    if (this.hud.isShowing(this.waiting) || this.hud.isShowing(this.message) || this.hud.isShowing(this.end)) this.hud.hideOverlay();
  }

  // ——— Franja del calentamiento ———

  setStrip(visible: boolean, title = ''): void {
    if (this.strip.hidden === !visible) {
      if (visible) setText(this.stripTitle, title);
      return;
    }
    this.strip.hidden = !visible;
    if (visible) setText(this.stripTitle, title);
    // El aviso de punto y el de conexión bajan para no tapar la franja.
    this.strip.parentElement?.classList.toggle('with-strip', visible);
  }

  setChips(a: ReadyChip, b: ReadyChip): void {
    this.chip(this.chips[0], a);
    this.chip(this.chips[1], b);
    setText(this.readyBtn, (a.me ? a.ready : b.ready) ? 'Quitar Listo' : 'Listo');
  }

  private chip(n: ChipNodes, c: ReadyChip): void {
    setText(n.mark, c.ready ? '✓' : '·');
    setText(n.name, c.me ? `${c.name} (tú)` : c.name);
    setText(n.state, c.away ? 'desconectado' : c.ready ? 'Listo' : 'sin Listo');
    const cls = `ready-chip${c.ready ? ' on' : ''}${c.away ? ' away' : ''}`;
    if (n.root.className !== cls) n.root.className = cls;
  }

  /** Listo disponible (no en la prueba de lectura ni con su resultado encima). */
  setReadyEnabled(on: boolean): void {
    if (this.readyBtn.disabled === on) this.readyBtn.disabled = !on;
  }

  /** Botón de la prueba de lectura: visible en el warm-up; «Dejar la prueba» mientras dura. */
  setReadTest(visible: boolean, running: boolean, enabled: boolean): void {
    setHidden(this.readTestBtn, !visible);
    setText(this.readTestBtn, running ? 'Dejar la prueba' : 'Prueba de lectura');
    if (this.readTestBtn.disabled === enabled) this.readTestBtn.disabled = !enabled;
  }

  /** Aviso de la prueba de lectura del rival ('' lo oculta). */
  setReadNote(text: string): void {
    setText(this.readNote, text);
    setHidden(this.readNote, text === '');
  }

  /** Aviso del timeout del Listo ('' lo oculta). */
  setWarn(text: string): void {
    setText(this.warn, text);
    setHidden(this.warn, text === '');
  }

  /** Anillo de Shift: 0…1, en RING_STEPS pasos (solo toca el DOM al cambiar de paso). */
  setRing(p: number): void {
    const step = Math.round(Math.max(0, Math.min(1, p)) * RING_STEPS);
    if (step === this.ringStep) return;
    this.ringStep = step;
    this.ring.style.setProperty('--p', RING_VALUES[step]);
    this.ring.classList.toggle('full', step === RING_STEPS);
  }

  // ——— Centro ———

  /** Texto grande en el centro ('' lo oculta); `kind` da el estilo: count (3-2-1-GO), info (entre games, pausa…). */
  setCenter(big: string, sub: string, kind: 'count' | 'info'): void {
    if (big === '') {
      if (!this.center.hidden) this.center.hidden = true;
      return;
    }
    setText(this.big, big);
    setText(this.sub, sub);
    setHidden(this.sub, sub === '');
    if (this.centerKind !== kind) {
      this.centerKind = kind;
      this.center.className = `room-center ${kind}`;
    }
    if (this.center.hidden) this.center.hidden = false;
  }

  hideAll(): void {
    this.hidePanel();
    this.setStrip(false);
    this.setCenter('', '', 'info');
  }

  // ——— Copiar enlace ———

  private copyLink(): void {
    const link = this.linkEl.textContent ?? '';
    const fallback = () => {
      // Sin portapapeles (http sin localhost, permisos): el enlace queda seleccionado para copiarlo a mano.
      const sel = window.getSelection();
      if (sel) {
        const r = document.createRange();
        r.selectNodeContents(this.linkEl);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      this.note('Enlace seleccionado: cópialo con Ctrl+C.');
    };
    try {
      if (!navigator.clipboard) return fallback();
      navigator.clipboard.writeText(link).then(() => this.note('Enlace copiado.'), fallback);
    } catch {
      fallback();
    }
  }

  private note(text: string): void {
    setText(this.copyNote, text);
    this.copyNote.hidden = false;
  }
}
