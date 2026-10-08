import { describe, expect, it } from 'vitest';
import { LatencyQueue } from '../../src/net/latency.ts';

const SPIKE = { minMs: 100, maxMs: 300 };

/** Entregas (instante de llegada) de `count` mensajes enviados cada `every` ms. */
function deliveries(q: LatencyQueue<number>, count: number, every: number): number[] {
  const at: number[] = [];
  for (let i = 0; i < count; i++) at.push(q.push(i, i * every));
  return at;
}

describe('latencia simulada', () => {
  it('nunca reordena y respeta el retardo con su variación', () => {
    const q = new LatencyQueue<number>(50, 0.5, 3);
    const at = deliveries(q, 1000, 2);
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

describe('picos de latencia de TCP (spike)', () => {
  // Entregas de V0.3 con (50 ms, ±10 %, semilla 7) y un mensaje cada 20 ms, medidas antes de añadir los picos.
  const V03 = [45.11704753153026, 65.61958257574588, 94.7690763277933, 111.99028705712408, 130.2144526853226, 149.05521688051522, 169.66232632519677, 187.39925185916945];

  it('sin spike, o con prob 0, las entregas son las de V0.3 con la misma semilla (no gasta azar de más)', () => {
    expect(deliveries(new LatencyQueue<number>(50, 0.1, 7), 8, 20)).toEqual(V03);
    expect(deliveries(new LatencyQueue<number>(50, 0.1, 7, { prob: 0, ...SPIKE }), 8, 20)).toEqual(V03);
    const plain = deliveries(new LatencyQueue<number>(50, 0.1, 7), 2000, 3);
    expect(deliveries(new LatencyQueue<number>(50, 0.1, 7, { prob: 0, ...SPIKE }), 2000, 3)).toEqual(plain);
  });

  it('con prob 0.05, algunos mensajes llegan entre 100 y 300 ms más tarde; el resto, a su hora', () => {
    // Sin variación y con los envíos separados 1 s (sin empuje FIFO): el retardo es 50 ms o 50 ms + U(100, 300).
    const q = new LatencyQueue<number>(50, 0, 11, { prob: 0.05, ...SPIKE });
    const extra = deliveries(q, 2000, 1000).map((at, i) => at - i * 1000 - 50);
    const spikes = extra.filter((e) => e > 1e-9);
    for (const e of spikes) {
      expect(e).toBeGreaterThanOrEqual(100);
      expect(e).toBeLessThanOrEqual(300);
    }
    for (const e of extra) expect(e).toBeGreaterThanOrEqual(-1e-9);
    // 5 % de 2000 = 100 picos (±40 de margen: binomial, σ ≈ 10).
    expect(spikes.length).toBeGreaterThan(60);
    expect(spikes.length).toBeLessThan(140);
  });

  it('un pico retiene a los que vienen detrás (cabeza de línea) y nunca reordena', () => {
    const q = new LatencyQueue<number>(50, 0.1, 13, { prob: 0.05, ...SPIKE });
    const at = deliveries(q, 3000, 2);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThanOrEqual(at[i - 1]);
    // Algún mensaje enviado justo después de un pico llega con más de 55 ms de retardo (su propio máximo): lo arrastró el pico.
    const held = at.filter((t, i) => t - i * 2 > 55 + 1e-9 && i > 0 && at[i - 1] === t);
    expect(held.length).toBeGreaterThan(0);
    const got: number[] = [];
    for (let t = 0; t <= 7000; t++) for (let m = q.popDue(t); m !== undefined; m = q.popDue(t)) got.push(m);
    expect(got).toEqual([...Array(3000).keys()]);
  });

  it('es determinista: misma semilla y mismos picos, mismas entregas', () => {
    const a = deliveries(new LatencyQueue<number>(60, 0.1, 21, { prob: 0.05, ...SPIKE }), 1000, 5);
    const b = deliveries(new LatencyQueue<number>(60, 0.1, 21, { prob: 0.05, ...SPIKE }), 1000, 5);
    expect(a).toEqual(b);
    const c = deliveries(new LatencyQueue<number>(60, 0.1, 22, { prob: 0.05, ...SPIKE }), 1000, 5);
    expect(c).not.toEqual(a);
  });
});
