import { describe, expect, it } from 'vitest';
import {
  type BallContact,
  type BallState,
  classifyHit,
  describeStroke,
  type InputIntent,
  makeConfig,
  makeEnv,
  neutralIntent,
  planShot,
  powerLevel,
  predictPath,
  type ShotKeys,
  shotFromKeys,
  simDt,
  Simulation,
  type SimEvent,
  solveShot,
  stepBall,
  type StrokeType,
  strokePower,
  type Vec3,
} from '../src/index.ts';

// V0.2b (decisión del autor, 2026-10-02): el tipo de golpe se elige con teclas mantenidas al hacer click
// (W topspin, S slice, E smash) y la potencia sale de la calidad del golpe, no de la velocidad de un gesto.

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

const evalAt = (dtMs: number, posFrac = 0.05, lateral = 0.007) =>
  classifyHit({ dtMs, posFrac, lateral, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, cfg.hit);

const still = { vx: 0, vy: 0 };
const top = (h: number, z = 1.6, x = 0): Vec3 => ({ x, y: env.tableTop + h, z });
const aboveTape = (above: number, z = 1.6): Vec3 => ({ x: 0, y: env.netTop + env.r + above, z });

/** Planifica, resuelve y vuela un golpe del lado 0 (con red). */
function shoot(ev: ReturnType<typeof evalAt>, type: StrokeType, contact: Vec3, aimFactor = 1, swing = still) {
  const targets = planShot(ev, contact, { swing, type, aimFactor }, 0, cfg, false);
  const sol = solveShot(contact, targets, env, dt, cfg);
  const b: BallState = { pos: { ...contact }, vel: { ...sol.vel }, spin: { ...targets.spin } };
  const contacts: BallContact[] = [];
  for (let i = 0; i < 1500 && !contacts.some((c) => c.kind !== 'net'); i++) stepBall(b, dt, env, contacts);
  const first = contacts.find((c) => c.kind !== 'net');
  const valid = !!first && first.kind === 'table' && first.side === 1;
  return { targets, valid, first, net: contacts.some((c) => c.kind === 'net') && !valid, speed: Math.hypot(sol.vel.x, sol.vel.z) };
}

/**
 * Click del lado 0 en la simulación: bola entrante que ya botó en su campo y llega a (0, 1.6). `chase`: la raqueta
 * llega corriendo desde x = −0.7. `keys` y `block` se mantienen en el tick del click (y antes, con `holdMs`).
 */
function clickWith(opts: { keys?: ShotKeys; block?: boolean; chase?: boolean; swing?: { vx: number; vy: number }; holdMs?: number }) {
  const sim = new Simulation(makeConfig());
  sim.state.phase = 'rally';
  sim.state.rally = { lastHitter: null, isServe: false, bounces: [], netTouched: false, hits: 0 };
  const start = opts.chase ? -0.7 : 0;
  const at = (x: number): InputIntent => {
    const i = neutralIntent(1.6);
    i.target.x = x;
    return i;
  };
  for (let i = 0; i < 64; i++) sim.step([at(start), neutralIntent()]);
  sim.state.rally = { lastHitter: 1, isServe: false, bounces: [], netTouched: false, hits: 1 };
  sim.state.ball = { pos: { x: 0, y: env.tableTop + 0.25, z: 0.2 }, vel: { x: 0, y: 0.6, z: 4.2 }, spin: { x: 0, y: 0, z: 0 } };
  const path = predictPath(sim.state.ball, sim.env, sim.dt, sim.tickMs, sim.now, 1500);
  const k = path.findIndex((q, i) => i > 0 && path[i - 1].pos.z < 1.6 && q.pos.z >= 1.6);
  const tIdeal = path[k - 1].t + ((1.6 - path[k - 1].pos.z) / (path[k].pos.z - path[k - 1].pos.z)) * (path[k].t - path[k - 1].t);
  const hold = opts.holdMs ?? 300;
  while (sim.now + sim.tickMs < tIdeal) {
    const intent = at(opts.chase && sim.now > tIdeal - 330 ? 0 : start);
    if (sim.now > tIdeal - hold) {
      intent.modifiers = opts.keys;
      intent.block = !!opts.block;
    }
    sim.step([intent, neutralIntent()]);
  }
  const intent = at(0);
  intent.swing = opts.swing ?? still;
  intent.modifiers = opts.keys;
  intent.block = !!opts.block;
  intent.fire = tIdeal;
  const events: SimEvent[] = [];
  events.push(...sim.step([intent, neutralIntent()]));
  for (let i = 0; i < 40 && !events.some((e) => e.type === 'hit'); i++) events.push(...sim.step([at(0), neutralIntent()]));
  const swingEv = events.find((e): e is Extract<SimEvent, { type: 'swing' }> => e.type === 'swing');
  const hitEv = events.find((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit');
  return { sim, swing: swingEv, hit: hitEv };
}

describe('teclas → tipo de golpe (V0.2b)', () => {
  it.each([
    [undefined, 'NORMAL'],
    [{}, 'NORMAL'],
    [{ topspin: false, slice: false, smash: false }, 'NORMAL'],
    [{ topspin: true }, 'TOPSPIN'],
    [{ slice: true }, 'SLICE'],
    [{ smash: true }, 'SMASH'],
  ] as [ShotKeys | undefined, StrokeType][])('%o → %s', (keys, type) => {
    expect(shotFromKeys(keys)).toBe(type);
  });

  it('con varias teclas a la vez manda una prioridad fija: smash > topspin > slice', () => {
    expect(shotFromKeys({ topspin: true, smash: true })).toBe('SMASH');
    expect(shotFromKeys({ slice: true, smash: true })).toBe('SMASH');
    expect(shotFromKeys({ topspin: true, slice: true })).toBe('TOPSPIN');
  });

  it('en la simulación, la tecla mantenida en el instante del click elige el golpe', () => {
    for (const [keys, type] of [
      [{ topspin: true }, 'TOPSPIN'],
      [{ slice: true }, 'SLICE'],
      [{ smash: true }, 'SMASH'],
      [{}, 'NORMAL'],
    ] as [ShotKeys, StrokeType][]) {
      const { swing, hit } = clickWith({ keys });
      expect(swing?.shot, JSON.stringify(keys)).toBe(type);
      expect(hit?.targets.type).toBe(type);
    }
  });

  it('si la tecla se suelta antes del click, el golpe es normal', () => {
    const { swing } = clickWith({ keys: undefined, holdMs: 0 });
    expect(swing?.shot).toBe('NORMAL');
  });

  it('el gesto del ratón ya no elige el golpe: un gesto vertical sin tecla es un golpe normal', () => {
    expect(clickWith({ swing: { vx: 0, vy: 3 } }).swing?.shot).toBe('NORMAL');
    expect(clickWith({ swing: { vx: 0, vy: -3 } }).swing?.shot).toBe('NORMAL');
  });

  it('Espacio + tecla = bloqueo (el bloqueo no cambia)', () => {
    const { swing, hit } = clickWith({ keys: { topspin: true }, block: true });
    expect(swing?.shot).toBe('BLOCK');
    expect(hit?.targets.type).toBe('BLOCK');
  });

  it('el evento del click lleva las teclas que había', () => {
    expect(clickWith({ keys: { slice: true } }).swing?.keys).toEqual({ slice: true });
  });
});

describe('potencia por la calidad del golpe, no por el gesto (V0.2b)', () => {
  const pt = cfg.shotTypes.powerByTier;

  it('PERFECT = golpe completo, GOOD = reducido, débil = flojo', () => {
    expect(strokePower('TOPSPIN', 'PERFECT', 1, cfg)).toBe(1);
    expect(pt.GOOD).toBeLessThan(pt.PERFECT);
    expect(pt.WEAK).toBeLessThan(pt.GOOD);
    expect(powerLevel(strokePower('TOPSPIN', 'PERFECT', 1, cfg), cfg)).toBe('FULL');
    expect(powerLevel(strokePower('TOPSPIN', 'GOOD', 1, cfg), cfg)).toBe('REDUCED');
    expect(powerLevel(strokePower('TOPSPIN', 'WEAK', 1, cfg), cfg)).toBe('WEAK');
  });

  it('el golpe normal no tiene potencia (bajo riesgo, baja recompensa)', () => {
    expect(strokePower('NORMAL', 'PERFECT', 1, cfg)).toBe(0);
  });

  // Calidad por posición (mismo Δt = 0): así solo cambia la potencia, no la curva de timing. El débil es un golpe
  // con el borde del lado izquierdo: su desvío va hacia dentro y no saca el slice (que abre a la derecha).
  const perfect = evalAt(0, 0.05);
  const good = evalAt(0, 0.35);
  const weak = evalAt(0, 0.7, -0.001);
  it.each(['TOPSPIN', 'SLICE', 'SMASH'] as StrokeType[])('%s: PERFECT sale más rápido que GOOD, y GOOD que débil', (type) => {
    const contact = type === 'SMASH' ? aboveTape(0.25) : top(0.22);
    const p = shoot(perfect, type, contact);
    const g = shoot(good, type, contact);
    const w = shoot(weak, type, contact);
    expect(p.valid && g.valid && w.valid).toBe(true);
    expect(p.speed).toBeGreaterThan(g.speed);
    expect(g.speed).toBeGreaterThan(w.speed);
  });

  it('el topspin PERFECT lleva más spin que el GOOD y que el débil', () => {
    const spin = (ev: ReturnType<typeof evalAt>) => planShot(ev, top(0.2), { swing: still, type: 'TOPSPIN' }, 0, cfg, false).spinRel.top;
    expect(spin(perfect)).toBeGreaterThan(spin(good));
    expect(spin(good)).toBeGreaterThan(spin(weak));
  });

  it('un golpe de ataque débil es más arriesgado que uno normal débil: el mismo error de timing resta más margen', () => {
    const loss = (type: StrokeType) => -planShot(evalAt(-90), top(0.2), { swing: still, type }, 0, cfg, false).parts.clearance.timing!;
    expect(loss('TOPSPIN')).toBeGreaterThan(loss('NORMAL') * 1.2);
  });
});

describe('ningún error de timing sale más rápido que un PERFECT, con la potencia por calidad (criterio de P5)', () => {
  for (const type of ['NORMAL', 'TOPSPIN', 'SLICE', 'SMASH'] as StrokeType[]) {
    it(type, () => {
      const contact = type === 'SMASH' ? aboveTape(0.22) : top(0.22);
      const best = shoot(evalAt(0), type, contact).speed;
      for (let d = -110; d <= 120; d += 10) {
        if (Math.abs(d) <= cfg.hit.perfectMs) continue;
        const r = shoot(evalAt(d), type, contact);
        if (!r.valid) continue; // a la red o fuera: el error no sale premiado
        expect(r.speed, `Δt=${d}`).toBeLessThanOrEqual(best + 1e-6);
      }
    });
  }
});

describe('«colocado» ya no decide el tipo: llegar persiguiendo reduce la potencia a la mitad (V0.2b)', () => {
  it('strokePower: persiguiendo (factor 0) es la mitad; colocado (1), entera', () => {
    expect(strokePower('TOPSPIN', 'PERFECT', 0, cfg)).toBeCloseTo(cfg.shotTypes.chasingPower, 12);
    expect(cfg.shotTypes.chasingPower).toBe(0.5);
    expect(strokePower('TOPSPIN', 'GOOD', 0, cfg)).toBeCloseTo(0.5 * cfg.shotTypes.powerByTier.GOOD, 12);
  });

  it('en la simulación: persiguiendo, la tecla sigue eligiendo el golpe pero sale con la mitad de potencia', () => {
    const placed = clickWith({ keys: { topspin: true } });
    const chased = clickWith({ keys: { topspin: true }, chase: true });
    expect(chased.swing?.aimFactor).toBe(0);
    expect(chased.swing?.shot).toBe('TOPSPIN');
    expect(chased.hit?.targets.type).toBe('TOPSPIN');
    const tierPower = cfg.shotTypes.powerByTier[placed.hit!.tier as 'PERFECT' | 'GOOD' | 'WEAK'];
    expect(placed.hit!.targets.power).toBeCloseTo(tierPower, 12);
    const chasedTier = cfg.shotTypes.powerByTier[chased.hit!.tier as 'PERFECT' | 'GOOD' | 'WEAK'];
    expect(chased.hit!.targets.power).toBeCloseTo(0.5 * chasedTier, 12);
  });

  it('persiguiendo, el mismo topspin sale más lento', () => {
    expect(shoot(evalAt(0), 'TOPSPIN', top(0.22), 0).speed).toBeLessThan(shoot(evalAt(0), 'TOPSPIN', top(0.22), 1).speed);
  });

  it('describeStroke explica la potencia y si se redujo por perseguir', () => {
    const t = planShot(evalAt(0), top(0.22), { swing: still, type: 'TOPSPIN', aimFactor: 0 }, 0, cfg, false);
    const d = describeStroke(t, 0, cfg);
    expect(d.level).toBe('REDUCED');
    expect(d.notes).toContain('CHASING');
    expect(describeStroke(planShot(evalAt(0), top(0.22), { swing: still, type: 'TOPSPIN' }, 0, cfg, false), 1, cfg)).toEqual({ level: 'FULL', notes: [] });
  });
});

describe('riesgos legibles que se mantienen (V0.2b)', () => {
  it('smash con la bola baja → red, y describeStroke lo dice', () => {
    for (const z of [1.0, 1.6, 2.3]) {
      const r = shoot(evalAt(0), 'SMASH', aboveTape(cfg.shotTypes.smash.minAboveTape - 0.06, z));
      expect(r.net, `z=${z}`).toBe(true);
      expect(describeStroke(r.targets, 1, cfg).notes).toContain('SMASH_LOW');
    }
    expect(shoot(evalAt(0), 'SMASH', aboveTape(cfg.shotTypes.smash.minAboveTape + 0.03)).valid).toBe(true);
  });

  it('topspin desde una bola muy baja → red; el normal pasa', () => {
    expect(shoot(evalAt(0), 'NORMAL', top(0.04)).valid).toBe(true);
    expect(shoot(evalAt(0), 'TOPSPIN', top(0.04)).net).toBe(true);
  });

  it('slice pronto → fuera por la banda (pasa la red y bota fuera), aunque no cruces', () => {
    // Desde el centro con un GOOD algo pronto, y desde los lados (hacia fuera) con un golpe débil pronto.
    for (const [x, d] of [
      [0, -58],
      [0.3, -65],
      [-0.3, -65],
    ]) {
      const r = shoot(evalAt(d), 'SLICE', top(0.2, 1.6, x));
      expect(r.net, `x=${x} Δt=${d}: red`).toBe(false);
      expect(r.valid, `x=${x} Δt=${d}`).toBe(false);
      expect(Math.abs(r.targets.landing.x), `x=${x} Δt=${d}`).toBeGreaterThan(cfg.world.tableWidth / 2);
    }
    expect(shoot(evalAt(0), 'SLICE', top(0.2)).valid).toBe(true);
    expect(shoot(evalAt(-35), 'SLICE', top(0.2)).valid).toBe(true);
  });

  it('topspin fuerte y tarde → larga', () => {
    const r = planShot(evalAt(100), top(0.2), { swing: still, type: 'TOPSPIN' }, 0, cfg, false);
    expect(Math.abs(r.landing.z)).toBeGreaterThan(cfg.world.tableLength / 2);
    // Un topspin GOOD algo tarde todavía entra: el riesgo es de golpes claramente tardíos.
    const g = planShot(evalAt(45), top(0.2), { swing: still, type: 'TOPSPIN' }, 0, cfg, false);
    expect(Math.abs(g.landing.z)).toBeLessThan(cfg.world.tableLength / 2);
  });
});

describe('dirección de la curva del slice (V0.2b)', () => {
  const side = (x: number, vx: number) => planShot(evalAt(0), top(0.2, 1.6, x), { swing: { vx, vy: 0 }, type: 'SLICE' }, 0, cfg, false).spinRel.side;

  it('hacia el lado al que cruzas', () => {
    expect(side(0.3, -1.5)).toBeLessThan(0);
    expect(side(-0.3, 1.5)).toBeGreaterThan(0);
  });

  it('sin cruce, hacia fuera desde el lado donde golpeas', () => {
    expect(side(0.3, 0)).toBeGreaterThan(0);
    expect(side(-0.3, 0)).toBeLessThan(0);
  });

  it('la curva y el ángulo van al mismo lado', () => {
    const t = planShot(evalAt(0), top(0.2, 1.6, -0.3), { swing: still, type: 'SLICE' }, 0, cfg, false);
    expect(t.landing.x).toBeLessThan(-0.3 * cfg.shot.aimBaseFromContact);
  });
});

describe('determinismo con teclas (V0.2b)', () => {
  it('mismos intentos con teclas → mismo estado bit a bit', () => {
    const run = () => clickWith({ keys: { topspin: true } });
    const a = run();
    const b = run();
    expect(a.hit!.targets).toEqual(b.hit!.targets);
    for (let i = 0; i < 120; i++) {
      a.sim.step([neutralIntent(), neutralIntent()]);
      b.sim.step([neutralIntent(), neutralIntent()]);
    }
    expect(a.sim.state.ball).toEqual(b.sim.state.ball);
  });
});
