/**
 * Una partida en el servidor: el ServerMatch (autoridad) y las dos conexiones (jugador y bot remoto). Solo transporta:
 * cada mensaje entrante va al ServerMatch con su instante de llegada (ya con la latencia simulada) y cada mensaje del
 * ServerMatch sale por la conexión de su destinatario. Si alguien se va, avisa al otro y se cierra.
 */
import { type GameConfig, type MatchRecord, ServerMatch, type Side } from '@ppp/shared';
import type { BotClient } from './bot-client.ts';
import type { Peer } from './peer.ts';

export class Room {
  readonly id: string;
  readonly match: ServerMatch;
  readonly peers: [Peer | null, Peer | null] = [null, null];
  bot: BotClient | null = null;
  closed = false;
  readonly createdAt = performance.now();
  private readonly onClosed: () => void;
  private readonly log: (line: string) => void;

  constructor(id: string, cfg: GameConfig, log: (line: string) => void, onClosed: () => void) {
    this.id = id;
    this.log = log;
    this.onClosed = onClosed;
    this.match = new ServerMatch(cfg, {
      send: (to, msg) => this.peers[to]?.send(msg),
      log: (line) => log(`[${id}] ${line}`),
    });
  }

  get record(): MatchRecord {
    return this.match.record;
  }

  get protoErrors(): [number, number] {
    return [this.peers[0]?.protoErrors ?? 0, this.peers[1]?.protoErrors ?? 0];
  }

  attach(side: Side, peer: Peer): void {
    this.peers[side] = peer;
    peer.onMessage = (msg, now) => this.match.receive(side, msg, now);
    peer.onClose = () => this.leave(side);
    if (this.peers[0] && this.peers[1]) this.match.start(performance.now());
  }

  pump(now: number): void {
    this.peers[0]?.pump(now);
    this.peers[1]?.pump(now);
    if (!this.closed) this.match.poll(now);
  }

  private leave(side: Side): void {
    if (this.closed) return;
    this.log(`[${this.id}] se fue el lado ${side}`);
    const other = this.peers[side === 0 ? 1 : 0];
    other?.sendNow({ k: 'bye', m: side === 1 ? 'el bot se desconectó' : 'el rival se desconectó' });
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.peers[0]?.close();
    this.peers[1]?.close();
    this.bot?.stop();
    this.onClosed();
  }
}
