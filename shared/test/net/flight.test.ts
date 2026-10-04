import { describe, expect, it } from 'vitest';
import { aimFactorFromSpeeds, evaluateClickSamples, fixedHitPos } from '../../src/click.ts';
import { makeConfig, tickMs } from '../../src/config.ts';
import { type BallState, makeEnv } from '../../src/physics.ts';
import { newRally, registerStrike } from '../../src/rules.ts';
import { contactIndex, evalTick, Flight } from '../../src/net/flight.ts';
import { traceLocalMatch, type TracedFlight } from './local-trace.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const tick = tickMs(cfg);
const traced: TracedFlight[] = [...traceLocalMatch(cfg, [7, 8], 120 * 200), ...traceLocalMatch(cfg, [21, 22], 120 * 200)];

function sameBits(a: BallState, b: BallState): boolean {
  const pa = [a.pos.x, a.pos.y, a.pos.z, a.vel.x, a.vel.y, a.vel.z, a.spin.x, a.spin.y, a.spin.z];
  const pb = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin.x, b.spin.y, b.spin.z];
  return pa.every((v, i) => Object.is(v, pb[i]));
}

function build(tf: TracedFlight): Flight {
  return new Flight(cfg, env, tf.exit, tf.mode, tf.hitter, tf.rally);
}

describe('vuelo: la misma trayectoria que la simulación local, bit a bit [§17.6]', () => {
  it('estados y contactos de cada paso, en golpes y saques', () => {
    let rally = 0;
    let toss = 0;
    const out: BallState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
    for (const tf of traced) {
      const f = build(tf);
      for (let k = 0; k < tf.states.length; k++) {
        if (!tf.states[k]) continue;
        expect(sameBits(f.readState(k, out), tf.states[k]), `vuelo ${tf.mode} paso ${k}`).toBe(true);
        const mine = f.contactsAt(k).map((c) => [c.kind, c.pos.x, c.pos.y, c.pos.z]);
        const local = (tf.contacts[k] ?? []).map((c) => [c.kind, c.pos.x, c.pos.y, c.pos.z]);
        expect(mine).toEqual(local);
      }
      if (tf.mode === 'toss') toss++;
      else rally++;
    }
    expect(rally).toBeGreaterThanOrEqual(150);
    expect(toss).toBeGreaterThanOrEqual(20);
  });

  it('el desenlace sin golpe es el punto local, en el mismo paso', () => {
    let checked = 0;
    for (const tf of traced) {
      const f = build(tf);
      const end = tf.end;
      if (!end) continue;
      if (end.kind === 'hit') {
        expect(end.j).toBeLessThan(f.end.i);
        continue;
      }
      if (end.kind === 'point' && end.reason === 'VOLLEY') continue;
      expect(f.end.i).toBe(end.k);
      if (end.kind === 'let') expect(f.end.outcome.kind).toBe('let');
      else expect(f.end.outcome).toEqual({ kind: 'point', winner: end.winner, reason: end.reason });
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });
});

describe('ticks del click y del contacto', () => {
  it('el click se evalúa en el primer tick que no es anterior a él', () => {
    expect(evalTick(25, tick)).toBe(3);
    expect(evalTick(3 * tick, tick)).toBe(3);
    expect(evalTick(25.001, tick)).toBe(4);
    expect(evalTick(0.5, tick)).toBe(1);
  });
  it('el contacto usa el estado anterior a ese tick (como Simulation.applyHit)', () => {
    expect(contactIndex(16.67, tick)).toBe(2);
    expect(contactIndex(2 * tick, tick)).toBe(1);
  });
});

describe('evaluación de los clicks reales del partido sobre el vuelo', () => {
  it('misma calidad y causas que en local, Δt y posición a menos de 1e-9', () => {
    let n = 0;
    for (const tf of traced) {
      const f = build(tf);
      for (const c of tf.clicks) {
        const ev = c.swing?.evaluation ?? c.whiff?.evaluation;
        if (!ev || c.side !== f.receiver) continue;
        const fire = c.fire - tf.tick0 * tick;
        const block = c.intent.block && tf.mode !== 'toss';
        const aim = block ? 0 : aimFactorFromSpeeds(c.speeds, cfg);
        const pos = fixedHitPos(c.pad, c.ref, c.intent.swing.vx * aim, aim, cfg);
        const mine = evaluateClickSamples(f.clickSamples(fire), c.side, fire, pos, tf.mode === 'toss', cfg, env)!;
        expect(mine.tier).toBe(ev.tier);
        expect(mine.timingTier).toBe(ev.timingTier);
        expect(mine.positionTier).toBe(ev.positionTier);
        expect(mine.causes).toEqual(ev.causes);
        expect(Math.abs(mine.dtMs - ev.dtMs)).toBeLessThan(1e-9);
        expect(Math.abs(mine.posFrac - ev.posFrac)).toBeLessThan(1e-9);
        expect(Math.abs(mine.tIdeal + tf.tick0 * tick - ev.tIdeal)).toBeLessThan(1e-9);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(150);
  });
});

describe('quién puede cambiar el desenlace', () => {
  const rally = newRally();
  registerStrike(rally, 0, false);
  it('una bola a la red que cae en tu campo es un desenlace seguro', () => {
    const exit: BallState = { pos: { x: 0, y: 0.86, z: 0.4 }, vel: { x: 0, y: 0, z: -4 }, spin: { x: 0, y: 0, z: 0 } };
    const f = new Flight(cfg, env, exit, 'rally', 0, rally);
    expect(f.end.outcome).toEqual({ kind: 'point', winner: 1, reason: 'NET' });
    expect(f.certain).toBe(true);
    expect(f.expectedContact(1.6)).toBe(-1);
  });
  it('una bola que bota en el campo rival no es segura y tiene contacto esperado tras el bote', () => {
    const tf = traced.find((t) => t.mode === 'rally' && t.end?.kind === 'hit')!;
    const f = build(tf);
    expect(f.certain).toBe(false);
    const i = f.expectedContact(1.6);
    expect(i).toBeGreaterThan(0);
    const sgn = f.receiver === 0 ? 1 : -1;
    expect(f.z(i) * sgn).toBeGreaterThanOrEqual(1.6);
    const bounce = [...Array(i).keys()].some((k) => f.contactsAt(k).some((c) => c.kind === 'table' && c.side === f.receiver));
    expect(bounce).toBe(true);
  });
});
