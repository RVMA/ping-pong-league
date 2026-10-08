import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../src/config.ts';
import { RateLimiter } from '../../src/net/rate.ts';

const cfg = makeConfig();

/** Cuántos pasan seguidos en `now` (con un tope para que un fallo no cuelgue el test). */
function drain(r: RateLimiter, now: number, max = 10000): number {
  let n = 0;
  while (n < max && r.take(now)) n++;
  return n;
}

describe('RateLimiter: cubo de fichas por conexión (Decisión 12)', () => {
  it('la config: 200 de ráfaga, 100 por segundo', () => {
    expect(cfg.room.rate).toEqual({ burst: 200, perSecond: 100 });
  });

  it('200 seguidos pasan y el 201 no', () => {
    const r = new RateLimiter(cfg.room.rate.burst, cfg.room.rate.perSecond);
    for (let i = 0; i < 200; i++) expect(r.take(1000), `mensaje ${i + 1}`).toBe(true);
    expect(r.take(1000)).toBe(false);
    expect(r.take(1000)).toBe(false);
  });

  it('tras 1 s pasan otros 100 (y a 10 ms, uno)', () => {
    const r = new RateLimiter(200, 100);
    expect(drain(r, 1000)).toBe(200);
    expect(drain(r, 1010)).toBe(1);
    expect(drain(r, 2010)).toBe(100);
  });

  it('nunca más de 200 acumulados, aunque pase mucho tiempo', () => {
    const r = new RateLimiter(200, 100);
    expect(drain(r, 0)).toBe(200);
    expect(drain(r, 60000)).toBe(200);
    expect(drain(r, 3_600_000)).toBe(200);
  });

  it('un cliente normal (~32 mensajes/s) nunca se queda sin fichas', () => {
    const r = new RateLimiter(200, 100);
    for (let i = 0; i < 32 * 600; i++) expect(r.take(i * (1000 / 32))).toBe(true);
  });

  it('un reloj que va hacia atrás no regala fichas', () => {
    const r = new RateLimiter(200, 100);
    expect(drain(r, 5000)).toBe(200);
    expect(drain(r, 4000)).toBe(0);
    expect(drain(r, 4000)).toBe(0);
  });
});
