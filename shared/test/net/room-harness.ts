/**
 * Red en memoria con salas (V0.4) y tiempo virtual, como harness.ts para V0.3 pero con una RoomCore real: dos bots,
 * cada uno detrás de su ClientMatch, juegan un partido entero (warm-up → Listo → cuenta atrás → games → `mend`).
 *
 * El arnés hace de servidor mínimo y cumple el contrato conexión ↔ lado de `RoomCore.join`:
 *  - cada conexión tiene su cola de latencia de subida y de bajada (ping/2 de ida y de vuelta, con su variación y los
 *    picos de TCP), y cada mensaje pasa por el codec real (encode → decode);
 *  - una conexión manda primero `hello`; al llegar, `join` (lo que la sala mande durante el `join` a un lado sin conexión
 *    va a la que entra) y, si sale bien, la conexión queda registrada para su lado;
 *  - `drop` olvida la conexión en el acto: lo que mande después ya no llega a la sala;
 *  - el lado 1 abre su conexión cuando la sala ya ha sentado al 0 (así cada bot juega en su lado con cualquier ping).
 *
 * Bucle de eventos discretos: en cada tick de 120 Hz los bots piensan, los clientes procesan su entrada, se atiende en
 * orden de tiempo todo lo que vence hasta ese instante (llegadas al servidor, llegadas a los clientes y los plazos de
 * la sala, cada uno en su instante exacto, como el temporizador único de un servidor) y los clientes avanzan su mundo.
 *
 * Cada bot juega el warm-up, manda `rdy` tras `warmupPoints` puntos y juega el partido. Con `disconnect`, el bot de ese
 * lado pierde la conexión con la bola en juego hacia él (en su campo, sin golpe en curso) a partir del punto `atPoint`
 * del game `game`: sus colas se descartan y la sala lo sabe en ese instante. Si `backAfterMs` no es null, vuelve tras ese
 * tiempo (en el primer tick) con un ClientMatch y un bot nuevos y el mismo token. El arnés para unos segundos después del
 * fin del partido (por marcador o por abandono), para que los clientes acaben de enseñar el último punto.
 */
import { Bot, makeRng } from '../../src/bot.ts';
import { type BotDifficulty, type GameConfig, type MatchMode, tickMs } from '../../src/config.ts';
import type { SimEvent } from '../../src/sim.ts';
import { neutralIntent, type Side, sideSign } from '../../src/types.ts';
import { ClientMatch } from '../../src/net/client-match.ts';
import { configHash } from '../../src/net/config-hash.ts';
import { LatencyQueue, type LatencySpike } from '../../src/net/latency.ts';
import { type C2S, decodeC2S, decodeS2C, encode, type HelloMsg, PROTOCOL_VERSION, type S2C } from '../../src/net/protocol.ts';
import { RoomCore } from '../../src/net/room.ts';
import type { MatchRecord } from '../../src/net/server-match.ts';

export interface RoomRunOptions {
  cfg: GameConfig;
  mode: MatchMode;
  seeds: [number, number];
  difficulties?: [BotDifficulty, BotDifficulty];
  /** Ping (ida y vuelta, ms) de cada lado. */
  ping: [number, number];
  jitter: number;
  /** Probabilidad de picos de TCP en cada sentido de cada conexión (limitada a net.latency.spike.maxProb). */
  spike?: number;
  maxTicks: number;
  /** Puntos de warm-up antes de dar a Listo (por defecto 2). */
  warmupPoints?: number;
  /** null = no vuelve. */
  disconnect?: { side: Side; atPoint: number; game: number; backAfterMs: number | null };
}

export interface RoomRun {
  room: RoomCore;
  /** Un cliente por conexión, en orden: 0 y 1 al empezar, 2… los que vuelven (`side` dice de qué lado es). */
  clients: ClientMatch[];
  /** Eventos de cada cliente `c` (instante global), con el game que mostraba (`g`, 0 en el warm-up) y si era warm-up. */
  events: { side: Side; c: number; t: number; e: SimEvent; g: number; wu: boolean }[];
  /** Lo que mandó la sala: a qué lado y a qué conexión (= cliente), y cuándo (reloj del servidor). */
  s2c: { to: Side; c: number; t: number; msg: S2C }[];
  /** Lo que mandaron los clientes (también `hello` y `rdy`), cuándo lo mandaron. */
  c2s: { from: Side; c: number; t: number; msg: C2S }[];
  /** Correcciones de todos los clientes. */
  corrections: number;
  ticks: number;
  /** Registros de las autoridades de los games (sin warm-up), en orden. */
  games: MatchRecord[];
  /** Líneas de registro de la sala (y de sus autoridades). */
  log: string[];
  /** El corte: lado, instante, rally en juego, game y punto (el que se jugaba). */
  cut: { side: Side; t: number; n: number; game: number; point: number } | null;
  /** Mensajes que sufrieron un pico de TCP (todas las colas). */
  spikes: number;
  /** El mayor salto de la bola dibujada por tick en cualquier cliente (m, ClientMatch.stats.maxRenderJump). */
  maxRenderJump: number;
}

interface Conn {
  id: number;
  side: Side;
  up: LatencyQueue<C2S>;
  down: LatencyQueue<S2C>;
  /** El cliente la cortó: sus colas se descartan. */
  cut: boolean;
  /** La sala la cerró (`drop`): lo que mande ya no llega a la sala. */
  dropped: boolean;
  joined: boolean;
}

interface Player {
  side: Side;
  /** Índice del cliente (= de su conexión). */
  idx: number;
  client: ClientMatch;
  bot: Bot;
  conn: Conn;
  /** Instante global del 0 del reloj de su ClientMatch. */
  base: number;
  active: boolean;
  token: string | null;
  warmupPoints: number;
  readySent: boolean;
}

/** Tiempo que el arnés sigue tras el fin del partido: el vuelo que quede, el punto (1,6 s) y el fin del game. */
const SETTLE_MS = 6000;

export function runRoomMatch(o: RoomRunOptions): RoomRun {
  const cfg = o.cfg;
  const tick = tickMs(cfg);
  const diffs = o.difficulties ?? ['medium', 'medium'];
  const sc = cfg.net.latency.spike;
  const spike: LatencySpike | undefined = o.spike ? { prob: Math.min(o.spike, sc.maxProb), minMs: sc.minMs, maxMs: sc.maxMs } : undefined;
  const warmupPoints = o.warmupPoints ?? 2;
  const hash = configHash(cfg);

  const s2c: RoomRun['s2c'] = [];
  const c2s: RoomRun['c2s'] = [];
  const events: RoomRun['events'] = [];
  const games: MatchRecord[] = [];
  const log: string[] = [];
  const conns: Conn[] = [];
  const players: Player[] = [];
  const sideConn: [Conn | null, Conn | null] = [null, null];
  let joining: Conn | null = null;
  let serverNow = 0;
  let now = 0;
  let matchStarted = false;
  let cut: RoomRun['cut'] = null;

  // ——— Transporte ———

  const upload = (conn: Conn, msg: C2S, t: number): void => {
    if (conn.cut) return;
    const text = encode(msg);
    const back = decodeC2S(text);
    if (!back) throw new Error(`el cliente envió un mensaje que no se decodifica: ${text}`);
    c2s.push({ from: conn.side, c: conn.id, t, msg: back });
    conn.up.push(back, t);
  };

  const download = (conn: Conn, to: Side, msg: S2C): void => {
    const text = encode(msg);
    const back = decodeS2C(text);
    if (!back) throw new Error(`la sala envió un mensaje que no se decodifica: ${text}`);
    s2c.push({ to, c: conn.id, t: serverNow, msg: back });
    if (!conn.cut) conn.down.push(back, serverNow);
  };

  let tokens = 0;
  const room = new RoomCore({
    cfg,
    code: 'TEST',
    mode: o.mode,
    send: (to, msg) => {
      const conn = sideConn[to] ?? joining;
      // La sala atrapa y registra lo que lance un envío: el test lo ve en `log` («fallido»).
      if (!conn) throw new Error(`${msg.k} al lado ${to}, sin conexión`);
      if (msg.k === 'start' && msg.wu === 0) {
        matchStarted = true;
        const rec = room.record.authorities[room.record.authorities.length - 1];
        if (games[games.length - 1] !== rec) games.push(rec);
      }
      download(conn, to, msg);
    },
    drop: (to) => {
      const conn = sideConn[to];
      if (!conn) return;
      conn.dropped = true;
      sideConn[to] = null;
    },
    newToken: () => `tok-${++tokens}-${o.seeds[0]}-${o.seeds[1]}`,
    random: makeRng(o.seeds[0] * 7919 + o.seeds[1]),
    log: (line) => log.push(line),
  });

  /** Un bot con su ClientMatch (reloj desde `base`) y su conexión, aún sin abrir. */
  const newPlayer = (side: Side, base: number, token: string | null): Player => {
    const idx = players.length;
    const one = o.ping[side] / 2;
    const conn: Conn = { id: idx, side, up: new LatencyQueue<C2S>(one, o.jitter, 101 * (idx + 1), spike), down: new LatencyQueue<S2C>(one, o.jitter, 303 * (idx + 1) + 1, spike), cut: false, dropped: false, joined: false };
    conns.push(conn);
    const client = new ClientMatch(cfg, side, (msg) => upload(conn, msg, now));
    const bot = new Bot(side, cfg.bot.difficulties[diffs[side]], cfg, o.seeds[side] + 1000 * idx);
    const p: Player = { side, idx, client, bot, conn, base, active: true, token, warmupPoints: 0, readySent: false };
    players.push(p);
    return p;
  };

  /** Abre la conexión: su primer mensaje es el `hello` (con el token si vuelve). */
  const openConn = (p: Player, t: number): void => {
    const hello: HelloMsg = { k: 'hello', v: PROTOCOL_VERSION, h: hash, r: 'player', nm: `Bot ${p.side}`, p: o.ping[p.side], bp: 0, j: o.jitter, sp: spike?.prob ?? 0, d: diffs[p.side], s: o.seeds[p.side], o: 0 };
    if (p.token !== null) hello.tk = p.token;
    upload(p.conn, hello, t);
  };

  /** Llegada al servidor: el `hello` de una conexión nueva (join) o un mensaje de una conexión registrada. */
  const arriveUp = (conn: Conn, msg: C2S, at: number): void => {
    serverNow = at;
    if (conn.dropped) return;
    if (!conn.joined) {
      if (msg.k !== 'hello') throw new Error(`${msg.k} antes del hello`);
      joining = conn;
      const res = room.join(msg, at);
      joining = null;
      if (!res.ok) throw new Error(`join rechazado: ${res.err}`);
      if (res.side !== conn.side) throw new Error(`la conexión del lado ${conn.side} entró en el ${res.side}`);
      sideConn[res.side] = conn;
      conn.joined = true;
      // El lado 1 entra cuando la sala ya ha sentado al 0.
      if (conn.id === 0) openConn(players[1], at);
      return;
    }
    room.receive(conn.side, msg, at);
  };

  const arriveDown = (conn: Conn, msg: S2C, at: number): void => {
    const p = players[conn.id];
    if (msg.k === 'welcome') p.token = msg.tk;
    p.client.receive(msg, at - p.base);
  };

  /** Atiende en orden de tiempo todo lo que vence hasta `until`: plazos de la sala, subidas y bajadas. */
  const deliver = (until: number): void => {
    for (;;) {
      let at = room.nextDeadline();
      let kind: 'room' | 'up' | 'down' = 'room';
      let conn: Conn | null = null;
      for (const c of conns) {
        if (c.cut) continue;
        const u = c.up.nextAt();
        if (u < at) {
          at = u;
          kind = 'up';
          conn = c;
        }
      }
      for (const c of conns) {
        if (c.cut) continue;
        const d = c.down.nextAt();
        if (d < at) {
          at = d;
          kind = 'down';
          conn = c;
        }
      }
      if (at > until) return;
      if (kind === 'room') {
        serverNow = at;
        room.poll(at);
        if (room.nextDeadline() <= at) throw new Error(`la sala no avanza su plazo en ${at}`);
      } else if (kind === 'up') arriveUp(conn!, conn!.up.popDue(at)!, at);
      else arriveDown(conn!, conn!.down.popDue(at)!, at);
    }
  };

  // ——— Los bots: Listo, corte y vuelta ———

  const maybeReady = (p: Player): void => {
    if (matchStarted || p.readySent || !p.client.practice || p.warmupPoints < warmupPoints) return;
    p.readySent = true;
    upload(p.conn, { k: 'rdy', on: 1 }, now);
  };

  /** El lado que se corta pierde la conexión con la bola en juego hacia él, en su campo y sin golpe en curso. */
  const maybeCut = (): void => {
    const d = o.disconnect;
    if (!d || cut) return;
    const p = players.find((x) => x.active && x.side === d.side);
    if (!p) return;
    const c = p.client;
    const s = c.state;
    if (!c.started || c.practice || c.game !== d.game || s.score[0] + s.score[1] < d.atPoint - 1) return;
    if (s.phase !== 'rally' || s.rally.lastHitter !== c.rival || s.paddles[c.side].pending || s.ball.pos.z * sideSign(c.side) <= 0) return;
    cut = { side: p.side, t: now, n: c.rally, game: d.game, point: s.score[0] + s.score[1] + 1 };
    p.active = false;
    p.conn.cut = true;
    // Contrato de RoomCore.join: el cierre de una conexión que la sala ya cerró (`drop`) no se notifica.
    if (p.conn.dropped) return;
    if (sideConn[p.side] === p.conn) sideConn[p.side] = null;
    serverNow = now;
    room.disconnect(p.side, now);
  };

  const backTick = (): number => {
    const d = o.disconnect;
    if (!cut || !d || d.backAfterMs === null) return Number.POSITIVE_INFINITY;
    return Math.round(cut.t / tick) + Math.ceil(d.backAfterMs / tick);
  };

  // ——— Bucle ———

  newPlayer(0, 0, null);
  newPlayer(1, 0, null);
  openConn(players[0], 0);
  deliver(0);
  let back = false;
  let stopAt = Number.POSITIVE_INFINITY;
  let ticks = 0;
  for (let n = 1; n <= o.maxTicks; n++) {
    ticks = n;
    const active = players.filter((p) => p.active);
    const intents = active.map((p) => (p.client.started ? p.bot.think(p.client) : neutralIntent(cfg.bot.readyDepth)));
    now = n * tick;
    active.forEach((p, i) => p.client.stepInput(intents[i]));
    deliver(now);
    for (const p of active) {
      for (const e of p.client.stepWorld()) {
        events.push({ side: p.side, c: p.idx, t: now, e, g: p.client.game, wu: p.client.practice });
        if (p.client.practice && (e.type === 'point' || e.type === 'let')) p.warmupPoints++;
      }
      maybeReady(p);
    }
    maybeCut();
    if (!back && n >= backTick()) {
      back = true;
      const old = players.find((p) => p.side === cut!.side)!;
      openConn(newPlayer(cut!.side, now, old.token), now);
    }
    if (stopAt === Number.POSITIVE_INFINITY && room.record.matches.length > 0) stopAt = now + SETTLE_MS;
    if (now >= stopAt) break;
  }

  const clients = players.map((p) => p.client);
  return {
    room,
    clients,
    events,
    s2c,
    c2s,
    corrections: clients.reduce((a, c) => a + c.stats.corrections, 0),
    ticks,
    games,
    log,
    cut,
    spikes: conns.reduce((a, c) => a + c.up.spikes + c.down.spikes, 0),
    maxRenderJump: clients.reduce((a, c) => Math.max(a, c.stats.maxRenderJump), 0),
  };
}
