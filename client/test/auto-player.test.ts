import { Bot, type BotDifficultyConfig, type InputIntent, makeConfig, type ShotType, type Side, Simulation } from '@ppp/shared';
import { describe, expect, it } from 'vitest';
import { AutoPlayer, PilotSeat, readerProfile } from '../src/game/auto-player.ts';

const cfg = makeConfig();

interface Run {
  points: number;
  /** Golpes del lado del piloto (sin saques) y del rival (sin saques), por tipo. */
  pilotHits: number;
  pilotTypes: Record<ShotType, number>;
  rivalTypes: Record<ShotType, number>;
  rivalHits: number;
  /** Puntos que el piloto perdió por su golpe (red, fuera, lateral) o sin golpear. */
  pilotErrors: number;
  pilotMissed: number;
}

const types = (): Record<ShotType, number> => ({ NORMAL: 0, TOPSPIN: 0, SLICE: 0, SMASH: 0, BLOCK: 0 });

/** El piloto en `side` contra un Bot en el otro, `seconds` de partida (con games nuevos si acaba uno). */
function play(pilot: AutoPlayer, rival: BotDifficultyConfig, seconds: number, seed = 9, sim = new Simulation(cfg, { firstServer: 0 })): Run {
  const side = pilot.side;
  const other: Side = side === 0 ? 1 : 0;
  const bot = new Bot(other, rival, cfg, seed);
  const r: Run = { points: 0, pilotHits: 0, pilotTypes: types(), rivalTypes: types(), rivalHits: 0, pilotErrors: 0, pilotMissed: 0 };
  let lastHitter: Side | null = null;
  const ticks = Math.round((seconds * 1000) / sim.tickMs);
  for (let i = 0; i < ticks; i++) {
    const mine = pilot.intent(sim);
    const theirs = bot.think(sim);
    const intents: [InputIntent, InputIntent] = side === 0 ? [mine, theirs] : [theirs, mine];
    for (const e of sim.step(intents)) {
      if (e.type === 'hit') {
        lastHitter = e.player;
        if (e.serve) continue;
        if (e.player === side) {
          r.pilotHits++;
          r.pilotTypes[e.targets.type]++;
        } else {
          r.rivalHits++;
          r.rivalTypes[e.targets.type]++;
        }
      } else if (e.type === 'point') {
        r.points++;
        if (e.winner === other && lastHitter === side) r.pilotErrors++;
        if (e.winner === other && lastHitter === other && e.reason === 'MISSED') r.pilotMissed++;
      } else if (e.type === 'gameOver') sim.restart(0);
    }
  }
  return r;
}

describe('readerProfile (§13.1)', () => {
  it('solo golpes normales, calidad de presentation.readTest.autoReturn (débil siempre tarde), reacción y puntería de Difícil', () => {
    const p = readerProfile(cfg);
    const hard = cfg.bot.difficulties.hard;
    const q = cfg.presentation.readTest.autoReturn;
    expect(p.shots).toEqual({ topspin: 0, slice: 0, smash: 0, badSmash: 0, block: 0 });
    expect(p.quality).toEqual({ perfect: q.perfect, good: q.good, weak: q.weakLate, whiff: 0 });
    expect(p.quality.perfect + p.quality.good + p.quality.weak + p.quality.whiff).toBeCloseTo(1, 9);
    expect(p.lateWeak).toBe(true);
    expect(p.reactionMs).toBe(hard.reactionMs);
    expect(p.aimSpread).toBe(hard.aimSpread);
    expect(p.preferredDepth).toBe(hard.preferredDepth);
  });

  for (const side of [0, 1] as const) {
    it(`lado ${side}: tu raqueta devuelve sola (solo normales) y el bot Difícil mezcla golpes; 30 golpes en poco más de un minuto`, () => {
      const r = play(new AutoPlayer(side, readerProfile(cfg), cfg, 5), cfg.bot.difficulties.hard, 90);
      expect(r.rivalHits).toBeGreaterThanOrEqual(30);
      expect(r.pilotHits).toBe(r.pilotTypes.NORMAL);
      // Devuelve casi todo: pocos puntos perdidos por su golpe o sin llegar.
      expect(r.pilotErrors + r.pilotMissed).toBeLessThanOrEqual(Math.ceil(r.points * 0.35));
      // La mezcla del rival: normal, topspin, slice y smash (la bola alta del débil tardío lo permite).
      for (const t of ['NORMAL', 'TOPSPIN', 'SLICE', 'SMASH'] as const) expect(r.rivalTypes[t]).toBeGreaterThan(0);
    });
  }
});

describe('PilotSeat: quién mueve tu raqueta', () => {
  it('sin ?autoplay= el ratón (null); la prueba de lectura pone el lector y al acabar vuelve lo de antes', () => {
    const seat = new PilotSeat(cfg, null, 1);
    expect(seat.pilot).toBeNull();
    seat.setReading(true);
    expect(seat.pilot?.profile.label).toBe(readerProfile(cfg).label);
    seat.setReading(false);
    expect(seat.pilot).toBeNull();
  });

  it('con ?autoplay= su dificultad; la prueba de lectura manda mientras dura; un piloto nuevo solo si cambian perfil o lado', () => {
    const seat = new PilotSeat(cfg, 'hard', 1);
    const first = seat.pilot;
    expect(first?.profile).toBe(cfg.bot.difficulties.hard);
    expect(first?.side).toBe(0);
    seat.setSide(0);
    expect(seat.pilot).toBe(first);
    seat.setSide(1);
    expect(seat.pilot?.side).toBe(1);
    expect(seat.pilot).not.toBe(first);
    seat.setReading(true);
    expect(seat.pilot?.profile.lateWeak).toBe(true);
    expect(seat.pilot?.side).toBe(1);
    seat.setReading(false);
    expect(seat.pilot?.profile).toBe(cfg.bot.difficulties.hard);
  });
});

describe('AutoPlayer (?autoplay=)', () => {
  it('juega desde cualquier lado con el perfil de su dificultad (intentos en coordenadas del jugador)', () => {
    for (const side of [0, 1] as const) {
      const r = play(new AutoPlayer(side, cfg.bot.difficulties.medium, cfg, 3), cfg.bot.difficulties.medium, 90);
      expect(r.points).toBeGreaterThan(5);
      expect(r.pilotHits).toBeGreaterThan(10);
      // Las devoluciones del piloto pasan: el rival también golpea.
      expect(r.rivalHits).toBeGreaterThan(8);
    }
  });

  it('vista nueva tras ver un saque del rival (reconexión): devuelve el primer saque de la vista nueva', () => {
    const hard = cfg.bot.difficulties.hard;
    const pilot = new AutoPlayer(1, hard, cfg, 4);
    const a = new Simulation(cfg, { firstServer: 0 });
    const rivalA = new Bot(0, hard, cfg, 8);
    // Un minuto en la vista vieja y, después, hasta que el rival acaba de sacar (el piloto ya vio ese golpe 1).
    for (let i = 0; i < 200_000; i++) {
      const p = pilot.intent(a);
      a.step([rivalA.think(a), p]);
      if (a.now > 60_000 && a.state.phase === 'rally' && a.state.rally.hits === 1 && a.state.rally.lastHitter === 0) break;
    }
    expect(a.state.rally.hits).toBe(1);
    pilot.intent(a);
    // Vista nueva (reloj en 0) que empieza con el saque del rival: su golpe 1 es otro.
    const b = new Simulation(cfg, { firstServer: 0 });
    const rivalB = new Bot(0, hard, cfg, 12);
    let pilotHit = false;
    for (let i = 0; i < 20_000; i++) {
      const p = pilot.intent(b);
      const ev = b.step([rivalB.think(b), p]);
      if (ev.some((e) => e.type === 'hit' && e.player === 1)) pilotHit = true;
      if (ev.some((e) => e.type === 'point' || e.type === 'let')) break;
    }
    expect(pilotHit).toBe(true);
  });

  it('con una vista nueva cuyo reloj empieza de cero (reconexión a la sala) sigue jugando', () => {
    const pilot = new AutoPlayer(1, cfg.bot.difficulties.hard, cfg, 4);
    const first = play(pilot, cfg.bot.difficulties.hard, 120);
    expect(first.pilotHits).toBeGreaterThan(10);
    // Otra vista con el reloj en 0: sin empezar de cero, el Bot esperaría a que el reloj llegue a sus instantes viejos.
    const again = play(pilot, cfg.bot.difficulties.hard, 30, 11, new Simulation(cfg, { firstServer: 0 }));
    expect(again.pilotHits).toBeGreaterThan(5);
    expect(again.pilotMissed).toBeLessThanOrEqual(Math.ceil(again.points * 0.5));
  });
});
