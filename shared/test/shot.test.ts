import { describe, expect, it } from 'vitest';
import {
  type BallContact,
  type BallState,
  classifyHit,
  edgeDeviation,
  interpolateCurve,
  makeConfig,
  makeEnv,
  planShot,
  simDt,
  solveShot,
  stepBall,
} from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

function tableContacts(start: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }): BallContact[] {
  const b: BallState = { pos: { ...start }, vel: { ...vel }, spin: { x: 0, y: 0, z: 0 } };
  const contacts: BallContact[] = [];
  for (let i = 0; i < 1500 && contacts.filter((c) => c.kind !== 'net').length < 2; i++) stepBall(b, dt, env, contacts);
  return contacts;
}

describe('solver de tiro', () => {
  const starts = [
    { x: 0, y: env.tableTop + 0.2, z: 1.6 },
    { x: 0.6, y: env.tableTop + 0.05, z: 1.4 },
    { x: -0.9, y: env.tableTop + 0.6, z: 2.4 },
    { x: 0.3, y: env.tableTop + 0.3, z: -1.8 },
  ];
  const clearances = [0.05, 0.15, 0.4];

  it('bota en el objetivo (±1 cm) con el margen pedido (±5 mm) desde posiciones variadas', () => {
    for (const start of starts) {
      for (const clearance of clearances) {
        const sgn = start.z > 0 ? 1 : -1;
        const landing = { x: -0.3 * sgn, z: -sgn * 1.0 };
        const sol = solveShot(start, { landing, clearance, serve: false }, env, dt, cfg);
        expect(sol.converged).toBe(true);
        const c = tableContacts(start, sol.vel).find((k) => k.kind === 'table')!;
        expect(Math.abs(c.pos.x - landing.x)).toBeLessThan(0.01);
        expect(Math.abs(c.pos.z - landing.z)).toBeLessThan(0.01);
      }
    }
  });

  it('saque: bota primero en el campo propio y luego en el rival, en el objetivo', () => {
    for (const x of [-0.5, 0, 0.5]) {
      for (const clearance of [0.03, 0.08, 0.2]) {
        const start = { x, y: env.tableTop + cfg.serve.idealContactHeight, z: 1.5 };
        const landing = { x: -x * 0.5, z: -1.0 };
        const sol = solveShot(start, { landing, clearance, serve: true }, env, dt, cfg);
        expect(sol.converged).toBe(true);
        const tables = tableContacts(start, sol.vel).filter((k) => k.kind === 'table');
        expect(tables.map((t) => t.kind === 'table' && t.side)).toEqual([0, 1]);
        expect(Math.abs(tables[1].pos.z - landing.z)).toBeLessThan(0.02);
      }
    }
  });

  it('es determinista', () => {
    const run = () => solveShot(starts[1], { landing: { x: 0.2, z: -1.1 }, clearance: 0.1, serve: false }, env, dt, cfg).vel;
    expect(run()).toEqual(run());
  });
});

describe('efecto de la calidad en la trayectoria [§4.3]', () => {
  const evalAt = (dtMs: number, posFrac = 0.05, lateral = 0.01) =>
    classifyHit({ dtMs, posFrac, lateral, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, cfg.hit);
  const contact = { x: 0, y: env.tableTop + 0.25, z: 1.6 };
  const swing = { swing: { vx: 0, vy: 0 } };

  it('EARLY es más bajo que PERFECT y LATE más alto', () => {
    const early = planShot(evalAt(-90), contact, swing, 0, cfg, false);
    const perfect = planShot(evalAt(0), contact, swing, 0, cfg, false);
    const late = planShot(evalAt(90), contact, swing, 0, cfg, false);
    expect(early.clearance).toBeLessThan(perfect.clearance);
    expect(late.clearance).toBeGreaterThan(perfect.clearance);
  });

  it('LATE es más lento que PERFECT (bola fácil para el rival)', () => {
    const speed = (dtMs: number) => {
      const t = planShot(evalAt(dtMs), contact, swing, 0, cfg, false);
      const v = solveShot(contact, t, env, dt, cfg).vel;
      return Math.hypot(v.x, v.z);
    };
    expect(speed(110)).toBeLessThan(speed(0) * 0.85);
  });

  it('PERFECT es el golpe más rápido: ni pronto ni tarde dan más velocidad', () => {
    const speed = (dtMs: number) => {
      const t = planShot(evalAt(dtMs), contact, swing, 0, cfg, false);
      const v = solveShot(contact, t, env, dt, cfg).vel;
      return Math.hypot(v.x, v.z);
    };
    const perfect = speed(0);
    for (let d = -100; d <= 120; d += 5) if (Math.abs(d) > cfg.hit.perfectMs) expect(speed(d)).toBeLessThanOrEqual(perfect + 1e-6);
  });

  it('un EARLY extremo apunta por debajo de la cinta (red)', () => {
    expect(interpolateCurve(cfg.shot.timingCurve, -120).clearance).toBeLessThan(0);
  });

  it('golpear la bola muy baja reduce el margen (posición desfavorable)', () => {
    const high = planShot(evalAt(0), contact, swing, 0, cfg, false);
    const low = planShot(evalAt(0), { ...contact, y: env.tableTop + 0.01 }, swing, 0, cfg, false);
    expect(low.clearance).toBeLessThan(high.clearance);
  });

  it('el golpe con el borde desvía hacia el lado del impacto, proporcional y sin azar', () => {
    const d1 = edgeDeviation({ posFrac: 0.6, lateral: 0.08 }, cfg.shot);
    const d2 = edgeDeviation({ posFrac: 0.9, lateral: 0.12 }, cfg.shot);
    const d3 = edgeDeviation({ posFrac: 0.9, lateral: -0.12 }, cfg.shot);
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeCloseTo(-d2, 12);
  });

  it('el lado 1 apunta al campo del lado 0 y con el eje lateral espejado', () => {
    const ev = evalAt(0);
    const t0 = planShot(ev, { x: 0, y: 1, z: 1.6 }, { swing: { vx: 3, vy: 0 } }, 0, cfg, false);
    const t1 = planShot(ev, { x: 0, y: 1, z: -1.6 }, { swing: { vx: 3, vy: 0 } }, 1, cfg, false);
    expect(t0.landing.z).toBeLessThan(0);
    expect(t1.landing.z).toBeGreaterThan(0);
    expect(t0.landing.x).toBeCloseTo(-t1.landing.x, 12);
    expect(t0.landing.x).toBeGreaterThan(0);
  });
});
