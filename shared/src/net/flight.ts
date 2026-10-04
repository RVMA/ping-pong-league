/**
 * Vuelo [§17.2]: la bola entre dos golpes. Queda definida por su estado de salida (posición, velocidad y spin en el
 * contacto) y la física compartida, así que cliente, bot y servidor la calculan igual, bit a bit (§17.6). Cada
 * jugador la mide con su propio reloj de vuelo: el índice k es el estado tras k pasos de 120 Hz (k·tick ms del vuelo).
 *
 * Reproduce la simulación local (Simulation.step):
 *  - los contactos del paso k (k−1 → k) y las reglas que aplican;
 *  - el desenlace si nadie la golpea (índice del paso en que se decide y regla);
 *  - la ventana de muestras con la que se evalúa un click (Simulation.sampleWindow dentro de un paso);
 *  - el estado del contacto: el anterior al tick en que se aplica el golpe (Simulation.applyHit).
 */
import { type GameConfig, simDt, tickMs } from '../config.ts';
import { type BallContact, type BallState, type PathSample, type PhysicsEnv, stepBall } from '../physics.ts';
import { applyContact, type PointReason, type RallyState, registerStrike } from '../rules.ts';
import { type Side, sideSign } from '../types.ts';

export type FlightMode = 'toss' | 'rally';

export type FlightOutcome = { kind: 'point'; winner: Side; reason: PointReason } | { kind: 'let' };

export interface FlightEnd {
  /** Índice tras el paso en que se decide (como el tick del evento `point` local). */
  i: number;
  outcome: FlightOutcome;
}

const EPS = 1e-9;
/** Máximo de pasos que se calculan buscando el desenlace (~33 s); en la práctica acaba en < 3 s. */
const MAX_STEPS = 4000;
/** Historial de la simulación local (Simulation.historyLen con searchWindowMs 400 y 120 Hz). */
const HISTORY = 50;

/** Tick (en ticks del vuelo) en que se evalúa un click en el instante `fireMs`: el primero que no es anterior a él. */
export function evalTick(fireMs: number, tick: number): number {
  return Math.ceil(fireMs / tick - EPS);
}

/** Índice del estado con el que se golpea un contacto en `contactMs`: el anterior al tick en que se aplica. */
export function contactIndex(contactMs: number, tick: number): number {
  return evalTick(contactMs, tick) - 1;
}

function other(s: Side): Side {
  return s === 0 ? 1 : 0;
}

function copyRally(r: RallyState): RallyState {
  return { lastHitter: r.lastHitter, isServe: r.isServe, bounces: [...r.bounces], netTouched: r.netTouched, hits: r.hits };
}

/** Reglas tras un golpe de `hitter` (copia de `prev` con el golpe registrado). */
export function strikeRally(prev: RallyState, hitter: Side, serve: boolean): RallyState {
  const r = copyRally(prev);
  registerStrike(r, hitter, serve);
  return r;
}

export class Flight {
  readonly mode: FlightMode;
  readonly hitter: Side;
  /** Quien puede golpearla: en el lanzamiento, el que saca; en el rally, el rival de quien golpeó. */
  readonly receiver: Side;
  readonly exit: BallState;
  readonly startRally: RallyState;
  readonly end: FlightEnd;
  /** Primer índice con la bola en el campo del receptor (Infinity si nunca llega antes del desenlace). */
  readonly firstOnSide: number;
  /** El receptor no puede cambiar el desenlace (llega antes de que la bola pise su campo). */
  readonly certain: boolean;
  private readonly cfg: GameConfig;
  private readonly env: PhysicsEnv;
  private readonly dt: number;
  private readonly tick: number;
  private data: Float64Array;
  private count = 0;
  private readonly cur: BallState;
  private readonly contacts = new Map<number, BallContact[]>();
  private readonly stepContacts: BallContact[] = [];

  constructor(cfg: GameConfig, env: PhysicsEnv, exit: BallState, mode: FlightMode, hitter: Side, rally: RallyState) {
    this.cfg = cfg;
    this.env = env;
    this.dt = simDt(cfg);
    this.tick = tickMs(cfg);
    this.mode = mode;
    this.hitter = hitter;
    this.receiver = mode === 'toss' ? hitter : other(hitter);
    this.exit = { pos: { ...exit.pos }, vel: { ...exit.vel }, spin: { ...exit.spin } };
    this.startRally = copyRally(rally);
    this.cur = { pos: { ...exit.pos }, vel: { ...exit.vel }, spin: { ...exit.spin } };
    this.data = new Float64Array(9 * 256);
    this.push(this.cur);
    this.end = this.findEnd();
    const sgn = sideSign(this.receiver);
    let first = Number.POSITIVE_INFINITY;
    if (mode === 'rally') {
      for (let i = 0; i <= this.end.i; i++) {
        if (this.z(i) * sgn >= 0) {
          first = i;
          break;
        }
      }
    }
    this.firstOnSide = first;
    this.certain = mode === 'rally' && this.end.i < first;
  }

  /** Índices calculados (0 … length − 1). */
  get length(): number {
    return this.count;
  }

  private push(b: BallState): void {
    if ((this.count + 1) * 9 > this.data.length) {
      const bigger = new Float64Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const o = this.count * 9;
    const d = this.data;
    d[o] = b.pos.x;
    d[o + 1] = b.pos.y;
    d[o + 2] = b.pos.z;
    d[o + 3] = b.vel.x;
    d[o + 4] = b.vel.y;
    d[o + 5] = b.vel.z;
    d[o + 6] = b.spin.x;
    d[o + 7] = b.spin.y;
    d[o + 8] = b.spin.z;
    this.count++;
  }

  /** Calcula los estados hasta el índice i (incluido). */
  ensure(i: number): void {
    while (this.count <= i) {
      this.stepContacts.length = 0;
      stepBall(this.cur, this.dt, this.env, this.stepContacts);
      if (this.stepContacts.length) this.contacts.set(this.count, [...this.stepContacts]);
      this.push(this.cur);
    }
  }

  private findEnd(): FlightEnd {
    const top = this.env.tableTop;
    const rally = copyRally(this.startRally);
    for (let i = 1; i <= MAX_STEPS; i++) {
      this.ensure(i);
      const cs = this.contacts.get(i);
      if (this.mode === 'toss') {
        // Simulation.step en serveToss: el primer contacto decide (salvo la red) y, si no, caer bajo la mesa.
        if (cs && cs[0].kind !== 'net') return { i, outcome: { kind: 'point', winner: other(this.hitter), reason: 'TOSS_MISSED' } };
        if (this.y(i) < top) return { i, outcome: { kind: 'point', winner: other(this.hitter), reason: 'TOSS_MISSED' } };
        continue;
      }
      if (!cs) continue;
      for (const c of cs) {
        const outcome = applyContact(rally, c);
        if (outcome) return { i, outcome };
      }
    }
    return { i: MAX_STEPS, outcome: { kind: 'let' } };
  }

  readState(i: number, out: BallState): BallState {
    this.ensure(i);
    const o = i * 9;
    const d = this.data;
    out.pos.x = d[o];
    out.pos.y = d[o + 1];
    out.pos.z = d[o + 2];
    out.vel.x = d[o + 3];
    out.vel.y = d[o + 4];
    out.vel.z = d[o + 5];
    out.spin.x = d[o + 6];
    out.spin.y = d[o + 7];
    out.spin.z = d[o + 8];
    return out;
  }

  x(i: number): number {
    this.ensure(i);
    return this.data[i * 9];
  }

  y(i: number): number {
    this.ensure(i);
    return this.data[i * 9 + 1];
  }

  z(i: number): number {
    this.ensure(i);
    return this.data[i * 9 + 2];
  }

  /** Contactos del paso i − 1 → i (vacío si no hubo). */
  contactsAt(i: number): readonly BallContact[] {
    this.ensure(i);
    return this.contacts.get(i) ?? [];
  }

  /** Reglas del rally con la bola en el índice j (tras los contactos de los pasos ≤ j que no acabaron el punto). */
  rallyBefore(j: number): RallyState {
    const r = copyRally(this.startRally);
    const last = Math.min(j, this.end.i - 1);
    for (let i = 1; i <= last; i++) {
      const cs = this.contacts.get(i);
      if (cs) for (const c of cs) applyContact(r, c);
    }
    return r;
  }

  /**
   * Muestras con las que se evalúa un click en `fireMs` (ms del vuelo), como Simulation.sampleWindow dentro del paso
   * en que se procesa: historial hasta el estado anterior al paso (etiquetas j·tick), ese estado repetido en `now` y la
   * predicción desde él (etiquetas now + i·tick). Se queda con las de ±searchWindowMs.
   */
  clickSamples(fireMs: number): PathSample[] {
    const out: PathSample[] = [];
    const n = evalTick(fireMs, this.tick);
    const J = n - 1;
    if (J < 0) return out;
    const win = this.cfg.hit.searchWindowMs;
    const pred = Math.ceil(win / this.tick);
    this.ensure(J + pred);
    const now = n * this.tick;
    const add = (t: number, i: number) => {
      if (Math.abs(t - fireMs) <= win) out.push({ t, pos: { x: this.data[i * 9], y: this.data[i * 9 + 1], z: this.data[i * 9 + 2] } });
    };
    for (let j = Math.max(0, J - (HISTORY - 1)); j <= J; j++) add(j * this.tick, j);
    add(now, J);
    for (let i = 1; i <= pred; i++) add(now + i * this.tick, J + i);
    return out;
  }

  /**
   * Índice en que se espera el golpe del receptor (para frenar la bola que se aleja): el primero tras el bote en su
   * campo con la bola a `depth` m de la red o más. Si no llega a esa profundidad, el último antes del desenlace.
   * −1 si el vuelo no es devolvible (no bota en su campo antes de acabar).
   */
  expectedContact(depth: number): number {
    if (this.mode !== 'rally') return -1;
    const sgn = sideSign(this.receiver);
    let bounced = false;
    for (let i = 1; i < this.end.i; i++) {
      const cs = this.contacts.get(i);
      if (!bounced && cs && cs.some((c) => c.kind === 'table' && c.side === this.receiver)) bounced = true;
      if (bounced && this.z(i) * sgn >= depth) return i;
    }
    return bounced ? this.end.i - 1 : -1;
  }
}
