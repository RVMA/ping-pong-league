import { describe, expect, it } from 'vitest';
import { type BallContact, type BallState, makeConfig, makeEnv, simDt, stepBall } from '../src/index.ts';

const ball = (pos: [number, number, number], vel: [number, number, number]): BallState => ({
  pos: { x: pos[0], y: pos[1], z: pos[2] },
  vel: { x: vel[0], y: vel[1], z: vel[2] },
  spin: { x: 0, y: 0, z: 0 },
});

describe('trayectoria balística', () => {
  it('sin drag coincide con la solución analítica (error < 1 cm en 0.5 s)', () => {
    const cfg = makeConfig({ ball: { dragK: 0 } });
    const env = makeEnv(cfg);
    const b = ball([0, 2, 0.5], [0, 1, 0]);
    const dt = simDt(cfg);
    const n = Math.round(0.5 / dt);
    for (let i = 0; i < n; i++) stepBall(b, dt, env, undefined, { net: false, table: false });
    const t = n * dt;
    expect(b.pos.y).toBeCloseTo(2 + 1 * t - 0.5 * 9.81 * t * t, 2);
  });

  it('el drag acorta el alcance', () => {
    const run = (dragK: number) => {
      const cfg = makeConfig({ ball: { dragK } });
      const env = makeEnv(cfg);
      const b = ball([0, 1.5, 1.4], [0, 1, -8]);
      for (let i = 0; i < 2000 && b.pos.y > 1; i++) stepBall(b, simDt(cfg), env, undefined, { net: false, table: false });
      return -b.pos.z;
    };
    expect(run(0.12)).toBeLessThan(run(0) - 0.3);
  });

  it('gameSpeed no altera la forma de la trayectoria (bote en el mismo sitio ± 1 cm)', () => {
    const landing = (gameSpeed: number) => {
      const cfg = makeConfig({ sim: { gameSpeed } });
      const env = makeEnv(cfg);
      const b = ball([0.1, 1.0, 1.6], [-0.2, 1.2, -5.5]);
      const contacts: BallContact[] = [];
      for (let i = 0; i < 5000 && contacts.length === 0; i++) stepBall(b, simDt(cfg), env, contacts, { net: false });
      return contacts[0].pos;
    };
    const a = landing(0.6);
    const b = landing(1.0);
    expect(Math.abs(a.z - b.z)).toBeLessThan(0.01);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.01);
  });

  it('es determinista: dos simulaciones idénticas dan el mismo estado bit a bit', () => {
    const cfg = makeConfig();
    const env = makeEnv(cfg);
    const run = () => {
      const b = ball([0.31, 1.07, 1.52], [-0.73, 1.31, -6.17]);
      for (let i = 0; i < 600; i++) stepBall(b, simDt(cfg), env);
      return [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z];
    };
    expect(run()).toEqual(run());
  });
});

describe('bote en la mesa', () => {
  const cfg = makeConfig();
  const env = makeEnv(cfg);

  it('invierte la velocidad vertical con restitución 0.89 y registra el lado', () => {
    const b = ball([0.2, env.tableContactY + 0.05, -0.8], [0, -3, 0]);
    const contacts: BallContact[] = [];
    for (let i = 0; i < 20 && contacts.length === 0; i++) stepBall(b, simDt(cfg), env, contacts);
    expect(contacts).toHaveLength(1);
    const c = contacts[0];
    expect(c.kind).toBe('table');
    if (c.kind !== 'table') return;
    expect(c.side).toBe(1);
    expect(b.vel.y / c.impactSpeed).toBeCloseTo(0.89, 2);
    expect(c.pos.y).toBeCloseTo(env.tableContactY, 9);
  });

  it('la posición del bote se calcula de forma continua (sin error de un paso)', () => {
    // Bola rápida en diagonal: el bote exacto se puede calcular a mano sin drag ni gravedad apreciable.
    const cfgNoG = makeConfig({ ball: { dragK: 0, gravity: 0 } });
    const envNoG = makeEnv(cfgNoG);
    const b = ball([0, envNoG.tableContactY + 0.1, 0.5], [0, -2, -2]);
    const contacts: BallContact[] = [];
    for (let i = 0; i < 50 && contacts.length === 0; i++) stepBall(b, simDt(cfgNoG), envNoG, contacts, { net: false });
    expect(contacts[0].pos.z).toBeCloseTo(0.4, 9);
  });

  it('fuera de la mesa no bota: cae al suelo', () => {
    const b = ball([1.0, env.tableContactY + 0.05, 0.5], [0, -2, 0]);
    const contacts: BallContact[] = [];
    for (let i = 0; i < 200 && contacts.length === 0; i++) stepBall(b, simDt(cfg), env, contacts);
    expect(contacts[0].kind).toBe('floor');
  });
});
