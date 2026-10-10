import { makeConfig, type RoomMsg } from '@ppp/shared';
import { describe, expect, it } from 'vitest';
import { betweenText, clockText, countdownStep, modeText, nextRetryAt, pauseText, ReadyHold, readyWarnText, retryDelayMs, secondsLeft, toRoomView } from '../src/game/room-logic.ts';

const cfg = makeConfig();

describe('reintentos (Decisión 10)', () => {
  it('esperan 0.5, 1, 2, 4, 4, 4… s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([500, 1000, 2000, 4000, 4000, 4000, 4000]);
  });

  it('se intentan mientras no pasen 30 s desde el corte; después, null', () => {
    // Cada intento falla en el acto: el siguiente se programa desde ese instante.
    const at: number[] = [];
    let now = 0;
    for (let k = 0; k < 50; k++) {
      const next = nextRetryAt(0, k, now, cfg.room.reconnectMs);
      if (next === null) break;
      at.push(next);
      now = next;
    }
    expect(at).toEqual([500, 1500, 3500, 7500, 11500, 15500, 19500, 23500, 27500]);
    expect(nextRetryAt(0, 9, 27500, cfg.room.reconnectMs)).toBeNull();
  });
});

describe('Listo con Shift mantenido', () => {
  it('dispara una vez al llegar a readyHoldMs y el anillo se queda lleno hasta soltar', () => {
    const h = new ReadyHold(600);
    h.down(1000);
    expect(h.poll(1599)).toBe(false);
    expect(h.progress(1300)).toBeCloseTo(0.5);
    expect(h.poll(1600)).toBe(true);
    expect(h.poll(1700)).toBe(false);
    expect(h.progress(1700)).toBe(1);
    h.up();
    expect(h.progress(1800)).toBe(0);
    expect(h.holding).toBe(false);
  });

  it('soltar antes lo cancela; la repetición del teclado no reinicia la cuenta; otra pulsación larga vuelve a disparar', () => {
    const h = new ReadyHold(600);
    h.down(0);
    h.up();
    expect(h.poll(1000)).toBe(false);
    h.down(2000);
    h.down(2300);
    expect(h.poll(2600)).toBe(true);
    h.up();
    h.down(3000);
    expect(h.poll(3600)).toBe(true);
  });
});

describe('relojes', () => {
  it('segundos que faltan hacia arriba y «m:ss»', () => {
    expect(secondsLeft(27100, 100)).toBe(27);
    expect(secondsLeft(27101, 100)).toBe(28);
    expect(secondsLeft(-1, 100)).toBe(0);
    expect(secondsLeft(100, 5000)).toBe(0);
    expect([0, 9, 27, 150].map(clockText)).toEqual(['0:00', '0:09', '0:27', '2:30']);
  });

  it('cuenta atrás: 3, 2, 1 y GO (0) al vencer', () => {
    expect([0, 999, 1001, 2500, 2999, 3000, 3500].map((t) => countdownStep(3000, t))).toEqual([3, 3, 2, 1, 1, 0, 0]);
  });
});

describe('vista de la sala', () => {
  it('el plazo llega como ms que faltan y se guarda como instante local; sin plazo, −1', () => {
    const msg: RoomMsg = { k: 'room', code: 'ABCD', md: 'standard', ph: 'countdown', pl: [{ nm: 'Ana', c: 1, r: 1, rt: 0 }, null], gw: [1, 0], dl: 2500, dk: 'count' };
    const v = toRoomView(msg, 1, 1000, null);
    expect(v).toMatchObject({ code: 'ABCD', side: 1, mode: 'standard', phase: 'countdown', gamesWon: [1, 0], deadlineAt: 3500, deadlineKind: 'count', lastEnd: null });
    expect(v.players[0]?.nm).toBe('Ana');
    expect(v.players[1]).toBeNull();
    expect(toRoomView({ ...msg, dl: -1, dk: '' }, 0, 1000, null).deadlineAt).toBe(-1);
  });
});

describe('textos', () => {
  it('modos, entre games, pausa y timeout del Listo', () => {
    expect(modeText('quick', cfg)).toBe('Rápido · 1 game a 11');
    expect(modeText('standard', cfg)).toBe('Estándar · al mejor de 3 games');
    expect(modeText('full', cfg)).toBe('Completo · al mejor de 5 games');
    expect(betweenText(1, 'Ana', [11, 7], [1, 0])).toBe('Game 1 para Ana · 11-7 · Games 1-0');
    expect(betweenText(2, 'Beto', null, [1, 1])).toBe('Game 2 para Beto · Games 1-1');
    expect(pauseText('Beto', 27)).toBe('Esperando a Beto… 0:27');
    expect(readyWarnText(true, 'Beto', 29)).toBe('Da a Listo en 0:29 o saldrás de la sala');
    expect(readyWarnText(false, 'Beto', 29)).toBe('Beto tiene 0:29 para dar a Listo');
  });
});
