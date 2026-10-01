import { describe, expect, it } from 'vitest';
import {
  classifyHit,
  classifyPosition,
  classifyTiming,
  DEFAULT_CONFIG,
  makeConfig,
  measureClosestApproach,
  type PathSample,
  Simulation,
  worstTier,
} from '../src/index.ts';

const hit = DEFAULT_CONFIG.hit;

describe('clasificación de timing (ms) — escala simétrica EARLY–GOOD–PERFECT–GOOD–LATE', () => {
  it.each([
    [0, 'PERFECT'],
    [25, 'PERFECT'],
    [-25, 'PERFECT'],
    [26, 'GOOD'],
    [-26, 'GOOD'],
    [60, 'GOOD'],
    [-60, 'GOOD'],
    [61, 'WEAK'],
    [-120, 'WEAK'],
    [121, 'WHIFF'],
    [-121, 'WHIFF'],
  ] as const)('Δt = %d ms → %s', (dt, tier) => {
    expect(classifyTiming(dt, hit)).toBe(tier);
  });

  it('es simétrica', () => {
    for (let dt = 0; dt <= 200; dt += 0.5) expect(classifyTiming(dt, hit)).toBe(classifyTiming(-dt, hit));
  });
});

describe('clasificación de posición (% del radio)', () => {
  it.each([
    [0, 'PERFECT'],
    [0.19, 'PERFECT'],
    [0.2, 'GOOD'],
    [0.49, 'GOOD'],
    [0.5, 'WEAK'],
    [0.99, 'WEAK'],
    [1.0, 'WHIFF'],
  ] as const)('pos = %d → %s', (pos, tier) => {
    expect(classifyPosition(pos, hit)).toBe(tier);
  });
});

describe('calidad final = la peor de las dos', () => {
  const m = (dtMs: number, posFrac: number) =>
    classifyHit({ dtMs, posFrac, lateral: posFrac * 0.1, tIdeal: 0, ballAtIdeal: { x: 0, y: 0, z: 0 }, reachOverflow: 0 }, hit);

  it('PERFECT exige timing y posición PERFECT', () => {
    expect(m(10, 0.1).tier).toBe('PERFECT');
    expect(m(10, 0.3).tier).toBe('GOOD');
    expect(m(40, 0.1).tier).toBe('GOOD');
  });
  it('timing perfecto con el borde → WEAK con causa EDGE', () => {
    const e = m(0, 0.7);
    expect(e.tier).toBe('WEAK');
    expect(e.causes).toContain('EDGE');
  });
  it('pronto/tarde se reflejan en las causas', () => {
    expect(m(-90, 0.1).causes).toEqual(['EARLY']);
    expect(m(90, 0.1).causes).toEqual(['LATE']);
  });
  it('fuera de la raqueta o fuera de ventana → WHIFF', () => {
    expect(m(0, 1.2).tier).toBe('WHIFF');
    expect(m(150, 0).tier).toBe('WHIFF');
  });
  it('worstTier es conmutativa', () => {
    const tiers = ['WHIFF', 'WEAK', 'GOOD', 'PERFECT'] as const;
    for (const a of tiers) for (const b of tiers) expect(worstTier(a, b)).toBe(worstTier(b, a));
  });
});

describe('medición del paso más cercano', () => {
  // Bola en línea recta hacia el jugador del lado 0 (z creciente), 3 m/s, una muestra cada 8.33 ms.
  const tick = 1000 / 120;
  const mkSamples = (x: number): PathSample[] =>
    Array.from({ length: 120 }, (_, i) => ({ t: i * tick, pos: { x, y: 0.9, z: 0.2 + 0.025 * i } }));

  it('t_ideal tiene precisión sub-tick y Δt tiene el signo correcto', () => {
    const samples = mkSamples(0.05);
    // El sweet spot está en z = 1.5013 → entre muestras.
    const zSweet = 1.5013;
    const tExpected = ((zSweet - 0.2) / 0.025) * tick;
    const base = { samples, weightY: 0, side: 0 as const, paddleRadius: 0.14, reachMinY: 0, reachMaxY: 5, ownSideOnly: true };
    const early = measureClosestApproach({ ...base, sweet: { x: 0, y: 0, z: zSweet }, tClick: tExpected - 40 })!;
    expect(early.tIdeal).toBeCloseTo(tExpected, 6);
    expect(early.dtMs).toBeCloseTo(-40, 6);
    const late = measureClosestApproach({ ...base, sweet: { x: 0, y: 0, z: zSweet }, tClick: tExpected + 70 })!;
    expect(late.dtMs).toBeCloseTo(70, 6);
  });

  it('la posición es la distancia perpendicular en fracción del radio, con signo lateral del jugador', () => {
    const samples = mkSamples(0.07);
    const base = { samples, weightY: 0, paddleRadius: 0.14, reachMinY: 0, reachMaxY: 5, ownSideOnly: true, tClick: 0 };
    const m0 = measureClosestApproach({ ...base, side: 0, sweet: { x: 0, y: 0, z: 1.2 } })!;
    expect(m0.posFrac).toBeCloseTo(0.5, 6);
    expect(m0.lateral).toBeGreaterThan(0); // la bola pasa por la derecha del jugador 0
  });

  it('el lado 1 ve el eje lateral espejado', () => {
    const samples: PathSample[] = Array.from({ length: 60 }, (_, i) => ({ t: i * 8, pos: { x: 0.07, y: 0.9, z: -0.2 - 0.03 * i } }));
    const m1 = measureClosestApproach({
      samples,
      weightY: 0,
      side: 1,
      paddleRadius: 0.14,
      reachMinY: 0,
      reachMaxY: 5,
      ownSideOnly: true,
      tClick: 0,
      sweet: { x: 0, y: 0, z: -1.2 },
    })!;
    expect(m1.lateral).toBeLessThan(0); // +x del mundo es la izquierda del jugador 1
  });

  it('la altura fuera de alcance se suma a la distancia', () => {
    const samples = mkSamples(0);
    const m = measureClosestApproach({
      samples,
      weightY: 0,
      side: 0,
      paddleRadius: 0.14,
      reachMinY: 1.0,
      reachMaxY: 2.0,
      ownSideOnly: true,
      tClick: 0,
      sweet: { x: 0, y: 0, z: 1.2 },
    })!;
    expect(m.reachOverflow).toBeCloseTo(0.1, 6);
    expect(m.posFrac).toBeCloseTo(0.1 / 0.14, 6);
  });

  it('sin bola en el campo propio → null', () => {
    const samples: PathSample[] = Array.from({ length: 10 }, (_, i) => ({ t: i * 8, pos: { x: 0, y: 1, z: -1 } }));
    const m = measureClosestApproach({
      samples,
      weightY: 0,
      side: 0,
      paddleRadius: 0.14,
      reachMinY: 0,
      reachMaxY: 2,
      ownSideOnly: true,
      tClick: 0,
      sweet: { x: 0, y: 0, z: 1.5 },
    });
    expect(m).toBeNull();
  });
});

describe('evaluación de un click en una trayectoria real del simulador', () => {
  it('el timing se mide en ms reales: es el mismo con distintos gameSpeed', () => {
    for (const gameSpeed of [0.6, 0.75, 1.0]) {
      const cfg = makeConfig({ sim: { gameSpeed } });
      const sim = new Simulation(cfg);
      // Forzar un rally: el lado 1 acaba de golpear hacia el lado 0.
      sim.state.phase = 'rally';
      sim.state.rally = { lastHitter: 1, isServe: false, bounces: [], netTouched: false, hits: 1 };
      sim.state.ball = { pos: { x: 0, y: 0.95, z: 1.0 }, vel: { x: 0, y: 0.8, z: 4.0 }, spin: { x: 0, y: 0, z: 0 } };
      const paddle = { x: 0, z: 1.6 };
      // Buscar t_ideal y evaluar clicks desplazados ±40 ms.
      const ideal = sim.evaluateClick(0, sim.now, paddle)!;
      const tIdeal = ideal.tIdeal;
      const e1 = sim.evaluateClick(0, tIdeal - 40, paddle)!;
      const e2 = sim.evaluateClick(0, tIdeal + 40, paddle)!;
      expect(e1.dtMs).toBeCloseTo(-40, 3);
      expect(e2.dtMs).toBeCloseTo(40, 3);
      expect(e1.tier).toBe('GOOD');
      expect(e1.causes).toEqual([]);
    }
  });
});
