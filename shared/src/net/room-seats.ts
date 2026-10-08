/**
 * Los dos huecos de una sala (V0.4) y el transporte hacia ellos. Quién está: token, nombre limpio, conectado o con el
 * hueco reservado hasta `until`, Listo, prueba de lectura y ping. Cómo se le habla: solo a conexiones presentes, sin que
 * un fallo del transporte rompa la sala, y el `room` solo cuando cambia lo que enseña a esa conexión (nunca por tick).
 * Las fases las decide RoomCore.
 */
import type { Side } from '../types.ts';
import { type PingMsg, PROTOCOL_VERSION, type RoomMsg, type RoomPhase, type RoomPlayerWire, type S2C } from './protocol.ts';
import type { RoomDeps } from './room.ts';
import { cleanName } from './route.ts';

export interface Seat {
  readonly token: string;
  name: string;
  connected: boolean;
  ready: boolean;
  /** Cuándo dio a Listo: el timeout del warm-up cuenta desde ahí. */
  readySince: number;
  readTest: boolean;
  /** Fin de la reserva del hueco mientras está desconectado (Infinity si está conectado). */
  until: number;
  /** Último `room` que vio esta conexión (clave), para mandarlo solo cuando cambia. */
  shown: string;
}

/** Lo que enseña el `room` además de los jugadores: fase, games ganados y el plazo vigente (y cuándo vence). */
export interface RoomView {
  ph: RoomPhase;
  gw: readonly [number, number];
  dk: RoomMsg['dk'];
  at: number;
}

export type SeatDeps = Pick<RoomDeps, 'cfg' | 'code' | 'mode' | 'send' | 'drop' | 'newToken' | 'log'>;

const SIDES: readonly Side[] = [0, 1];
const INF = Number.POSITIVE_INFINITY;
/** Cota de `dl` en el protocolo. */
const MAX_DL = 600000;

export class RoomSeats {
  /** Media del ping de cada lado (−1 sin medir); la sala se la pasa a cada autoridad nueva. */
  readonly pings: [number, number] = [-1, -1];
  private readonly seats: [Seat | null, Seat | null] = [null, null];
  private readonly deps: SeatDeps;

  constructor(deps: SeatDeps) {
    this.deps = deps;
  }

  get(s: Side): Seat | null {
    return this.seats[s];
  }

  /** El hueco `s`, que tiene que estar ocupado. */
  at(s: Side): Seat {
    const seat = this.seats[s];
    if (!seat) throw new Error(`hueco ${s} vacío`);
    return seat;
  }

  /** Huecos ocupados (conectados o reservados). */
  get players(): number {
    return (this.seats[0] ? 1 : 0) + (this.seats[1] ? 1 : 0);
  }

  connected(s: Side): boolean {
    return !!this.seats[s]?.connected;
  }

  get allConnected(): boolean {
    return this.connected(0) && this.connected(1);
  }

  sideOfToken(tk: string): Side | null {
    for (const s of SIDES) if (this.seats[s]?.token === tk) return s;
    return null;
  }

  /** El primer hueco libre (o null: sala llena, también con un hueco reservado). */
  freeSide(): Side | null {
    return !this.seats[0] ? 0 : !this.seats[1] ? 1 : null;
  }

  /** Ocupa el hueco con un token nuevo. */
  sit(s: Side, rawName: string): void {
    this.seats[s] = { token: this.deps.newToken(), name: this.cleanName(rawName, s), connected: true, ready: false, readySince: 0, readTest: false, until: INF, shown: '' };
  }

  /** Conexión nueva en un hueco ya ocupado (vuelta o pestaña duplicada): su nombre, sin prueba de lectura y sin `room` visto. */
  renew(s: Side, rawName: string): void {
    const seat = this.at(s);
    seat.connected = true;
    seat.until = INF;
    seat.name = this.cleanName(rawName, s);
    seat.readTest = false;
    seat.shown = '';
  }

  /** Socket cerrado: el hueco queda reservado hasta `until` (sin prueba de lectura; el Listo lo decide la sala). */
  reserve(s: Side, until: number): void {
    const seat = this.at(s);
    seat.connected = false;
    seat.until = until;
    seat.readTest = false;
    seat.shown = '';
  }

  free(s: Side): void {
    this.seats[s] = null;
    this.pings[s] = -1;
  }

  reserveEnd(s: Side): number {
    const seat = this.seats[s];
    return seat && !seat.connected ? seat.until : INF;
  }

  /** Fin de la reserva más cercana (Infinity si no hay huecos reservados). */
  firstReserveEnd(): number {
    return Math.min(this.reserveEnd(0), this.reserveEnd(1));
  }

  /** Lados con el hueco reservado (desconectados). */
  away(): Side[] {
    return SIDES.filter((s) => this.seats[s] !== null && !this.seats[s]?.connected);
  }

  /** Con los dos huecos ocupados y uno solo Listo: ese lado. */
  onlyReady(): Side | null {
    const a = this.seats[0];
    const b = this.seats[1];
    if (!a || !b || a.ready === b.ready) return null;
    return a.ready ? 0 : 1;
  }

  bothReady(): boolean {
    return !!this.seats[0]?.ready && !!this.seats[1]?.ready;
  }

  clearReady(): void {
    for (const seat of this.seats) if (seat) seat.ready = false;
  }

  clearReadTest(): void {
    for (const seat of this.seats) if (seat) seat.readTest = false;
  }

  // ——— Transporte ———

  /** Solo a una conexión presente; un fallo del transporte se registra y no rompe la sala. */
  send(s: Side, msg: S2C): void {
    if (!this.connected(s)) return;
    try {
      this.deps.send(s, msg);
    } catch (e) {
      this.deps.log?.(`[${this.deps.code}] envío al lado ${s} fallido: ${(e as Error).message}`);
    }
  }

  both(msg: S2C): void {
    this.send(0, msg);
    this.send(1, msg);
  }

  /** Cierra la conexión del lado (después de un `bye`, o tras un `leave`). */
  drop(s: Side): void {
    try {
      this.deps.drop(s);
    } catch (e) {
      this.deps.log?.(`[${this.deps.code}] cierre del lado ${s} fallido: ${(e as Error).message}`);
    }
  }

  welcome(s: Side): void {
    this.send(s, { k: 'welcome', v: PROTOCOL_VERSION, side: s, room: this.deps.code, tk: this.at(s).token, md: this.deps.mode });
  }

  /** `pong` al que lo manda; con su media (≥ 0), la guarda y manda `pings` a los dos. Devuelve si hubo media. */
  ping(s: Side, msg: PingMsg): boolean {
    this.send(s, { k: 'pong', i: msg.i, t: msg.t });
    if (msg.a < 0) return false;
    this.pings[s] = msg.a;
    this.both({ k: 'pings', a: [this.pings[0], this.pings[1]] });
    return true;
  }

  /** Los pings conocidos, a quien acaba de entrar. */
  sendPings(s: Side): void {
    if (this.pings[0] >= 0 || this.pings[1] >= 0) this.send(s, { k: 'pings', a: [this.pings[0], this.pings[1]] });
  }

  /** Manda `room` a cada conexión cuyo último `room` ya no es el estado de la sala. */
  sync(view: RoomView, now: number): void {
    let msg: RoomMsg | null = null;
    let key = '';
    for (const s of SIDES) {
      const seat = this.seats[s];
      if (!seat?.connected) continue;
      if (msg === null) {
        const dl = view.at === INF ? -1 : Math.min(MAX_DL, Math.max(0, Math.round(view.at - now)));
        msg = { k: 'room', code: this.deps.code, md: this.deps.mode, ph: view.ph, pl: [this.wire(0), this.wire(1)], gw: [view.gw[0], view.gw[1]], dl, dk: view.dk };
        key = JSON.stringify([msg.ph, msg.pl, msg.gw, view.dk, view.at]);
      }
      if (seat.shown === key) continue;
      seat.shown = key;
      this.send(s, msg);
    }
  }

  private wire(s: Side): RoomPlayerWire | null {
    const p = this.seats[s];
    return p ? { nm: p.name, c: p.connected ? 1 : 0, r: p.ready ? 1 : 0, rt: p.readTest ? 1 : 0 } : null;
  }

  private cleanName(raw: string, s: Side): string {
    return cleanName(raw, `Jugador ${s + 1}`, this.deps.cfg);
  }
}
