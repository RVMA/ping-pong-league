import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../src/config.ts';
import { canonicalJson, configHash } from '../../src/net/config-hash.ts';

describe('hash de la config (§17.6: cliente y servidor con la misma config)', () => {
  it('es estable y tiene 8 caracteres hexadecimales', () => {
    const h = configHash(makeConfig());
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(configHash(makeConfig())).toBe(h);
  });

  it('cambia con cualquier valor de juego', () => {
    const base = configHash(makeConfig());
    expect(configHash(makeConfig({ sim: { gameSpeed: 0.7 } }))).not.toBe(base);
    expect(configHash(makeConfig({ paddle: { radius: 0.15 } }))).not.toBe(base);
    expect(configHash(makeConfig({ net: { brake: { minSpeed: 0.3 } } }))).not.toBe(base);
  });

  it('no depende de la presentación ni de los textos', () => {
    const base = configHash(makeConfig());
    expect(configHash(makeConfig({ presentation: { reduceShakeAndFlash: true } }))).toBe(base);
    expect(configHash(makeConfig({ feedback: { messageMs: 500 } }))).toBe(base);
  });

  it('no depende del orden de las claves', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }));
  });

  it('la sección net existe con sus valores base', () => {
    const cfg = makeConfig();
    expect(cfg.net.paddleHz).toBe(30);
    expect(cfg.net.ping.everyMs).toBe(2000);
    expect(cfg.net.ping.average).toBe(5);
  });
});

describe('hash de la config: sala (V0.4)', () => {
  it('cambia con la sección room y con el pico de latencia; no con la prueba de lectura', () => {
    const base = configHash(makeConfig());
    expect(configHash(makeConfig({ room: { countdownMs: 2000 } }))).not.toBe(base);
    expect(configHash(makeConfig({ net: { latency: { spike: { maxProb: 0.1 } } } }))).not.toBe(base);
    expect(configHash(makeConfig({ presentation: { readTest: { shots: 10 } } }))).toBe(base);
  });
});
