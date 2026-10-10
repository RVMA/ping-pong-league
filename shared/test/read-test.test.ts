import { describe, expect, it } from 'vitest';
import { makeConfig, READ_ANSWERS, READ_KEYS, ReadTest } from '../src/index.ts';

// Prueba de lectura (§13.1 ✅): tu raqueta devuelve sola, el rival mezcla golpes y tú nombras cada golpe suyo con
// 1 normal · 2 topspin · 3 slice · 4 smash · 5 bloqueo. Cuenta la primera tecla; los saques no cuentan (Decisión 19).

describe('prueba de lectura (§13.1)', () => {
  it('(a) acierto, fallo y sin respuesta: % sobre las respondidas y tabla de confusiones', () => {
    const t = new ReadTest(30);
    t.onRivalHit('TOPSPIN', false);
    t.answer('TOPSPIN');
    t.close();
    t.onRivalHit('SLICE', false);
    t.answer('NORMAL');
    t.close();
    t.onRivalHit('SMASH', false);
    t.close();
    const r = t.result();
    expect(t.asked).toBe(3);
    expect(r.asked).toBe(3);
    expect(r.answered).toBe(2);
    expect(r.correct).toBe(1);
    expect(r.pct).toBe(50);
    expect(r.confusion.TOPSPIN.TOPSPIN).toBe(1);
    expect(r.confusion.SLICE.NORMAL).toBe(1);
    expect(r.confusion.SLICE.SLICE).toBe(0);
    expect(r.confusion.SMASH.NONE).toBe(1);
    // Nada más en la tabla: 3 golpes, 3 casillas.
    let sum = 0;
    for (const row of READ_ANSWERS) for (const n of Object.values(r.confusion[row])) sum += n;
    expect(sum).toBe(3);
    // Cada fila tiene las 5 respuestas y «sin respuesta».
    expect(Object.keys(r.confusion.NORMAL).sort()).toEqual(['BLOCK', 'NONE', 'NORMAL', 'SLICE', 'SMASH', 'TOPSPIN']);
  });

  it('(b) un saque del rival no abre pregunta', () => {
    const t = new ReadTest(30);
    t.onRivalHit('NORMAL', true);
    expect(t.asked).toBe(0);
    expect(t.open).toBeNull();
    t.answer('NORMAL');
    t.close();
    const r = t.result();
    expect(r.asked).toBe(0);
    expect(r.answered).toBe(0);
    expect(r.pct).toBe(0);
  });

  it('(c) cuenta la primera tecla: una segunda no cambia la respuesta', () => {
    const t = new ReadTest(30);
    t.onRivalHit('BLOCK', false);
    t.answer('BLOCK');
    t.answer('NORMAL');
    t.answer('SMASH');
    expect(t.given).toBe('BLOCK');
    t.close();
    const r = t.result();
    expect(r.answered).toBe(1);
    expect(r.correct).toBe(1);
    expect(r.confusion.BLOCK.BLOCK).toBe(1);
    expect(r.confusion.BLOCK.NORMAL).toBe(0);
    expect(r.pct).toBe(100);
  });

  it('(d) done a los `total` golpes (al cerrarse el último); después no abre más preguntas', () => {
    const t = new ReadTest(3);
    for (let i = 0; i < 3; i++) {
      expect(t.done).toBe(false);
      t.onRivalHit('NORMAL', false);
      t.answer('NORMAL');
      if (i < 2) t.close();
    }
    // El último golpe sigue abierto: aún se puede nombrar.
    expect(t.asked).toBe(3);
    expect(t.done).toBe(false);
    t.close();
    expect(t.done).toBe(true);
    t.onRivalHit('SMASH', false);
    t.answer('SMASH');
    t.close();
    expect(t.asked).toBe(3);
    expect(t.result()).toMatchObject({ asked: 3, answered: 3, correct: 3, pct: 100 });
  });

  it('(e) una respuesta sin pregunta abierta se ignora', () => {
    const t = new ReadTest(30);
    t.answer('TOPSPIN');
    t.onRivalHit('SLICE', false);
    t.close();
    t.answer('SLICE');
    const r = t.result();
    expect(r.asked).toBe(1);
    expect(r.answered).toBe(0);
    expect(r.correct).toBe(0);
    expect(r.confusion.SLICE.NONE).toBe(1);
  });

  it('un golpe del rival con otra pregunta abierta la cierra sin respuesta antes de abrir la suya', () => {
    const t = new ReadTest(30);
    t.onRivalHit('TOPSPIN', false);
    t.onRivalHit('SLICE', false);
    expect(t.open).toBe('SLICE');
    t.answer('SLICE');
    t.close();
    const r = t.result();
    expect(r.asked).toBe(2);
    expect(r.confusion.TOPSPIN.NONE).toBe(1);
    expect(r.confusion.SLICE.SLICE).toBe(1);
  });

  it('cerrar sin pregunta abierta no hace nada; answered y correct cuentan al responder', () => {
    const t = new ReadTest(30);
    t.close();
    t.onRivalHit('SMASH', false);
    t.answer('SMASH');
    expect(t.answered).toBe(1);
    expect(t.correct).toBe(1);
    t.close();
    t.close();
    expect(t.result().confusion.SMASH.SMASH).toBe(1);
    expect(t.result().confusion.SMASH.NONE).toBe(0);
  });

  it('teclas físicas: 1–5 de la fila de números y del teclado numérico, en el orden de §13.1', () => {
    expect(READ_ANSWERS).toEqual(['NORMAL', 'TOPSPIN', 'SLICE', 'SMASH', 'BLOCK']);
    READ_ANSWERS.forEach((a, i) => {
      expect(READ_KEYS[`Digit${i + 1}`]).toBe(a);
      expect(READ_KEYS[`Numpad${i + 1}`]).toBe(a);
    });
    expect(Object.keys(READ_KEYS)).toHaveLength(10);
    // Sin cruce con las teclas del juego (Q/W/E, Espacio, Shift, Tab, D, Esc).
    for (const code of ['KeyQ', 'KeyW', 'KeyE', 'Space', 'ShiftLeft', 'Tab', 'KeyD', 'Escape', 'Digit0', 'Digit6']) expect(READ_KEYS[code]).toBeUndefined();
  });

  it('30 golpes por defecto (presentation.readTest.shots)', () => {
    expect(makeConfig().presentation.readTest.shots).toBe(30);
  });
});
