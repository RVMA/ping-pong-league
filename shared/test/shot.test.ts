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
    // Mide la precisión del Newton, no el tope de P54: desde (−0.9, 0.6 m, 2.4) con margen 0.05 pide 25.3 m/s, por encima de solverMaxSpeed.
    const free = makeConfig({ shotTypes: { solverMaxSpeed: 60 } });
    for (const start of starts) {
      for (const clearance of clearances) {
        const sgn = start.z > 0 ? 1 : -1;
        const landing = { x: -0.3 * sgn, z: -sgn * 1.0 };
        const sol = solveShot(start, { landing, clearance, serve: false }, env, dt, free);
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
    // Desde ~−85 ms el tiro va a la red (ver net.test.ts): su velocidad ya no importa.
    for (let d = -80; d <= 120; d += 5) if (Math.abs(d) > cfg.hit.perfectMs) expect(speed(d)).toBeLessThanOrEqual(perfect + 1e-6);
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

describe('saque desde un lateral (regresión del playtest 1)', () => {
  it('el primer bote cae en tu campo aunque saques desde el borde y cruces la bola', () => {
    for (const cx of [-0.7, 0.7, -0.97]) {
      for (const vx of [-4, 0, 4]) {
        const start = { x: cx, y: env.tableTop + cfg.serve.idealContactHeight, z: 1.5 };
        const ev = classifyHit({ dtMs: 0, posFrac: 0.02, lateral: 0.003, tIdeal: 0, ballAtIdeal: start, reachOverflow: 0 }, cfg.hit);
        const t = planShot(ev, start, { swing: { vx, vy: 0 } }, 0, cfg, true);
        const sol = solveShot(start, t, env, dt, cfg);
        const tables = tableContacts(start, sol.vel).filter((k) => k.kind === 'table');
        expect(tables.map((k) => k.kind === 'table' && k.side)).toEqual([0, 1]);
      }
    }
  });
});

describe('riesgo de ángulo al cruzar (playtest 2)', () => {
  // V0.2: un gesto lateral de 2.5 alturas/s o más ya es slice; el cruce a tope de V0.1 se consigue con 2.0
  // (puntería saturada: (2.0 − 0.5)·0.5 = 0.75 m > 0.66 m). Antes estos tests usaban 4.
  const evalAt = (dtMs: number) =>
    classifyHit({ dtMs, posFrac: 0.05, lateral: 0.007, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, cfg.hit);
  const contact = { x: 0, y: env.tableTop + 0.2, z: 1.6 };
  const half = cfg.world.tableWidth / 2;
  const plan = (dtMs: number, vx: number) => planShot(evalAt(dtMs), contact, { swing: { vx, vy: 0 } }, 0, cfg, false);

  it('cruzar a tope con PERFECT entra; pronto (GOOD a −60 ms) se abre demasiado y sale por la banda', () => {
    expect(Math.abs(plan(0, 2).landing.x)).toBeLessThan(half);
    expect(Math.abs(plan(-60, 2).landing.x)).toBeGreaterThan(half);
  });

  it('medio cruce con el mismo error todavía entra', () => {
    expect(Math.abs(plan(-60, 1.2).landing.x)).toBeLessThan(half);
  });

  it('tarde no llegas a cruzar: el ángulo se reduce', () => {
    expect(Math.abs(plan(90, 2).aim)).toBeLessThan(Math.abs(plan(0, 2).aim) * 0.6);
  });

  it('dentro de la ventana PERFECT el ángulo no cambia', () => {
    expect(plan(-20, 2).aim).toBeCloseTo(plan(0, 2).aim, 12);
  });

  it('cruzar a tope deja menos margen sobre la red', () => {
    expect(plan(0, 2).clearance).toBeCloseTo(plan(0, 0).clearance - cfg.shot.aimClearancePenalty, 9);
  });
});

describe('saque tardío (regresión del playtest 2)', () => {
  // Altura real del contacto cuando el click llega tarde: la bola sigue cayendo desde la altura ideal.
  const apex = cfg.serve.holdHeight + cfg.serve.tossSpeed ** 2 / (2 * env.g);
  const vIdeal = Math.sqrt(2 * env.g * (apex - cfg.serve.idealContactHeight));
  const heightAt = (dtMs: number) => {
    const t = (dtMs * cfg.sim.gameSpeed) / 1000;
    return cfg.serve.idealContactHeight - (vIdeal * t + 0.5 * env.g * t * t);
  };

  it('tarde (+80 ms) el saque entra y pasa la red más alto que un PERFECT', () => {
    for (const cx of [-0.5, 0, 0.5]) {
      const start = { x: cx, y: env.tableTop + heightAt(80), z: 1.6 };
      const ev = classifyHit({ dtMs: 80, posFrac: 0.05, lateral: 0.007, tIdeal: 0, ballAtIdeal: start, reachOverflow: 0 }, cfg.hit);
      const late = planShot(ev, start, { swing: { vx: 0, vy: 0 } }, 0, cfg, true);
      const sol = solveShot(start, late, env, dt, cfg);
      expect(sol.converged).toBe(true);
      const tables = tableContacts(start, sol.vel).filter((k) => k.kind === 'table');
      expect(tables.map((k) => k.kind === 'table' && k.side)).toEqual([0, 1]);
      expect(late.clearance).toBeGreaterThan(interpolateCurve(cfg.serve.timingCurve, 0).clearance);
    }
  });
});
