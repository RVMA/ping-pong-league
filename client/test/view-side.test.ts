import { makeConfig, type PointReason } from '@ppp/shared';
import { describe, expect, it } from 'vitest';
import { gamesLine } from '../src/game/room-logic.ts';
import { bounceMarkerShown, CATCH_UP_TICKS, mineFirst, seatOf, sideAt, tickBudget, viewPoint } from '../src/game/view-side.ts';
import { pointText } from '../src/ui/texts.ts';

const cfg = makeConfig();

describe('cámara del lado 1 (§2.1, P59)', () => {
  it('el lado 0 no cambia; el lado 1 cambia de signo x y z (giro de 180°), no la altura', () => {
    const { pos, lookAt } = cfg.presentation.camera;
    expect(viewPoint(0, pos)).toEqual([pos[0], pos[1], pos[2]]);
    expect(viewPoint(1, [0.5, 1.78, 3.45])).toEqual([-0.5, 1.78, -3.45]);
    const p1 = viewPoint(1, pos);
    const l1 = viewPoint(1, lookAt);
    expect(p1[1]).toBe(pos[1]);
    expect(p1[2]).toBe(-pos[2]);
    expect(l1[2]).toBe(-lookAt[2]);
    // La cámara del lado 1 queda en su extremo (z < 0) y mira hacia la red (su punto de mira, más cerca de z = 0).
    expect(p1[2]).toBeLessThan(0);
    expect(Math.abs(l1[2])).toBeLessThan(Math.abs(p1[2]));
    // Un giro, no un espejo: la distancia horizontal de la cámara a su punto de mira es la misma.
    expect(Math.hypot(p1[0] - l1[0], p1[2] - l1[2])).toBeCloseTo(Math.hypot(pos[0] - lookAt[0], pos[2] - lookAt[2]), 12);
  });

  it('sin ceros negativos (x = 0 sigue siendo 0)', () => {
    expect(Object.is(viewPoint(1, [0, 1, 2])[0], 0)).toBe(true);
  });
});

describe('marcador: «Tú» a la izquierda (§15)', () => {
  it('la casilla 0 es la del jugador local y la 1 la del rival, en los dos lados', () => {
    expect([seatOf(0, 0), seatOf(1, 0)]).toEqual([0, 1]);
    expect([seatOf(1, 1), seatOf(0, 1)]).toEqual([0, 1]);
    for (const me of [0, 1] as const) for (const seat of [0, 1] as const) expect(seatOf(sideAt(seat, me), me)).toBe(seat);
  });

  it('un par por lado sale como [yo, rival]', () => {
    expect(mineFirst(['Ana', 'Beto'], 0)).toEqual(['Ana', 'Beto']);
    expect(mineFirst(['Ana', 'Beto'], 1)).toEqual(['Beto', 'Ana']);
  });

  it('la línea de games va como [yo, rival]', () => {
    expect(gamesLine([1, 0], 0, true)).toBe('Game 2 · Games 1-0');
    expect(gamesLine([1, 0], 1, true)).toBe('Game 2 · Games 0-1');
    expect(gamesLine([2, 1], 1, true)).toBe('Game 4 · Games 1-2');
    expect(gamesLine([0, 0], 1, false)).toBe('Game 1');
  });
});

describe('marcador de bote (§2.2)', () => {
  it('en local y contra el bot remoto, sí; en una sala, solo en el warm-up', () => {
    expect(bounceMarkerShown(false, false)).toBe(true);
    expect(bounceMarkerShown(true, true)).toBe(true);
    expect(bounceMarkerShown(true, false)).toBe(false);
  });
});

describe('puesta al día por tramos (Review Focus 4)', () => {
  it('en red, más de 2 s atrás: como mucho 240 ticks por frame; si no, todos', () => {
    expect(tickBudget(true, 10000)).toBe(CATCH_UP_TICKS);
    expect(tickBudget(true, 2001)).toBe(240);
    expect(tickBudget(true, 2000)).toBe(Number.POSITIVE_INFINITY);
    expect(tickBudget(true, 30)).toBe(Number.POSITIVE_INFINITY);
    expect(tickBudget(false, 10000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('tras 10 s con la pestaña oculta, a 60 fps llega al presente en pocos frames y sin pasar de 240 ticks en ninguno', () => {
    const tickMs = 1000 / cfg.sim.tickHz;
    let real = 10000; // la vista se quedó en 0 y el reloj de la partida va por 10 s
    let sim = 0;
    let caughtUp = 0;
    let most = 0;
    for (let frame = 1; frame <= 100 && !caughtUp; frame++) {
      let budget = tickBudget(true, real - sim);
      let n = 0;
      while (budget-- > 0 && sim + tickMs <= real) {
        sim += tickMs;
        n++;
      }
      most = Math.max(most, n);
      if (real - sim < tickMs) caughtUp = frame;
      real += 1000 / 60;
    }
    expect(most).toBe(240);
    expect(caughtUp).toBeGreaterThan(1);
    expect(caughtUp).toBeLessThanOrEqual(6);
  });
});

describe('textos de punto: «el bot» o «el rival»', () => {
  const reasons: PointReason[] = ['NET', 'OUT', 'OWN_SIDE', 'DOUBLE_BOUNCE', 'MISSED', 'VOLLEY', 'SERVE_FAULT', 'SIDE', 'TOSS_MISSED'];
  const base = { why: null, rivalShot: null, smashMinAboveTape: 0.17 };

  it('en local y contra el bot remoto siguen diciendo «el bot»', () => {
    expect(pointText({ ...base, mine: true, reason: 'TOSS_MISSED' })).toBe('Punto. El bot no golpeó su saque.');
    expect(pointText({ ...base, mine: true, reason: 'OUT', rival: 'bot' })).toBe('Punto. La bola del bot salió fuera.');
  });

  it('en una sala dicen «el rival» y nunca «bot»', () => {
    expect(pointText({ ...base, mine: true, reason: 'TOSS_MISSED', rival: 'rival' })).toBe('Punto. El rival no golpeó su saque.');
    expect(pointText({ ...base, mine: true, reason: 'DOUBLE_BOUNCE', rival: 'rival' })).toBe('Punto. Doble bote en el campo del rival.');
    for (const reason of reasons) {
      // «el bot» o «del bot» (no «botó» ni «del bote»).
      expect(pointText({ ...base, mine: true, reason, rival: 'rival' })).not.toMatch(/el bot(?![a-záéíóú])/i);
      expect(pointText({ ...base, mine: false, reason, rival: 'rival', rivalShot: 'SMASH', why: { cause: 'NO_CLICK' } as never })).not.toMatch(/el bot(?![a-záéíóú])/i);
    }
  });

  it('el punto perdido se cuenta desde el jugador local (sea cual sea su lado)', () => {
    expect(pointText({ ...base, mine: false, reason: 'TOSS_MISSED', rival: 'rival' })).toBe('No golpeaste el saque.');
  });
});
