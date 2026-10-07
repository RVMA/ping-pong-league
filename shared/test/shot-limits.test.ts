import { describe, expect, it } from 'vitest';
import {
  Bot,
  type BallContact,
  type BallState,
  classifyHit,
  diagnose,
  makeConfig,
  makeEnv,
  planShot,
  type ShotTargets,
  simDt,
  Simulation,
  solveShot,
  stepBall,
  type Vec3,
} from '../src/index.ts';

// P54 [§7.5]: un topspin débil muy pronto pedía botar en TU mitad (profundidad negativa) y el solver devolvía
// velocidades absurdas (~151 m/s). Ahora la profundidad pedida tiene un mínimo y el solver tiene un tope de velocidad.

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);
const sum = (p: Partial<Record<string, number>>): number => Object.values(p).reduce<number>((a, b) => a + (b ?? 0), 0);
const speed = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const evalAt = (dtMs: number) => classifyHit({ dtMs, posFrac: 0.05, lateral: 0.007, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, cfg.hit);
const plan = (dtMs: number, c: Vec3): ShotTargets => planShot(evalAt(dtMs), c, { swing: { vx: 0, vy: 0 }, type: 'TOPSPIN' }, 0, cfg, false);

/** Barrido de topspins débiles muy pronto, con la bola lejos de la mesa (contacto a 2 m de la red): el primero con profundidad cruda negativa. */
function findCase(): { dtMs: number; contact: Vec3; raw: number } | null {
  for (let d = -120; d <= -90; d += 5)
    for (let h = 0.03; h <= 0.151; h += 0.03)
      for (let x = -0.5; x <= 0.501; x += 0.25) {
        const contact = { x, y: env.tableTop + h, z: 2.0 };
        const t = plan(d, contact);
        const raw = sum(t.parts.depth) - (t.parts.depth.minDepth ?? 0);
        if (raw < 0) return { dtMs: d, contact, raw };
      }
  return null;
}

describe('P54: profundidad mínima del bote', () => {
  const found = findCase();

  it('(a) existe un topspin débil muy pronto cuya profundidad pedida es negativa (botaría en tu mitad)', () => {
    expect(found).not.toBeNull();
    expect(found!.raw).toBeLessThan(0);
    // Con la profundidad cruda, el solver devolvía una bola absurdamente rápida (aquí sin tope no baja de ~29 m/s en este contacto).
    const t = plan(found!.dtMs, found!.contact);
    expect(t.parts.depth.minDepth).toBeGreaterThan(0);
  });

  it('(b) el bote pedido sube a la profundidad mínima, la velocidad es razonable y la bola acaba en la red', () => {
    const { dtMs, contact } = found!;
    const t = plan(dtMs, contact);
    expect(sum(t.parts.depth)).toBeGreaterThanOrEqual(cfg.shot.minLandingDepth - 1e-9);
    const sol = solveShot(contact, t, env, dt, cfg);
    expect(speed(sol.vel)).toBeLessThanOrEqual(cfg.shotTypes.solverMaxSpeed + 1e-9);

    const b: BallState = { pos: { ...contact }, vel: { ...sol.vel }, spin: { ...t.spin } };
    const contacts: BallContact[] = [];
    for (let i = 0; i < 1500 && !contacts.some((c) => c.kind !== 'net'); i++) stepBall(b, dt, env, contacts);
    const first = contacts.find((c) => c.kind !== 'net');
    expect(contacts.some((c) => c.kind === 'net')).toBe(true);
    expect(!!first && first.kind === 'table' && first.side === 1).toBe(false);

    const why = diagnose({ reason: 'NET', lastHit: { targets: t, evaluation: evalAt(dtMs), contactHeight: contact.y - env.tableTop }, whiff: null, whiffed: false }, cfg);
    expect(why?.cause).toBe('EARLY');
  });

  it('(c) un objetivo imposible no devuelve más del tope y no converge', () => {
    const start: Vec3 = { x: 0, y: env.tableTop + 0.15, z: 2.0 };
    // Bote a 0.02 m detrás de la red desde 2 m de distancia, con margen 0.
    const sol = solveShot(start, { landing: { x: 0, z: -0.02 }, clearance: 0, serve: false }, env, dt, cfg);
    expect(speed(sol.vel)).toBeLessThanOrEqual(cfg.shotTypes.solverMaxSpeed + 1e-9);
    expect(sol.converged).toBe(false);
  });

  it('(d) 30 partidos de bots: ninguna velocidad de salida pasa del tope', () => {
    let max = 0;
    for (let g = 0; g < 30; g++) {
      const seed = 7 + g * 101;
      const sim = new Simulation(cfg, { firstServer: (g % 2) as 0 | 1 });
      const bots = [new Bot(0, cfg.bot.difficulties.medium, cfg, seed), new Bot(1, cfg.bot.difficulties.medium, cfg, seed * 31 + 1)];
      for (let i = 0; i < 120 * 60 * 30 && sim.state.phase !== 'gameOver'; i++) {
        const ev = sim.step([bots[0].think(sim), bots[1].think(sim)]);
        if (ev.some((e) => e.type === 'hit')) max = Math.max(max, speed(sim.state.ball.vel));
      }
    }
    expect(max).toBeLessThanOrEqual(cfg.shotTypes.solverMaxSpeed + 1e-9);
  }, 120_000);
});
