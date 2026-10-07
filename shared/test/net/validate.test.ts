import { describe, expect, it } from 'vitest';
import { makeConfig, tickMs } from '../../src/config.ts';
import { configHash } from '../../src/net/config-hash.ts';
import { type HelloMsg, PROTOCOL_VERSION } from '../../src/net/protocol.ts';
import { validClickTime, validHello, validOffset, validPaddleBounds, validReach } from '../../src/net/validate.ts';

const cfg = makeConfig();
const hello: HelloMsg = { k: 'hello', v: PROTOCOL_VERSION, h: configHash(cfg), r: 'player', nm: 'Ana', p: 100, bp: 100, j: 0.1, sp: 0, d: 'medium', s: 7, o: 0 };

describe('validación del servidor [§17.3]', () => {
  it('el desfase de latencia declarado está dentro del límite [−50, +100] ms', () => {
    expect(validOffset(-51, cfg)).toBe(false);
    expect(validOffset(-50, cfg)).toBe(true);
    expect(validOffset(100, cfg)).toBe(true);
    expect(validOffset(101, cfg)).toBe(false);
  });

  it('hello: versión, config y parámetros', () => {
    expect(validHello(hello, cfg)).toBeNull();
    expect(validHello({ ...hello, v: PROTOCOL_VERSION + 1 }, cfg)).toBe('version');
    expect(validHello({ ...hello, h: configHash(makeConfig({ sim: { gameSpeed: 0.7 } })) }, cfg)).toBe('config');
    expect(validHello({ ...hello, p: 600 }, cfg)).toBe('params');
    expect(validHello({ ...hello, bp: 501 }, cfg)).toBe('params');
    expect(validHello({ ...hello, j: 0.8 }, cfg)).toBe('params');
    expect(validHello({ ...hello, o: 200 }, cfg)).toBe('params');
    expect(validHello({ ...hello, sp: 0.9 }, cfg)).toBe('params');
    expect(validHello({ ...hello, sp: cfg.net.latency.spike.maxProb }, cfg)).toBeNull();
  });

  it('la raqueta dentro de sus límites (y detrás de la línea de fondo al sacar)', () => {
    expect(validPaddleBounds({ x: 0.2, z: 1.6 }, 0, false, cfg)).toBe(true);
    expect(validPaddleBounds({ x: -0.2, z: -1.6 }, 1, false, cfg)).toBe(true);
    expect(validPaddleBounds({ x: 1.5, z: 1.6 }, 0, false, cfg)).toBe(false);
    expect(validPaddleBounds({ x: 0, z: 0.5 }, 0, false, cfg)).toBe(false);
    expect(validPaddleBounds({ x: 0, z: -1.6 }, 0, false, cfg)).toBe(false);
    expect(validPaddleBounds({ x: 0, z: 1.2 }, 0, true, cfg)).toBe(false);
    expect(validPaddleBounds({ x: 0.9, z: 1.6 }, 0, true, cfg)).toBe(false);
    expect(validPaddleBounds({ x: 0.5, z: 1.5 }, 0, true, cfg)).toBe(true);
  });

  it('la raqueta pudo llegar desde su última posición enviada', () => {
    expect(validReach(null, { r: 500, x: 0, z: 1.6 }, cfg)).toBe(true);
    expect(validReach({ r: 467, x: 0, z: 1.6 }, { r: 500, x: 0.2, z: 1.6 }, cfg)).toBe(true);
    expect(validReach({ r: 467, x: 0, z: 1.6 }, { r: 500, x: 0.4, z: 1.6 }, cfg)).toBe(false);
  });

  it('el click está dentro del vuelo y no «en el futuro»', () => {
    const tick = tickMs(cfg);
    expect(validClickTime(400, 100, 500, cfg)).toBe(true);
    expect(validClickTime(-5, 100, 500, cfg)).toBe(false);
    expect(validClickTime(100 * tick + 1, 100, 5000, cfg)).toBe(false);
    expect(validClickTime(100 * tick, 100, 5000, cfg)).toBe(true);
    expect(validClickTime(600, 100, 500, cfg)).toBe(false);
    expect(validClickTime(550, 100, 500, cfg)).toBe(true);
  });
});
