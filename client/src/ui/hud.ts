/**
 * HUD en DOM: marcador de tarjetas abatibles, mensajes de golpe junto a la raqueta [§5.2],
 * aviso de fin de punto, barra de teclas de golpe (V0.2b), pantallas de inicio / pausa / fin y panel de datos
 * de precisión.
 */
import type { BotDifficulty, PingLevel, ShotType } from '@ppp/shared';
import { assetUrl, CHARACTERS, type CharacterId, UI_ASSETS } from '../assets/manifest.ts';

export type FeedbackKind = 'good' | 'perfect-1' | 'perfect-2' | 'perfect-3' | 'perfect-4' | 'label';

export interface GameOverInfo {
  won: boolean;
  score: [number, number];
  perfectPct: number;
  maxStreak: number;
  netErrors: number;
  outErrors: number;
  hits: number;
  /** "Topspin 5 · Slice 2 · …" */
  shots: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

class FlipCard {
  readonly root = el('div', 'flip');
  private readonly num = el('span', 'flip-num', '0');
  private value = 0;
  constructor() {
    this.root.append(this.num);
  }
  set(v: number): void {
    if (v === this.value) return;
    this.value = v;
    this.num.textContent = String(v);
    this.root.classList.remove('flipping');
    void this.root.offsetWidth; // reinicia la animación
    this.root.classList.add('flipping');
  }
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly cards: [FlipCard, FlipCard] = [new FlipCard(), new FlipCard()];
  private readonly serveDots: [HTMLElement, HTMLElement];
  private readonly toast = el('div', 'toast');
  private readonly debug = el('div', 'debug');
  private readonly overlay = el('div', 'overlay');
  private readonly hint = el('div', 'hint');
  private readonly botLabel = el('span', 'bot-diff');
  private readonly keybar = el('div', 'keybar');
  private readonly keyChips = new Map<ShotType, HTMLElement>();
  private keyActive: ShotType | null = null;
  private toastTimer = 0;
  /** Ping de cada jugador junto a su nombre (solo online) y aviso de conexión inestable [§15.1]. */
  private readonly pings: [HTMLElement, HTMLElement] = [el('span', 'ping'), el('span', 'ping')];
  private readonly netWarn = el('div', 'net-warn', 'Conexión inestable, el timing puede verse afectado');
  private pingText: [string, string] = ['', ''];

  constructor(root: HTMLElement, characters: [CharacterId, CharacterId]) {
    this.root = root;
    const board = el('div', 'scoreboard');
    const side = (i: 0 | 1, name: string) => {
      const ch = CHARACTERS[characters[i]];
      const wrap = el('div', `side side-${i}`);
      const img = el('img', 'portrait');
      img.alt = '';
      img.src = assetUrl(ch.portrait) ?? '';
      img.style.borderColor = ch.color;
      const label = el('div', 'name');
      label.append(el('span', '', name));
      if (i === 1) label.append(this.botLabel);
      this.pings[i].hidden = true;
      label.append(this.pings[i]);
      const dot = el('span', 'serve-dot');
      dot.title = 'Saca';
      wrap.append(img, label, dot);
      return { wrap, dot };
    };
    const a = side(0, 'Tú');
    const b = side(1, 'Bot');
    this.serveDots = [a.dot, b.dot];
    const cards = el('div', 'cards');
    cards.append(this.cards[0].root, this.cards[1].root);
    board.append(a.wrap, cards, b.wrap);
    this.hint.textContent = 'Mueve el ratón para colocar la raqueta. Click cuando la bola llegue.';
    this.debug.hidden = true;
    // Barra de teclas de golpe (V0.2b): esquina inferior izquierda, nunca sobre la mesa [§5.2]. Cada tecla lleva
    // su letra y su nombre; el color de la tecla mantenida es un extra, no la única señal [§19].
    for (const [key, name, type] of [
      ['Q', 'Slice', 'SLICE'],
      ['W', 'Topspin', 'TOPSPIN'],
      ['E', 'Smash', 'SMASH'],
      ['Espacio', 'Bloqueo', 'BLOCK'],
    ] as [string, string, ShotType][]) {
      const chip = el('div', `kb kb-${type.toLowerCase()}`);
      chip.append(el('kbd', '', key), el('span', '', name));
      this.keyChips.set(type, chip);
      this.keybar.append(chip);
    }
    this.keybar.append(el('span', 'kb-tab', 'Tab: ocultar'));
    this.keybar.hidden = true;
    this.netWarn.hidden = true;
    root.append(board, this.netWarn, this.toast, this.hint, this.keybar, this.debug, this.overlay);
  }

  /**
   * Ping de los dos jugadores [§15.1] (media de las últimas 5 medidas), con su color y siempre con el número [§19]:
   * < 60 ms verde, 60–120 amarillo, > 120 rojo y aviso. null = modo local (se oculta).
   */
  setPings(values: [number | null, number | null] | null, levels: [PingLevel, PingLevel]): void {
    let warn = false;
    for (const i of [0, 1] as const) {
      const node = this.pings[i];
      if (!values) {
        node.hidden = true;
        continue;
      }
      const v = values[i];
      const text = v === null ? '… ms' : `${Math.round(v)} ms`;
      const cls = `ping ping-${levels[i]}`;
      if (text !== this.pingText[i] || node.className !== cls) {
        node.textContent = text;
        node.className = cls;
        node.title = levels[i] === 'bad' ? 'Ping alto' : levels[i] === 'fair' ? 'Ping medio' : levels[i] === 'good' ? 'Ping bajo' : 'Midiendo';
        this.pingText[i] = text;
      }
      node.hidden = false;
      if (levels[i] === 'bad') warn = true;
    }
    this.netWarn.hidden = !warn;
  }

  /** Pantalla de conexión (conectando, error, conexión perdida) con un botón opcional para volver al menú. */
  showConnection(title: string, text: string, onMenu?: () => void): void {
    const panel = el('div', 'panel compact');
    panel.append(el('h2', '', title));
    if (text) panel.append(el('p', 'lead', text));
    if (onMenu) panel.append(this.button('Volver al menú', true, onMenu, 'menu'));
    this.overlay.replaceChildren(panel);
    this.overlay.className = 'overlay show';
  }

  /** Muestra u oculta la barra de teclas (solo durante la partida). */
  showKeyBar(visible: boolean): void {
    this.keybar.hidden = !visible;
  }

  get keyBarVisible(): boolean {
    return !this.keybar.hidden;
  }

  /** Ilumina la tecla de golpe mantenida (null = ninguna). */
  setKeyBarActive(type: ShotType | null): void {
    if (type === this.keyActive) return;
    if (this.keyActive) this.keyChips.get(this.keyActive)?.classList.remove('on');
    if (type) this.keyChips.get(type)?.classList.add('on');
    this.keyActive = type;
  }

  get keyBarActive(): ShotType | null {
    return this.keyActive;
  }

  setScore(score: [number, number], server: 0 | 1): void {
    this.cards[0].set(score[0]);
    this.cards[1].set(score[1]);
    this.serveDots[0].classList.toggle('on', server === 0);
    this.serveDots[1].classList.toggle('on', server === 1);
  }

  setBotDifficulty(label: string): void {
    this.botLabel.textContent = label;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  /**
   * Mensaje de golpe pequeño junto a la raqueta: sube y se desvanece [§5.2]. `sub`: segunda línea más pequeña
   * (el tipo de golpe propio: Topspin, Slice, Smash, Bloqueo).
   */
  feedback(text: string, kind: FeedbackKind, x: number, y: number, scale = 1, durationMs = 400, sub?: string): HTMLElement {
    const node = el('div', `fb fb-${kind}`, text);
    if (sub) node.append(el('span', 'fb-sub', sub));
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.setProperty('--s', String(scale));
    node.style.setProperty('--d', `${durationMs}ms`);
    this.root.append(node);
    node.addEventListener('animationend', () => node.remove());
    return node;
  }

  /**
   * Cambia la segunda línea de un mensaje que aún se ve (p. ej. «pulsaste W después del click») y, si se indica,
   * alarga su duración total para que dé tiempo a leerla.
   */
  setFeedbackSub(node: HTMLElement, sub: string, durationMs?: number): void {
    if (!node.isConnected) return;
    if (durationMs !== undefined) node.style.setProperty('--d', `${durationMs}ms`);
    let span = node.querySelector<HTMLElement>('.fb-sub');
    if (!span) {
      span = el('span', 'fb-sub');
      node.append(span);
    }
    span.textContent = sub;
  }

  showToast(text: string, tone: 'win' | 'lose' | 'neutral', ms = 1500): void {
    this.toast.textContent = text;
    this.toast.className = `toast show ${tone}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.className = 'toast'), ms);
  }

  setDebug(lines: [string, string][] | null): void {
    this.debug.hidden = lines === null;
    if (!lines) return;
    this.debug.replaceChildren(
      ...lines.map(([k, v]) => {
        const row = el('div', 'row');
        row.append(el('span', 'k', k), el('span', 'v', v));
        return row;
      }),
    );
  }

  get debugVisible(): boolean {
    return !this.debug.hidden;
  }

  hideOverlay(): void {
    this.overlay.className = 'overlay';
    this.overlay.replaceChildren();
  }

  private difficultyButtons(current: BotDifficulty, labels: Record<BotDifficulty, string>, onPick: (d: BotDifficulty) => void): HTMLElement {
    const group = el('div', 'diff');
    for (const d of ['easy', 'medium', 'hard'] as BotDifficulty[]) {
      const b = el('button', d === current ? 'btn primary' : 'btn', labels[d]);
      b.dataset.difficulty = d;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(d);
      });
      group.append(b);
    }
    return group;
  }

  private button(text: string, primary: boolean, onClick: () => void, id?: string): HTMLButtonElement {
    const b = el('button', primary ? 'btn primary' : 'btn', text);
    if (id) b.dataset.action = id;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  /** Bloque de latencia de la pantalla de inicio (hará de lobby hasta que haya salas en V0.4). */
  private latencySection(offsetMs: number | null, onCalibrate: () => void): HTMLElement {
    const wrap = el('div', 'latency');
    const text =
      offsetMs === null
        ? 'Sin calibrar. Si tus golpes suelen salir tarde, calibra: son 12 bolas, menos de un minuto.'
        : `Tu desfase de latencia: ${offsetMs > 0 ? '+' : ''}${offsetMs} ms. Se descuenta de cada click.`;
    wrap.append(el('p', 'latency-text', text), this.button(offsetMs === null ? 'Calibrar latencia' : 'Volver a calibrar', false, onCalibrate, 'calibrate'));
    return wrap;
  }

  /** Aviso fijo arriba durante la calibración (no bloquea los clicks sobre la escena). */
  setBanner(title: string | null, detail = ''): void {
    let banner = this.root.querySelector<HTMLElement>('.banner');
    if (title === null) {
      banner?.remove();
      return;
    }
    if (!banner) {
      banner = el('div', 'banner');
      this.root.append(banner);
    }
    banner.replaceChildren(el('div', 'banner-title', title), el('div', 'banner-detail', detail));
  }

  showCalibrationResult(
    r: { offsetMs: number; medianMs: number; samples: number[]; misses: number; clamped: boolean; enough: boolean },
    onSave: () => void,
    onRetry: () => void,
    onCancel: () => void,
  ): void {
    const panel = el('div', 'panel');
    if (!r.enough) {
      panel.append(el('h1', 'result', 'Faltan clicks'));
      panel.append(el('p', 'lead', `Solo ${r.samples.length} clicks válidos. Haz click en cada bola, justo cuando llegue al centro de tu raqueta.`));
      const row = el('div', 'diff');
      row.append(this.button('Repetir', true, onRetry, 'retry'), this.button('Cancelar', false, onCancel, 'cancel'));
      panel.append(row);
    } else {
      const sign = r.offsetMs > 0 ? '+' : '';
      panel.append(el('h1', 'result', `Desfase: ${sign}${r.offsetMs} ms`));
      const explain =
        r.offsetMs > 5
          ? `De media haces click ${r.offsetMs} ms después de que la bola llegue. Esa diferencia se descontará de tus golpes.`
          : r.offsetMs < -5
            ? `De media haces click ${-r.offsetMs} ms antes de que la bola llegue. Esa diferencia se compensará en tus golpes.`
            : 'Tus clicks llegan prácticamente a tiempo: casi no hace falta corregir nada.';
      panel.append(el('p', 'lead', explain));
      const spread = r.samples.length ? Math.round(Math.max(...r.samples) - Math.min(...r.samples)) : 0;
      const details = [`${r.samples.length} clicks válidos, ${r.misses} sin respuesta, dispersión ${spread} ms.`];
      if (r.clamped) details.push(`La mediana fue ${sign}${r.medianMs} ms; se limita al rango permitido.`);
      panel.append(el('p', 'latency-text', details.join(' ')));
      const row = el('div', 'diff');
      row.append(this.button('Guardar', true, onSave, 'save'), this.button('Repetir', false, onRetry, 'retry'), this.button('Cancelar', false, onCancel, 'cancel'));
      panel.append(row);
    }
    this.overlay.replaceChildren(panel);
    this.overlay.className = 'overlay show';
  }

  /** Interruptor "¿Por qué fallé?" [§2.2: siempre, desactivable]. */
  private explainToggle(on: boolean, onToggle: (on: boolean) => void): HTMLElement {
    const wrap = el('div', 'latency');
    const b = this.button(on ? 'Explicar mis errores: sí' : 'Explicar mis errores: no', false, () => {
      const next = b.dataset.on !== '1';
      b.dataset.on = next ? '1' : '0';
      b.textContent = next ? 'Explicar mis errores: sí' : 'Explicar mis errores: no';
      onToggle(next);
    }, 'explain');
    b.dataset.on = on ? '1' : '0';
    wrap.append(el('p', 'latency-text', 'Al perder un punto por un error tuyo, una frase dice la causa (pronto, bola baja, ángulo, smash bajo…).'), b);
    return wrap;
  }

  showStart(
    current: BotDifficulty,
    labels: Record<BotDifficulty, string>,
    onPick: (d: BotDifficulty) => void,
    latency?: { offsetMs: number | null; onCalibrate: () => void },
    explain?: { on: boolean; onToggle: (on: boolean) => void },
    online?: string,
  ): void {
    const panel = el('div', 'panel');
    const logoUrl = assetUrl(UI_ASSETS.logo);
    if (logoUrl) {
      const img = el('img', 'logo');
      img.src = logoUrl;
      img.alt = 'Ping Pong PvP';
      panel.append(img);
    } else {
      panel.append(el('h1', '', 'Ping Pong PvP'));
    }
    panel.append(el('p', 'lead', online ? 'Un game a 11 contra el bot remoto, por la red. Prototipo V0.3: cada uno golpea en su tiempo.' : 'Un game a 11 contra el bot. Prototipo V0.3 (en local).'));
    if (online) panel.append(el('p', 'latency-text online-info', online));
    panel.append(el('h2', '', 'Elige rival'));
    panel.append(this.difficultyButtons(current, labels, onPick));
    if (latency) {
      panel.append(el('h2', '', 'Latencia'));
      panel.append(this.latencySection(latency.offsetMs, latency.onCalibrate));
    }
    if (explain) panel.append(this.explainToggle(explain.on, explain.onToggle));
    const how = el('ul', 'how');
    for (const line of [
      'Mueve el ratón: la raqueta te sigue con algo de inercia. Click justo cuando la bola llega al centro: ¡Perfecto!',
      'Pronto: la bola sale baja y puede ir a la red. Tarde: sale alta y lenta.',
      'Tipo de golpe: mantén una tecla y haz click. Q slice (curva y va a la banda). W topspin (más rápido, cae antes). E smash (solo con la bola alta). Sin tecla: golpe normal.',
      'La fuerza sale de tu golpe: ¡Perfecto! = golpe completo; Bien = reducido; pronto, tarde o con el borde = flojo y más arriesgado. Si llegas corriendo, la mitad.',
      'Cruzar la bola: con la raqueta ya colocada, un gesto lateral seco del ratón al hacer click.',
      'Bloqueo: mantén Espacio y haz click. Devuelve con la fuerza de la bola que llega; mientras lo mantienes, la raqueta va más lenta.',
      'Para sacar, click (o espera un segundo) y otro click cuando la bola baje. Tab: barra de teclas. D: datos de precisión. Esc: pausa.',
    ])
      how.append(el('li', '', line));
    panel.append(how);
    this.overlay.replaceChildren(panel);
    this.overlay.className = 'overlay show';
  }

  showPause(onResume: () => void): void {
    const panel = el('div', 'panel compact');
    panel.append(el('h2', '', 'Pausa'));
    const b = el('button', 'btn primary', 'Seguir jugando');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onResume();
    });
    panel.append(b);
    this.overlay.replaceChildren(panel);
    this.overlay.className = 'overlay show';
  }

  showGameOver(info: GameOverInfo, current: BotDifficulty, labels: Record<BotDifficulty, string>, onPick: (d: BotDifficulty) => void): void {
    const panel = el('div', 'panel');
    panel.append(el('h1', 'result', info.won ? 'Has ganado' : 'Ha ganado el bot'));
    const score = el('div', 'final-score');
    score.append(el('span', 'flip big', String(info.score[0])), el('span', 'flip big', String(info.score[1])));
    panel.append(score);
    const stats = el('dl', 'stats');
    for (const [k, v] of [
      ['Golpes PERFECT', `${Math.round(info.perfectPct)} %`],
      ['Racha máxima', String(info.maxStreak)],
      ['Bolas a la red', String(info.netErrors)],
      ['Bolas fuera', String(info.outErrors)],
      ['Golpes', String(info.hits)],
      ['Por tipo', info.shots],
    ]) {
      const d = el('div', k === 'Por tipo' ? 'wide' : undefined);
      d.append(el('dt', '', k), el('dd', '', v));
      stats.append(d);
    }
    panel.append(stats, el('h2', '', 'Otra partida'), this.difficultyButtons(current, labels, onPick));
    this.overlay.replaceChildren(panel);
    this.overlay.className = 'overlay show';
  }
}
