import { describe, expect, it } from 'vitest';
import { classifyHit, diagnose, type HitEvaluation, makeConfig, makeEnv, planShot, type StrokeType, type Vec3, worldSpin } from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);

const evalAt = (dtMs: number, posFrac = 0.05, lateral = 0.007): HitEvaluation =>
  classifyHit({ dtMs, posFrac, lateral, tIdeal: 0, ballAtIdeal: { x: 0, y: env.tableTop + 0.2, z: 1.6 }, reachOverflow: 0 }, cfg.hit);
const at = (h: number, x = 0): Vec3 => ({ x, y: env.tableTop + h, z: 1.6 });

// V0.2b: el tipo de golpe va con teclas (`type`); `vx` es el gesto lateral (cruce).
function why(reason: 'NET' | 'OUT', dtMs: number, type: StrokeType, contact: Vec3, opts: Parameters<typeof planShot>[6] = {}, posFrac = 0.05, lateral = 0.007, vx = 0) {
  const evaluation = evalAt(dtMs, posFrac, lateral);
  const targets = planShot(evaluation, contact, { swing: { vx, vy: 0 }, type }, 0, cfg, false, opts);
  return diagnose({ reason, lastHit: { targets, evaluation, contactHeight: contact.y - env.tableTop }, whiffed: false }, cfg)!;
}

describe('"¿por qué fallé?": cada error con una causa que se puede nombrar [§2.2]', () => {
  it('red por golpear pronto (con el Δt)', () => {
    const r = why('NET', -100, 'NORMAL', at(0.2));
    expect(r.cause).toBe('EARLY');
    expect(r.dtMs).toBe(-100);
  });

  it('red por coger la bola muy baja', () => {
    expect(why('NET', 0, 'NORMAL', at(0.0)).cause).toBe('LOW_CONTACT');
  });

  it('red por topspin desde una bola baja', () => {
    expect(why('NET', 0, 'TOPSPIN', at(0.04)).cause).toBe('TOPSPIN_LOW');
  });

  it('red por smash con la bola baja (con la altura sobre la cinta)', () => {
    const r = why('NET', 0, 'SMASH', { x: 0, y: env.netTop + env.r + 0.08, z: 1.6 });
    expect(r.cause).toBe('SMASH_LOW');
    expect(r.aboveTape).toBeCloseTo(0.08, 9);
  });

  it('red por smash pronto', () => {
    expect(why('NET', -100, 'SMASH', { x: 0, y: env.netTop + env.r + 0.25, z: 1.6 }).cause).toBe('SMASH_EARLY');
  });

  it('fuera por la banda: cruzar pronto y slice pronto', () => {
    expect(why('OUT', -60, 'NORMAL', at(0.2), {}, 0.05, 0.007, 2).cause).toBe('CROSS_EARLY');
    expect(why('OUT', -70, 'SLICE', at(0.2)).cause).toBe('SLICE_EARLY');
  });

  it('fuera por la banda: golpe con el borde', () => {
    expect(why('OUT', 0, 'NORMAL', at(0.2, 0.6), {}, 0.95, 0.13).cause).toBe('EDGE_WIDE');
  });

  it('fuera por el fondo: golpe fuerte y tarde', () => {
    const evaluation = evalAt(115);
    const targets = planShot(evaluation, at(0.2), { swing: { vx: 0, vy: 0 }, type: 'TOPSPIN' }, 0, cfg, false);
    expect(Math.abs(targets.landing.z)).toBeGreaterThan(cfg.world.tableLength / 2);
    expect(diagnose({ reason: 'OUT', lastHit: { targets, evaluation, contactHeight: 0.2 }, whiffed: false }, cfg)!.cause).toBe('POWER_LATE');
  });

  it('fuera con el bote pedido dentro, a ras de la banda: la parte que lo llevó a la línea (saque pronto y cruzado)', () => {
    // El caso que encontró room-bots (y shot-stats con 300 partidos, semilla 7, partida 296): saque WEAK pronto (−96 ms)
    // con mucho cruce. El riesgo de ángulo (−0.23 m) lleva el bote pedido a 1 mm de la banda con −1.3 cm de margen sobre
    // la cinta; el solver no puede cumplirlo (converged false: pasa 2 cm más alta y bota 12 cm más larga, en diagonal
    // hacia la banda) y la bola sale por la banda. Sin ese riesgo, el bote pedido quedaría 23 cm dentro.
    const evaluation = evalAt(-95.5, 0.184);
    const contact = { x: 0.069, y: env.tableTop + 0.297, z: -1.6 };
    const targets = {
      ...planShot(evaluation, contact, { swing: { vx: 0, vy: 0 } }, 1, cfg, true),
      landing: { x: 0.761, z: 0.809 },
      parts: {
        clearance: { base: 0.0024, angle: -0.0157 },
        depth: { base: 0.5908 },
        lateral: { base: -0.0311, aim: -0.5204, angleRisk: -0.2318, edge: 0.0221 },
      },
    };
    expect(Math.abs(targets.landing.x)).toBeLessThan(cfg.world.tableWidth / 2);
    expect(diagnose({ reason: 'OUT', lastHit: { targets, evaluation, contactHeight: 0.297 }, whiffed: false }, cfg)!.cause).toBe('CROSS_EARLY');
  });

  it('fuera con el bote pedido dentro, a ras del fondo: la parte que lo alargó (golpe fuerte y tarde)', () => {
    const evaluation = evalAt(115);
    const planned = planShot(evaluation, at(0.2), { swing: { vx: 0, vy: 0 }, type: 'TOPSPIN' }, 0, cfg, false);
    const halfL = cfg.world.tableLength / 2;
    const targets = { ...planned, landing: { x: planned.landing.x, z: Math.sign(planned.landing.z) * (halfL - 0.004) } };
    expect(diagnose({ reason: 'OUT', lastHit: { targets, evaluation, contactHeight: 0.2 }, whiffed: false }, cfg)!.cause).toBe('POWER_LATE');
  });

  it('fuera con el bote pedido lejos de las líneas: no se inventa una causa', () => {
    // Un golpe PERFECT al centro que sale (p. ej. tras tocar la cinta): ninguna parte lo acercó a una línea.
    const evaluation = evalAt(0);
    const targets = planShot(evaluation, at(0.2), { swing: { vx: 0, vy: 0 } }, 0, cfg, false);
    expect(Math.abs(targets.landing.x)).toBeLessThan(cfg.world.tableWidth / 4);
    expect(diagnose({ reason: 'OUT', lastHit: { targets, evaluation, contactHeight: 0.2 }, whiffed: false }, cfg)!.cause).toBe('UNKNOWN');
  });

  it('bloqueo: topspin sin absorber → largo; backspin → red; pronto → red', () => {
    const inc = (top: number) => ({ vel: { x: 0, y: -0.5, z: 7 }, spin: worldSpin({ top, side: 0 }, 0, 1) });
    // Bloqueo débil por posición (borde) contra un topspin fuerte.
    expect(why('OUT', 0, 'NORMAL', at(0.22), { block: true, incoming: inc(500) }, 0.6).cause).toBe('BLOCK_TOPSPIN');
    expect(why('NET', 80, 'NORMAL', at(0.22), { block: true, incoming: inc(-400) }).cause).toBe('BLOCK_BACKSPIN');
    expect(why('NET', -110, 'NORMAL', at(0.22), { block: true, incoming: inc(0) }).cause).toBe('BLOCK_EARLY');
  });

  it('no devuelta: fallo al aire pronto / tarde / fuera de la raqueta, o sin click', () => {
    const whiff = (dtMs: number, posFrac: number) => evalAt(dtMs, posFrac);
    expect(diagnose({ reason: 'MISSED', lastHit: null, whiff: whiff(-150, 0.1), whiffed: true }, cfg)!.cause).toBe('WHIFF_EARLY');
    expect(diagnose({ reason: 'MISSED', lastHit: null, whiff: whiff(140, 0.1), whiffed: true }, cfg)!.cause).toBe('WHIFF_LATE');
    expect(diagnose({ reason: 'MISSED', lastHit: null, whiff: whiff(10, 1.3), whiffed: true }, cfg)!.cause).toBe('WHIFF_POSITION');
    expect(diagnose({ reason: 'MISSED', lastHit: null, whiffed: false }, cfg)!.cause).toBe('NO_CLICK');
  });

  it('los motivos que no son error de golpe no se diagnostican', () => {
    expect(diagnose({ reason: 'VOLLEY', lastHit: null, whiffed: false }, cfg)).toBeNull();
  });
});
