/**
 * Partidos de bots POR LA RED (V0.3): Node, sockets reales, sin navegador. Arranca el servidor de juego en este mismo
 * proceso y juega N partidos en paralelo: en cada uno, un bot se conecta como jugador (lado 0) y el servidor arranca el
 * bot remoto (lado 1), los dos con la latencia simulada pedida. Equivale a `shot-stats` pero por la red.
 *
 *   node server/scripts/net-bots.ts [dificultad0] [dificultad1] [partidos] [semilla] [ping] [variación]
 *   p. ej.: node server/scripts/net-bots.ts medium medium 30 7 100 0.1
 *
 * Muestra: golpes por punto, motivos de los puntos, causas de «¿por qué fallé?» con nombre, discrepancias (correcciones
 * de los clientes y rechazos del servidor), CPU del servidor por golpe, bytes/s por jugador, frenado de la bola que se
 * aleja, ping medido y duración de los games.
 */
import { type BotDifficulty, diagnose, type HitEvaluation, makeConfig, type ShotTargets, type SimEvent } from '@ppp/shared';
import { BotClient } from '../src/bot-client.ts';
import { startServer } from '../src/server.ts';

const d0 = (process.argv[2] ?? 'medium') as BotDifficulty;
const d1 = (process.argv[3] ?? 'medium') as BotDifficulty;
const games = Number(process.argv[4] ?? 10);
const seed0 = Number(process.argv[5] ?? 7);
const ping = Number(process.argv[6] ?? 100);
const jitter = Number(process.argv[7] ?? 0.1);
const cfg = makeConfig(process.env.PPP_CFG ? JSON.parse(process.env.PPP_CFG) : {});
if (d0 !== d1) console.log('Aviso: el bot remoto usa la dificultad del jugador que se conecta (d0); d1 se ignora.');

interface LossTracker {
  lastHit: { targets: ShotTargets; evaluation: HitEvaluation; contactHeight: number } | null;
  whiff: HitEvaluation | null;
  whiffed: boolean;
}

const causes: Record<string, number> = {};
const reasons: Record<string, number> = {};
const brakeMeans: number[] = [];
const brakeMax: number[] = [];
const pings: number[] = [];

/** «¿Por qué fallé?» de cada punto perdido, desde la vista de quien lo pierde (como shot-stats). */
function trackLosses(c: BotClient): void {
  const t: LossTracker = { lastHit: null, whiff: null, whiffed: false };
  c.onEvent = (e: SimEvent, client) => {
    const me = client.match?.side;
    if (me === undefined) return;
    if (e.type === 'serveReady' || e.type === 'let') {
      t.lastHit = null;
      t.whiff = null;
      t.whiffed = false;
    } else if (e.type === 'hit' && e.player === me) {
      t.lastHit = { targets: e.targets, evaluation: e.evaluation, contactHeight: e.pos.y - cfg.world.tableHeight };
    } else if (e.type === 'whiff' && e.player === me) {
      t.whiff = e.evaluation;
      t.whiffed = true;
    } else if (e.type === 'point') {
      if (e.winner !== me) {
        const d = diagnose({ reason: e.reason, lastHit: t.lastHit, whiff: t.whiff, whiffed: t.whiffed }, cfg);
        if (d) causes[`${e.reason}:${d.cause}`] = (causes[`${e.reason}:${d.cause}`] ?? 0) + 1;
      }
      t.lastHit = null;
      t.whiff = null;
      t.whiffed = false;
    }
  };
}

const server = await startServer({ port: 0, cfg, log: () => {} });
const url = `ws://127.0.0.1:${server.port}/ws`;
const t0 = performance.now();
const players: BotClient[] = [];
for (let g = 0; g < games; g++) {
  const seed = seed0 + g * 101;
  // Mismas semillas y mismo primer saque que shot-stats (bot 0: seed; bot 1: seed·31 + 1; saca primero g % 2).
  const c = new BotClient({ url, route: `?bot=${d0}`, role: 'player', difficulty: d0, seed, botSeed: seed * 31 + 1, ping, botping: ping, jitter, cfg, firstServer: (g % 2) as 0 | 1 });
  trackLosses(c);
  players.push(c);
  c.start();
}
// Los bots remotos aparecen al conectarse los jugadores: se engancha su seguimiento en cuanto existen.
const hooked = new Set<string>();
/** Por sala: cuándo acabó y los bytes de cada jugador en ese momento (después solo hay ping y raqueta en espera). */
const rooms = new Map<string, { room: import('../src/room.ts').Room; endedAt: number; bytes: { in: number; out: number }[] }>();
const finished = await new Promise<boolean>((resolve) => {
  const timer = setInterval(() => {
    for (const r of server.botRooms.values()) {
      if (!rooms.has(r.id)) rooms.set(r.id, { room: r, endedAt: 0, bytes: [] });
      if (r.bot && !hooked.has(r.id)) {
        hooked.add(r.id);
        trackLosses(r.bot);
      }
      const e = rooms.get(r.id)!;
      if (r.record.winner !== null && !e.endedAt) {
        e.endedAt = performance.now();
        e.bytes = r.peers.map((p) => ({ in: p?.bytesIn ?? 0, out: p?.bytesOut ?? 0 }));
      }
    }
    const done = [...rooms.values()].filter((e) => e.endedAt).length;
    if (rooms.size === games && done === games) {
      clearInterval(timer);
      resolve(true);
    }
    if (performance.now() - t0 > 20 * 60 * 1000) {
      clearInterval(timer);
      resolve(false);
    }
  }, 200);
});

// ——— Medidas ———
const rallies: number[] = [];
const cpu: number[] = [];
let rejected = 0;
let corrections = 0;
const up: number[] = [];
const down: number[] = [];
const durations: number[] = [];
for (const { room, endedAt, bytes } of rooms.values()) {
  const rec = room.record;
  for (const p of rec.points) {
    if (p.winner === -1) continue;
    reasons[p.reason] = (reasons[p.reason] ?? 0) + 1;
    rallies.push(rec.hits.filter((h) => h.n === p.n).length);
  }
  cpu.push(...rec.hitCpuMs);
  rejected += rec.rejected.length;
  const secs = ((endedAt || performance.now()) - room.createdAt) / 1000;
  durations.push(secs);
  for (const b of bytes) {
    up.push(b.in / secs);
    down.push(b.out / secs);
  }
  for (const c of [players.find((p) => p.code === room.id), room.bot]) {
    const st = c?.match?.stats;
    if (!st) continue;
    corrections += st.corrections;
    if (st.brakes.flights) {
      brakeMeans.push(st.brakes.meanSlowdown);
      brakeMax.push(st.brakes.maxSlowdown);
    }
    if (st.myPing !== null) pings.push(st.myPing);
  }
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const total = Object.values(reasons).reduce((a, b) => a + b, 0);
const named = Object.entries(causes).filter(([k]) => !k.endsWith('UNKNOWN')).reduce((a, [, v]) => a + v, 0);
const all = Object.values(causes).reduce((a, b) => a + b, 0);
console.log(`${d0} vs ${d0} (bot remoto), ${games} partidos por la red, ping ${ping} ms ±${Math.round(jitter * 100)} %, gameSpeed ${cfg.sim.gameSpeed}${finished ? '' : ' — ¡NO TERMINARON TODOS!'}`);
console.log(`golpes/punto: media ${avg(rallies).toFixed(2)} (mediana ${pct(rallies, 0.5)}, p90 ${pct(rallies, 0.9)}), ${rallies.length} puntos`);
console.log('motivos:', Object.entries(reasons).map(([k, v]) => `${k} ${v} (${Math.round((100 * v) / total)} %)`).join(', '));
console.log(`causas ("¿por qué fallé?"): ${named}/${all} con nombre`, JSON.stringify(Object.fromEntries(Object.entries(causes).sort((a, b) => b[1] - a[1]))));
console.log(`discrepancias: ${corrections} correcciones de los clientes, ${rejected} rechazos del servidor`);
console.log(`CPU del servidor por golpe: p50 ${pct(cpu, 0.5).toFixed(3)} ms, p99 ${pct(cpu, 0.99).toFixed(3)} ms, máx ${Math.max(0, ...cpu).toFixed(3)} ms (${cpu.length} golpes)`);
console.log(`bytes/s por jugador: subida media ${avg(up).toFixed(0)} (máx ${Math.max(0, ...up).toFixed(0)}), bajada media ${avg(down).toFixed(0)} (máx ${Math.max(0, ...down).toFixed(0)})`);
console.log(`frenado de la bola que se aleja: medio ${(avg(brakeMeans) * 100).toFixed(1)} %, máximo ${(Math.max(0, ...brakeMax) * 100).toFixed(1)} %`);
console.log(`ping medido: media ${avg(pings).toFixed(1)} ms; duración media del game ${avg(durations).toFixed(0)} s`);
for (const p of players) p.stop();
await server.close();
process.exit(0);
