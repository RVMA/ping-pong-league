/**
 * Lobby (V0.4) [§14.1, §3.7 ✅]: tu nombre (guardado en este navegador), crear una sala (Rápido · Estándar · Completo,
 * marcada Estándar), unirse con su código, calibrar la latencia, jugar contra el bot en local y «Explicar mis errores».
 * Y la pantalla corta que pide el nombre al entrar por un enlace `?room=` sin nombre guardado.
 *
 * Se construye una vez; al volver a enseñarlo solo cambian los textos que cambiaron (setText). El nombre se limpia como
 * en el servidor antes de usarlo y todo se pinta como texto.
 */
import { type BotDifficulty, cleanName, type GameConfig, type MatchMode, normalizeCode } from '@ppp/shared';
import { codeFieldText, modeText } from '../game/room-logic.ts';
import { button, difficultyButtons, el, explainToggle, howToPlay, logo, setText } from './hud.ts';

export interface LobbyHandlers {
  onCreate(mode: MatchMode, name: string): void;
  onJoin(code: string, name: string): void;
  onCalibrate(): void;
  onLocal(d: BotDifficulty): void;
  onExplain(on: boolean): void;
  /** El nombre cambió en el campo (se guarda en este navegador). */
  onName(name: string): void;
}

/** Lo que el lobby enseña y puede cambiar entre visitas. */
export interface LobbyState {
  name: string;
  offsetMs: number | null;
  explain: boolean;
  labels: Record<BotDifficulty, string>;
  difficulty: BotDifficulty;
  /** Aviso (código no válido, falta el nombre…) o ''. */
  notice: string;
}

const MODES: readonly MatchMode[] = ['quick', 'standard', 'full'];
const NAME_MISSING = 'Escribe tu nombre (hasta 16 letras).';
/** Caracteres que admite el campo del código antes de limpiarlo (codeFieldText lo deja en codeLength). */
const CODE_FIELD_MAX = 12;

function textInput(cls: string, max: number, placeholder: string): HTMLInputElement {
  const i = el('input', cls);
  i.type = 'text';
  i.maxLength = max;
  i.placeholder = placeholder;
  i.autocomplete = 'off';
  i.spellcheck = false;
  return i;
}

export class Lobby {
  readonly panel = el('div', 'panel lobby');
  /** Pantalla del nombre antes de entrar por un enlace. */
  readonly prompt = el('div', 'panel compact name-prompt');
  private readonly cfg: GameConfig;
  private readonly handlers: LobbyHandlers;
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly notice = el('p', 'lobby-notice');
  private readonly latencyText = el('p', 'latency-text');
  private readonly calibrateBtn: HTMLButtonElement;
  private readonly modeBtns = new Map<MatchMode, HTMLButtonElement>();
  private readonly botBox = el('div', 'bot-box');
  private botKey = '';
  private mode: MatchMode;
  private explainBox: HTMLElement | null = null;
  private readonly promptTitle = el('h2', '');
  private readonly promptInput: HTMLInputElement;
  private readonly promptNotice = el('p', 'lobby-notice');
  private promptEnter: (name: string) => void = () => {};
  private promptCancel: () => void = () => {};

  constructor(cfg: GameConfig, handlers: LobbyHandlers) {
    this.cfg = cfg;
    this.handlers = handlers;
    this.mode = cfg.room.defaultMode;
    const max = cfg.room.nameMaxLength;

    this.nameInput = textInput('field name-field', max, 'Ana');
    this.nameInput.addEventListener('input', () => {
      const n = this.cleaned(this.nameInput.value);
      if (n) handlers.onName(n);
    });
    const nameRow = el('label', 'field-row');
    nameRow.append(el('span', 'field-label', 'Tu nombre'), this.nameInput);

    const seg = el('div', 'seg');
    for (const m of MODES) {
      const b = el('button', 'seg-btn');
      b.type = 'button';
      b.dataset.mode = m;
      const [name, detail] = modeText(m, cfg).split(' · ');
      b.append(el('span', 'seg-name', name), el('span', 'seg-detail', detail));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pickMode(m);
      });
      this.modeBtns.set(m, b);
      seg.append(b);
    }
    this.pickMode(this.mode);
    const createRow = el('div', 'diff');
    createRow.append(seg, button('Crear sala', true, () => this.create(), 'create'));

    // El campo admite más que el código: lo pegado con espacios alrededor (« tkjv») se limpia en vez de cortarse.
    this.codeInput = textInput('field code-field', CODE_FIELD_MAX, 'ABCD');
    this.codeInput.addEventListener('input', () => {
      const v = codeFieldText(this.codeInput.value, cfg.room.codeLength);
      if (v !== this.codeInput.value) this.codeInput.value = v;
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.join();
    });
    const joinRow = el('div', 'diff');
    joinRow.append(this.codeInput, button('Unirse', false, () => this.join(), 'join'));

    this.calibrateBtn = button('Calibrar latencia', false, () => handlers.onCalibrate(), 'calibrate');
    const latency = el('div', 'latency');
    latency.append(this.latencyText, this.calibrateBtn);

    const how = el('details', 'how-box');
    how.append(el('summary', '', 'Cómo se juega'), howToPlay());

    this.panel.append(
      logo(),
      el('p', 'lead', 'Partido entre dos personas: crea una sala y pásale el enlace a tu rival, o únete con su código.'),
      nameRow,
      el('h2', '', 'Crear sala'),
      createRow,
      el('h2', '', 'Unirse'),
      joinRow,
      this.notice,
      el('h2', '', 'Latencia'),
      latency,
      el('h2', '', 'Contra el bot (en local)'),
      this.botBox,
      how,
    );

    this.promptInput = textInput('field name-field', max, 'Ana');
    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.enterPrompt();
    });
    const promptRow = el('label', 'field-row');
    promptRow.append(el('span', 'field-label', 'Tu nombre'), this.promptInput);
    const promptActions = el('div', 'diff');
    promptActions.append(button('Entrar', true, () => this.enterPrompt(), 'enter'), button('Ir al lobby', false, () => this.promptCancel(), 'lobby'));
    this.prompt.append(this.promptTitle, promptRow, this.promptNotice, promptActions);
  }

  /** Prepara el lobby con su estado (solo toca lo que cambió) y lo devuelve para enseñarlo. */
  show(s: LobbyState): HTMLElement {
    if (document.activeElement !== this.nameInput && this.cleaned(this.nameInput.value) !== s.name) this.nameInput.value = s.name;
    setText(this.notice, s.notice);
    this.notice.hidden = s.notice === '';
    const o = s.offsetMs;
    setText(this.latencyText, o === null ? 'Sin calibrar. Si tus golpes suelen salir tarde, calibra: son 12 bolas, menos de un minuto.' : `Tu desfase de latencia: ${o > 0 ? '+' : ''}${o} ms. Se descuenta de cada click.`);
    setText(this.calibrateBtn, o === null ? 'Calibrar latencia' : 'Volver a calibrar');
    // Dificultades: se rehacen solo si cambia la que está destacada.
    if (this.botKey !== s.difficulty) {
      this.botKey = s.difficulty;
      this.botBox.replaceChildren(difficultyButtons(s.difficulty, s.labels, (d) => this.handlers.onLocal(d)));
    }
    if (!this.explainBox) {
      this.explainBox = explainToggle(s.explain, (on) => this.handlers.onExplain(on));
      this.botBox.after(this.explainBox);
    }
    return this.panel;
  }

  /** Pide el nombre antes de entrar en la sala `title` (enlace sin nombre guardado). */
  showPrompt(title: string, name: string, notice: string, onEnter: (name: string) => void, onCancel: () => void): HTMLElement {
    setText(this.promptTitle, title);
    if (document.activeElement !== this.promptInput) this.promptInput.value = name;
    setText(this.promptNotice, notice);
    this.promptNotice.hidden = notice === '';
    this.promptEnter = onEnter;
    this.promptCancel = onCancel;
    return this.prompt;
  }

  /** Pone el foco en el campo del nombre de la pantalla corta (después de enseñarla). */
  focusPrompt(): void {
    this.promptInput.focus();
  }

  private cleaned(raw: string): string {
    return cleanName(raw, '', this.cfg);
  }

  private pickMode(m: MatchMode): void {
    this.mode = m;
    for (const [k, b] of this.modeBtns) {
      b.classList.toggle('on', k === m);
      b.setAttribute('aria-pressed', k === m ? 'true' : 'false');
    }
  }

  /** El nombre del campo, o null (con el aviso y el foco en el campo) si falta. */
  private nameOrAsk(): string | null {
    const n = this.cleaned(this.nameInput.value);
    if (n) return n;
    this.say(NAME_MISSING);
    this.nameInput.focus();
    return null;
  }

  private say(text: string): void {
    setText(this.notice, text);
    this.notice.hidden = text === '';
  }

  private create(): void {
    const name = this.nameOrAsk();
    if (name) this.handlers.onCreate(this.mode, name);
  }

  private join(): void {
    const code = normalizeCode(this.codeInput.value, this.cfg);
    // Solo códigos de sala de personas (4 letras); `b-<n>` es una sala del bot remoto.
    if (!code || code.length !== this.cfg.room.codeLength) {
      this.say(this.codeInput.value.trim() ? 'Código de sala no válido' : 'Escribe el código de la sala (4 letras).');
      this.codeInput.focus();
      return;
    }
    const name = this.nameOrAsk();
    if (name) this.handlers.onJoin(code, name);
  }

  private enterPrompt(): void {
    const n = this.cleaned(this.promptInput.value);
    if (!n) {
      setText(this.promptNotice, NAME_MISSING);
      this.promptNotice.hidden = false;
      this.promptInput.focus();
      return;
    }
    this.promptEnter(n);
  }
}
