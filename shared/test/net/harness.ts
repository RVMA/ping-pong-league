/**
 * Red en memoria con tiempo virtual para probar ClientMatch + ServerMatch sin sockets: dos bots, cada uno detrás de
 * su ClientMatch, y un ServerMatch. Cada mensaje pasa por el codec real (encode → decode) y por una LatencyQueue por
 * sentido y por jugador (ping/2 de ida y de vuelta, con su variación). En cada tick de 120 Hz: los dos bots piensan,
 * los dos clientes procesan su entrada, se entregan los mensajes vencidos (el servidor los procesa en su instante
 * exacto de llegada), el servidor revisa sus temporizadores y los dos clientes avanzan su mundo.
 */
import { Bot } from '../../src/bot.ts';
import { type BotDifficulty, type GameConfig, tickMs } from '../../src/config.ts';
import type { SimEvent } from '../../src/sim.ts';
import type { Side } from '../../src/types.ts';
import { ClientMatch } from '../../src/net/client-match.ts';
import { LatencyQueue } from '../../src/net/latency.ts';
import { type C2S, decodeC2S, decodeS2C, encode, type S2C } from '../../src/net/protocol.ts';
import { ServerMatch } from '../../src/net/server-match.ts';

export interface NetworkRunOptions {
  cfg: GameConfig;
  seeds: [number, number];
  difficulties?: [BotDifficulty, BotDifficulty];
  /** Ping (ida y vuelta, ms) de cada jugador. */
  ping: [number, number];
  jitter: number;
  maxTicks: number;
  /** Altera un mensaje del servidor antes de que llegue a `to` (para probar correcciones). */
  tamper?: (msg: S2C, to: Side) => S2C;
}

export interface NetworkRun {
  events: [{ t: number; e: SimEvent }[], { t: number; e: SimEvent }[]];
  server: ServerMatch;
  clients: [ClientMatch, ClientMatch];
  c2s: { from: Side; text: string }[];
  s2c: { to: Side; text: string }[];
  ticks: number;
}

export function runNetworkMatch(o: NetworkRunOptions): NetworkRun {
  const cfg = o.cfg;
  const tick = tickMs(cfg);
  const diffs = o.difficulties ?? ['medium', 'medium'];
  const up = [new LatencyQueue<C2S>(o.ping[0] / 2, o.jitter, 101), new LatencyQueue<C2S>(o.ping[1] / 2, o.jitter, 202)];
  const down = [new LatencyQueue<S2C>(o.ping[0] / 2, o.jitter, 303), new LatencyQueue<S2C>(o.ping[1] / 2, o.jitter, 404)];
  const c2s: NetworkRun['c2s'] = [];
  const s2c: NetworkRun['s2c'] = [];
  let serverNow = 0;
  let now = 0;
  const server = new ServerMatch(cfg, {
    send: (to, msg) => {
      const text = encode(msg);
      s2c.push({ to, text });
      const back = decodeS2C(text);
      if (!back) throw new Error(`el servidor envió un mensaje que no se decodifica: ${text}`);
      down[to].push(o.tamper ? o.tamper(back, to) : back, serverNow);
    },
  });
  const mk = (side: Side) =>
    new ClientMatch(cfg, side, (msg) => {
      const text = encode(msg);
      c2s.push({ from: side, text });
      const back = decodeC2S(text);
      if (!back) throw new Error(`el cliente envió un mensaje que no se decodifica: ${text}`);
      up[side].push(back, now);
    });
  const clients: [ClientMatch, ClientMatch] = [mk(0), mk(1)];
  const bots = [new Bot(0, cfg.bot.difficulties[diffs[0]], cfg, o.seeds[0]), new Bot(1, cfg.bot.difficulties[diffs[1]], cfg, o.seeds[1])];
  const events: NetworkRun['events'] = [[], []];

  const deliver = (until: number) => {
    for (;;) {
      let best = -1;
      let at = Number.POSITIVE_INFINITY;
      const queues = [up[0], up[1], down[0], down[1]];
      for (let q = 0; q < 4; q++) {
        const a = queues[q].nextAt();
        if (a <= until && a < at) {
          at = a;
          best = q;
        }
      }
      if (best < 0) return;
      if (best < 2) {
        serverNow = at;
        server.receive(best as Side, up[best].popDue(at)!, at);
      } else {
        const side = (best - 2) as Side;
        clients[side].receive(down[side].popDue(at)!, at);
      }
    }
  };

  server.start(0);
  deliver(0);
  let ticks = 0;
  for (let n = 1; n <= o.maxTicks; n++) {
    ticks = n;
    const i0 = bots[0].think(clients[0]);
    const i1 = bots[1].think(clients[1]);
    now = n * tick;
    clients[0].stepInput(i0);
    clients[1].stepInput(i1);
    deliver(now);
    serverNow = now;
    server.poll(now);
    for (const side of [0, 1] as Side[]) for (const e of clients[side].stepWorld()) events[side].push({ t: now, e });
    if (clients[0].finished && clients[1].finished) break;
  }
  return { events, server, clients, c2s, s2c, ticks };
}
