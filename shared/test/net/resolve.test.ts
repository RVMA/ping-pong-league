import { describe, expect, it } from 'vitest';
import { makeConfig, simDt, tickMs } from '../../src/config.ts';
import { type BallState, makeEnv } from '../../src/physics.ts';
import { newRally, registerStrike } from '../../src/rules.ts';
import { Flight } from '../../src/net/flight.ts';
import type { HitInput } from '../../src/net/protocol.ts';
import { resolveHit } from '../../src/net/resolve.ts';
import { type TracedClick, traceLocalMatch, type TracedFlight } from './local-trace.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);
const tick = tickMs(cfg);
const traced: TracedFlight[] = traceLocalMatch(cfg, [7, 8], 120 * 200);

function input(tf: TracedFlight, c: TracedClick): HitInput {
  return {
    t: c.fire - tf.tick0 * tick,
    pad: c.pad,
    swingVx: c.intent.swing.vx,
    keys: c.intent.modifiers ?? {},
    block: c.intent.block,
    speeds: c.speeds,
    ref: c.ref,
  };
}

describe('resolución del golpe sobre un vuelo = Simulation.handleClick + applyHit', () => {
  it('cada golpe del partido local sale igual: calidad, tipo, potencia, contacto y estado de salida', () => {
    let n = 0;
    for (const tf of traced) {
      const end = tf.end;
      if (!end || end.kind !== 'hit') continue;
      const f = new Flight(cfg, env, tf.exit, tf.mode, tf.hitter, tf.rally);
      const c = [...tf.clicks].reverse().find((k) => k.swing && k.side === end.player)!;
      const r = resolveHit(f, c.side, input(tf, c), cfg, env, dt);
      expect(r.kind).toBe('hit');
      if (r.kind !== 'hit') continue;
      const h = r.hit;
      expect(h.j).toBe(end.j);
      expect(h.late).toBe(false);
      expect(h.foul).toBeNull();
      expect(h.evaluation.tier).toBe(c.swing!.evaluation.tier);
      expect(h.shot).toBe(c.swing!.shot);
      expect(h.power).toBeCloseTo(c.swing!.power, 12);
      expect(h.aimFactor).toBeCloseTo(c.swing!.aimFactor, 12);
      const ex = h.exit!;
      const want = end.next.exit;
      for (const [a, b] of [
        [ex.pos.x, want.pos.x],
        [ex.pos.y, want.pos.y],
        [ex.pos.z, want.pos.z],
        [ex.vel.x, want.vel.x],
        [ex.vel.y, want.vel.y],
        [ex.vel.z, want.vel.z],
        [ex.spin.x, want.spin.x],
        [ex.spin.y, want.spin.y],
        [ex.spin.z, want.spin.z],
      ])
        expect(Math.abs(a - b)).toBeLessThan(1e-9);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(80);
  });

  it('un click sobre tu propia bola es un fallo sin bola', () => {
    const tf = traced.find((t) => t.mode === 'rally')!;
    const f = new Flight(cfg, env, tf.exit, 'rally', tf.hitter, tf.rally);
    const r = resolveHit(f, tf.hitter, { t: 100, pad: { x: 0, z: 1.6 * (tf.hitter === 0 ? 1 : -1) }, swingVx: 0, keys: {}, block: false, speeds: [], ref: null }, cfg, env, dt);
    expect(r).toEqual({ kind: 'whiff', evaluation: null });
  });

  it('golpear antes del bote en tu campo es volea', () => {
    const tf = traced.find((t) => t.mode === 'rally' && t.end?.kind === 'hit' && !t.rally.isServe)!;
    const f = new Flight(cfg, env, tf.exit, 'rally', tf.hitter, tf.rally);
    const sgn = f.receiver === 0 ? 1 : -1;
    let i = 1;
    while (!(f.z(i) * sgn > 0.8)) i++;
    expect(f.rallyBefore(i).bounces).toEqual([]);
    const r = resolveHit(f, f.receiver, { t: i * tick, pad: { x: f.x(i), z: f.z(i) }, swingVx: 0, keys: {}, block: false, speeds: [], ref: null }, cfg, env, dt);
    expect(r.kind).toBe('hit');
    if (r.kind === 'hit') expect(r.hit.foul).toEqual({ kind: 'point', winner: tf.hitter, reason: 'VOLLEY' });
  });

  it('si el contacto llega después del desenlace, el golpe no cuenta (late)', () => {
    const rally = newRally();
    registerStrike(rally, 0, false);
    // Bola corta y lenta: bota dos veces en el campo rival (doble bote).
    const exit: BallState = { pos: { x: 0, y: 0.95, z: 0.5 }, vel: { x: 0, y: 1.2, z: -2.6 }, spin: { x: 0, y: 0, z: 0 } };
    const f = new Flight(cfg, env, exit, 'rally', 0, rally);
    expect(f.end.outcome).toEqual({ kind: 'point', winner: 0, reason: 'DOUBLE_BOUNCE' });
    const k = f.end.i + 2;
    const r = resolveHit(f, 1, { t: k * tick - 50, pad: { x: f.x(k), z: f.z(k) }, swingVx: 0, keys: {}, block: false, speeds: [], ref: null }, cfg, env, dt);
    expect(r.kind).toBe('hit');
    if (r.kind === 'hit') {
      expect(r.hit.late).toBe(true);
      expect(r.hit.exit).toBeNull();
    }
  });
});
