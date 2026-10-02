import { describe, expect, it } from 'vitest';
import {
  type BallContact,
  type BallState,
  classifyHit,
  makeConfig,
  makeEnv,
  planShot,
  simDt,
  solveShot,
  stepBall,
  type StrokeType,
  type Vec3,
} from '../src/index.ts';

// V0.2b: el tipo de golpe se elige con teclas (keys.test.ts) y la potencia sale de la calidad. Estos tests de V0.2
// comprueban lo mismo que antes, pero pidiendo el tipo con `type` en lugar de con un gesto del ratón.

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

const evalAt = (dtMs: number, posFrac = 0.05, lateral = 0.007) =>
  classifyHit({ dtMs, posFrac, lateral, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, cfg.hit);

/** Planifica, resuelve y vuela un golpe del lado 0 (con red). `vx`: gesto lateral (cruce). */
function shoot(dtMs: number, type: StrokeType, contact: Vec3, vx = 0) {
  const targets = planShot(evalAt(dtMs), contact, { swing: { vx, vy: 0 }, type }, 0, cfg, false);
  const sol = solveShot(contact, targets, env, dt, cfg);
  const b: BallState = { pos: { ...contact }, vel: { ...sol.vel }, spin: { ...targets.spin } };
  const contacts: BallContact[] = [];
  for (let i = 0; i < 1500 && !contacts.some((c) => c.kind !== 'net'); i++) stepBall(b, dt, env, contacts);
  const first = contacts.find((c) => c.kind !== 'net');
  const valid = !!first && first.kind === 'table' && first.side === 1;
  return { targets, sol, net: contacts.some((c) => c.kind === 'net') && !valid, valid, first, speed: Math.hypot(sol.vel.x, sol.vel.z) };
}

const top = (h: number, z = 1.6, x = 0): Vec3 => ({ x, y: env.tableTop + h, z });
/** Contacto con la parte inferior de la bola `above` m por encima de la cinta. */
const aboveTape = (above: number, z = 1.6): Vec3 => ({ x: 0, y: env.netTop + env.r + above, z });

describe('topspin [§4.6]', () => {
  it('pega más fuerte que el normal manteniendo la bola baja, y entra', () => {
    const normal = shoot(0, 'NORMAL', top(0.2));
    const topspin = shoot(0, 'TOPSPIN', top(0.2));
    expect(topspin.valid).toBe(true);
    expect(topspin.targets.type).toBe('TOPSPIN');
    expect(topspin.targets.spinRel.top).toBeGreaterThan(cfg.shotTypes.topspin.spinMin);
    expect(topspin.speed).toBeGreaterThan(normal.speed * 1.25);
    // V0.2b: el PERFECT da el topspin completo y su techo de ritmo actúa: pasa a la altura de un normal (±1 cm).
    expect(topspin.targets.clearance).toBeLessThanOrEqual(normal.targets.clearance + 0.01);
  });

  it('desde una bola muy baja, demasiado topspin va a la red; el golpe normal pasa', () => {
    expect(shoot(0, 'NORMAL', top(0.04)).valid).toBe(true);
    const r = shoot(0, 'TOPSPIN', top(0.04));
    expect(r.net).toBe(true);
    expect(r.targets.parts.clearance.lowContact!).toBeLessThan(-0.1);
  });

  it('PERFECT controla mejor el spin que GOOD y que un golpe débil [§4.3]', () => {
    const spinAt = (d: number) => planShot(evalAt(d), top(0.2), { swing: { vx: 0, vy: 0 }, type: 'TOPSPIN' }, 0, cfg, false).spinRel.top;
    expect(spinAt(0)).toBeGreaterThan(spinAt(45));
    expect(spinAt(45)).toBeGreaterThan(spinAt(90));
  });
});

describe('slice [§4.6]: efecto lateral y más ángulo', () => {
  it('curva hacia el lado del cruce, bota más abierto que un cruce a medias y entra con PERFECT', () => {
    const cross = shoot(0, 'NORMAL', top(0.2), 1.2);
    const slice = shoot(0, 'SLICE', top(0.2), 1.2);
    expect(slice.targets.type).toBe('SLICE');
    expect(slice.targets.spinRel.side).toBeGreaterThan(100);
    expect(slice.targets.spinRel.top).toBeLessThan(0); // algo de backspin
    expect(slice.valid).toBe(true);
    expect(slice.first!.pos.x).toBeGreaterThan(cross.first!.pos.x);
    const left = shoot(0, 'SLICE', top(0.2), -1.2);
    expect(left.targets.spinRel.side).toBeLessThan(-100);
  });

  it('pronto se pasa de ángulo y sale por la banda', () => {
    const r = shoot(-70, 'SLICE', top(0.2), 2);
    expect(Math.abs(r.targets.landing.x)).toBeGreaterThan(cfg.world.tableWidth / 2);
    expect(r.valid).toBe(false);
  });

  it('deja menos margen sobre la red que el golpe normal', () => {
    expect(shoot(0, 'SLICE', top(0.2)).targets.clearance).toBeLessThan(shoot(0, 'NORMAL', top(0.2)).targets.clearance - 0.03);
  });
});

describe('smash: umbral relativo a la red [§4.6]', () => {
  const smash = 'SMASH';

  it(`con la bola más de ${cfg.shotTypes.smash.minAboveTape * 100} cm sobre la cinta entra y es muy rápido`, () => {
    const normal = shoot(0, 'NORMAL', top(0.22));
    for (const z of [1.0, 1.6, 2.3]) {
      const r = shoot(0, smash, aboveTape(cfg.shotTypes.smash.minAboveTape + 0.02, z));
      expect(r.targets.type).toBe('SMASH');
      expect(r.valid, `z=${z}`).toBe(true);
    }
    expect(shoot(0, smash, aboveTape(0.25)).speed).toBeGreaterThan(normal.speed * 1.6);
  });

  it('con la bola baja (a menos del umbral) va a la red, desde cualquier profundidad', () => {
    for (const z of [1.0, 1.6, 2.3]) {
      const r = shoot(0, smash, aboveTape(cfg.shotTypes.smash.minAboveTape - 0.06, z));
      expect(r.net, `z=${z}`).toBe(true);
      expect(r.targets.parts.clearance.smashLow!).toBeLessThan(0);
    }
  });

  it('el umbral se mide en el contacto respecto a la cinta: por debajo, la bola baja más empinada', () => {
    const r = planShot(evalAt(0), aboveTape(0.1), { swing: { vx: 0, vy: 0 }, type: smash }, 0, cfg, false);
    expect(r.aboveTape).toBeCloseTo(0.1, 9);
    expect(r.parts.depth.smashLow).toBeCloseTo(-cfg.shotTypes.smash.lowDepthPerM * (cfg.shotTypes.smash.minAboveTape - 0.1), 9);
    expect(r.parts.clearance.smashLow!).toBeLessThan(0);
    const ok = planShot(evalAt(0), aboveTape(0.16), { swing: { vx: 0, vy: 0 }, type: smash }, 0, cfg, false);
    expect(ok.parts.clearance.smashLow).toBeUndefined();
  });

  it('desde una bola alta, un golpe normal no es un smash: tiene techo de ritmo', () => {
    const normal = shoot(0, 'NORMAL', aboveTape(0.35));
    const sm = shoot(0, smash, aboveTape(0.35));
    expect(normal.targets.parts.clearance.paceCap!).toBeGreaterThan(0);
    expect(sm.speed).toBeGreaterThan(normal.speed * 1.35);
  });

  it('smash pronto: más bajo y más corto → red', () => {
    expect(shoot(-100, smash, aboveTape(0.2)).net).toBe(true);
  });
});

describe('el margen pedido es la suma de sus partes (base de "¿por qué fallé?")', () => {
  it('para todos los tipos', () => {
    for (const [type, vx] of [
      ['NORMAL', 0],
      ['NORMAL', 1.5],
      ['TOPSPIN', 0],
      ['SLICE', 1.5],
      ['SLICE', 0],
      ['SMASH', 0],
    ] as [StrokeType, number][]) {
      for (const d of [-90, 0, 80]) {
        const t = planShot(evalAt(d, 0.6, 0.08), top(0.1), { swing: { vx, vy: 0 }, type }, 0, cfg, false);
        const sum = Object.values(t.parts.clearance).reduce((a, b) => a + (b ?? 0), 0);
        expect(t.clearance).toBeCloseTo(sum, 12);
        const lat = Object.values(t.parts.lateral).reduce((a, b) => a + (b ?? 0), 0);
        expect(t.landing.x).toBeCloseTo(lat, 12);
      }
    }
  });
});
