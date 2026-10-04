import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../src/config.ts';
import { DisplayClock } from '../../src/net/brake.ts';

const cfg = makeConfig().net.brake;

/** Recorre el reloj cada 0.5 ms y comprueba que es continuo y no retrocede; devuelve las velocidades vistas. */
function sweep(c: DisplayClock, from: number, to: number, maxSpeed = 1): { min: number; max: number } {
  let prev = c.at(from);
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let u = from + 0.5; u <= to; u += 0.5) {
    const d = c.at(u);
    expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
    expect(d - prev).toBeLessThanOrEqual(0.5 * maxSpeed + 1e-9);
    const s = c.speedAt(u);
    min = Math.min(min, s);
    max = Math.max(max, s);
    prev = d;
  }
  return { min, max };
}

describe('reloj de la bola que se aleja [§17.2]', () => {
  it('sin frenar es la identidad', () => {
    const c = new DisplayClock();
    for (let u = 0; u <= 3000; u += 37.5) expect(c.at(u)).toBe(u);
    expect(c.isIdentity).toBe(true);
    c.planBrake(790, 0, cfg);
    expect(c.isIdentity).toBe(true);
    for (let u = 0; u <= 3000; u += 37.5) expect(c.at(u)).toBe(u);
  });

  it('llega al contacto esperado con tu ping + el del rival de retraso', () => {
    const c = new DisplayClock();
    c.planBrake(790, 200, cfg);
    expect(Math.abs(c.at(990) - 790)).toBeLessThan(1e-9);
    c.planBrake(790, 300, cfg);
    expect(Math.abs(c.at(1090) - 790)).toBeLessThan(1e-9);
  });

  it('tras el contacto esperado vuelve a velocidad real, P ms por detrás', () => {
    const c = new DisplayClock();
    c.planBrake(790, 200, cfg);
    expect(c.speedAt(1000)).toBeCloseTo(1, 12);
    expect(c.at(1500)).toBeCloseTo(1300, 9);
  });

  it('es monótona, con la velocidad entre el límite del freno y 1, y normal cerca de ti', () => {
    const c = new DisplayClock();
    for (const extra of [100, 200, 300]) {
      c.planBrake(790, extra, cfg);
      const s = sweep(c, 0, 790 + extra);
      expect(s.min).toBeGreaterThanOrEqual(cfg.minSpeed - 1e-9);
      expect(s.max).toBeLessThanOrEqual(1 + 1e-9);
      for (let u = 0; u <= 0.25 * 790; u += 10) expect(c.at(u)).toBeCloseTo(u, 9);
    }
  });

  it('si el freno no da para tanto retraso, no baja del límite y llega antes', () => {
    const c = new DisplayClock();
    c.planBrake(300, 2000, cfg);
    const s = sweep(c, 0, 2300);
    expect(s.min).toBeGreaterThanOrEqual(cfg.minSpeed - 1e-9);
    expect(c.at(2300)).toBeGreaterThan(300);
    expect(c.speedAt(2300)).toBeCloseTo(cfg.minSpeed, 9);
  });

  it('retarget desde un punto frenado llega exacto, sin salto y sin retroceder', () => {
    const c = new DisplayClock();
    c.planBrake(790, 300, cfg);
    const u = 800;
    const before = c.at(u);
    c.retarget(u, before + 60, 900);
    expect(Math.abs(c.at(u) - before)).toBeLessThan(1e-9);
    expect(Math.abs(c.at(900) - (before + 60))).toBeLessThan(1e-9);
    sweep(c, u, 900);
    // Adelantarse: mucho camino en poco tiempo.
    c.planBrake(790, 300, cfg);
    const d0 = c.at(700);
    c.retarget(700, d0 + 200, 780);
    expect(Math.abs(c.at(780) - (d0 + 200))).toBeLessThan(1e-9);
    sweep(c, 700, 780, 5);
  });

  it('resume vuelve a velocidad real sin salto', () => {
    const c = new DisplayClock();
    c.planBrake(790, 300, cfg);
    const d = c.at(1100);
    c.resume(1100, cfg.rampBackMs);
    expect(Math.abs(c.at(1100) - d)).toBeLessThan(1e-9);
    expect(c.speedAt(1100 + cfg.rampBackMs + 1)).toBeCloseTo(1, 12);
    sweep(c, 1100, 1500, 1);
  });

  it('con ping 0, alcanzar el contacto es seguir a velocidad real', () => {
    const c = new DisplayClock();
    c.planBrake(790, 0, cfg);
    c.retarget(700, 760, 760);
    for (let u = 700; u <= 760; u += 7.5) expect(c.at(u)).toBeCloseTo(u, 9);
  });

  it('informa de la velocidad mínima planificada', () => {
    const c = new DisplayClock();
    expect(c.minPlannedSpeed()).toBe(1);
    c.planBrake(790, 200, cfg);
    expect(c.minPlannedSpeed()).toBeGreaterThan(cfg.minSpeed);
    expect(c.minPlannedSpeed()).toBeLessThan(0.6);
  });
});
