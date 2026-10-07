/**
 * Servidor de juego de V0.3 [§17.1–§17.3]: WebSocket propio (librería `ws`) en /ws. Por cada jugador que se conecta
 * crea una sala y arranca un bot remoto que se conecta por WebSocket a este mismo servidor, cada uno con su latencia
 * simulada. La autoridad es la simulación compartida (ServerMatch). Rechaza la conexión si la versión del protocolo, la
 * config (hash) o los parámetros no valen.
 */
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { type ErrCode, type GameConfig, makeConfig, PROTOCOL_VERSION, validHello } from '@ppp/shared';
import { WebSocketServer } from 'ws';
import { BotClient } from './bot-client.ts';
import { Peer } from './peer.ts';
import { Room } from './room.ts';
import { ticker } from './ticker.ts';

export interface GameServer {
  port: number;
  /** Interfaz en la que escucha (por defecto 127.0.0.1: el cliente llega por el proxy de Vite). */
  host: string;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

const ERR_TEXT: Record<ErrCode, string> = {
  version: 'Versión del protocolo distinta de la del servidor',
  config: 'Configuración del juego distinta de la del servidor (¿parámetros de URL como speed o radius?)',
  params: 'Parámetros fuera de rango (ping, variación o desfase de latencia)',
  room: 'Sala inexistente o completa',
  full: 'Sala completa',
  proto: 'Mensaje inválido',
  rate: 'Demasiados mensajes',
  route: 'Ruta no válida',
};

export async function startServer(opts: { port: number; cfg?: GameConfig; log?: (line: string) => void; host?: string }): Promise<GameServer> {
  const cfg = opts.cfg ?? makeConfig();
  const log = opts.log ?? ((line: string) => console.log(line));
  // Solo en esta máquina salvo que se pida otra interfaz (PPP_HOST); mensajes de como mucho 16 KB (el mayor, un
  // golpe, ocupa < 1 KB): un cliente no puede llenar la memoria del servidor con uno enorme.
  const host = opts.host ?? '127.0.0.1';
  const wss = new WebSocketServer({ port: opts.port, host, path: '/ws', maxPayload: 16 * 1024 });
  await once(wss, 'listening');
  const port = (wss.address() as AddressInfo).port;
  const rooms = new Map<string, Room>();
  const pending = new Set<Peer>();
  let counter = 0;

  // El bucle solo corre mientras hay conexiones: un servidor sin nadie no ocupa la CPU.
  let looping = false;
  const task = (now: number) => {
    for (const p of pending) p.pump(now);
    for (const r of rooms.values()) r.pump(now);
    if (!pending.size && !rooms.size) {
      ticker.remove(task);
      looping = false;
    }
  };
  const wake = () => {
    if (looping) return;
    looping = true;
    ticker.add(task);
  };

  wss.on('connection', (ws, req) => {
    // Provisional (V0.3): el bot remoto dice a qué sala va en la query de la URL; la sala ya no viaja en `hello`.
    const wantedRoom = new URL(req.url ?? '/', 'http://localhost').searchParams.get('room');
    const peer = new Peer(ws, log);
    pending.add(peer);
    wake();
    const reject = (m: ErrCode) => {
      log(`[servidor] conexión rechazada: ${m}`);
      peer.sendNow({ k: 'err', m, d: ERR_TEXT[m] });
      pending.delete(peer);
      peer.close();
    };
    peer.onBad = () => reject('proto');
    peer.onClose = () => pending.delete(peer);
    peer.onMessage = (msg) => {
      if (msg.k !== 'hello') return reject('proto');
      const err = validHello(msg, cfg);
      if (err) return reject(err);
      pending.delete(peer);
      peer.onBad = () => {};
      if (msg.r === 'player') {
        counter += 1;
        const id = `b-${counter}`;
        const room = new Room(id, cfg, log, () => rooms.delete(id), msg.fs ?? 0);
        rooms.set(id, room);
        peer.setLatency(msg.p, msg.j, msg.s);
        peer.send({ k: 'welcome', v: PROTOCOL_VERSION, side: 0, room: id, tk: crypto.randomUUID(), md: 'bot' });
        room.attach(0, peer);
        const bot = new BotClient({ url: `ws://127.0.0.1:${port}/ws`, role: 'bot', room: id, difficulty: msg.d, seed: msg.s, ping: msg.bp, botping: msg.bp, jitter: msg.j, cfg });
        room.bot = bot;
        bot.start();
        log(`[${id}] jugador: ping ${msg.p} ms, bot ${msg.d} con ping ${msg.bp} ms, variación ±${Math.round(msg.j * 100)} %`);
        return;
      }
      const room = wantedRoom ? rooms.get(wantedRoom) : undefined;
      if (!room || room.peers[1] || room.closed) return reject('room');
      peer.setLatency(msg.p, msg.j, msg.s + 7919);
      peer.send({ k: 'welcome', v: PROTOCOL_VERSION, side: 1, room: room.id, tk: crypto.randomUUID(), md: 'bot' });
      room.attach(1, peer);
    };
  });

  return {
    port,
    host,
    rooms,
    close: async () => {
      ticker.remove(task);
      looping = false;
      for (const r of [...rooms.values()]) r.close();
      for (const p of pending) p.close();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((res) => wss.close(() => res()));
    },
  };
}
