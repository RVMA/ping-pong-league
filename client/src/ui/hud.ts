/**
 * HUD en DOM: marcador de tarjetas abatibles, mensajes de golpe junto a la raqueta [§5.2],
 * aviso de fin de punto, pantallas de inicio / pausa / fin y panel de datos de precisión.
 */
import type { BotDifficulty } from '@ppp/shared';
import { assetUrl, CHARACTERS, type CharacterId, UI_ASSETS } from '../assets/manifest.ts';

export type FeedbackKind = 'good' | 'perfect-1' | 'perfect-2' | 'perfect-3' | 'perfect-4' | 'label';

export interface GameOverInfo {
  won: boolean;
  score: [number, number];
  perfectPct: number;
  maxStreak: number;
  netErrors: number;
  hits: number;
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
  private toastTimer = 0;

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
    root.append(board, this.toast, this.hint, this.debug, this.overlay);
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

  /** Mensaje de golpe pequeño junto a la raqueta: sube y se desvanece [§5.2]. */
  feedback(text: string, kind: FeedbackKind, x: number, y: number, scale = 1, durationMs = 400): void {
    const node = el('div', `fb fb-${kind}`, text);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.setProperty('--s', String(scale));
    node.style.setProperty('--d', `${durationMs}ms`);
    this.root.append(node);
    node.addEventListener('animationend', () => node.remove());
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

  showStart(current: BotDifficulty, labels: Record<BotDifficulty, string>, onPick: (d: BotDifficulty) => void): void {
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
    panel.append(el('p', 'lead', 'Un game a 11 contra el bot. Prototipo V0.1 para probar el tacto del golpe.'));
    panel.append(el('h2', '', 'Elige rival'));
    panel.append(this.difficultyButtons(current, labels, onPick));
    const how = el('ul', 'how');
    for (const line of [
      'Mueve el ratón: la raqueta te sigue con algo de inercia.',
      'Haz click justo cuando la bola llega al centro de la raqueta. A tiempo y centrado es ¡Perfecto!',
      'Pronto: la bola sale baja y puede ir a la red. Tarde: sale alta y lenta.',
      'Para sacar, click (o espera un segundo) y otro click cuando la bola baje.',
      'Mueve el ratón hacia un lado al golpear para cruzar la bola.',
      'D muestra los datos de precisión. Esc pausa.',
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
      ['Golpes', String(info.hits)],
    ]) {
      const d = el('div');
      d.append(el('dt', '', k), el('dd', '', v));
      stats.append(d);
    }
    panel.append(stats, el('h2', '', 'Otra partida'), this.difficultyButtons(current, labels, onPick));
    this.overlay.replaceChildren(panel);
    this.overlay.className = 'overlay show';
  }
}
