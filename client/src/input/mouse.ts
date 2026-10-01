/**
 * Traductor mouse → InputIntent [§3.1, §3.3]. Es el ÚNICO sitio que lee eventos del mouse:
 * la simulación solo recibe intentos. Añadir trackpad o táctil (V0.7) será escribir otro traductor.
 *
 *  - target: el cursor proyectado sobre un plano horizontal a la altura de la mesa (coordenadas
 *    del jugador: x lateral, z profundidad desde la red).
 *  - swing: velocidad del cursor en los últimos ~150 ms, en alturas de pantalla por segundo.
 *  - fire: instante del click en ms de tiempo de juego (timestamp del propio evento, no del frame).
 */
import { type InputIntent, neutralIntent, type Side, sideSign } from '@ppp/shared';
import * as THREE from 'three';

const SWING_WINDOW_MS = 150;

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
  private fires: number[] = [];
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

  constructor(el: HTMLElement, camera: THREE.Camera, planeY: number, clock: InputClock, side: Side = 0) {
    this.el = el;
    this.camera = camera;
    this.clock = clock;
    this.side = side;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerdown', this.onDown);
  }

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
    this.fires.push(e.timeStamp - this.clock.epoch);
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
    if (this.fires.length && this.fires[0] <= tickEndMs) intent.fire = this.fires.shift();
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
