import { configHash, decodeS2C, encode, type HelloMsg, makeConfig, PROTOCOL_VERSION, type S2C } from '@ppp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BotClient } from '../src/bot-client.ts';
import { type GameServer, startServer } from '../src/server.ts';
import { ticker } from '../src/ticker.ts';

// Partidas algo más cortas (pausa entre puntos de 0.3 s) para que la prueba con sockets reales dure poco.
const cfg = makeConfig({ rules: { pointDelayMs: 300 } });
let server: GameServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

function hello(over: Partial<HelloMsg> = {}): HelloMsg {
  return { k: 'hello', v: PROTOCOL_VERSION, h: configHash(cfg), r: 'player', nm: 'Jugador', p: 0, bp: 0, j: 0, sp: 0, d: 'medium', s: 7, o: 0, ...over };
}

/** Abre un socket (ruta de V0.3: contra el bot), envía `first` y devuelve los mensajes recibidos hasta que se cierre o pase `ms`. */
async function exchange(port: number, first: string, ms = 1500): Promise<{ msgs: S2C[]; closed: boolean }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?bot=medium`);
  const msgs: S2C[] = [];
  let closed = false;
  await new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(first));
    ws.on('message', (d) => {
      const m = decodeS2C(String(d));
      if (m) msgs.push(m);
    });
    ws.on('close', () => {
      closed = true;
      resolve();
    });
    setTimeout(resolve, ms);
  });
  ws.close();
  return { msgs, closed };
}

const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

describe('servidor de juego (sockets reales)', () => {
  it('rechaza config, versión y parámetros distintos', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const other = makeConfig({ rules: { pointDelayMs: 300 }, sim: { gameSpeed: 0.7 } });
    const a = await exchange(server.port, encode(hello({ h: configHash(other) })));
    expect(a.msgs[0]).toMatchObject({ k: 'err', m: 'config' });
    expect(a.closed).toBe(true);
    const b = await exchange(server.port, encode(hello({ v: PROTOCOL_VERSION + 1 })));
    expect(b.msgs[0]).toMatchObject({ k: 'err', m: 'version' });
    const c = await exchange(server.port, encode(hello({ o: 200 })));
    expect(c.msgs[0]).toMatchObject({ k: 'err', m: 'params' });
    const d = await exchange(server.port, '{');
    expect(d.msgs[0]).toMatchObject({ k: 'err', m: 'proto' });
  });

  it('por defecto solo escucha en esta máquina y corta los mensajes enormes', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    expect(server.host).toBe('127.0.0.1');
    const big = await exchange(server.port, 'x'.repeat(20000));
    expect(big.closed).toBe(true);
  });

  it('un jugador contra el bot que arranca el servidor: se juegan puntos sin rechazos ni correcciones', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const player = new BotClient({ url: `ws://127.0.0.1:${server.port}/ws`, route: '?bot=medium', role: 'player', difficulty: 'medium', seed: 7, ping: 0, botping: 0, jitter: 0, cfg });
    const kinds = new Set<string>();
    player.onMessage = (m) => kinds.add(m.k);
    player.start();
    expect(await until(() => [...(server?.botRooms.values() ?? [])].some((r) => r.record.points.length >= 2), 25000)).toBe(true);
    const room = [...server.botRooms.values()][0];
    expect(kinds.has('welcome') && kinds.has('start') && kinds.has('pings')).toBe(true);
    expect(room.record.rejected).toEqual([]);
    expect(player.match?.stats.corrections).toBe(0);
    expect(room.bot?.match?.stats.corrections).toBe(0);
    // Un mensaje basura en mitad de la partida se descarta y la partida sigue.
    player.sendRaw('{');
    const before = room.record.points.length;
    expect(await until(() => room.record.points.length > before, 15000)).toBe(true);
    expect(room.protoErrors[0]).toBe(1);
    player.stop();
  }, 45000);

  it('si el jugador se va a mitad de punto, la sala se cierra y el bot se detiene', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const player = new BotClient({ url: `ws://127.0.0.1:${server.port}/ws`, route: '?bot=medium', role: 'player', difficulty: 'medium', seed: 3, ping: 0, botping: 0, jitter: 0, cfg });
    player.start();
    expect(await until(() => (server?.botRooms.size ?? 0) === 1 && [...server!.botRooms.values()][0].bot?.match?.started === true, 5000)).toBe(true);
    const room = [...server.botRooms.values()][0];
    await new Promise((r) => setTimeout(r, 1500));
    player.stop();
    expect(await until(() => server!.botRooms.size === 0, 3000)).toBe(true);
    expect(room.bot?.stopped).toBe(true);
  }, 15000);

  it('sin conexiones el servidor no deja su bucle en marcha', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    expect(ticker.taskCount).toBe(0);
    const player = new BotClient({ url: `ws://127.0.0.1:${server.port}/ws`, route: '?bot=medium', role: 'player', difficulty: 'medium', seed: 9, ping: 0, botping: 0, jitter: 0, cfg });
    player.start();
    expect(await until(() => ticker.taskCount > 0, 3000)).toBe(true);
    player.stop();
    expect(await until(() => server!.botRooms.size === 0 && ticker.taskCount === 0, 3000)).toBe(true);
  }, 10000);

  it('si el bot se cae, el jugador recibe bye', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const player = new BotClient({ url: `ws://127.0.0.1:${server.port}/ws`, route: '?bot=medium', role: 'player', difficulty: 'medium', seed: 5, ping: 0, botping: 0, jitter: 0, cfg });
    const got: string[] = [];
    player.onMessage = (m) => got.push(m.k);
    player.start();
    expect(await until(() => [...(server?.botRooms.values() ?? [])][0]?.bot?.match?.started === true, 5000)).toBe(true);
    [...server.botRooms.values()][0].bot!.stop();
    expect(await until(() => got.includes('bye'), 3000)).toBe(true);
    player.stop();
  }, 15000);
});
