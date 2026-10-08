/**
 * Una sala de dos personas en el servidor Node (V0.4): la RoomCore de `shared/` (toda la lógica) y la conexión de cada
 * lado, con su latencia simulada. Solo transporta: cada mensaje entrante va a la sala con su instante de llegada, cada
 * mensaje de la sala sale por la conexión de su lado, y el bucle del servidor llama a `pump`, que atiende los plazos de
 * la sala (`poll`) cuando vence `nextDeadline()`.
 *
 * Contrato conexión ↔ lado de `RoomCore.join` (el mismo que cumple la red en memoria de los tests de `shared/`):
 *  - durante `join`, lo que la sala manda a un lado sin conexión va a la conexión que está entrando; si sale bien, esa
 *    conexión queda registrada para su lado;
 *  - `drop` cierra la conexión del lado y la olvida en el acto (lo que tenía pendiente, como el `bye`, sale antes); lo
 *    que llegue después de ella (mensajes o su cierre) ya no va a la sala: el lado puede ser ya de otra conexión;
 *  - el cierre de una conexión registrada (sin `drop`) es `disconnect`, con el instante en que llega el cierre.
 */
import { type GameConfig, type HelloMsg, type JoinResult, type MatchMode, RoomCore, type S2C, type Side } from '@ppp/shared';
import type { Peer } from './peer.ts';

export interface RoomHostOptions {
  cfg: GameConfig;
  code: string;
  mode: MatchMode;
  log: (line: string) => void;
  /** Azar del sorteo del primer saque (crypto). */
  random: () => number;
  /** Tokens de reconexión (crypto.randomUUID). */
  newToken: () => string;
}

const SIDES: readonly Side[] = [0, 1];

export class RoomHost {
  readonly code: string;
  readonly core: RoomCore;
  /** La conexión de cada lado (null sin conexión, también con el hueco reservado). */
  readonly peers: [Peer | null, Peer | null] = [null, null];
  readonly createdAt = performance.now();
  /** La conexión que está entrando (solo durante `join`). */
  private joining: Peer | null = null;
  private readonly log: (line: string) => void;

  constructor(o: RoomHostOptions) {
    this.code = o.code;
    this.log = o.log;
    this.core = new RoomCore({
      cfg: o.cfg,
      code: o.code,
      mode: o.mode,
      send: (to, msg) => this.deliver(to, msg),
      drop: (to) => this.drop(to),
      newToken: o.newToken,
      random: o.random,
      log: o.log,
    });
  }

  /** Sin jugadores ni huecos reservados: el servidor la borra. */
  get closed(): boolean {
    return this.core.closed;
  }

  /** Entra (o vuelve) una conexión con su `hello` ya validado. Si falla, la sala no le ha mandado nada. */
  join(peer: Peer, hello: HelloMsg, now: number): JoinResult {
    this.joining = peer;
    let res: JoinResult;
    try {
      res = this.core.join(hello, now);
    } catch (e) {
      this.log(`[${this.code}] join falló: ${(e as Error).message}`);
      res = { ok: false, err: 'room' };
    } finally {
      this.joining = null;
    }
    if (!res.ok) return res;
    const side = res.side;
    this.peers[side] = peer;
    peer.onMessage = (msg, at) => {
      if (this.peers[side] === peer) this.safely(() => this.core.receive(side, msg, at));
    };
    peer.onClose = (at) => {
      if (this.peers[side] !== peer) return;
      this.peers[side] = null;
      this.safely(() => this.core.disconnect(side, at));
    };
    // Un mensaje inválido ya lo descartó y registró el Peer: la sala sigue.
    peer.onBad = () => {};
    return res;
  }

  /** Bombea las conexiones (salida, entrada y cierres) y atiende los plazos vencidos de la sala. */
  pump(now: number): void {
    for (const s of SIDES) this.peers[s]?.pump(now);
    if (now >= this.core.nextDeadline()) this.safely(() => this.core.poll(now));
  }

  /** Cierre del servidor: se cierran las conexiones sin avisar a la sala. */
  close(): void {
    for (const s of SIDES) {
      const p = this.peers[s];
      this.peers[s] = null;
      p?.detach();
      p?.close();
    }
  }

  private deliver(to: Side, msg: S2C): void {
    const p = this.peers[to] ?? this.joining;
    // RoomSeats atrapa y registra el error (no debería pasar: solo manda a lados conectados).
    if (!p) throw new Error(`${msg.k} al lado ${to}, sin conexión`);
    p.send(msg);
  }

  private drop(to: Side): void {
    const p = this.peers[to];
    if (!p) return;
    this.peers[to] = null;
    p.detach();
    p.flushAndClose();
  }

  /** Última red de seguridad: la sala no lanza con mensajes decodificados, pero un fallo no debe tumbar el bucle. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.log(`[${this.code}] error: ${(e as Error).stack ?? e}`);
    }
  }
}
