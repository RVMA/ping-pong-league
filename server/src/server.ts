/**
 * Servidor de juego Node (desarrollo y pruebas) [§17.1–§17.3; V0.4]: WebSocket propio (librería `ws`) en /ws, con la
 * ruta en la URL (Decisión 1):
 *  - `/ws?create=quick|standard|full`: sala nueva con un código de 4 letras al azar;
 *  - `/ws?room=<código>`: entrar o volver (con el token del `hello`) a una sala que existe; nunca crea una;
 *  - `/ws?bot=easy|medium|hard`: el flujo de V0.3 contra el bot remoto, que arranca el servidor y que entra en su sala
 *    `b-<n>` con `/ws?room=b-<n>` y rol `bot` (Decisión 20: solo en este servidor).
 *
 * Toda la lógica de sala está en la RoomCore de `shared/`; room-host.ts la transporta. Antes de abrir el socket se
 * comprueba el origen (Decisión 13, 403); después, cada error que el usuario tiene que leer (ruta, sala inexistente o
 * llena, versión, config o parámetros del `hello`) es un `err` en español y el cierre (Decisión 14). Mensajes de 16 KB
 * como mucho y límite de ritmo por conexión (peer.ts). Latencia simulada por conexión (`p`, `j`, `sp` del `hello`). Un
 * bucle (`ticker`) bombea las colas de latencia y atiende los plazos de cada sala; solo corre mientras hay conexiones o
 * salas.
 */
import { once } from 'node:events';
import { createServer, STATUS_CODES } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { type BotDifficulty, type ErrCode, type GameConfig, type HelloMsg, type LatencySpike, makeConfig, type MatchMode, newRoomCode, PROTOCOL_VERSION, parseRoute, validHello } from '@ppp/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import { BotClient } from './bot-client.ts';
import { Peer } from './peer.ts';
import { cryptoRandom, DEV_ORIGINS, NO_FREE_CODE_TEXT, originAllowed, routeErrorText } from './policy.ts';
import { Room } from './room.ts';
import { RoomHost } from './room-host.ts';
import { ticker } from './ticker.ts';

export interface GameServer {
  port: number;
  /** Interfaz en la que escucha (por defecto 127.0.0.1: el cliente llega por el proxy de Vite). */
  host: string;
  /** Salas de dos personas, por código (4 letras). */
  rooms: Map<string, RoomHost>;
  /** Salas contra el bot remoto (V0.3), por id (`b-<n>`). */
  botRooms: Map<string, Room>;
  close(): Promise<void>;
}

/** Códigos al azar que se prueban al crear una sala (hay 24⁴ = 331 776: chocar con uno ocupado es raro). */
const CODE_TRIES = 32;

/** Rechazo HTTP antes de abrir el WebSocket (origen ajeno, otra ruta). */
function refuse(socket: Duplex, status: number): void {
  const text = STATUS_CODES[status] ?? '';
  socket.on('error', () => {});
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
}

export async function startServer(opts: { port: number; cfg?: GameConfig; log?: (line: string) => void; host?: string }): Promise<GameServer> {
  const cfg = opts.cfg ?? makeConfig();
  const log = opts.log ?? ((line: string) => console.log(line));
  // Solo en esta máquina salvo que se pida otra interfaz (PPP_HOST).
  const host = opts.host ?? '127.0.0.1';
  const http = createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Solo WebSocket en /ws');
  });
  // Mensajes de como mucho 16 KB (el mayor, un golpe, ocupa < 1 KB): uno enorme cierra la conexión (1009).
  const wss = new WebSocketServer({ noServer: true, maxPayload: cfg.room.maxMessageBytes });
  const rooms = new Map<string, RoomHost>();
  const botRooms = new Map<string, Room>();
  /** Conexiones que aún no han mandado su `hello`. */
  const pending = new Set<Peer>();
  let botCounter = 0;

  // El bucle solo corre mientras hay conexiones o salas: un servidor sin nadie no ocupa la CPU.
  let looping = false;
  const task = (now: number) => {
    for (const p of pending) p.pump(now);
    for (const [code, r] of rooms) {
      r.pump(now);
      if (r.closed) {
        rooms.delete(code);
        r.close();
        log(`[${code}] sala cerrada`);
      }
    }
    for (const r of botRooms.values()) r.pump(now);
    if (!pending.size && !rooms.size && !botRooms.size) {
      ticker.remove(task);
      looping = false;
    }
  };
  const wake = () => {
    if (looping) return;
    looping = true;
    ticker.add(task);
  };

  const reject = (peer: Peer, code: ErrCode, text?: string) => {
    log(`[servidor] conexión rechazada: ${code}${text ? ` (${text})` : ''}`);
    pending.delete(peer);
    peer.detach();
    peer.reject(code, text);
  };

  const spikeOf = (sp: number): LatencySpike | undefined => {
    const s = cfg.net.latency.spike;
    return sp > 0 ? { prob: Math.min(sp, s.maxProb), minMs: s.minMs, maxMs: s.maxMs } : undefined;
  };

  const freeCode = (): string | null => {
    for (let i = 0; i < CODE_TRIES; i++) {
      const code = newRoomCode(cryptoRandom, cfg);
      if (!rooms.has(code)) return code;
    }
    return null;
  };

  const createRoom = (peer: Peer, mode: MatchMode, hello: HelloMsg, at: number) => {
    const code = freeCode();
    if (!code) return reject(peer, 'room', NO_FREE_CODE_TEXT);
    const room = new RoomHost({ cfg, code, mode, log, random: cryptoRandom, newToken: () => crypto.randomUUID() });
    peer.setLatency(hello.p, hello.j, hello.s, spikeOf(hello.sp));
    const res = room.join(peer, hello, at);
    // La sala solo se registra si su creador ha entrado: un `hello` que falla no deja salas huérfanas.
    if (!res.ok) return reject(peer, res.err);
    rooms.set(code, room);
    log(`[${code}] sala nueva (${mode}): ping ${hello.p} ms ±${Math.round(hello.j * 100)} %${hello.sp > 0 ? `, picos ${hello.sp}` : ''}`);
  };

  const joinRoom = (peer: Peer, code: string, hello: HelloMsg, at: number) => {
    if (code.startsWith('b-')) return joinBotRoom(peer, code, hello);
    const room = rooms.get(code);
    if (!room || room.closed) return reject(peer, 'room');
    peer.setLatency(hello.p, hello.j, hello.s + 1, spikeOf(hello.sp));
    const res = room.join(peer, hello, at);
    if (!res.ok) return reject(peer, res.err);
  };

  /** El jugador de V0.3 contra el bot remoto: sala `b-<n>` y un bot que se conecta a este mismo servidor. */
  const startBotRoom = (peer: Peer, difficulty: BotDifficulty, hello: HelloMsg) => {
    botCounter += 1;
    const id = `b-${botCounter}`;
    const room = new Room(id, cfg, log, () => botRooms.delete(id), hello.fs ?? 0);
    botRooms.set(id, room);
    peer.setLatency(hello.p, hello.j, hello.s, spikeOf(hello.sp));
    peer.send({ k: 'welcome', v: PROTOCOL_VERSION, side: 0, room: id, tk: crypto.randomUUID(), md: 'bot' });
    room.attach(0, peer);
    const self = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
    const bot = new BotClient({ url: `ws://${self}:${port}/ws`, route: `?room=${id}`, role: 'bot', name: 'Bot', difficulty, seed: hello.s, ping: hello.bp, botping: hello.bp, jitter: hello.j, cfg });
    room.bot = bot;
    bot.start();
    log(`[${id}] jugador: ping ${hello.p} ms, bot ${difficulty} con ping ${hello.bp} ms, variación ±${Math.round(hello.j * 100)} %`);
  };

  /** El bot que arrancó el servidor entra en su sala `b-<n>` (nadie más). */
  const joinBotRoom = (peer: Peer, id: string, hello: HelloMsg) => {
    const room = botRooms.get(id);
    if (!room || room.closed) return reject(peer, 'room');
    if (room.peers[1] || hello.r !== 'bot') return reject(peer, 'full');
    peer.setLatency(hello.p, hello.j, hello.s + 7919);
    peer.send({ k: 'welcome', v: PROTOCOL_VERSION, side: 1, room: room.id, tk: crypto.randomUUID(), md: 'bot' });
    room.attach(1, peer);
  };

  const onConnection = (ws: WebSocket, search: string) => {
    const peer = new Peer(ws, log, cfg.room.rate);
    const route = parseRoute(search, cfg);
    if (route.kind === 'bad') {
      log(`[servidor] ruta rechazada (${route.why}): ${JSON.stringify(search.slice(0, 40))}`);
      peer.reject('route', routeErrorText(route.why));
      return;
    }
    pending.add(peer);
    wake();
    peer.onBad = () => reject(peer, 'proto');
    peer.onClose = () => pending.delete(peer);
    peer.onMessage = (msg, at) => {
      // El primer mensaje decide: a partir de aquí, la conexión es de su sala (o se rechaza).
      pending.delete(peer);
      peer.detach();
      if (msg.k !== 'hello') return reject(peer, 'proto');
      const err = validHello(msg, cfg);
      if (err) return reject(peer, err);
      if (route.kind === 'create') createRoom(peer, route.mode, msg, at);
      else if (route.kind === 'join') joinRoom(peer, route.code, msg, at);
      else startBotRoom(peer, route.difficulty, msg);
    };
  };

  http.on('upgrade', (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return refuse(socket, 400);
    }
    if (url.pathname !== '/ws') return refuse(socket, 404);
    if (!originAllowed(req.headers.origin, req.headers.host, DEV_ORIGINS)) {
      log(`[servidor] origen rechazado: ${JSON.stringify(String(req.headers.origin).slice(0, 80))}`);
      return refuse(socket, 403);
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url.search));
  });

  http.listen(opts.port, host);
  await once(http, 'listening');
  const port = (http.address() as AddressInfo).port;

  return {
    port,
    host,
    rooms,
    botRooms,
    close: async () => {
      ticker.remove(task);
      looping = false;
      for (const r of rooms.values()) r.close();
      rooms.clear();
      for (const r of [...botRooms.values()]) r.close();
      botRooms.clear();
      for (const p of pending) {
        p.detach();
        p.close();
      }
      pending.clear();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((res) => wss.close(() => res()));
      http.closeAllConnections();
      await new Promise<void>((res) => http.close(() => res()));
    },
  };
}
