import { describe, expect, it } from 'vitest';
import {
  applyContact,
  type BallContact,
  checkStrike,
  DEFAULT_CONFIG,
  isGameOver,
  newRally,
  type RallyState,
  registerStrike,
  serverFor,
  type Side,
} from '../src/index.ts';

const rules = DEFAULT_CONFIG.rules;
const table = (side: Side): BallContact => ({ kind: 'table', side, pos: { x: 0, y: 0.78, z: side === 0 ? 1 : -1 }, impactSpeed: 2 });
const net: BallContact = { kind: 'net', cord: false, fromSide: 0, pos: { x: 0, y: 0.85, z: 0.02 } };
const floor: BallContact = { kind: 'floor', pos: { x: 0, y: 0.02, z: -3 } };

function served(by: Side): RallyState {
  const r = newRally();
  registerStrike(r, by, true);
  return r;
}
function rallyHitBy(by: Side): RallyState {
  const r = newRally();
  registerStrike(r, by, false);
  return r;
}

describe('marcador de un game a 11', () => {
  it('gana quien llega a 11 con 2 de diferencia', () => {
    expect(isGameOver([11, 9], rules)).toBe(0);
    expect(isGameOver([5, 11], rules)).toBe(1);
    expect(isGameOver([11, 10], rules)).toBeNull();
    expect(isGameOver([10, 10], rules)).toBeNull();
    expect(isGameOver([12, 10], rules)).toBe(0);
    expect(isGameOver([14, 15], rules)).toBeNull();
    expect(isGameOver([14, 16], rules)).toBe(1);
  });

  it('el saque cambia cada 2 puntos y desde 10-10 cada punto', () => {
    const seq: Side[] = [];
    for (let p = 0; p < 8; p++) seq.push(serverFor([Math.ceil(p / 2), Math.floor(p / 2)], 0, rules));
    expect(seq).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    expect(serverFor([10, 10], 0, rules)).toBe(0);
    expect(serverFor([11, 10], 0, rules)).toBe(1);
    expect(serverFor([11, 11], 0, rules)).toBe(0);
    expect(serverFor([12, 11], 0, rules)).toBe(1);
    expect(serverFor([10, 10], 1, rules)).toBe(1);
  });

  it('con 10-9 todavía se alterna cada 2', () => {
    // 19 puntos jugados → turno 9 → saca el segundo.
    expect(serverFor([10, 9], 0, rules)).toBe(1);
  });
});

describe('reglas del rally', () => {
  it('bote en el rival y luego el rival no devuelve → punto para quien golpeó', () => {
    const r = rallyHitBy(0);
    expect(applyContact(r, table(1))).toBeNull();
    expect(applyContact(r, floor)).toEqual({ kind: 'point', winner: 0, reason: 'MISSED' });
  });

  it('doble bote en el campo del receptor', () => {
    const r = rallyHitBy(0);
    applyContact(r, table(1));
    expect(applyContact(r, table(1))).toEqual({ kind: 'point', winner: 0, reason: 'DOUBLE_BOUNCE' });
  });

  it('bola fuera (no bota en el campo rival)', () => {
    expect(applyContact(rallyHitBy(1), floor)).toEqual({ kind: 'point', winner: 0, reason: 'OUT' });
  });

  it('red: la bola toca la red y cae en el propio campo → punto para el rival con motivo NET', () => {
    const r = rallyHitBy(0);
    expect(applyContact(r, net)).toBeNull();
    expect(applyContact(r, table(0))).toEqual({ kind: 'point', winner: 1, reason: 'NET' });
  });

  it('net cord en el rally es válido si pasa', () => {
    const r = rallyHitBy(0);
    applyContact(r, net);
    expect(applyContact(r, table(1))).toBeNull();
    expect(checkStrike(r, 1)).toBeNull();
  });

  it('volea: golpear antes de que bote en tu campo → punto para el rival', () => {
    const r = rallyHitBy(0);
    expect(checkStrike(r, 1)).toEqual({ kind: 'point', winner: 0, reason: 'VOLLEY' });
  });

  it('golpe válido tras un bote', () => {
    const r = rallyHitBy(0);
    applyContact(r, table(1));
    expect(checkStrike(r, 1)).toBeNull();
  });
});

describe('reglas del saque', () => {
  it('saque válido: bota en tu campo y luego en el rival', () => {
    const r = served(0);
    expect(applyContact(r, table(0))).toBeNull();
    expect(applyContact(r, table(1))).toBeNull();
    expect(checkStrike(r, 1)).toBeNull();
  });

  it('saque que bota directamente en el rival → falta', () => {
    expect(applyContact(served(0), table(1))).toEqual({ kind: 'point', winner: 1, reason: 'SERVE_FAULT' });
  });

  it('let: el saque toca la red y entra → se repite', () => {
    const r = served(0);
    applyContact(r, table(0));
    applyContact(r, net);
    expect(applyContact(r, table(1))).toEqual({ kind: 'let' });
  });

  it('el saque toca la red y no entra → punto para el rival (NET)', () => {
    const r = served(0);
    applyContact(r, table(0));
    applyContact(r, net);
    expect(applyContact(r, table(0))).toEqual({ kind: 'point', winner: 1, reason: 'NET' });
  });

  it('el receptor no puede golpear el saque antes de que bote en su campo', () => {
    const r = served(0);
    applyContact(r, table(0));
    expect(checkStrike(r, 1)).toEqual({ kind: 'point', winner: 0, reason: 'VOLLEY' });
  });
});
