import { READ_ANSWERS, ReadTest } from '@ppp/shared';
import { describe, expect, it } from 'vitest';
import { readFlagToSend, readNoticeText } from '../src/game/room-logic.ts';
import { READ_LEGEND, readConfusions, readSummary } from '../src/ui/texts.ts';

describe('prueba de lectura: textos (§13.1)', () => {
  it('la leyenda: 1 Normal · 2 Topspin · 3 Slice · 4 Smash · 5 Bloqueo, en el orden de las teclas', () => {
    expect(READ_LEGEND.map(([k, label]) => `${k} ${label}`).join(' · ')).toBe('1 Normal · 2 Topspin · 3 Slice · 4 Smash · 5 Bloqueo');
    expect(READ_LEGEND.map(([, , a]) => a)).toEqual([...READ_ANSWERS]);
  });

  it('resumen: % de aciertos sobre las respondidas y las que faltaron', () => {
    const t = new ReadTest(4);
    t.onRivalHit('TOPSPIN', false);
    t.answer('TOPSPIN');
    t.onRivalHit('SLICE', false);
    t.answer('NORMAL');
    t.onRivalHit('SMASH', false);
    t.onRivalHit('NORMAL', false);
    t.answer('NORMAL');
    t.close();
    const s = readSummary(t.result());
    expect(s.pct).toBe('67 %');
    expect(s.line).toBe('Acertaste 2 de los 3 golpes que nombraste. Sin respuesta: 1 de 4.');
    const none = readSummary(new ReadTest(30).result());
    expect(none.pct).toBe('—');
    expect(none.line).toBe('No nombraste ningún golpe. Sin respuesta: 0 de 0.');
  });

  it('en qué te confundes: las confusiones más repetidas primero, sin los aciertos ni las que faltaron', () => {
    const t = new ReadTest(30);
    const shot = (real: Parameters<ReadTest['onRivalHit']>[0], said: (typeof READ_ANSWERS)[number] | null) => {
      t.onRivalHit(real, false);
      if (said) t.answer(said);
      t.close();
    };
    shot('TOPSPIN', 'NORMAL');
    shot('TOPSPIN', 'NORMAL');
    shot('TOPSPIN', 'TOPSPIN');
    shot('SLICE', 'BLOCK');
    shot('SMASH', null);
    shot('NORMAL', 'NORMAL');
    expect(readConfusions(t.result())).toEqual(['Topspin: dijiste Normal 2 de 3 veces.', 'Slice: dijiste Bloqueo 1 de 1 veces.']);
    expect(readConfusions(t.result(), 1)).toEqual(['Topspin: dijiste Normal 2 de 3 veces.']);
    expect(readConfusions(new ReadTest(30).result())).toEqual([]);
  });
});

describe('prueba de lectura en la sala', () => {
  it('aviso para el rival: «Ana está haciendo la prueba de lectura: mezcla golpes»', () => {
    expect(readNoticeText('Ana')).toBe('Ana está haciendo la prueba de lectura: mezcla golpes');
  });

  it('el aviso `rt` se manda una vez por conexión hasta que la sala lo refleja (y otra tras reconectar)', () => {
    // Empiezas la prueba: la sala aún no lo sabe y no se ha mandado → 1.
    expect(readFlagToSend(true, false, null, 'warmup')).toBe(true);
    // Ya mandado, esperando a que la sala lo refleje: nada.
    expect(readFlagToSend(true, false, true, 'warmup')).toBeNull();
    // La sala ya lo refleja: nada.
    expect(readFlagToSend(true, true, true, 'warmup')).toBeNull();
    // Tras reconectar (lo enviado se olvida) la sala lo borró: otra vez.
    expect(readFlagToSend(true, false, null, 'warmup')).toBe(true);
    // Acabó la prueba: 0 una vez.
    expect(readFlagToSend(false, true, null, 'warmup')).toBe(false);
    expect(readFlagToSend(false, true, false, 'warmup')).toBeNull();
    // Fuera del warm-up la sala lo ignora: no se manda.
    for (const ph of ['waiting', 'countdown', 'match', 'between', 'paused'] as const) expect(readFlagToSend(true, false, null, ph)).toBeNull();
  });
});
