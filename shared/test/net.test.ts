import { describe, expect, it } from 'vitest';
import { type BallContact, type BallState, makeConfig, makeEnv, simDt, solveShot, stepBall } from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

function fly(b: BallState, maxSteps = 1500): BallContact[] {
  const contacts: BallContact[] = [];
  for (let i = 0; i < maxSteps; i++) {
    stepBall(b, dt, env, contacts);
    if (contacts.some((c) => c.kind === 'floor')) break;
  }
  return contacts;
}

describe('colisión con la red', () => {
  it('una bola baja choca con la malla y cae en el propio campo', () => {
    const b: BallState = { pos: { x: 0, y: env.tableTop + 0.08, z: 0.6 }, vel: { x: 0, y: 0.3, z: -5 }, spin: { x: 0, y: 0, z: 0 } };
    const contacts = fly(b);
    expect(contacts[0].kind).toBe('net');
    const firstTable = contacts.find((c) => c.kind === 'table');
    expect(firstTable && firstTable.kind === 'table' && firstTable.side).toBe(0);
  });

  it('una bola con margen pasa sin tocar la red', () => {
    const b: BallState = { pos: { x: 0, y: env.netTop + 0.15, z: 0.6 }, vel: { x: 0, y: 0, z: -5 }, spin: { x: 0, y: 0, z: 0 } };
    const contacts = fly(b);
    expect(contacts.some((c) => c.kind === 'net')).toBe(false);
    expect(contacts[0].kind === 'table' && contacts[0].side).toBe(1);
  });

  it('net cord: rozando la cinta por encima, la bola sigue al campo rival (válido en rally)', () => {
    const b: BallState = { pos: { x: 0, y: env.netTop + env.r * 0.9, z: 0.06 }, vel: { x: 0, y: 0, z: -5 }, spin: { x: 0, y: 0, z: 0 } };
    const contacts = fly(b);
    const net = contacts.find((c) => c.kind === 'net');
    expect(net && net.kind === 'net' && net.cord).toBe(true);
    const table = contacts.find((c) => c.kind === 'table');
    expect(table && table.kind === 'table' && table.side).toBe(1);
  });

  it('net cord: rozando la cinta por debajo de su línea, la bola vuelve a su campo', () => {
    const b: BallState = { pos: { x: 0, y: env.netTop - env.r * 0.3, z: 0.06 }, vel: { x: 0, y: 0, z: -5 }, spin: { x: 0, y: 0, z: 0 } };
    const contacts = fly(b);
    expect(contacts[0].kind).toBe('net');
    const table = contacts.find((c) => c.kind === 'table');
    expect(table && table.kind === 'table' && table.side).toBe(0);
  });

  it('por fuera de los postes no hay red', () => {
    const b: BallState = { pos: { x: 1.0, y: env.tableTop + 0.05, z: 0.3 }, vel: { x: 0, y: 0, z: -5 }, spin: { x: 0, y: 0, z: 0 } };
    expect(fly(b).some((c) => c.kind === 'net')).toBe(false);
  });

  it('el mismo tiro con margen −2 cm acaba en la red y con +3 cm pasa: la red se entiende', () => {
    const start = { x: 0.1, y: env.tableTop + 0.2, z: 1.6 };
    const throughNet = (clearance: number) => {
      const sol = solveShot(start, { landing: { x: -0.1, z: -1.0 }, clearance, serve: false }, env, dt, cfg);
      const b: BallState = { pos: { ...start }, vel: sol.vel, spin: { x: 0, y: 0, z: 0 } };
      return fly(b).some((c) => c.kind === 'net');
    };
    expect(throughNet(-0.02)).toBe(true);
    expect(throughNet(0.03)).toBe(false);
  });
});
