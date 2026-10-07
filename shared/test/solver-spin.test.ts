import { describe, expect, it } from 'vitest';
import { type BallContact, type BallState, makeConfig, makeEnv, simDt, solveShot, stepBall, type Vec3, worldSpin } from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

/** Vuelo real (con red y mesa): margen al cruzar la red y primer bote. */
function fly(start: Vec3, vel: Vec3, spin: Vec3) {
  const b: BallState = { pos: { ...start }, vel: { ...vel }, spin: { ...spin } };
  const contacts: BallContact[] = [];
  let clearance = Number.NaN;
  for (let i = 0; i < 1500 && !contacts.some((c) => c.kind === 'table' || c.kind === 'floor'); i++) {
    const prev = { ...b.pos };
    stepBall(b, dt, env, contacts);
    if (Number.isNaN(clearance) && Math.sign(b.pos.z) !== Math.sign(prev.z)) {
      const f = prev.z / (prev.z - b.pos.z);
      clearance = prev.y + (b.pos.y - prev.y) * f - env.r - env.netTop;
    }
  }
  return { clearance, first: contacts.find((c) => c.kind !== 'net'), net: contacts.some((c) => c.kind === 'net') };
}

const spinFor = (start: Vec3, landing: { x: number; z: number }, top: number, side: number) => {
  const dx = landing.x - start.x;
  const dz = landing.z - start.z;
  const d = Math.hypot(dx, dz);
  return worldSpin({ top, side }, dx / d, dz / d);
};

describe('solver con spin: Magnus dentro de la simulación que resuelve [§7.5]', () => {
  const starts = [
    { x: 0, y: env.tableTop + 0.2, z: 1.6 },
    { x: 0.6, y: env.tableTop + 0.08, z: 1.4 },
    { x: -0.9, y: env.tableTop + 0.45, z: 2.3 },
    { x: 0.3, y: env.tableTop + 0.3, z: -1.8 },
  ];
  const spins: [number, number][] = [
    [450, 0],
    [250, 0],
    [-150, 0],
    [0, 300],
    [0, -300],
    [-80, 250],
  ];

  it('bota en el objetivo (±1 cm) con el margen pedido (±5 mm) con topspin, backspin y lateral', () => {
    // Mide la precisión del Newton, no el tope de P54: con 450 rad/s y margen 0.06 desde (−0.9, 0.45 m, 2.3) pide 40 m/s.
    const free = makeConfig({ shotTypes: { solverMaxSpeed: 60 } });
    for (const start of starts) {
      const sgn = start.z > 0 ? 1 : -1;
      for (const [top, side] of spins) {
        for (const clearance of [0.06, 0.2]) {
          const landing = { x: -0.35 * sgn, z: -sgn * 1.05 };
          const spin = spinFor(start, landing, top, side);
          const sol = solveShot(start, { landing, clearance, serve: false, spin }, env, dt, free);
          expect(sol.converged, `top=${top} side=${side} c=${clearance} start=${JSON.stringify(start)}`).toBe(true);
          const r = fly(start, sol.vel, spin);
          expect(r.net).toBe(false);
          expect(r.first?.kind).toBe('table');
          expect(Math.abs(r.first!.pos.x - landing.x)).toBeLessThan(0.01);
          expect(Math.abs(r.first!.pos.z - landing.z)).toBeLessThan(0.01);
          expect(Math.abs(r.clearance - clearance)).toBeLessThan(0.005);
        }
      }
    }
  });

  it('el topspin permite pegar más fuerte con el mismo margen y el mismo bote; el backspin, más despacio', () => {
    const start = starts[0];
    const landing = { x: 0, z: -1.15 };
    const speed = (top: number) => {
      const v = solveShot(start, { landing, clearance: 0.1, serve: false, spin: spinFor(start, landing, top, 0) }, env, dt, cfg).vel;
      return Math.hypot(v.x, v.z);
    };
    expect(speed(400)).toBeGreaterThan(speed(0) * 1.2);
    expect(speed(-150)).toBeLessThan(speed(0));
  });

  it('con lateral la bola sale hacia dentro y la curva la lleva al objetivo', () => {
    const start = { x: 0, y: env.tableTop + 0.2, z: 1.6 };
    const landing = { x: 0.5, z: -1.0 };
    const sol = solveShot(start, { landing, clearance: 0.1, serve: false, spin: spinFor(start, landing, 0, 300) }, env, dt, cfg);
    const straight = solveShot(start, { landing, clearance: 0.1, serve: false }, env, dt, cfg);
    // Curva a la derecha (+x): sale con menos x que el tiro recto.
    expect(sol.vel.x / -sol.vel.z).toBeLessThan(straight.vel.x / -straight.vel.z - 0.02);
  });

  it('si la física manda a la red, la red llega: margen negativo con topspin choca con la red', () => {
    const start = starts[0];
    const landing = { x: 0, z: -1.0 };
    const spin = spinFor(start, landing, 400, 0);
    const sol = solveShot(start, { landing, clearance: -0.03, serve: false, spin }, env, dt, cfg);
    expect(fly(start, sol.vel, spin).net).toBe(true);
  });

  it('es determinista con spin', () => {
    const start = starts[1];
    const landing = { x: 0.2, z: -1.1 };
    const run = () => solveShot(start, { landing, clearance: 0.1, serve: false, spin: spinFor(start, landing, 300, -200) }, env, dt, cfg).vel;
    expect(run()).toEqual(run());
  });
});
