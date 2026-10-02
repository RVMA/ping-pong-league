import { describe, expect, it } from 'vitest';
import {
  type BallContact,
  type BallState,
  classifyHit,
  makeConfig,
  makeEnv,
  neutralIntent,
  planShot,
  predictPath,
  simDt,
  Simulation,
  type SimEvent,
  solveShot,
  stepBall,
  type Vec3,
  worldSpin,
} from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

const evalAt = (dtMs: number, posFrac = 0.05) =>
  classifyHit({ dtMs, posFrac, lateral: 0.007, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, cfg.hit);

/** Bola que llega al lado 0 (+z) con velocidad horizontal `vh` y spin relativo a su vuelo. */
const incoming = (vh: number, top = 0, side = 0) => ({ vel: { x: 0, y: -0.5, z: vh }, spin: worldSpin({ top, side }, 0, 1) });
const contact: Vec3 = { x: 0.1, y: env.tableTop + 0.22, z: 1.6 };

function block(dtMs: number, inc: ReturnType<typeof incoming>, at: Vec3 = contact, posFrac = 0.05) {
  const targets = planShot(evalAt(dtMs, posFrac), at, { swing: { vx: 3, vy: 3 } }, 0, cfg, false, { block: true, incoming: inc });
  const sol = solveShot(at, targets, env, dt, cfg);
  const b: BallState = { pos: { ...at }, vel: { ...sol.vel }, spin: { ...targets.spin } };
  const contacts: BallContact[] = [];
  for (let i = 0; i < 1500 && !contacts.some((c) => c.kind !== 'net'); i++) stepBall(b, dt, env, contacts);
  const first = contacts.find((c) => c.kind !== 'net');
  const valid = !!first && first.kind === 'table' && first.side === 1;
  return { targets, speed: Math.hypot(sol.vel.x, sol.vel.z), valid, net: !valid && contacts.some((c) => c.kind === 'net') };
}

describe('bloqueo (Space) [§8]', () => {
  it('sin gesto ni tipo de golpe: sale recto y sin potencia propia, aunque haya gesto', () => {
    const r = block(0, incoming(7)).targets;
    expect(r.type).toBe('BLOCK');
    expect(r.power).toBe(0);
    expect(r.aim).toBe(0);
    expect(r.landing.x).toBeCloseTo(contact.x * cfg.shot.aimBaseFromContact + r.parts.lateral.edge!, 9);
  });

  it('devuelve con la energía de la bola entrante: más rápida llega, más rápida sale', () => {
    const slow = block(0, incoming(5));
    const fast = block(0, incoming(10));
    expect(slow.valid && fast.valid).toBe(true);
    expect(fast.speed).toBeGreaterThan(slow.speed * 1.3);
  });

  it('contra una bola lenta devuelve una bola alta y fácil', () => {
    expect(block(0, incoming(4)).targets.clearance).toBeGreaterThan(0.25);
  });

  it('un bloqueo PERFECT reduce la velocidad recibida más que uno GOOD (mismo Δt, GOOD por posición)', () => {
    const perfect = block(0, incoming(9));
    const good = block(0, incoming(9), contact, 0.3);
    expect(good.targets.parts.clearance.timing).toBe(perfect.targets.parts.clearance.timing);
    expect(perfect.speed).toBeLessThan(good.speed);
  });

  it('un bloqueo PERFECT devuelve parte del spin invertido: el topspin vuelve como backspin', () => {
    const r = block(0, incoming(8, 400, 120)).targets;
    expect(r.spinRel.top).toBeCloseTo(-400 * cfg.block.spinInvert, 6);
    expect(r.spinRel.side).toBeCloseTo(-120 * cfg.block.spinInvert, 6);
    expect(Math.abs(block(0, incoming(8, 400), contact, 0.3).targets.spinRel.top)).toBe(0);
  });

  it('sin PERFECT el spin entrante no se absorbe: el topspin la levanta y alarga, el backspin la hunde', () => {
    const flat = block(80, incoming(7)).targets;
    const top = block(80, incoming(7, 400)).targets;
    const back = block(80, incoming(7, -300)).targets;
    expect(top.clearance).toBeGreaterThan(flat.clearance + 0.05);
    expect(top.parts.depth.blockSpin!).toBeGreaterThan(0.1);
    expect(back.clearance).toBeLessThan(flat.clearance - 0.03);
    expect(top.parts.clearance.blockSpin!).toBeGreaterThan(0);
    expect(back.parts.clearance.blockSpin!).toBeLessThan(0);
  });

  it('pronto: más corto → red; tarde: más alto y más lento', () => {
    expect(block(-110, incoming(7)).net).toBe(true);
    const perfect = block(0, incoming(7));
    const late = block(90, incoming(7));
    expect(late.valid).toBe(true);
    expect(late.targets.clearance).toBeGreaterThan(perfect.targets.clearance);
    expect(late.speed).toBeLessThan(perfect.speed);
  });
});

describe('bloqueo en la simulación', () => {
  it('mientras se mantiene Space, la raqueta va al 50 % de su velocidad máxima', () => {
    const top = (block: boolean) => {
      const sim = new Simulation(makeConfig());
      sim.state.phase = 'rally';
      let vmax = 0;
      for (let i = 0; i < 90; i++) {
        const intent = neutralIntent(1.6);
        intent.target.x = i < 1 ? 0 : 1.3;
        intent.block = block;
        sim.step([intent, neutralIntent()]);
        vmax = Math.max(vmax, Math.hypot(sim.state.paddles[0].vel.x, sim.state.paddles[0].vel.z));
      }
      return vmax;
    };
    expect(top(false)).toBeCloseTo(cfg.paddle.maxSpeed, 6);
    expect(top(true)).toBeCloseTo(cfg.paddle.maxSpeed * cfg.block.paddleSpeedFactor, 6);
  });

  it('usa la misma medición de timing y posición que el golpe, y la bola sale como bloqueo', () => {
    const run = (blockHeld: boolean) => {
      const sim = new Simulation(makeConfig());
      sim.state.phase = 'rally';
      sim.state.rally = { lastHitter: null, isServe: false, bounces: [], netTouched: false, hits: 0 };
      for (let i = 0; i < 64; i++) sim.step([neutralIntent(1.6), neutralIntent()]);
      sim.state.rally = { lastHitter: 1, isServe: false, bounces: [], netTouched: false, hits: 1 };
      sim.state.ball = { pos: { x: 0.03, y: env.tableTop + 0.25, z: 0.2 }, vel: { x: 0, y: 0.6, z: 4.2 }, spin: worldSpin({ top: 300, side: 0 }, 0, 1) };
      const path = predictPath(sim.state.ball, sim.env, sim.dt, sim.tickMs, sim.now, 1500);
      const k = path.findIndex((q, i) => i > 0 && path[i - 1].pos.z < 1.6 && q.pos.z >= 1.6);
      const tClick = path[k].t - 20;
      const evs: SimEvent[] = [];
      for (let i = 0; i < 400 && !evs.some((e) => e.type === 'hit'); i++) {
        const intent = neutralIntent(1.6);
        intent.block = blockHeld;
        if (sim.now + sim.tickMs >= tClick && !evs.some((e) => e.type === 'swing')) intent.fire = tClick;
        evs.push(...sim.step([intent, neutralIntent()]));
      }
      const swing = evs.find((e): e is Extract<SimEvent, { type: 'swing' }> => e.type === 'swing')!;
      const hit = evs.find((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit')!;
      return { swing, hit };
    };
    const normal = run(false);
    const blocked = run(true);
    expect(blocked.swing.evaluation.dtMs).toBeCloseTo(normal.swing.evaluation.dtMs, 9);
    expect(blocked.swing.evaluation.posFrac).toBeCloseTo(normal.swing.evaluation.posFrac, 9);
    expect(blocked.swing.shot).toBe('BLOCK');
    expect(blocked.hit.targets.type).toBe('BLOCK');
    expect(blocked.hit.incoming.spin.x).toBeGreaterThan(0); // llegaba con topspin (lado 1 → lado 0)
    expect(blocked.hit.serve).toBe(false);
    expect(blocked.hit.player).toBe(0);
  });
});
