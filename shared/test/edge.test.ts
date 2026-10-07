import { describe, expect, it } from 'vitest';
import {
  applyContact,
  type BallContact,
  type BallState,
  makeConfig,
  makeEnv,
  newRally,
  registerStrike,
  SIDE_TEXT,
  simDt,
  stepBall,
} from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);
const hw = env.halfWidth;
const hl = env.halfLength;
const top = env.tableTop;
const r = env.r;

const ball = (pos: [number, number, number], vel: [number, number, number]): BallState => ({
  pos: { x: pos[0], y: pos[1], z: pos[2] },
  vel: { x: vel[0], y: vel[1], z: vel[2] },
  spin: { x: 0, y: 0, z: 0 },
});

/** Avanza hasta el primer contacto (máx. 600 pasos) con la red desactivada para aislar la mesa. */
function run(b: BallState, steps = 600): BallContact[] {
  const contacts: BallContact[] = [];
  for (let i = 0; i < steps && contacts.length === 0; i++) stepBall(b, dt, env, contacts, { net: false });
  return contacts;
}

describe('bola de canto: aristas y esquinas de la mesa [§7.4]', () => {
  it('(a) cae sobre la arista lateral con el centro 1 cm fuera: bote válido con edge, hacia fuera y arriba', () => {
    const b = ball([hw + 0.01, top + 0.3, 0.8], [0, -3, 0]);
    const cs = run(b);
    expect(cs).toHaveLength(1);
    const c = cs[0];
    expect(c.kind).toBe('table');
    if (c.kind !== 'table') return;
    expect(c.edge).toBe(true);
    expect(c.side).toBe(0); // z > 0
    expect(b.vel.x).toBeGreaterThan(0); // hacia fuera
    expect(b.vel.y).toBeGreaterThan(0); // arriba
  });

  it('(a2) arista de fondo: campo del lado 1 por el signo de z', () => {
    const b = ball([0.2, top + 0.3, -(hl + 0.01)], [0, -3, 0]);
    const c = run(b)[0];
    expect(c.kind === 'table' && c.edge === true && c.side === 1).toBe(true);
    expect(b.vel.z).toBeLessThan(0);
  });

  it('(b) llega en horizontal por debajo de la arista (1 cm bajo; con r = 2 cm, 2 cm bajo sería tangente): lateral (bola muerta)', () => {
    const b = ball([hw + 0.06, top - 0.01, 0.8], [-4, 0, 0]);
    const cs = run(b);
    expect(cs).toHaveLength(1);
    expect(cs[0].kind).toBe('side');
    expect(b.vel.x).toBeGreaterThan(0); // rebota hacia fuera
  });

  it('(c) pasa a 1.5 r de la arista: sin contacto', () => {
    const b = ball([hw + 1.5 * r, top + 0.3, 0.8], [0, -3, 0]);
    // Cae por fuera de la mesa: solo puede acabar en el suelo.
    const cs = run(b);
    expect(cs.every((c) => c.kind === 'floor')).toBe(true);
  });

  it('(d) esquina: cae en diagonal sobre (hw, tableTop, hl) desde fuera', () => {
    const b = ball([hw + 0.008, top + 0.3, hl + 0.008], [-0.05, -3, -0.05]);
    const cs = run(b);
    expect(cs).toHaveLength(1);
    const c = cs[0];
    expect(c.kind === 'table' && c.edge === true && c.side === 0).toBe(true);
    expect(b.vel.x).toBeGreaterThan(0); // empujada hacia fuera de la esquina en x y en z
    expect(b.vel.z).toBeGreaterThan(0);
  });

  it('el spin no cambia en el contacto (solo el decaimiento del aire)', () => {
    const b = ball([hw, top + 0.3, 0.8], [0, -3, 0]);
    b.spin = { x: 10, y: 20, z: 30 };
    const c = run(b)[0];
    expect(c.kind).toBe('table');
    for (const [got, want] of [[b.spin.x, 10], [b.spin.y, 20], [b.spin.z, 30]]) expect(Math.abs(got / want - 1)).toBeLessThan(0.05);
  });

  it('sin mesa o con mesa infinita no hay aristas', () => {
    const a = ball([hw + 0.01, top + 0.3, 0.8], [0, -3, 0]);
    const contacts: BallContact[] = [];
    for (let i = 0; i < 300; i++) stepBall(a, dt, env, contacts, { net: false, table: false });
    expect(contacts.every((c) => c.kind === 'floor')).toBe(true);
    const bb = ball([hw + 0.01, top + 0.3, 0.8], [0, -3, 0]);
    const contacts2: BallContact[] = [];
    for (let i = 0; i < 300; i++) stepBall(bb, dt, env, contacts2, { net: false, infiniteTable: true });
    expect(contacts2.some((c) => c.kind === 'table' && c.edge)).toBe(false);
  });
});

describe('reglas con aristas', () => {
  const edge = (side: 0 | 1): BallContact => ({ kind: 'table', side, pos: { x: hw, y: top + r, z: side === 0 ? 1 : -1 }, impactSpeed: 2, edge: true });
  const sideHit: BallContact = { kind: 'side', pos: { x: hw + 0.02, y: top - 0.02, z: -1 } };

  it('(e) un canto en el campo del rival tras mi golpe es bote válido: el rally sigue', () => {
    const rl = newRally();
    registerStrike(rl, 0, false);
    expect(applyContact(rl, edge(1))).toBeNull();
    expect(rl.bounces).toEqual([1]);
  });

  it('(e) lateral antes de botar: punto del rival con SIDE', () => {
    const rl = newRally();
    registerStrike(rl, 0, false);
    expect(applyContact(rl, sideHit)).toEqual({ kind: 'point', winner: 1, reason: 'SIDE' });
  });

  it('(e) lateral después del bote válido: punto del que golpeó (MISSED, como el suelo)', () => {
    const rl = newRally();
    registerStrike(rl, 0, false);
    applyContact(rl, edge(1));
    expect(applyContact(rl, sideHit)).toEqual({ kind: 'point', winner: 0, reason: 'MISSED' });
  });

  it('(e) saque: lateral antes de los dos botes es falta del que saca', () => {
    const rl = newRally();
    registerStrike(rl, 0, true);
    expect(applyContact(rl, sideHit)).toEqual({ kind: 'point', winner: 1, reason: 'SIDE' });
  });
});

describe('determinismo', () => {
  it('(f) misma trayectoria bit a bit en dos ejecuciones con un contacto de canto', () => {
    const trace = () => {
      const b = ball([hw + 0.004, top + 0.4, 0.3], [0.5, -2.5, 1.1]);
      b.spin = { x: 40, y: -15, z: 22 };
      const out: number[] = [];
      for (let i = 0; i < 300; i++) {
        stepBall(b, dt, env, undefined, { net: false });
        out.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z);
      }
      return out;
    };
    const a = trace();
    const c = trace();
    expect(a.length).toBe(c.length);
    for (let i = 0; i < a.length; i++) expect(Object.is(a[i], c[i])).toBe(true);
    expect(a.some((v) => !Number.isFinite(v))).toBe(false);
  });
});

describe('why', () => {
  it('(g) el punto SIDE da el texto del lateral', () => {
    expect(SIDE_TEXT).toBe('Lateral. La bola tocó el lateral de la mesa, no la superficie.');
  });
});
