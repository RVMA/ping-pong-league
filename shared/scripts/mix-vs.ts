/**
 * ¿Hay un golpe dominante? (V0.2b, decisión del autor 7): enfrenta un bot que mezcla golpes (la mezcla de su
 * dificultad) contra un bot de la MISMA calidad que siempre pide un único golpe. Si el de un solo golpe gana con
 * claridad, ese golpe domina y hay que reequilibrar.
 *
 *   node shared/scripts/mix-vs.ts [dificultad] [partidos] [semilla] [golpe: topspin|normal|slice|smash]
 *
 * Alterna el lado y quién saca primero. Muestra games y puntos ganados, golpes por punto y, por bot, los errores y
 * los ganadores directos por tipo de golpe.
 */
import { Bot, type BotDifficulty, type BotDifficultyConfig, makeConfig, Simulation, type SimEvent, type Side } from '../src/index.ts';

const diff = (process.argv[2] ?? 'medium') as BotDifficulty;
const games = Number(process.argv[3] ?? 40);
const seed0 = Number(process.argv[4] ?? 1);
const only = (process.argv[5] ?? 'topspin') as 'topspin' | 'normal' | 'slice' | 'smash';
// PPP_CFG='{"shotTypes":{...}}' sobrescribe valores de la config para probar ajustes sin editar config.ts.
const cfg = makeConfig(process.env.PPP_CFG ? JSON.parse(process.env.PPP_CFG) : {});

const mix = cfg.bot.difficulties[diff];
const single: BotDifficultyConfig = {
  ...mix,
  label: `${mix.label} (solo ${only})`,
  shots: {
    topspin: only === 'topspin' ? 1 : 0,
    slice: only === 'slice' ? 1 : 0,
    smash: only === 'smash' ? 1 : 0,
    badSmash: only === 'smash' ? 1 : 0,
    block: 0,
  },
};

const won = { mix: 0, single: 0 };
const points = { mix: 0, single: 0 };
const rallies: number[] = [];
type Tally = Record<string, { n: number; errors: number; winners: number }>;
const tally: Record<'mix' | 'single', Tally> = { mix: {}, single: {} };

for (let g = 0; g < games; g++) {
  const singleSide: Side = (g % 2) as Side;
  const sim = new Simulation(cfg, { firstServer: (Math.floor(g / 2) % 2) as Side });
  const seed = seed0 + g * 101;
  const bots = [0, 1].map((s) => new Bot(s as Side, s === singleSide ? single : mix, cfg, s === 0 ? seed : seed * 31 + 1));
  const who = (s: Side) => (s === singleSide ? 'single' : 'mix');
  let hits = 0;
  let last: { player: Side; type: string } | null = null;
  for (let i = 0; i < 120 * 60 * 30 && sim.state.phase !== 'gameOver'; i++) {
    const ev: SimEvent[] = sim.step([bots[0].think(sim), bots[1].think(sim)]);
    for (const e of ev) {
      if (e.type === 'hit') {
        hits++;
        const type = e.serve ? 'SERVE' : e.targets.type;
        const t = (tally[who(e.player)][type] ??= { n: 0, errors: 0, winners: 0 });
        t.n++;
        last = { player: e.player, type };
      }
      if (e.type === 'point') {
        points[who(e.winner)]++;
        rallies.push(hits);
        if (last) {
          const t = tally[who(last.player)][last.type];
          if (e.winner === last.player && e.reason === 'MISSED') t.winners++;
          if (e.winner !== last.player && (e.reason === 'NET' || e.reason === 'OUT' || e.reason === 'OWN_SIDE')) t.errors++;
        }
        hits = 0;
        last = null;
      }
      if (e.type === 'let') hits = 0;
      if (e.type === 'gameOver') won[who(e.winner)]++;
    }
  }
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
const total = points.mix + points.single;
console.log(`${mix.label}: mezcla contra solo ${only}, ${games} games`);
console.log(`games: mezcla ${won.mix} · solo ${only} ${won.single} (${pct(won.single, games)})`);
console.log(`puntos: mezcla ${points.mix} · solo ${only} ${points.single} (${pct(points.single, total)})`);
console.log(`golpes por punto: ${(rallies.reduce((a, b) => a + b, 0) / Math.max(1, rallies.length)).toFixed(2)}`);
for (const k of ['mix', 'single'] as const) {
  const rows = Object.entries(tally[k])
    .sort((a, b) => b[1].n - a[1].n)
    .map(([type, t]) => `${type} ${t.n} (error ${pct(t.errors, t.n)}, ganador ${pct(t.winners, t.n)})`);
  console.log(`${k === 'mix' ? 'mezcla' : `solo ${only}`}: ${rows.join(' · ')}`);
}
