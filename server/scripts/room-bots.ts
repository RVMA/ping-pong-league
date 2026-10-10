/**
 * Partidos de bots POR SALAS (V0.4) contra cualquier servidor: el Node de este mismo proceso (`local`), el de
 * `wrangler dev` o el publicado (una URL). En cada partido, el bot A crea la sala, el B entra con su código, juegan 2
 * puntos de warm-up, dan a Listo, juegan el partido y se van. Como mucho 10 partidos a la vez.
 *
 *   node server/scripts/room-bots.ts <url|local> <partidos> <modo> <dif0> <dif1> <semilla> [ping0 ping1 jitter spike]
 *   p. ej.: node server/scripts/room-bots.ts local 20 standard medium medium 7 100 100 0.1 0.02
 *           node server/scripts/room-bots.ts ws://localhost:8787/ws 5 quick medium medium 7
 *
 * Con `local` arranca el servidor Node en un puerto libre: admite latencia simulada (ping de cada bot, variación y
 * probabilidad de picos de TCP) y mide la CPU del servidor por golpe. Con una URL solo hay latencia real (el `hello`
 * lleva 0). PPP_CFG='{…}' sobrescribe valores de la config, como en shot-stats (el servidor debe usar la misma).
 *
 * Muestra (del partido, sin warm-up, salvo donde se dice):
 *  - partidos acabados / pedidos, y una línea por partido;
 *  - golpes por punto (media, mediana, p90) frente a la referencia local: shot-stats con las mismas dificultades,
 *    30 partidos y la misma semilla;
 *  - motivos de los puntos y causas de «¿por qué fallé?» con nombre, vistas por quien pierde el punto;
 *  - discrepancias: correcciones de los dos clientes (toda la sesión) + rechazos del servidor (`rj` del `mend`);
 *  - primer saque de cada game alternado, saque de cada punto según las reglas y marcadores iguales en los dos clientes
 *    (lo que mandó el servidor a cada uno, lo que enseñó cada uno y su `mend`);
 *  - duración del partido; ping medido (todas las medidas de la sesión); bytes/s y mensajes/s por jugador;
 *  - peticiones de Durable Objects por hora de partido: mensajes entrantes por hora de los dos ÷ 20 + 2 conexiones;
 *  - frenado de la bola que se aleja y mayor salto de la bola en pantalla (toda la sesión);
 *  - con `local`, CPU del servidor por golpe: la de la autoridad (`hitCpuMs`: recalcular el golpe y el vuelo nuevo) y
 *    la de todo el `receive` de la sala para ese golpe (plazos, validar, recalcular, vuelo, punto y codificar lo que
 *    sale), de todos los golpes de todos los partidos, warm-up incluido.
 * Al final, los criterios de la fase; el código de salida es 1 si alguno falla. Si el proceso se para más de 5 s (el
 * equipo se suspende, p. ej.), los partidos en juego se congelan: la corrida no vale y también sale con 1.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { type BotDifficulty, diagnose, firstServerOfGame, type HitEvaluation, makeConfig, type MatchEndMsg, type MatchMode, type RoomRecord, serverFor, type ShotTargets, type Side, type SimEvent, type StartMsg } from '@ppp/shared';
import { BotClient } from '../src/bot-client.ts';
import { startServer } from '../src/server.ts';

const USAGE = 'Uso: node server/scripts/room-bots.ts <url|local> <partidos> <modo> <dif0> <dif1> <semilla> [ping0 ping1 jitter spike]';
const MODES: readonly string[] = ['quick', 'standard', 'full'];
const DIFFICULTIES: readonly string[] = ['easy', 'medium', 'hard'];
/** Partidos a la vez como mucho. */
const PARALLEL = 10;
/** Tope de tiempo real por partido (un Estándar de bots dura unos 7 min). */
const MATCH_TIMEOUT_MS = 30 * 60 * 1000;
/** Tras el `mend`, cada cliente acaba de enseñar el último punto y vuelve al warm-up (como mucho esto). */
const SETTLE_TIMEOUT_MS = 15_000;
/** Referencia local: partidos de shot-stats. */
const REF_GAMES = 30;
/** Plan gratuito de Workers (§17.7): peticiones de Durable Objects al día; los mensajes entrantes cuentan 1 de cada 20. */
const DO_FREE_PER_DAY = 100_000;
const DO_MSGS_PER_REQUEST = 20;
const DO_CONNECTIONS = 2;
// Criterios de la fase (docs/prompts/fase_v0.4.md: Verificación 2 y presupuestos).
const MAX_DO_PER_HOUR = 12_000;
const MAX_UP_BPS = 2000;
const MAX_DOWN_BPS = 3000;
const MAX_CPU_P99_MS = 1;
const SHOTS_TOLERANCE = 0.1;
/** Un hueco así en un intervalo de 1 s es que el proceso se paró (el equipo se suspendió, p. ej.): medidas no válidas. */
const STALL_MS = 5000;

// ——— Argumentos ———

const args = process.argv.slice(2);
const fail = (why: string): never => {
  console.error(`${why}\n${USAGE}`);
  process.exit(2);
};
if (args.length < 6) fail('Faltan argumentos.');
const target = args[0];
const local = target === 'local';
const matches = Number(args[1]);
const mode = args[2] as MatchMode;
const d0 = args[3] as BotDifficulty;
const d1 = args[4] as BotDifficulty;
const seed0 = Number(args[5]);
const lat = args.slice(6, 10).map(Number);
let [ping0, ping1, jitter, spike] = [lat[0] ?? 0, lat[1] ?? 0, lat[2] ?? 0, lat[3] ?? 0];
if (!Number.isInteger(matches) || matches < 1) fail(`Número de partidos no válido: ${args[1]}`);
if (!MODES.includes(mode)) fail(`Modo no válido: ${args[2]} (quick, standard o full)`);
if (!DIFFICULTIES.includes(d0) || !DIFFICULTIES.includes(d1)) fail(`Dificultad no válida: ${args[3]} ${args[4]} (easy, medium o hard)`);
if (!Number.isFinite(seed0)) fail(`Semilla no válida: ${args[5]}`);
if (lat.some((v) => !Number.isFinite(v) || v < 0)) fail(`Latencia no válida: ${args.slice(6).join(' ')}`);
const url = local ? '' : target.replace(/^http/, 'ws');
if (!local && !/^wss?:\/\/.+/.test(url)) fail(`Ni «local» ni una URL ws(s)://…/ws: ${target}`);
if (!local && (ping0 || ping1 || jitter || spike)) {
  console.log('Aviso: con una URL solo hay latencia real; se ignoran ping0 ping1 jitter spike.');
  ping0 = ping1 = jitter = spike = 0;
}
const cfg = makeConfig(process.env.PPP_CFG ? JSON.parse(process.env.PPP_CFG) : {});

// ——— Servidor (local) y su registro ———

/** Líneas del registro del servidor que indican algo raro: respaldo, rechazos, errores. */
const anomalies = { fallback: 0, rejected: 0, errors: 0, lines: [] as string[] };
const note = (line: string) => {
  if (anomalies.lines.length < 12) anomalies.lines.push(line);
};
const server = local
  ? await startServer({
      port: 0,
      cfg,
      log: (line) => {
        if (/respaldo:|ausente:/.test(line)) {
          anomalies.fallback++;
          note(line);
        } else if (/descartado/.test(line)) {
          anomalies.rejected++;
          note(line);
        } else if (/error|falló|rechazad/.test(line)) {
          anomalies.errors++;
          note(line);
        }
      },
    })
  : null;
const wsUrl = server ? `ws://127.0.0.1:${server.port}/ws` : url;

// ——— Lo que ve cada cliente ———

interface Snap {
  t: number;
  bi: number;
  bo: number;
  mi: number;
  mo: number;
}

const snap = (c: BotClient): Snap => ({ t: performance.now(), bi: c.bytesIn, bo: c.bytesOut, mi: c.messagesIn, mo: c.messagesOut });
const label = (g: number, w: Side | -1, sc: readonly number[]) => `${g}:${w === -1 ? 'LET' : sc.join('-')}`;

/** Un cliente de la sala: lo que le mandó el servidor (en los games) y lo que enseñó, más sus causas de fallo. */
class Watch {
  readonly c: BotClient;
  /** Game del último `start` (0: warm-up). */
  game = 0;
  /** Primer `start` de cada game. */
  readonly firstStart = new Map<number, StartMsg>();
  /** Golpes aceptados (`fl`) por rally. */
  private readonly hitsByN = new Map<number, number>();
  /** Golpes de cada punto ganado por alguien (sin let) y su motivo, según los `pt` del servidor. */
  readonly rallies: number[] = [];
  readonly reasons: Record<string, number> = {};
  /** `pt` de los games (con los let) y puntos que enseñó el cliente en los games. */
  readonly sent: string[] = [];
  readonly shown: string[] = [];
  /** Marcador final de cada game (del último `pt` con punto). */
  readonly gameScores = new Map<number, [number, number]>();
  /** Saque de cada punto (`pt.ns`) frente a las reglas, con el primer saque del game. */
  serveOk = 0;
  readonly serveBad: string[] = [];
  /** Causas de los puntos que perdió este cliente (en los games) y los que no tienen diagnóstico, por motivo. */
  readonly causes: Record<string, number> = {};
  readonly undiagnosed: Record<string, number> = {};
  /** Llegada del primer `start` del partido y del `mend`, con los contadores de bytes y mensajes. */
  s0: Snap | null = null;
  s1: Snap | null = null;

  constructor(c: BotClient) {
    this.c = c;
    c.onMessage = (msg) => {
      switch (msg.k) {
        case 'start':
          this.game = msg.wu === 1 ? 0 : msg.g;
          if (msg.wu === 0 && !this.firstStart.has(msg.g)) {
            this.firstStart.set(msg.g, msg);
            this.s0 ??= snap(c);
          }
          return;
        case 'fl':
          this.hitsByN.set(msg.n, (this.hitsByN.get(msg.n) ?? 0) + 1);
          return;
        case 'pt': {
          if (this.game === 0) return;
          this.sent.push(label(this.game, msg.w, msg.sc));
          if (msg.w === -1) return;
          this.rallies.push(this.hitsByN.get(msg.n) ?? 0);
          this.reasons[msg.r] = (this.reasons[msg.r] ?? 0) + 1;
          this.gameScores.set(this.game, [msg.sc[0], msg.sc[1]]);
          if (msg.go !== -1) return;
          const fs = this.firstStart.get(this.game)?.fs;
          if (fs !== undefined && msg.ns === serverFor(msg.sc, fs, cfg.rules)) this.serveOk++;
          else this.serveBad.push(`game ${this.game} ${msg.sc.join('-')}: saca ${msg.ns}`);
          return;
        }
        case 'mend':
          this.s1 = snap(c);
          return;
      }
    };
    this.trackLosses();
  }

  /** Acabó de enseñar el último punto del partido: ya volvió al warm-up. */
  get settled(): boolean {
    return this.c.lastEnd !== null && this.c.match?.practice === true;
  }

  /** «¿Por qué fallé?» de cada punto perdido en los games, desde la vista de quien lo pierde (como shot-stats). */
  private trackLosses(): void {
    let lastHit: { targets: ShotTargets; evaluation: HitEvaluation; contactHeight: number } | null = null;
    let whiff: HitEvaluation | null = null;
    let whiffed = false;
    const reset = () => {
      lastHit = null;
      whiff = null;
      whiffed = false;
    };
    this.c.onEvent = (e: SimEvent, client) => {
      const m = client.match;
      if (!m) return;
      const me = m.side;
      if (e.type === 'serveReady' || e.type === 'let') {
        if (e.type === 'let' && !m.practice) this.shown.push(label(m.game, -1, []));
        reset();
      } else if (e.type === 'hit' && e.player === me) {
        lastHit = { targets: e.targets, evaluation: e.evaluation, contactHeight: e.pos.y - cfg.world.tableHeight };
      } else if (e.type === 'whiff' && e.player === me) {
        whiff = e.evaluation;
        whiffed = true;
      } else if (e.type === 'point') {
        if (!m.practice) {
          this.shown.push(label(m.game, e.winner, e.score));
          if (e.winner !== me) {
            const d = diagnose({ reason: e.reason, lastHit, whiff, whiffed }, cfg);
            const tally = d ? this.causes : this.undiagnosed;
            const k = d ? `${e.reason}:${d.cause}` : e.reason;
            tally[k] = (tally[k] ?? 0) + 1;
          }
        }
        reset();
      }
    };
  }
}

// ——— Un partido ———

interface Result {
  i: number;
  code: string | null;
  watches: Watch[];
  /** Por qué no acabó (null si acabó por marcador). */
  problem: string | null;
  /** Solo `local`: registro de la sala y CPU de todo el `receive` de cada golpe. */
  record: RoomRecord | null;
  recvMs: number[];
}

/** Espera a que se cumpla `cond` (comprobándolo cada 50 ms); false si vence el plazo. */
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) return false;
    await sleep(50);
  }
  return true;
}

const closedText = (c: BotClient) => (c.closedBy ? JSON.stringify(c.closedBy) : `cerrado (${c.closeCode ?? '?'})`);

async function playMatch(i: number): Promise<Result> {
  const seed = seed0 + i * 101;
  const common = { url: wsUrl, role: 'player' as const, botping: 0, jitter, spike, cfg, warmupPoints: 2 };
  const a = new BotClient({ ...common, route: `?create=${mode}`, name: `Bot ${i + 1}A`, difficulty: d0, seed, ping: ping0 });
  const res: Result = { i, code: null, watches: [new Watch(a)], problem: null, record: null, recvMs: [] };
  a.start();
  if (!(await until(() => a.code !== null || a.stopped, 30_000)) || !a.code) {
    res.problem = a.stopped ? `A: ${closedText(a)}` : 'A: sin welcome en 30 s';
    a.stop();
    return res;
  }
  res.code = a.code;
  // La sala ya existe y el B aún no ha entrado: se guarda su registro (el servidor la borra cuando se van los dos) y se
  // mide todo el `receive` de cada golpe.
  const host = server?.rooms.get(a.code);
  if (host) {
    res.record = host.core.record;
    const core = host.core;
    const receive = core.receive.bind(core);
    core.receive = (side, msg, now) => {
      if (msg.k !== 'hit') return receive(side, msg, now);
      const t0 = performance.now();
      receive(side, msg, now);
      res.recvMs.push(performance.now() - t0);
    };
  }
  const b = new BotClient({ ...common, route: `?room=${a.code}`, name: `Bot ${i + 1}B`, difficulty: d1, seed: seed * 31 + 1, ping: ping1 });
  res.watches.push(new Watch(b));
  b.start();
  await until(() => (a.lastEnd !== null && b.lastEnd !== null) || a.stopped || b.stopped, MATCH_TIMEOUT_MS);
  if (a.lastEnd && b.lastEnd) await until(() => res.watches.every((w) => w.settled || w.c.stopped), SETTLE_TIMEOUT_MS);
  if (!a.lastEnd || !b.lastEnd) res.problem = a.stopped || b.stopped ? `cerrado: A ${a.stopped ? closedText(a) : 'abierto'}, B ${b.stopped ? closedText(b) : 'abierto'}` : 'sin mend (tiempo agotado)';
  else if (a.lastEnd.why !== 'score' || b.lastEnd.why !== 'score') res.problem = `acabó por ${a.lastEnd.why}/${b.lastEnd.why}`;
  a.leave();
  b.leave();
  return res;
}

// ——— Comprobaciones de un partido ———

interface Check {
  /** Primer saque de cada game alternado (y 0-0, sacando él), en los dos clientes y, con `local`, en el registro. */
  serveGames: boolean;
  serveWhy: string[];
  /** Mismo `mend`, mismos `pt` y mismos puntos enseñados en los dos clientes (y lo enseñado = lo mandado). */
  scoresEqual: boolean;
  scoresWhy: string[];
  corrections: number;
  rj: number;
}

function check(r: Result): Check {
  const serveWhy: string[] = [];
  const scoresWhy: string[] = [];
  const [wa, wb] = r.watches;
  const ends = r.watches.map((w) => w.c.lastEnd);
  for (const w of r.watches) {
    const who = w === wa ? 'A' : 'B';
    const fs1 = w.firstStart.get(1)?.fs;
    const games = [...w.firstStart.keys()].sort((x, y) => x - y);
    const end = w.c.lastEnd;
    if (end && games.length !== end.gw[0] + end.gw[1]) serveWhy.push(`${who}: ${games.length} games empezados, gw ${end.gw.join('-')}`);
    games.forEach((g, k) => {
      const s = w.firstStart.get(g)!;
      if (g !== k + 1) serveWhy.push(`${who}: game ${g} fuera de orden`);
      if (fs1 === undefined || s.fs !== firstServerOfGame(fs1, g) || s.ns !== s.fs || s.sc[0] !== 0 || s.sc[1] !== 0) serveWhy.push(`${who}: game ${g} empieza con fs ${s.fs} ns ${s.ns} ${s.sc.join('-')} (primer saque del partido ${fs1})`);
    });
    if (w.serveBad.length) serveWhy.push(`${who}: ${w.serveBad.slice(0, 3).join('; ')}`);
  }
  const row = r.record?.matches[0];
  if (row && wa) {
    if (row.firstServer !== wa.firstStart.get(1)?.fs) serveWhy.push(`registro: primer saque ${row.firstServer}`);
    row.games.forEach((g, k) => {
      if (g.firstServer !== wa.firstStart.get(k + 1)?.fs) serveWhy.push(`registro: game ${k + 1} lo empezó ${g.firstServer}`);
    });
  }
  if (wb) {
    if (JSON.stringify(ends[0]) !== JSON.stringify(ends[1])) scoresWhy.push(`mend distinto: ${JSON.stringify(ends[0])} / ${JSON.stringify(ends[1])}`);
    if (wa.sent.join() !== wb.sent.join()) scoresWhy.push('pt distintos en A y B');
    for (const w of r.watches) if (w.shown.join() !== w.sent.join()) scoresWhy.push(`${w === wa ? 'A' : 'B'} enseñó otros puntos: ${firstDiff(w.shown, w.sent)}`);
  } else scoresWhy.push('sin cliente B');
  const corrections = r.watches.reduce((s, w) => s + (w.c.match?.stats.corrections ?? 0), 0);
  const rj = ends[0] ? ends[0].rj[0] + ends[0].rj[1] : 0;
  return { serveGames: serveWhy.length === 0, serveWhy, scoresEqual: scoresWhy.length === 0, scoresWhy, corrections, rj };
}

function firstDiff(a: string[], b: string[]): string {
  for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) return `#${k}: ${a[k] ?? '-'} / ${b[k] ?? '-'}`;
  return '';
}

const secs = (w: Watch) => (w.s0 && w.s1 ? (w.s1.t - w.s0.t) / 1000 : 0);

function matchLine(r: Result, k: Check): string {
  const [wa] = r.watches;
  const end: MatchEndMsg | null = wa.c.lastEnd;
  const scores = [...wa.gameScores.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([, s]) => s.join('-'))
    .join(' ');
  const corr = r.watches.map((w) => w.c.match?.stats.corrections ?? 0).join('+');
  const head = `#${String(r.i + 1).padStart(2)} ${r.code ?? '----'}`;
  if (!end) return `${head}: NO ACABÓ — ${r.problem}`;
  const flags = [k.serveGames ? '' : `SAQUE MAL (${k.serveWhy.join('; ')})`, k.scoresEqual ? '' : `MARCADORES DISTINTOS (${k.scoresWhy.join('; ')})`, r.problem ? `PROBLEMA: ${r.problem}` : ''].filter(Boolean);
  return `${head}: ${end.gw.join('-')} (${scores}), primer saque ${wa.firstStart.get(1)?.fs ?? '?'}, ${secs(wa).toFixed(0)} s, ${wa.rallies.length} puntos, correcciones ${corr}, rj ${end.rj.join('+')}${flags.length ? ` — ${flags.join(' — ')}` : ''}`;
}

// ——— Partidos (como mucho PARALLEL a la vez) ———

const where = local ? `servidor Node en este proceso (puerto ${server!.port})` : url;
console.log(`room-bots: ${where}; ${matches} partidos ${mode}, ${d0} vs ${d1}, semilla ${seed0}, ping ${ping0}/${ping1} ms ±${Math.round(jitter * 100)} %, picos ${spike}, gameSpeed ${cfg.sim.gameSpeed}`);
const tRun = performance.now();
/** Pausas del proceso (ms): con el equipo suspendido, los partidos en juego se congelan y vencen sus plazos de golpe. */
const stalls: number[] = [];
let lastBeat = tRun;
const heartbeat = setInterval(() => {
  const now = performance.now();
  if (now - lastBeat > STALL_MS) stalls.push(now - lastBeat);
  lastBeat = now;
}, 1000);
const results: Result[] = [];
const checks: Check[] = [];
let next = 0;
const worker = async () => {
  while (next < matches) {
    const i = next++;
    const r = await playMatch(i);
    const k = check(r);
    results[i] = r;
    checks[i] = k;
    console.log(matchLine(r, k));
  }
};
await Promise.all(Array.from({ length: Math.min(PARALLEL, matches) }, worker));
const runMin = (performance.now() - tRun) / 60_000;
clearInterval(heartbeat);
await server?.close();

// ——— Medidas ———

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const max = (a: number[]) => a.reduce((x, y) => Math.max(x, y), 0);
const min = (a: number[]) => (a.length ? a.reduce((x, y) => Math.min(x, y)) : 0);
const add = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};
const sorted = (o: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1])));

const finished = results.filter((r) => r.problem === null && r.watches.length === 2).length;
const rallies: number[] = [];
const reasons: Record<string, number> = {};
const causes: Record<string, number> = {};
const undiagnosed: Record<string, number> = {};
const durations: number[] = [];
const pings: number[] = [];
const up: number[] = [];
const down: number[] = [];
const msgUp: number[] = [];
const msgDown: number[] = [];
const doPerHour: number[] = [];
const correctionKinds: Record<string, number> = {};
let brakeFlights = 0;
let brakeSum = 0;
let brakeMax = 0;
let renderJump = 0;
let corrections = 0;
let rj = 0;
let serveOk = 0;
let serveTotal = 0;
let gamesPlayed = 0;
const firstServers = [0, 0];
const gameTally: Record<string, number> = {};
for (const [i, r] of results.entries()) {
  const k = checks[i];
  corrections += k.corrections;
  rj += k.rj;
  const [wa] = r.watches;
  if (r.watches.length === 2 && wa.c.lastEnd) {
    rallies.push(...wa.rallies);
    add(reasons, wa.reasons);
    durations.push(secs(wa));
    gamesPlayed += wa.firstStart.size;
    const fs = wa.firstStart.get(1)?.fs;
    if (fs !== undefined) firstServers[fs]++;
    const g = wa.c.lastEnd.gw;
    gameTally[`${Math.max(g[0], g[1])}-${Math.min(g[0], g[1])}`] = (gameTally[`${Math.max(g[0], g[1])}-${Math.min(g[0], g[1])}`] ?? 0) + 1;
  }
  let inRate = 0;
  for (const w of r.watches) {
    add(causes, w.causes);
    add(undiagnosed, w.undiagnosed);
    serveOk += w.serveOk;
    serveTotal += w.serveOk + w.serveBad.length;
    pings.push(...w.c.pings);
    const st = w.c.match?.stats;
    if (st) {
      for (const kind of st.correctionKinds) correctionKinds[kind] = (correctionKinds[kind] ?? 0) + 1;
      brakeFlights += st.brakes.flights;
      brakeSum += st.brakes.meanSlowdown * st.brakes.flights;
      brakeMax = Math.max(brakeMax, st.brakes.maxSlowdown);
      renderJump = Math.max(renderJump, st.maxRenderJump);
    }
    const s = secs(w);
    if (!w.s0 || !w.s1 || s <= 0) continue;
    up.push((w.s1.bo - w.s0.bo) / s);
    down.push((w.s1.bi - w.s0.bi) / s);
    msgUp.push((w.s1.mo - w.s0.mo) / s);
    msgDown.push((w.s1.mi - w.s0.mi) / s);
    inRate += (w.s1.mo - w.s0.mo) / s;
  }
  if (r.watches.length === 2 && r.watches.every((w) => w.s0 && w.s1)) doPerHour.push((inRate * 3600) / DO_MSGS_PER_REQUEST + DO_CONNECTIONS);
}
const named = Object.entries(causes)
  .filter(([key]) => !key.endsWith('UNKNOWN'))
  .reduce((s, [, v]) => s + v, 0);
const diagnosed = Object.values(causes).reduce((s, v) => s + v, 0);
const totalReasons = Object.values(reasons).reduce((s, v) => s + v, 0);
const cpu = results.flatMap((r) => (r.record ? r.record.authorities.flatMap((a) => a.hitCpuMs) : []));
const recv = results.flatMap((r) => r.recvMs);
const allRejected = results.reduce((s, r) => s + (r.record ? r.record.authorities.reduce((t, a) => t + a.rejected.length, 0) : 0), 0);
const serveGamesOk = checks.filter((k) => k.serveGames).length;
const scoresOk = checks.filter((k) => k.scoresEqual).length;

// Referencia local: el mismo shot-stats de la Step 1, con las mismas dificultades y la misma semilla.
const shotStats = fileURLToPath(new URL('../../shared/scripts/shot-stats.ts', import.meta.url));
let ref: number | null = null;
try {
  const out = execFileSync(process.execPath, [shotStats, d0, d1, String(REF_GAMES), String(seed0)], { encoding: 'utf8' });
  const m = /golpes\/punto: media ([\d.]+)/.exec(out);
  ref = m ? Number(m[1]) : null;
} catch (e) {
  console.log(`referencia local: shot-stats falló (${(e as Error).message})`);
}
const shotsDev = ref ? avg(rallies) / ref - 1 : Number.NaN;

const pctStr = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} %`;
const doMean = avg(doPerHour);
console.log('');
console.log(`partidos acabados: ${finished}/${matches} (${Object.entries(gameTally).map(([k, v]) => `${k}: ${v}`).join(', ')}; ${gamesPlayed} games); primer saque del partido (sorteo): lado 0 en ${firstServers[0]}, lado 1 en ${firstServers[1]}; ${runMin.toFixed(1)} min en total; pausas del proceso de más de ${STALL_MS / 1000} s: ${stalls.length}${stalls.length ? ` (máx ${(max(stalls) / 1000).toFixed(0)} s): ¡MEDIDAS NO VÁLIDAS!` : ''}`);
console.log(`golpes/punto (partido, sin warm-up): media ${avg(rallies).toFixed(2)} (mediana ${pct(rallies, 0.5)}, p90 ${pct(rallies, 0.9)}), ${rallies.length} puntos; referencia local (shot-stats ${d0} ${d1} ${REF_GAMES} ${seed0}): ${ref?.toFixed(2) ?? '?'} → ${pctStr(shotsDev)}`);
console.log('motivos:', Object.entries(reasons).map(([key, v]) => `${key} ${v} (${Math.round((100 * v) / totalReasons)} %)`).join(', '));
console.log(`causas ("¿por qué fallé?"): ${named}/${diagnosed} con nombre`, sorted(causes), `; sin diagnóstico (como en shot-stats): ${sorted(undiagnosed)}`);
console.log(`discrepancias: ${corrections + rj} = ${corrections} correcciones de los clientes ${corrections ? sorted(correctionKinds) : ''}+ ${rj} rechazos del servidor (rj de los mend)${local ? `; rechazos en todo el registro de las salas (warm-up incluido): ${allRejected}` : ''}`);
console.log(`saque: primer saque de cada game alternado en ${serveGamesOk}/${results.length} partidos; saque de cada punto según las reglas: ${serveOk}/${serveTotal} (los dos clientes)`);
console.log(`marcadores iguales en los dos clientes (pt recibidos, puntos enseñados y mend): ${scoresOk}/${results.length} partidos`);
console.log(`duración del partido (del primer start al mend): media ${avg(durations).toFixed(0)} s (mín ${min(durations).toFixed(0)}, máx ${max(durations).toFixed(0)})`);
console.log(`ping medido: media ${avg(pings).toFixed(1)} ms, p95 ${pct(pings, 0.95).toFixed(1)} ms, máx ${max(pings).toFixed(1)} ms (${pings.length} medidas)`);
console.log(`bytes/s por jugador (partido): subida media ${avg(up).toFixed(0)} (máx ${max(up).toFixed(0)}), bajada media ${avg(down).toFixed(0)} (máx ${max(down).toFixed(0)})`);
console.log(`mensajes/s por jugador (partido): subida media ${avg(msgUp).toFixed(1)} (máx ${max(msgUp).toFixed(1)}), bajada media ${avg(msgDown).toFixed(1)} (máx ${max(msgDown).toFixed(1)})`);
console.log(`Durable Objects: ${doMean.toFixed(0)} peticiones por hora de partido (máx ${max(doPerHour).toFixed(0)} en un partido) = mensajes entrantes de los dos por hora ÷ ${DO_MSGS_PER_REQUEST} + ${DO_CONNECTIONS} conexiones → ${(DO_FREE_PER_DAY / doMean).toFixed(1)} h de partido al día en el plan gratuito (${DO_FREE_PER_DAY}/día)`);
console.log(`frenado de la bola que se aleja: medio ${((brakeFlights ? brakeSum / brakeFlights : 0) * 100).toFixed(1)} %, máximo ${(brakeMax * 100).toFixed(1)} % (${brakeFlights} vuelos); mayor salto de la bola en pantalla: ${(renderJump * 100).toFixed(1)} cm`);
if (local) {
  console.log(`CPU del servidor por golpe, autoridad (recalcular + vuelo nuevo): p50 ${pct(cpu, 0.5).toFixed(3)} ms, p99 ${pct(cpu, 0.99).toFixed(3)} ms, máx ${max(cpu).toFixed(3)} ms (${cpu.length} golpes, todos, warm-up incluido)`);
  console.log(`CPU del servidor por golpe, todo el receive de la sala: p50 ${pct(recv, 0.5).toFixed(3)} ms, p99 ${pct(recv, 0.99).toFixed(3)} ms, máx ${max(recv).toFixed(3)} ms (${recv.length} mensajes de golpe, todos)`);
  console.log(`registro del servidor: respaldo ${anomalies.fallback}, descartados ${anomalies.rejected}, errores ${anomalies.errors}${anomalies.lines.length ? ` — ${anomalies.lines.join(' | ')}` : ''}`);
}

// ——— Criterios ———

const criteria: [string, boolean | null][] = [
  ['proceso sin pausas', stalls.length === 0],
  [`${finished}/${matches} acabados`, finished === matches],
  ['0 discrepancias', corrections + rj === 0],
  ['golpes/punto ±10 %', ref ? Math.abs(shotsDev) <= SHOTS_TOLERANCE : false],
  ['100 % de causas con nombre', diagnosed > 0 && named === diagnosed],
  ['saque alternado', serveGamesOk === results.length && serveOk === serveTotal],
  ['marcadores iguales', scoresOk === results.length],
  ['CPU p99 < 1 ms', local ? pct(cpu, 0.99) < MAX_CPU_P99_MS && pct(recv, 0.99) < MAX_CPU_P99_MS : null],
  ['subida < 2 KB/s', up.length > 0 && max(up) < MAX_UP_BPS],
  ['bajada < 3 KB/s', down.length > 0 && max(down) < MAX_DOWN_BPS],
  ['Durable Objects ≤ 12 000/h', doPerHour.length > 0 && doMean <= MAX_DO_PER_HOUR],
];
console.log(`criterios: ${criteria.map(([name, ok]) => `${name} ${ok === null ? 'n/a' : ok ? 'OK' : 'FALLA'}`).join('; ')}`);
process.exit(criteria.some(([, ok]) => ok === false) ? 1 : 0);
