import { describe, expect, it } from 'vitest';
import {
  type BallContact,
  type BallState,
  classifyGesture,
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
} from '../src/index.ts';

const cfg = makeConfig();
const env = makeEnv(cfg);
const dt = simDt(cfg);

const evalAt = (dtMs: number, posFrac = 0.05, lateral = 0.007) =>
  classifyHit({ dtMs, posFrac, lateral, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, cfg.hit);

/** Planifica, resuelve y vuela un golpe del lado 0 (con red). */
function shoot(dtMs: number, swing: { vx: number; vy: number }, contact: Vec3) {
  const targets = planShot(evalAt(dtMs), contact, { swing }, 0, cfg, false);
  const sol = solveShot(contact, targets, env, dt, cfg);
  const b: BallState = { pos: { ...contact }, vel: { ...sol.vel }, spin: { ...targets.spin } };
  const contacts: BallContact[] = [];
  for (let i = 0; i < 1500 && !contacts.some((c) => c.kind !== 'net'); i++) stepBall(b, dt, env, contacts);
  const first = contacts.find((c) => c.kind !== 'net');
  const valid = !!first && first.kind === 'table' && first.side === 1;
  return { targets, sol, net: contacts.some((c) => c.kind === 'net') && !valid, valid, first, speed: Math.hypot(sol.vel.x, sol.vel.z) };
}

const top = (h: number, z = 1.6, x = 0): Vec3 => ({ x, y: env.tableTop + h, z });
/** Contacto con la parte inferior de la bola `above` m por encima de la cinta. */
const aboveTape = (above: number, z = 1.6): Vec3 => ({ x: 0, y: env.netTop + env.r + above, z });

describe('gesto → tipo de golpe [§4.6]', () => {
  const t = cfg.shotTypes;
  it.each([
    [{ vx: 0, vy: 0 }, 'NORMAL'],
    [{ vx: 0.4, vy: -0.3 }, 'NORMAL'],
    [{ vx: 1.8, vy: 0.4 }, 'NORMAL'], // cruce (§4.5) por debajo del umbral del slice
    [{ vx: 0, vy: 2 }, 'TOPSPIN'],
    [{ vx: 1.2, vy: 2 }, 'TOPSPIN'], // topspin cruzado
    [{ vx: 0, vy: -2 }, 'SMASH'],
    [{ vx: -3, vy: 0 }, 'SLICE'],
    [{ vx: 3, vy: 2.5 }, 'SLICE'], // domina el lateral
    [{ vx: 0.2, vy: 1.0 }, 'NORMAL'], // vertical por debajo del umbral
  ] as const)('%o → %s', (swing, type) => {
    expect(classifyGesture(swing, cfg).type).toBe(type);
  });

  it('el slice es el cruce por encima de un umbral de velocidad del gesto', () => {
    expect(classifyGesture({ vx: t.sliceThreshold - 0.01, vy: 0 }, cfg).type).toBe('NORMAL');
    expect(classifyGesture({ vx: t.sliceThreshold, vy: 0 }, cfg).type).toBe('SLICE');
  });

  it('la potencia crece con la velocidad del gesto, de 0 en el umbral a 1 [§4.7]', () => {
    expect(classifyGesture({ vx: 0, vy: t.topspinThreshold }, cfg).power).toBe(0);
    expect(classifyGesture({ vx: 0, vy: (t.topspinThreshold + t.topspinFullPower) / 2 }, cfg).power).toBeCloseTo(0.5, 9);
    expect(classifyGesture({ vx: 0, vy: 99 }, cfg).power).toBe(1);
    expect(classifyGesture({ vx: 0, vy: -99 }, cfg).power).toBe(1);
  });
});

describe('regla de "colocado" para todos los golpes (pregunta abierta 11)', () => {
  /** Raqueta del lado 0 en (x0, 1.6); bola que ya botó en su campo y llega a (0, 1.6). Click con `swing`. */
  function clickWith(swing: { vx: number; vy: number }, chase: boolean): Extract<SimEvent, { type: 'swing' }> | undefined {
    const sim = new Simulation(makeConfig());
    sim.state.phase = 'rally';
    sim.state.rally = { lastHitter: null, isServe: false, bounces: [], netTouched: false, hits: 0 };
    const start = chase ? -0.7 : 0;
    const at = (x: number) => {
      const i = neutralIntent(1.6);
      i.target.x = x;
      return i;
    };
    for (let i = 0; i < 64; i++) sim.step([at(start), neutralIntent()]);
    // Bola entrante: cruza z = 1.6 dentro de ~0.36 s.
    sim.state.rally = { lastHitter: 1, isServe: false, bounces: [], netTouched: false, hits: 1 };
    sim.state.ball = { pos: { x: 0, y: env.tableTop + 0.25, z: 0.2 }, vel: { x: 0, y: 0.6, z: 4.2 }, spin: { x: 0, y: 0, z: 0 } };
    // Instante en que la bola (tras botar en su campo) cruza la profundidad de la raqueta.
    const path = predictPath(sim.state.ball, sim.env, sim.dt, sim.tickMs, sim.now, 1500);
    const k = path.findIndex((q, i) => i > 0 && path[i - 1].pos.z < 1.6 && q.pos.z >= 1.6);
    const tIdeal = path[k - 1].t + ((1.6 - path[k - 1].pos.z) / (path[k].pos.z - path[k - 1].pos.z)) * (path[k].t - path[k - 1].t);
    let swingEv: Extract<SimEvent, { type: 'swing' }> | undefined;
    // Persiguiendo: el objetivo salta a x = 0 tarde y la raqueta llega corriendo.
    while (sim.now + sim.tickMs < tIdeal) {
      const intent = at(chase && sim.now > tIdeal - 330 ? 0 : start);
      sim.step([intent, neutralIntent()]);
    }
    const intent = at(0);
    intent.swing = swing;
    intent.fire = tIdeal;
    for (const e of sim.step([intent, neutralIntent()])) if (e.type === 'swing') swingEv = e;
    return swingEv;
  }

  it('colocado: el gesto elige el golpe', () => {
    expect(clickWith({ vx: 0, vy: 2.5 }, false)?.shot).toBe('TOPSPIN');
    expect(clickWith({ vx: 0, vy: -2.5 }, false)?.shot).toBe('SMASH');
    expect(clickWith({ vx: 3.5, vy: 0 }, false)?.shot).toBe('SLICE');
  });

  it('persiguiendo la bola, cualquier gesto da un golpe normal', () => {
    for (const swing of [
      { vx: 0, vy: 2.5 },
      { vx: 0, vy: -2.5 },
      { vx: 3.5, vy: 0 },
    ]) {
      const ev = clickWith(swing, true);
      expect(ev, JSON.stringify(swing)).toBeDefined();
      expect(ev!.aimFactor).toBe(0);
      expect(ev!.shot).toBe('NORMAL');
    }
  });
});

describe('topspin [§4.6]', () => {
  it('pega más fuerte que el normal manteniendo la bola baja, y entra', () => {
    const normal = shoot(0, { vx: 0, vy: 0 }, top(0.2));
    const topspin = shoot(0, { vx: 0, vy: 2.6 }, top(0.2));
    expect(topspin.valid).toBe(true);
    expect(topspin.targets.type).toBe('TOPSPIN');
    expect(topspin.targets.spinRel.top).toBeGreaterThan(300);
    expect(topspin.speed).toBeGreaterThan(normal.speed * 1.25);
    expect(topspin.targets.clearance).toBeLessThanOrEqual(normal.targets.clearance);
  });

  it('desde una bola muy baja, demasiado topspin va a la red; el golpe normal pasa', () => {
    expect(shoot(0, { vx: 0, vy: 0 }, top(0.04)).valid).toBe(true);
    const r = shoot(0, { vx: 0, vy: 3 }, top(0.04));
    expect(r.net).toBe(true);
    expect(r.targets.parts.clearance.lowContact!).toBeLessThan(-0.1);
  });

  it('PERFECT controla mejor el spin que GOOD y que un golpe débil [§4.3]', () => {
    const spinAt = (d: number) => planShot(evalAt(d), top(0.2), { swing: { vx: 0, vy: 2.6 } }, 0, cfg, false).spinRel.top;
    expect(spinAt(0)).toBeGreaterThan(spinAt(45));
    expect(spinAt(45)).toBeGreaterThan(spinAt(90));
  });
});

describe('slice [§4.6]: el cruce con efecto lateral y más ángulo', () => {
  it('curva hacia el lado del gesto, bota más abierto que el cruce a tope y entra con PERFECT', () => {
    const cross = shoot(0, { vx: 2.0, vy: 0 }, top(0.2));
    const slice = shoot(0, { vx: 3.5, vy: 0 }, top(0.2));
    expect(slice.targets.type).toBe('SLICE');
    expect(slice.targets.spinRel.side).toBeGreaterThan(100);
    expect(slice.targets.spinRel.top).toBeLessThan(0); // algo de backspin
    expect(slice.valid).toBe(true);
    expect(slice.first!.pos.x).toBeGreaterThan(cross.first!.pos.x);
    const left = shoot(0, { vx: -3.5, vy: 0 }, top(0.2));
    expect(left.targets.spinRel.side).toBeLessThan(-100);
  });

  it('pronto se pasa de ángulo y sale por la banda', () => {
    const r = shoot(-70, { vx: 3.5, vy: 0 }, top(0.2));
    expect(Math.abs(r.targets.landing.x)).toBeGreaterThan(cfg.world.tableWidth / 2);
    expect(r.valid).toBe(false);
  });

  it('deja menos margen sobre la red que el golpe normal', () => {
    expect(shoot(0, { vx: 4.5, vy: 0 }, top(0.2)).targets.clearance).toBeLessThan(shoot(0, { vx: 0, vy: 0 }, top(0.2)).targets.clearance - 0.03);
  });
});

describe('smash: umbral relativo a la red [§4.6]', () => {
  const smash = { vx: 0, vy: -2.6 };

  it(`con la bola más de ${cfg.shotTypes.smash.minAboveTape * 100} cm sobre la cinta entra y es muy rápido`, () => {
    const normal = shoot(0, { vx: 0, vy: 0 }, top(0.22));
    for (const z of [1.0, 1.6, 2.3]) {
      const r = shoot(0, smash, aboveTape(cfg.shotTypes.smash.minAboveTape + 0.02, z));
      expect(r.targets.type).toBe('SMASH');
      expect(r.valid, `z=${z}`).toBe(true);
    }
    expect(shoot(0, smash, aboveTape(0.25)).speed).toBeGreaterThan(normal.speed * 1.6);
  });

  it('con la bola baja (a menos del umbral) va a la red, desde cualquier profundidad', () => {
    for (const z of [1.0, 1.6, 2.3]) {
      const r = shoot(0, smash, aboveTape(cfg.shotTypes.smash.minAboveTape - 0.06, z));
      expect(r.net, `z=${z}`).toBe(true);
      expect(r.targets.parts.clearance.smashLow!).toBeLessThan(0);
    }
  });

  it('el umbral se mide en el contacto respecto a la cinta: por debajo, la bola baja más empinada', () => {
    const r = planShot(evalAt(0), aboveTape(0.1), { swing: smash }, 0, cfg, false);
    expect(r.aboveTape).toBeCloseTo(0.1, 9);
    expect(r.parts.depth.smashLow).toBeCloseTo(-cfg.shotTypes.smash.lowDepthPerM * (cfg.shotTypes.smash.minAboveTape - 0.1), 9);
    expect(r.parts.clearance.smashLow!).toBeLessThan(0);
    const ok = planShot(evalAt(0), aboveTape(0.16), { swing: smash }, 0, cfg, false);
    expect(ok.parts.clearance.smashLow).toBeUndefined();
  });

  it('desde una bola alta, un golpe normal no es un smash: tiene techo de ritmo', () => {
    const normal = shoot(0, { vx: 0, vy: 0 }, aboveTape(0.35));
    const sm = shoot(0, smash, aboveTape(0.35));
    expect(normal.targets.parts.clearance.paceCap!).toBeGreaterThan(0);
    expect(sm.speed).toBeGreaterThan(normal.speed * 1.35);
  });

  it('smash pronto: más bajo y más corto → red', () => {
    expect(shoot(-100, smash, aboveTape(0.2)).net).toBe(true);
  });
});

describe('potencia [§4.7]', () => {
  it('más potencia → más velocidad', () => {
    const s1 = shoot(0, { vx: 0, vy: 1.3 }, top(0.2)).speed;
    const s2 = shoot(0, { vx: 0, vy: 4 }, top(0.2)).speed;
    expect(s2).toBeGreaterThan(s1);
  });

  it('más potencia → más sensible al timing: el mismo error resta más margen', () => {
    const loss = (vy: number) => {
      const p = planShot(evalAt(-70), top(0.2), { swing: { vx: 0, vy } }, 0, cfg, false).parts.clearance.timing!;
      return -p;
    };
    expect(loss(4)).toBeGreaterThan(loss(1.3) * 1.4);
  });

  it('tarde y con potencia la bola se va larga (riesgo de fuera)', () => {
    const r = planShot(evalAt(110), top(0.2), { swing: { vx: 0, vy: 4 } }, 0, cfg, false);
    expect(r.parts.depth.powerLate!).toBeGreaterThan(0.2);
  });
});

describe('ningún error de timing da más velocidad que un PERFECT, en ningún tipo de golpe (criterio de P5)', () => {
  const gestures = {
    NORMAL: { vx: 0, vy: 0 },
    TOPSPIN: { vx: 0, vy: 3 },
    SLICE: { vx: 3.5, vy: 0 },
    SMASH: { vx: 0, vy: -3 },
  };
  for (const [name, swing] of Object.entries(gestures)) {
    it(name, () => {
      const contact = name === 'SMASH' ? aboveTape(0.22) : top(0.22);
      const perfect = shoot(0, swing, contact).speed;
      for (let d = -110; d <= 120; d += 10) {
        if (Math.abs(d) <= cfg.hit.perfectMs) continue;
        const r = shoot(d, swing, contact);
        if (!r.valid) continue; // a la red o fuera: el error no sale premiado
        expect(r.speed, `Δt=${d}`).toBeLessThanOrEqual(perfect + 1e-6);
      }
    });
  }
});

describe('el margen pedido es la suma de sus partes (base de "¿por qué fallé?")', () => {
  it('para todos los tipos', () => {
    for (const swing of [
      { vx: 0, vy: 0 },
      { vx: 1.5, vy: 0 },
      { vx: 0, vy: 3 },
      { vx: 4, vy: 0 },
      { vx: 0, vy: -3 },
    ]) {
      for (const d of [-90, 0, 80]) {
        const t = planShot(evalAt(d, 0.6, 0.08), top(0.1), { swing }, 0, cfg, false);
        const sum = Object.values(t.parts.clearance).reduce((a, b) => a + (b ?? 0), 0);
        expect(t.clearance).toBeCloseTo(sum, 12);
        const lat = Object.values(t.parts.lateral).reduce((a, b) => a + (b ?? 0), 0);
        expect(t.landing.x).toBeCloseTo(lat, 12);
      }
    }
  });
});
