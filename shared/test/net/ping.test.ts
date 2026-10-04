import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../src/config.ts';
import { PingTracker, pingLevel } from '../../src/net/ping.ts';
import { LatencyQueue } from '../../src/net/latency.ts';

const cfg = makeConfig();

describe('ping de la sala [§15.1]', () => {
  it('media de las últimas 5 medidas', () => {
    const p = new PingTracker(5);
    expect(p.average).toBeNull();
    for (const v of [100, 200, 10, 20, 30, 40, 50]) p.add(v);
    expect(p.average).toBe(30);
    expect(p.count).toBe(7);
  });
  it('colores: < 60 verde, 60–120 amarillo, > 120 rojo', () => {
    expect(pingLevel(null, cfg)).toBe('unknown');
    expect(pingLevel(59, cfg)).toBe('good');
    expect(pingLevel(60, cfg)).toBe('fair');
    expect(pingLevel(120, cfg)).toBe('fair');
    expect(pingLevel(121, cfg)).toBe('bad');
  });
});

describe('latencia simulada', () => {
  it('nunca reordena y respeta el retardo con su variación', () => {
    const q = new LatencyQueue<number>(50, 0.5, 3);
    const at: number[] = [];
    for (let i = 0; i < 1000; i++) at.push(q.push(i, i * 2));
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThanOrEqual(at[i - 1]);
    for (let i = 0; i < at.length; i++) expect(at[i] - i * 2).toBeGreaterThanOrEqual(25 - 1e-9);
    const got: number[] = [];
    for (let t = 0; t <= 3000; t++) for (let m = q.popDue(t); m !== undefined; m = q.popDue(t)) got.push(m);
    expect(got).toEqual([...Array(1000).keys()]);
    expect(q.size).toBe(0);
  });
  it('sin empuje FIFO, el retardo queda dentro de ±variación', () => {
    const q = new LatencyQueue<number>(50, 0.1, 9);
    for (let i = 0; i < 200; i++) {
      const d = q.push(i, i * 1000) - i * 1000;
      expect(d).toBeGreaterThanOrEqual(45 - 1e-9);
      expect(d).toBeLessThanOrEqual(55 + 1e-9);
    }
  });
  it('misma semilla, mismas entregas; sin retardo, en el acto', () => {
    const a = new LatencyQueue<number>(75, 0.1, 5);
    const b = new LatencyQueue<number>(75, 0.1, 5);
    for (let i = 0; i < 50; i++) expect(a.push(i, i * 10)).toBe(b.push(i, i * 10));
    const z = new LatencyQueue<string>(0, 0.1, 1);
    expect(z.push('x', 12)).toBe(12);
    expect(z.popDue(12)).toBe('x');
    expect(z.nextAt()).toBe(Number.POSITIVE_INFINITY);
  });
});
