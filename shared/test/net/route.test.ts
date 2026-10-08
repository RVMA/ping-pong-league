import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/bot.ts';
import { makeConfig } from '../../src/config.ts';
import { cleanName, newRoomCode, normalizeCode, parseRoute } from '../../src/net/route.ts';

const cfg = makeConfig();

describe('parseRoute', () => {
  it('create con modo, y con el modo por defecto si va vacío', () => {
    expect(parseRoute('?create=standard', cfg)).toEqual({ kind: 'create', mode: 'standard' });
    expect(parseRoute('?create=quick', cfg)).toEqual({ kind: 'create', mode: 'quick' });
    expect(parseRoute('?create=', cfg)).toEqual({ kind: 'create', mode: cfg.room.defaultMode });
    expect(parseRoute('?create=huge', cfg).kind).toBe('bad');
  });
  it('join normaliza el código', () => {
    expect(parseRoute('?room=abcd', cfg)).toEqual({ kind: 'join', code: 'ABCD' });
    expect(parseRoute('?room=%20AbCd%20', cfg)).toEqual({ kind: 'join', code: 'ABCD' });
    expect(parseRoute('?room= AbCd ', cfg)).toEqual({ kind: 'join', code: 'ABCD' });
    for (const q of ['?room=AB0D', '?room=ABC', '?room=ABCDE', '?room=', '?room=ABIO']) expect(parseRoute(q, cfg).kind, q).toBe('bad');
  });
  it('bot con dificultad; sin parámetros o basura es bad; nunca lanza', () => {
    expect(parseRoute('?bot=medium', cfg)).toEqual({ kind: 'bot', difficulty: 'medium' });
    expect(parseRoute('?bot=godlike', cfg).kind).toBe('bad');
    expect(parseRoute('', cfg).kind).toBe('bad');
    expect(parseRoute('?x=1', cfg).kind).toBe('bad');
    expect(() => parseRoute('?%E0%A4%A', cfg)).not.toThrow();
  });
});

describe('normalizeCode', () => {
  it('deja intacto el id de sala de bot', () => {
    expect(normalizeCode('b-12', cfg)).toBe('b-12');
    expect(normalizeCode('B-12', cfg)).toBeNull();
    expect(normalizeCode('b-', cfg)).toBeNull();
  });
  it('mayúsculas y sin espacios', () => {
    expect(normalizeCode(' ab cd ', cfg)).toBe('ABCD');
    expect(normalizeCode('abcd', cfg)).toBe('ABCD');
    expect(normalizeCode('ABCI', cfg)).toBeNull();
  });
});

describe('cleanName', () => {
  it('quita markup y recorta', () => {
    const n = cleanName('<img src=x onerror=alert(1)>', 'Jugador', cfg);
    expect(n).not.toMatch(/[<>]/);
    expect(Array.from(n).length).toBeLessThanOrEqual(16);
    expect(cleanName('a'.repeat(200), 'J', cfg)).toBe('a'.repeat(16));
  });
  it('vacío → fallback; control fuera; espacios colapsados', () => {
    expect(cleanName('   ', 'Jugador', cfg)).toBe('Jugador');
    expect(cleanName('\u0000Ana\u0007', 'J', cfg)).toBe('Ana');
    expect(cleanName('Ana  María', 'J', cfg)).toBe('Ana María');
  });
  it('quita los invisibles de formato (anchos cero, controles de dirección, BOM); solo con ellos → fallback', () => {
    expect(cleanName('A\u200Bna', 'J', cfg)).toBe('Ana');
    expect(cleanName('\u202Eana\u202C', 'J', cfg)).toBe('ana');
    expect(cleanName('\u2066Bea\u2069\uFEFF', 'J', cfg)).toBe('Bea');
    const invisibles = '\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2061\u2066\u2067\u2068\u2069\u206F\uFEFF\u061C';
    expect(cleanName(invisibles, 'Jugador 1', cfg)).toBe('Jugador 1');
    expect(cleanName(` ${invisibles} \u200B `, 'Jugador 2', cfg)).toBe('Jugador 2');
    // No cuentan para el límite de 16.
    expect(cleanName(`${'\u200B'.repeat(20)}Carlos`, 'J', cfg)).toBe('Carlos');
  });
  it('no parte pares sustitutos', () => {
    expect(cleanName('😀', 'J', cfg)).toBe('😀');
    const n = cleanName('😀'.repeat(20), 'J', cfg);
    expect(Array.from(n).length).toBe(16);
    expect(n).toBe('😀'.repeat(16));
  });
});

describe('newRoomCode', () => {
  it('4 letras del alfabeto; 10 000 códigos sin I ni O', () => {
    const rng = makeRng(5);
    for (let i = 0; i < 10000; i++) {
      const c = newRoomCode(rng, cfg);
      expect(c).toMatch(/^[A-HJ-NP-Z]{4}$/);
    }
  });
});
