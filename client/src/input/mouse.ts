/**
 * Traductor ratón + teclado → InputIntent [§3.1, §3.3]. Es el ÚNICO sitio que lee eventos del ratón y de las
 * teclas de juego: la simulación solo recibe intentos. Añadir trackpad o táctil (V0.7) será escribir otro traductor.
 *
 *  - target: el cursor proyectado sobre un plano horizontal a la altura de la mesa (coordenadas
 *    del jugador: x lateral, z profundidad desde la red).
 *  - swing: velocidad del cursor en los últimos ~150 ms, en alturas de pantalla por segundo. Desde V0.2b solo
 *    cuenta el gesto lateral: cruzar la bola (§4.5).
 *  - fire: instante del click en ms de tiempo de juego (timestamp del propio evento, no del frame).
 *  - modifiers: teclas de golpe (V0.2b: W topspin, S slice, E smash) mantenidas EN EL INSTANTE DEL CLICK: se
 *    fotografían en el propio evento del click, así una tecla pulsada justo después no cuenta.
 *  - block: Space mantenido.
 */
import { type InputIntent, neutralIntent, type ShotKeys, type Side, sideSign } from '@ppp/shared';
import * as THREE from 'three';

const SWING_WINDOW_MS = 150;
/** Teclas de golpe (código físico: en un teclado AZERTY son las mismas posiciones). */
const SHOT_KEYS: Record<string, keyof ShotKeys> = { KeyW: 'topspin', KeyS: 'slice', KeyE: 'smash' };
export const SHOT_KEY_LABEL: Record<keyof ShotKeys, string> = { topspin: 'W', slice: 'S', smash: 'E' };
/** Ventana para avisar de que la tecla se soltó justo antes del click o se pulsó justo después. */
export const KEY_NOTE_MS = 200;

/** Un click y las teclas de golpe que había en su instante. */
export interface FireRecord {
  /** Instante en tiempo de juego (ya corregido con la latencia). */
  t: number;
  /** performance.now() del evento. */
  perf: number;
  keys: ShotKeys;
  /** Sin tecla en el click: la última tecla de golpe soltada justo antes (ms antes del click). */
  releasedBefore: { key: string; ms: number } | null;
  /** Sin tecla en el click: la primera tecla de golpe pulsada justo después (ms después del click). */
  pressedAfter: { key: string; ms: number } | null;
}

interface PointerSample {
  /** performance.now() del evento. */
  t: number;
  x: number;
  y: number;
}

export interface InputClock {
  /** performance.now() que corresponde al tiempo de juego 0. */
  epoch: number;
}

export class MouseTranslator {
  private samples: PointerSample[] = [];
  private fires: FireRecord[] = [];
  /** Teclas de golpe mantenidas ahora y cuándo se soltó cada una por última vez. */
  private held: ShotKeys = {};
  private lastUp: Partial<Record<keyof ShotKeys, number>> = {};
  /** Último click entregado a la simulación (para explicar el golpe que salió). */
  lastFire: FireRecord | null = null;
  /** Último click recibido (aún sin entregar o ya entregado). */
  private lastClick: FireRecord | null = null;
  /** Aviso al pulsar una tecla de golpe (etiqueta W/S/E y performance.now()). */
  onShotKeyDown: ((key: string, perf: number) => void) | null = null;
  private target = { x: 0, z: 1.7 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane: THREE.Plane;
  private readonly hitPoint = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly el: HTMLElement;
  private readonly camera: THREE.Camera;
  private readonly clock: InputClock;
  private readonly side: Side;
  enabled = true;
  /**
   * Desfase de latencia del jugador (ms, calibración P7): se resta al instante de cada click para
   * compensar el retardo de pantalla y de entrada. Positivo = sus clicks llegan tarde respecto a lo que ve.
   */
  latencyOffsetMs = 0;
  /** Bloqueo: Space mantenido [§3.3, §8]. El click con Space mantenido es un bloqueo. */
  private blockHeld = false;
  /** Con la partida en marcha, Space no llega a la página (no hace scroll ni pulsa botones). */
  captureKeys = false;

  constructor(el: HTMLElement, camera: THREE.Camera, planeY: number, clock: InputClock, side: Side = 0) {
    this.el = el;
    this.camera = camera;
    this.clock = clock;
    this.side = side;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
  }

  /** ¿Space mantenido ahora? (para el panel y la raqueta). */
  get blocking(): boolean {
    return this.blockHeld;
  }

  /** Teclas de golpe mantenidas ahora (solo las pulsadas). */
  heldKeys(): ShotKeys {
    const k: ShotKeys = {};
    if (this.held.topspin) k.topspin = true;
    if (this.held.slice) k.slice = true;
    if (this.held.smash) k.smash = true;
    return k;
  }

  private onKey = (e: KeyboardEvent): void => {
    const shot = SHOT_KEYS[e.code];
    if (shot) {
      if (e.type === 'keydown') {
        if (this.held[shot]) return; // repetición del teclado
        this.held[shot] = true;
        const c = this.lastClick;
        if (c && !c.pressedAfter && !Object.keys(c.keys).length && e.timeStamp - c.perf <= KEY_NOTE_MS) {
          c.pressedAfter = { key: SHOT_KEY_LABEL[shot], ms: e.timeStamp - c.perf };
        }
        this.onShotKeyDown?.(SHOT_KEY_LABEL[shot], e.timeStamp);
      } else {
        this.held[shot] = false;
        this.lastUp[shot] = e.timeStamp;
      }
      return;
    }
    if (e.code !== 'Space') return;
    if (this.captureKeys) e.preventDefault();
    this.blockHeld = e.type === 'keydown';
  };

  private onBlur = (): void => {
    this.blockHeld = false;
    this.held = {};
  };

  /** Objetivo actual en coordenadas del jugador (para dibujar el marcador del cursor). */
  get currentTarget(): { x: number; z: number } {
    return this.target;
  }

  private onMove = (e: PointerEvent): void => {
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ce of events.length ? events : [e]) this.samples.push({ t: ce.timeStamp, x: ce.clientX, y: ce.clientY });
    // Conservar solo lo necesario para la ventana del gesto.
    const cutoff = e.timeStamp - 400;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
    this.updateTarget(e.clientX, e.clientY);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.enabled) return;
    this.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    this.updateTarget(e.clientX, e.clientY);
    // Las teclas cuentan en el instante del click: los eventos llegan en orden, así que `held` es su estado ahora.
    const keys = this.heldKeys();
    let releasedBefore: FireRecord['releasedBefore'] = null;
    if (!Object.keys(keys).length) {
      for (const k of Object.keys(this.lastUp) as (keyof ShotKeys)[]) {
        const ms = e.timeStamp - (this.lastUp[k] ?? Number.NEGATIVE_INFINITY);
        if (ms <= KEY_NOTE_MS && (!releasedBefore || ms < releasedBefore.ms)) releasedBefore = { key: SHOT_KEY_LABEL[k], ms };
      }
    }
    const rec: FireRecord = { t: e.timeStamp - this.clock.epoch - this.latencyOffsetMs, perf: e.timeStamp, keys, releasedBefore, pressedAfter: null };
    this.fires.push(rec);
    this.lastClick = rec;
  };

  private updateTarget(clientX: number, clientY: number): void {
    const rect = this.el.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const sgn = sideSign(this.side);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hitPoint)) {
      this.target = { x: this.hitPoint.x * sgn, z: this.hitPoint.z * sgn };
    } else {
      // Cursor por encima del horizonte: hacia la red.
      this.target = { x: this.target.x, z: 0 };
    }
  }

  /** Descarta clicks pendientes (p. ej. el click que cierra un menú). */
  clearFires(): void {
    this.fires.length = 0;
  }

  /** Intento para el tick que termina en `tickEndMs` (tiempo de juego). */
  intentFor(tickEndMs: number): InputIntent {
    const intent = neutralIntent();
    intent.target = { x: this.target.x, z: this.target.z };
    intent.swing = this.swingAt(this.clock.epoch + tickEndMs);
    intent.block = this.blockHeld;
    intent.modifiers = this.heldKeys();
    if (this.fires.length && this.fires[0].t <= tickEndMs) {
      const f = this.fires.shift()!;
      intent.fire = f.t;
      intent.modifiers = { ...f.keys };
      this.lastFire = f;
    }
    return intent;
  }

  private swingAt(nowPerf: number): { vx: number; vy: number } {
    const from = nowPerf - SWING_WINDOW_MS;
    let first: PointerSample | null = null;
    let last: PointerSample | null = null;
    for (const s of this.samples) {
      if (s.t < from || s.t > nowPerf) continue;
      if (!first) first = s;
      last = s;
    }
    if (!first || !last || last.t - first.t < 8) return { vx: 0, vy: 0 };
    const h = Math.max(1, this.el.clientHeight);
    const dt = (last.t - first.t) / 1000;
    return { vx: (last.x - first.x) / h / dt, vy: -(last.y - first.y) / h / dt };
  }
}
