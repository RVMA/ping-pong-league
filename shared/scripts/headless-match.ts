/**
 * Partido bot contra bot sin navegador, en Node puro (type stripping de Node ≥ 22.18).
 * Demuestra que shared/ no depende del DOM y sirve para ajustar valores.
 *
 *   node shared/scripts/headless-match.ts [dificultad0] [dificultad1] [semilla] [gameSpeed]
 */
import { Bot, type BotDifficulty, diagnose, type HitEvaluation, makeConfig, type ShotTargets, Simulation, type SimEvent } from '../src/index.ts';

const d0 = (process.argv[2] ?? 'medium') as BotDifficulty;
const d1 = (process.argv[3] ?? 'medium') as BotDifficulty;
const seed = Number(process.argv[4] ?? 7);
const speed = process.argv[5] ? Number(process.argv[5]) : undefined;
const cfg = makeConfig(speed ? { sim: { gameSpeed: speed } } : {});
const sim = new Simulation(cfg);
const bots = [new Bot(0, cfg.bot.difficulties[d0], cfg, seed), new Bot(1, cfg.bot.difficulties[d1], cfg, seed * 31 + 1)];

const reasons: Record<string, number> = {};
const rallyLengths: number[] = [];
let lets = 0;
let hitsThisRally = 0;
let maxTicks = 120 * 60 * 30;
const flights: number[] = [];
let lastHitT = 0;
const tiers: Record<string, number> = {};
// "¿Por qué fallé?" de cada punto perdido por error, desde el lado de quien lo pierde.
const causes: Record<string, number> = {};
const lastHit: ({ targets: ShotTargets; evaluation: HitEvaluation; contactHeight: number } | null)[] = [null, null];
const whiff: (HitEvaluation | null)[] = [null, null];
const whiffed = [false, false];
while (sim.state.phase !== 'gameOver' && maxTicks-- > 0) {
  const ev: SimEvent[] = sim.step([bots[0].think(sim), bots[1].think(sim)]);
  for (const e of ev) {
    if (e.type === 'hit') {
      if (hitsThisRally > 0) flights.push(sim.now - lastHitT);
      lastHitT = sim.now;
      hitsThisRally++;
      tiers[e.tier] = (tiers[e.tier] ?? 0) + 1;
      lastHit[e.player] = { targets: e.targets, evaluation: e.evaluation, contactHeight: e.pos.y - cfg.world.tableHeight };
    }
    if (e.type === 'whiff') {
      tiers.WHIFF = (tiers.WHIFF ?? 0) + 1;
      whiff[e.player] = e.evaluation;
      whiffed[e.player] = true;
    }
    if (e.type === 'point') {
      reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
      const loser = e.winner === 0 ? 1 : 0;
      const d = diagnose({ reason: e.reason, lastHit: lastHit[loser], whiff: whiff[loser], whiffed: whiffed[loser] }, cfg);
      if (d) causes[d.cause] = (causes[d.cause] ?? 0) + 1;
      lastHit[0] = lastHit[1] = null;
      whiff[0] = whiff[1] = null;
      whiffed[0] = whiffed[1] = false;
      rallyLengths.push(hitsThisRally);
      hitsThisRally = 0;
    }
    if (e.type === 'let') {
      lets++;
      hitsThisRally = 0;
    }
  }
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(`bots: ${d0} vs ${d1}  seed=${seed}  gameSpeed=${cfg.sim.gameSpeed}`);
console.log(`resultado: ${sim.state.score.join('-')}  fase=${sim.state.phase}  tiempo=${(sim.now / 1000).toFixed(1)} s`);
console.log(`golpes/punto (incl. saque): media ${avg(rallyLengths).toFixed(2)}, máx ${Math.max(...rallyLengths)}`);
console.log(`ms entre golpes (media): ${avg(flights).toFixed(0)}`);
console.log('motivos de punto:', reasons, 'lets:', lets);
console.log('calidades:', tiers);
const types = { NORMAL: 0, TOPSPIN: 0, SLICE: 0, SMASH: 0, BLOCK: 0 };
for (const st of sim.state.stats) for (const k of Object.keys(types) as (keyof typeof types)[]) types[k] += st.types[k];
console.log('golpes por tipo (sin saques):', types);
console.log('"¿por qué fallé?" (causa de cada punto perdido por error):', causes);
console.log('stats:', JSON.stringify(sim.state.stats));
