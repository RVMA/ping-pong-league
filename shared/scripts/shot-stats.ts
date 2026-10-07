/**
 * Estadística de golpes en partidos bot contra bot (Node, sin navegador): para ajustar valores de V0.2.
 *
 *   node shared/scripts/shot-stats.ts [dificultad0] [dificultad1] [partidos] [semilla]
 *
 * Muestra, por tipo de golpe: cuántos, velocidad horizontal de salida (m/s de simulación y reales), altura
 * del contacto, margen pedido sobre la red, partes que más pesan y cómo acaban los puntos.
 */
import { Bot, type BotDifficulty, diagnose, type HitEvaluation, makeConfig, type ShotTargets, Simulation, type SimEvent } from '../src/index.ts';

const d0 = (process.argv[2] ?? 'medium') as BotDifficulty;
const d1 = (process.argv[3] ?? 'medium') as BotDifficulty;
const games = Number(process.argv[4] ?? 4);
const seed0 = Number(process.argv[5] ?? 1);
// PPP_CFG='{"shotTypes":{...}}' sobrescribe valores de la config para probar ajustes sin editar config.ts.
const cfg = makeConfig(process.env.PPP_CFG ? JSON.parse(process.env.PPP_CFG) : {});

interface Acc {
  n: number;
  speed: number[];
  h: number[];
  clr: number[];
  capped: number;
  maxV: number;
  parts: Record<string, number>;
}
const byType: Record<string, Acc> = {};
const reasons: Record<string, number> = {};
const rallies: number[] = [];
const flights: number[] = [];
let lastHitter: { type: string } | null = null;
const endByLastType: Record<string, Record<string, number>> = {};
const causes: Record<string, number> = {};
const blockedFrom: Record<string, number> = {};
const whiffWhy: Record<string, number> = {};
let maxExit = 0;

for (let g = 0; g < games; g++) {
  const seed = seed0 + g * 101;
  const sim = new Simulation(cfg, { firstServer: (g % 2) as 0 | 1 });
  const bots = [new Bot(0, cfg.bot.difficulties[d0], cfg, seed), new Bot(1, cfg.bot.difficulties[d1], cfg, seed * 31 + 1)];
  let hits = 0;
  let lastT = 0;
  const lastHit: ({ targets: ShotTargets; evaluation: HitEvaluation; contactHeight: number } | null)[] = [null, null];
  const whiff: (HitEvaluation | null)[] = [null, null];
  const whiffed = [false, false];
  let prevType = '-';
  for (let i = 0; i < 120 * 60 * 30 && sim.state.phase !== 'gameOver'; i++) {
    const ev: SimEvent[] = sim.step([bots[0].think(sim), bots[1].think(sim)]);
    for (const e of ev) {
      if (e.type === 'hit') {
        if (hits > 0) flights.push(sim.now - lastT);
        lastT = sim.now;
        hits++;
        const key = e.serve ? 'SERVE' : e.targets.type;
        const a = (byType[key] ??= { n: 0, speed: [], h: [], clr: [], capped: 0, maxV: 0, parts: {} });
        a.n++;
        a.speed.push(Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.z));
        const v3 = Math.hypot(sim.state.ball.vel.x, sim.state.ball.vel.y, sim.state.ball.vel.z);
        a.maxV = Math.max(a.maxV, v3);
        maxExit = Math.max(maxExit, v3);
        a.h.push(e.pos.y - cfg.world.tableHeight);
        a.clr.push(e.targets.clearance);
        if ((e.targets.parts.clearance.paceCap ?? 0) > 0) a.capped++;
        for (const [k, v] of Object.entries(e.targets.parts.clearance)) if (k !== 'base') a.parts[k] = (a.parts[k] ?? 0) + (v ?? 0);
        lastHitter = { type: key };
        lastHit[e.player] = { targets: e.targets, evaluation: e.evaluation, contactHeight: e.pos.y - cfg.world.tableHeight };
        if (key === 'BLOCK') blockedFrom[prevType] = (blockedFrom[prevType] ?? 0) + 1;
        prevType = key;
      }
      if (e.type === 'whiff') {
        whiff[e.player] = e.evaluation;
        whiffed[e.player] = true;
        const ev = e.evaluation;
        const kind = !ev ? 'nada' : ev.timingTier === 'WHIFF' ? (ev.dtMs < 0 ? 'pronto' : 'tarde') : 'posición';
        const k = `${bots[e.player].lastIntendedTier}/${bots[e.player].lastIntendedShot} vs ${prevType}: ${kind}`;
        whiffWhy[k] = (whiffWhy[k] ?? 0) + 1;
      }
      if (e.type === 'point') {
        reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
        const lt = lastHitter?.type ?? '-';
        (endByLastType[lt] ??= {})[e.reason] = (endByLastType[lt][e.reason] ?? 0) + 1;
        rallies.push(hits);
        const loser = e.winner === 0 ? 1 : 0;
        const d = diagnose({ reason: e.reason, lastHit: lastHit[loser], whiff: whiff[loser], whiffed: whiffed[loser] }, cfg);
        if (d) causes[`${e.reason}:${d.cause}`] = (causes[`${e.reason}:${d.cause}`] ?? 0) + 1;
        hits = 0;
        lastHitter = null;
        lastHit[0] = lastHit[1] = null;
        whiff[0] = whiff[1] = null;
        whiffed[0] = whiffed[1] = false;
        prevType = '-';
      }
      if (e.type === 'let') hits = 0;
    }
  }
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
console.log(`${d0} vs ${d1}, ${games} games, gameSpeed ${cfg.sim.gameSpeed}`);
console.log(`golpes/punto: media ${avg(rallies).toFixed(2)} (mediana ${pct(rallies, 0.5)}, p90 ${pct(rallies, 0.9)}), ms entre golpes ${avg(flights).toFixed(0)}`);
const total = Object.values(reasons).reduce((a, b) => a + b, 0);
console.log('motivos:', Object.entries(reasons).map(([k, v]) => `${k} ${v} (${Math.round((100 * v) / total)} %)`).join(', '));
for (const [k, a] of Object.entries(byType)) {
  const parts = Object.entries(a.parts)
    .map(([p, v]) => `${p} ${(v / a.n).toFixed(3)}`)
    .join(' ');
  console.log(
    `${k.padEnd(8)} n=${String(a.n).padStart(4)}  v ${avg(a.speed).toFixed(1)} m/s (real ${(avg(a.speed) * cfg.sim.gameSpeed).toFixed(1)})  h ${avg(a.h).toFixed(2)} [p10 ${pct(a.h, 0.1).toFixed(2)} p90 ${pct(a.h, 0.9).toFixed(2)}]  margen ${avg(a.clr).toFixed(3)}  techo ${Math.round((100 * a.capped) / a.n)} %  partes: ${parts}`,
  );
}
console.log(`velocidad de salida máxima (módulo 3D, m/s de simulación): ${maxExit.toFixed(1)}  por tipo: ${Object.entries(byType).map(([k, a]) => `${k} ${a.maxV.toFixed(1)}`).join(', ')}`);
console.log('fin del punto según el último golpe:', JSON.stringify(endByLastType));
const named = Object.entries(causes).filter(([k]) => !k.endsWith('UNKNOWN')).reduce((a, [, v]) => a + v, 0);
const all = Object.values(causes).reduce((a, b) => a + b, 0);
console.log(`causas ("¿por qué fallé?"): ${named}/${all} con nombre`, JSON.stringify(Object.fromEntries(Object.entries(causes).sort((a, b) => b[1] - a[1]))));
console.log('bloqueos contra:', JSON.stringify(blockedFrom));
console.log('whiffs (calidad/golpe que intentaba vs golpe que llegaba):', JSON.stringify(Object.fromEntries(Object.entries(whiffWhy).sort((a, b) => b[1] - a[1]))));
