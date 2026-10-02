import { describe, expect, it } from 'vitest';
import { type BallContact, type BallState, makeConfig, makeEnv, relativeSpin, simDt, spinKind, stepBall, worldSpin } from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

/** Bola lanzada desde el lado 0 hacia el lado 1 (−z) con spin relativo (top, side). */
function launch(top: number, side: number, vel = { x: 0, y: 1.2, z: -6 }): BallState {
  const h = Math.hypot(vel.x, vel.z);
  return { pos: { x: 0, y: env.tableTop + 0.25, z: 1.5 }, vel: { ...vel }, spin: worldSpin({ top, side }, vel.x / h, vel.z / h) };
}

/** Vuela sin mesa ni red hasta bajar a la altura de la mesa; devuelve dónde la cruza. */
function crossTableHeight(b: BallState): { x: number; z: number } {
  for (let i = 0; i < 2000; i++) {
    stepBall(b, dt, env, undefined, { net: false, table: false });
    if (b.pos.y <= env.tableContactY && b.vel.y < 0) break;
  }
  return { x: b.pos.x, z: b.pos.z };
}

describe('efecto Magnus [§7.1]', () => {
  it('el topspin hace caer antes la bola y el backspin la sostiene', () => {
    const flat = crossTableHeight(launch(0, 0));
    const top = crossTableHeight(launch(400, 0));
    const back = crossTableHeight(launch(-400, 0));
    // z negativo = hacia el campo rival: cuanto más negativo, más lejos.
    expect(top.z).toBeGreaterThan(flat.z + 0.15);
    expect(back.z).toBeLessThan(flat.z - 0.15);
  });

  it('el lateral curva la bola hacia la derecha de quien golpea (y espejado para el lado 1)', () => {
    const right0 = crossTableHeight(launch(0, 300));
    const left0 = crossTableHeight(launch(0, -300));
    expect(right0.x).toBeGreaterThan(0.05); // derecha del lado 0 = +x
    expect(left0.x).toBeCloseTo(-right0.x, 9);
    // Lado 1: lanza hacia +z; su derecha es −x del mundo.
    const v1 = { x: 0, y: 1.2, z: 6 };
    const b1: BallState = { pos: { x: 0, y: env.tableTop + 0.25, z: -1.5 }, vel: v1, spin: worldSpin({ top: 0, side: 300 }, 0, 1) };
    expect(crossTableHeight(b1).x).toBeLessThan(-0.05);
  });

  it('sin spin la trayectoria es la de V0.1 (no hay fuerza lateral ni vertical extra)', () => {
    const b = launch(0, 0);
    const c = crossTableHeight(b);
    expect(Math.abs(c.x)).toBe(0);
    expect(Math.abs(b.spin.x) + Math.abs(b.spin.y) + Math.abs(b.spin.z)).toBe(0);
  });

  it('el spin decae despacio en el aire', () => {
    const b = launch(400, 0);
    // ~0.4 s de vuelo (antes de llegar al suelo).
    for (let i = 0; i < 64; i++) stepBall(b, dt, env, undefined, { net: false, table: false });
    const rel = relativeSpin(b.spin, b.vel);
    expect(rel.top).toBeLessThan(400);
    expect(rel.top).toBeGreaterThan(400 * 0.95);
  });
});

describe('bote con spin: intercambio spin ↔ velocidad [§7.1]', () => {
  /** Bola cayendo sobre la mesa del lado 1 con velocidad horizontal −z y spin relativo `top`. */
  const bounce = (top: number, vh = 5) => {
    const b: BallState = { pos: { x: 0, y: env.tableContactY + 0.004, z: -0.8 }, vel: { x: 0, y: -2.5, z: -vh }, spin: worldSpin({ top, side: 0 }, 0, -1) };
    const contacts: BallContact[] = [];
    for (let i = 0; i < 10 && contacts.length === 0; i++) stepBall(b, dt, env, contacts, { net: false });
    const c = contacts[0];
    expect(c?.kind).toBe('table');
    return { vh: -b.vel.z, rel: relativeSpin(b.spin, b.vel), vy: b.vel.y, impact: c?.kind === 'table' ? c.impactSpeed : 0 };
  };

  it('sin spin pierde el 8 % de la velocidad horizontal, como en V0.1, y sale con algo de topspin', () => {
    const r = bounce(0);
    expect(r.vh / 5).toBeCloseTo(1 - 0.08, 2);
    expect(r.rel.top).toBeGreaterThan(0);
  });

  it('el topspin frena menos (o acelera) y el backspin frena más', () => {
    const flat = bounce(0).vh;
    expect(bounce(200).vh).toBeGreaterThan(flat);
    expect(bounce(-200).vh).toBeLessThan(flat);
  });

  it('con topspin fuerte (la superficie gira más rápido de lo que avanza la bola) acelera tras el bote', () => {
    // R·ω = 0.02·400 = 8 m/s > 5 m/s de avance.
    expect(bounce(400).vh).toBeGreaterThan(5);
  });

  it('el bote no toca la componente vertical: restitución 0.89 con cualquier spin', () => {
    for (const top of [-300, 0, 300]) {
      const r = bounce(top);
      expect(r.vy).toBeCloseTo(r.impact * cfg.ball.tableRestitution, 12);
    }
  });

  it('es determinista bit a bit con spin', () => {
    const run = () => {
      const b: BallState = { pos: { x: 0.31, y: 1.07, z: 1.52 }, vel: { x: -0.73, y: 1.31, z: -6.17 }, spin: { x: -310.5, y: 120.25, z: 33.1 } };
      for (let i = 0; i < 600; i++) stepBall(b, dt, env);
      return [b.pos, b.vel, b.spin];
    };
    expect(run()).toEqual(run());
  });
});

describe('spin relativo a la dirección de vuelo', () => {
  it('worldSpin y relativeSpin son inversas para cualquier dirección horizontal', () => {
    for (const [dx, dz] of [
      [0, -1],
      [0, 1],
      [0.6, -0.8],
      [-0.28, 0.96],
    ]) {
      const w = worldSpin({ top: 250, side: -120 }, dx, dz);
      const rel = relativeSpin(w, { x: dx * 7, y: -1, z: dz * 7 });
      expect(rel.top).toBeCloseTo(250, 9);
      expect(rel.side).toBeCloseTo(-120, 9);
    }
  });

  it('clasifica el efecto dominante para el trail', () => {
    expect(spinKind({ top: 300, side: 40 }, 60)).toBe('top');
    expect(spinKind({ top: -200, side: 40 }, 60)).toBe('back');
    expect(spinKind({ top: 90, side: -250 }, 60)).toBe('side');
    expect(spinKind({ top: 20, side: -30 }, 60)).toBe('none');
  });
});
