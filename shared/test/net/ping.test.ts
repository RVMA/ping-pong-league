import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../src/config.ts';
import { PingTracker, pingLevel } from '../../src/net/ping.ts';

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
