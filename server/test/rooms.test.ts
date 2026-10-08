/**
 * Servidor Node con salas (V0.4), con sockets reales en un puerto libre: rutas (`?create=`, `?room=`, `?bot=`), códigos
 * y tokens, origen, límite de ritmo, tamaño máximo, reconexión y pestaña duplicada, el flujo de V0.3 contra el bot, un
 * partido Rápido completo entre dos bots y el cierre del servidor sin dejar nada vivo.
 */
import { configHash, decodeS2C, encode, type GameConfig, type HelloMsg, makeConfig, PROTOCOL_VERSION, type RoomMsg, type S2C } from '@ppp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BotClient, type BotClientOptions } from '../src/bot-client.ts';
import { type GameServer, startServer } from '../src/server.ts';
import { ticker } from '../src/ticker.ts';

// Puntos con pausa corta (0.3 s) para que los partidos con sockets reales duren poco.
const cfg = makeConfig({ rules: { pointDelayMs: 300 } });
let server: GameServer | null = null;
const clients: BotClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  await server?.close();
  server = null;
});

const until = async (cond: () => boolean, ms: number): Promise<boolean> => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function url(): string {
  return `ws://127.0.0.1:${server!.port}/ws`;
}

/** Un bot de sala (no da a Listo salvo que se pida `warmupPoints`). */
function bot(over: Partial<BotClientOptions> & { route: string }, c: GameConfig = cfg): BotClient {
  const b = new BotClient({ url: url(), role: 'player', difficulty: 'medium', seed: 7 + clients.length, ping: 0, botping: 0, jitter: 0, cfg: c, warmupPoints: Number.POSITIVE_INFINITY, ...over });
  clients.push(b);
  return b;
}

/** A crea una sala Estándar y B entra con el código: los dos en el warm-up. */
async function pair(over: Partial<BotClientOptions> = {}, mode = 'standard'): Promise<[BotClient, BotClient, string]> {
  const a = bot({ ...over, route: `?create=${mode}`, name: 'Ana' });
  a.start();
  expect(await until(() => a.code !== null, 3000)).toBe(true);
  const code = a.code!;
  const b = bot({ ...over, route: `?room=${code}`, name: 'Beto' });
  b.start();
  expect(await until(() => !!a.match?.started && !!b.match?.started, 3000)).toBe(true);
  return [a, b, code];
}

function hello(over: Partial<HelloMsg> = {}): HelloMsg {
  return { k: 'hello', v: PROTOCOL_VERSION, h: configHash(cfg), r: 'player', nm: 'Otro', p: 0, bp: 0, j: 0, sp: 0, d: 'medium', s: 7, o: 0, ...over };
}

/** Abre un socket con esa ruta, manda `hello` y devuelve lo recibido hasta que el servidor cierre (o pase `ms`). */
async function exchange(route: string, first: string = encode(hello()), ms = 1500): Promise<{ msgs: S2C[]; closed: boolean }> {
  const ws = new WebSocket(`${url()}${route}`);
  const msgs: S2C[] = [];
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
    ws.on('error', () => {});
    timer = setTimeout(resolve, ms);
  });
  clearTimeout(timer);
  ws.close();
  return { msgs, closed };
}

/** Intenta abrir un WebSocket con ese `Origin` (o sin él): 'open', o el estado HTTP con que lo rechazan. */
function tryOpen(origin?: string): Promise<'open' | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${url()}?create=quick`, origin === undefined ? {} : { origin });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('error', (e) => {
      const m = /Unexpected server response: (\d+)/.exec(e.message);
      resolve(m ? Number(m[1]) : -1);
    });
  });
}

/** Recursos que mantienen vivo el proceso, por tipo (sockets, servidores, temporizadores). */
function resources(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of process.getActiveResourcesInfo()) out[r] = (out[r] ?? 0) + 1;
  return out;
}

describe('servidor con salas (sockets reales)', () => {
  it('(a) crear da un código de 4 letras y un token; otro entra con el código en minúsculas como lado 1; los dos al warm-up', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const a = bot({ route: '?create=standard', name: 'Ana' });
    const got: S2C[][] = [[], []];
    a.onMessage = (m) => got[0].push(m);
    a.start();
    expect(await until(() => a.code !== null, 3000)).toBe(true);
    expect(a.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(a.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.side).toBe(0);
    expect(got[0][0]).toMatchObject({ k: 'welcome', v: PROTOCOL_VERSION, side: 0, room: a.code, md: 'standard' });
    expect(server.rooms.has(a.code!)).toBe(true);

    const b = bot({ route: `?room=${a.code!.toLowerCase()}`, name: 'Beto' });
    b.onMessage = (m) => got[1].push(m);
    b.start();
    const warm = (ms: S2C[]) => ms.some((m) => m.k === 'room' && m.ph === 'warmup') && ms.some((m) => m.k === 'start' && m.wu === 1);
    expect(await until(() => warm(got[0]) && warm(got[1]), 3000)).toBe(true);
    expect(b.side).toBe(1);
    expect(b.code).toBe(a.code);
    expect(b.token).not.toBe(a.token);
    const room = got[1].find((m): m is RoomMsg => m.k === 'room' && m.ph === 'warmup')!;
    expect(room.pl.map((p) => p?.nm)).toEqual(['Ana', 'Beto']);
    expect(server.rooms.size).toBe(1);
  }, 10000);

  it('(b) sala inexistente, llena o código no válido: err legible y cierre; unirse nunca crea una sala', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const [, , code] = await pair();
    const ghost = code === 'ZZZZ' ? 'YYYY' : 'ZZZZ';

    const none = await exchange(`?room=${ghost}`);
    expect(none.msgs).toEqual([{ k: 'err', m: 'room', d: 'Sala inexistente' }]);
    expect(none.closed).toBe(true);

    const full = await exchange(`?room=${code}`);
    expect(full.msgs).toEqual([{ k: 'err', m: 'full', d: 'Sala llena' }]);
    expect(full.closed).toBe(true);

    const bad = await exchange('?room=AB0D');
    expect(bad.msgs).toEqual([{ k: 'err', m: 'route', d: 'Código de sala no válido' }]);
    expect(bad.closed).toBe(true);
    // Un id de sala de bot que no existe tampoco crea nada.
    expect((await exchange('?room=b-99')).msgs).toEqual([{ k: 'err', m: 'room', d: 'Sala inexistente' }]);
    for (const route of ['?room=', '?room=ABC', '?room=ABCDE', '?room=ABIO']) {
      expect((await exchange(route)).msgs[0]).toMatchObject({ k: 'err', m: 'route', d: 'Código de sala no válido' });
    }
    // Otras rutas malas: texto claro, no el motivo interno.
    const mode = await exchange('?create=mega');
    expect(mode.msgs[0]).toMatchObject({ k: 'err', m: 'route' });
    expect((mode.msgs[0] as { d: string }).d).toMatch(/^Modo de partido no válido/);
    const none2 = await exchange('');
    expect(none2.msgs[0]).toMatchObject({ k: 'err', m: 'route' });
    expect((none2.msgs[0] as { d: string }).d).toMatch(/^Falta la ruta/);

    // Un hello con otra config en una sala nueva no deja una sala huérfana.
    const other = makeConfig({ rules: { pointDelayMs: 300 }, sim: { gameSpeed: 0.7 } });
    expect((await exchange('?create=quick', encode(hello({ h: configHash(other) })))).msgs[0]).toMatchObject({ k: 'err', m: 'config' });
    expect([...server.rooms.keys()]).toEqual([code]);
  }, 15000);

  it('(c) origen: uno ajeno recibe 403 antes de abrir; sin Origin, el de Vite o el del propio host, abre', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    expect(await tryOpen('http://evil.example')).toBe(403);
    expect(await tryOpen('null')).toBe(403);
    expect(await tryOpen()).toBe('open');
    expect(await tryOpen('http://localhost:5173')).toBe('open');
    expect(await tryOpen('http://127.0.0.1:5173')).toBe('open');
    expect(await tryOpen(`http://127.0.0.1:${server.port}`)).toBe('open');
    expect(await tryOpen('http://localhost:5174')).toBe(403);
    // Abrir sin mandar hello no crea ninguna sala.
    expect(await until(() => server!.rooms.size === 0, 1000)).toBe(true);
  }, 10000);

  it('(d) 500 mensajes de raqueta de golpe: err rate y cierre; la sala sigue para el otro con el hueco reservado', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const [a, b, code] = await pair();
    const host = server.rooms.get(code)!;
    const seen: RoomMsg[] = [];
    a.onRoom = (m) => seen.push(m);
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) b.sendRaw('[0,-1,0,1500]');
    expect(performance.now() - t0).toBeLessThan(100);
    expect(await until(() => b.closedBy !== null, 3000)).toBe(true);
    expect(b.closedBy).toEqual({ k: 'err', m: 'rate', d: 'Demasiados mensajes: conexión cerrada' });
    expect(await until(() => seen.some((m) => m.pl[1]?.c === 0), 3000)).toBe(true);
    expect(host.peers[1]).toBeNull();
    expect(server.rooms.get(code)).toBe(host);
    expect(host.core.players).toBe(2);
    expect(a.stopped).toBe(false);
  }, 10000);

  it('(e) volver con el token tras cerrar en el warm-up: mismo lado; con el viejo aún abierto, el viejo recibe bye y se cierra', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const [a, b, code] = await pair();
    const host = server.rooms.get(code)!;
    const tk = b.token!;
    b.stop();
    expect(await until(() => a.lastRoom?.pl[1]?.c === 0, 3000)).toBe(true);

    const b2 = bot({ route: `?room=${code}`, token: tk, name: 'Beto' });
    b2.start();
    expect(await until(() => b2.side === 1 && a.lastRoom?.pl[1]?.c === 1 && b2.lastRoom?.pl[1]?.c === 1, 3000)).toBe(true);
    expect(b2.token).toBe(tk);
    expect(b2.code).toBe(code);
    const old = host.peers[1]!;
    expect(old.isOpen).toBe(true);

    // Pestaña duplicada: el mismo token con la conexión vieja abierta.
    const seen: RoomMsg[] = [];
    a.onRoom = (m) => seen.push(m);
    const b3 = bot({ route: `?room=${code}`, token: tk, name: 'Beto' });
    b3.start();
    expect(await until(() => b3.side === 1 && b2.closedBy !== null, 3000)).toBe(true);
    expect(b2.closedBy).toEqual({ k: 'bye', m: 'Conectado desde otra pestaña' });
    expect(old.isOpen).toBe(false);
    expect(host.peers[1]).not.toBe(old);
    expect(host.peers[1]).not.toBeNull();
    await sleep(200);
    // El rival no ve ningún corte.
    expect(seen.some((m) => m.pl[1]?.c === 0)).toBe(false);
    expect(host.core.phase).toBe('warmup');
  }, 10000);

  it('(e2) `leave` seguido del cierre del socket: el cierre llega detrás del `leave` y el hueco queda libre, sin reserva', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const [a, b, code] = await pair({ ping: 200 });
    const host = server.rooms.get(code)!;
    b.leave();
    expect(await until(() => a.lastRoom?.ph === 'waiting', 3000)).toBe(true);
    expect(a.lastRoom!.pl[1]).toBeNull();
    expect(host.core.players).toBe(1);
    expect(host.core.record.events.map((e) => e.what)).toContain('leave 1');
    expect(host.core.record.events.map((e) => e.what)).not.toContain('disconnect 1');
  }, 10000);

  it('(f) un mensaje de 17 KB cierra la conexión; uno basura se descarta y la sala sigue', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const [a, b, code] = await pair();
    const host = server.rooms.get(code)!;
    const peer = host.peers[1]!;
    b.sendRaw('{basura');
    b.sendRaw('{"k":"hit","n":-3}');
    expect(await until(() => peer.protoErrors === 2, 2000)).toBe(true);
    await sleep(200);
    expect(b.stopped).toBe(false);
    expect(host.peers[1]).toBe(peer);

    b.sendRaw('x'.repeat(17 * 1024));
    expect(await until(() => b.stopped, 3000)).toBe(true);
    expect(b.closeCode).toBe(1009);
    expect(await until(() => a.lastRoom?.pl[1]?.c === 0, 3000)).toBe(true);
    expect(server.rooms.get(code)).toBe(host);
  }, 10000);

  it('(j) latencia simulada por conexión (ping del hello) y picos dentro del límite; picos de más → err params', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const [a, b, code] = await pair({ ping: 200, spike: cfg.net.latency.spike.maxProb });
    expect(await until(() => a.match?.stats.myPing != null && b.match?.stats.myPing != null, 4000)).toBe(true);
    const host = server.rooms.get(code)!;
    expect(host.peers[0]!.spikes + host.peers[1]!.spikes).toBeGreaterThan(0);
    for (const c of [a, b]) {
      expect(c.match!.stats.myPing).toBeGreaterThanOrEqual(195);
      expect(c.match!.stats.myPing).toBeLessThan(200 + 2 * cfg.net.latency.spike.maxMs);
    }
    expect((await exchange('?create=quick', encode(hello({ sp: 0.5 })))).msgs[0]).toMatchObject({ k: 'err', m: 'params' });
  }, 10000);

  it('(g) ?bot=medium: el flujo de V0.3 contra el bot remoto, 3 puntos sin rechazos ni correcciones', async () => {
    server = await startServer({ port: 0, cfg, log: () => {} });
    const p = bot({ route: '?bot=medium' });
    p.start();
    expect(await until(() => [...(server?.botRooms.values() ?? [])].some((r) => r.record.points.length >= 3), 30000)).toBe(true);
    const room = [...server.botRooms.values()][0];
    expect(room.id).toMatch(/^b-\d+$/);
    expect(p.code).toBe(room.id);
    expect(p.mode).toBe('bot');
    expect(room.record.rejected).toEqual([]);
    expect(p.match?.stats.corrections).toBe(0);
    expect(room.bot?.match?.stats.corrections).toBe(0);
    expect(server.rooms.size).toBe(0);
  }, 40000);

  it('(h) dos bots juegan un partido Rápido completo por sockets: mend por marcador y sin rechazos', async () => {
    // Todo el flujo (warm-up, Listo, cuenta atrás, game, mend) con un game corto: a 3 puntos, cuenta atrás de 1 s. Con
    // el game de 11 puntos son ~2.5 min en tiempo real; el partido largo ya lo prueba la red en memoria de shared/.
    const short = makeConfig({ rules: { pointDelayMs: 300, pointsToWin: 3, winBy: 1 }, room: { countdownMs: 1000 } });
    server = await startServer({ port: 0, cfg: short, log: () => {} });
    const [a, b] = await pair({ warmupPoints: 1, cfg: short }, 'quick');
    expect(await until(() => a.lastEnd !== null && b.lastEnd !== null, 50000)).toBe(true);
    for (const c of [a, b]) {
      expect(c.lastEnd).toMatchObject({ k: 'mend', why: 'score', rj: [0, 0] });
      expect(c.match?.stats.corrections).toBe(0);
    }
    expect(a.lastEnd!.w).toBe(b.lastEnd!.w);
    expect(a.lastEnd!.gw).toEqual(b.lastEnd!.gw);
    expect(Math.max(...a.lastEnd!.gw)).toBe(1);
    expect(a.mode).toBe('quick');
    expect(a.lastEnd!.st[0].pts + a.lastEnd!.st[1].pts).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('(i) close() no deja temporizadores ni sockets', async () => {
    const before = resources();
    server = await startServer({ port: 0, cfg, log: () => {} });
    await pair();
    const p = bot({ route: '?bot=easy' });
    p.start();
    expect(await until(() => [...(server?.botRooms.values() ?? [])].some((r) => r.bot?.match?.started === true), 5000)).toBe(true);
    await server.close();
    server = null;
    const back = () => ['TCPSocketWrap', 'TCPServerWrap', 'Timeout'].every((k) => (resources()[k] ?? 0) <= (before[k] ?? 0));
    expect(await until(() => ticker.taskCount === 0 && back(), 5000)).toBe(true);
    expect(clients.every((c) => c.stopped)).toBe(true);
  }, 15000);
});
