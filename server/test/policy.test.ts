/**
 * La decisión común a los dos servidores (Node y el Durable Object) de cuándo una sala está rota: `pollRoom` atiende sus
 * plazos vencidos y dice si sigue sana. El Durable Object no se puede romper desde `worker-checks.ts` (es una prueba de
 * caja negra contra `wrangler dev`): esta prueba es la suya; la del servidor Node, con sockets, está en rooms.test.ts (k).
 */
import { describe, expect, it } from 'vitest';
import { pollRoom, ROOM_BROKEN_TEXT } from '../src/policy.ts';

/** Una sala falsa: su plazo y lo que hace `poll`. */
function fake(deadline: number, poll: (now: number) => number | 'throw') {
  const room = {
    at: deadline,
    polls: 0,
    poll(now: number): void {
      room.polls += 1;
      const next = poll(now);
      if (next === 'throw') throw new Error('fallo de prueba');
      room.at = next;
    },
    nextDeadline(): number {
      return room.at;
    },
  };
  return room;
}

describe('pollRoom: plazos de la sala y sala rota', () => {
  it('sin plazo vencido no llama a poll y la sala sigue', () => {
    const r = fake(5000, () => 9000);
    const log: string[] = [];
    expect(pollRoom(r, 4999, (l) => log.push(l))).toBe(true);
    expect(pollRoom(r, 1000, (l) => log.push(l))).toBe(true);
    const none = fake(Number.POSITIVE_INFINITY, () => 0);
    expect(pollRoom(none, 1e12, (l) => log.push(l))).toBe(true);
    expect(r.polls + none.polls).toBe(0);
    expect(log).toEqual([]);
  });

  it('con un plazo vencido llama a poll una vez; si el siguiente plazo es futuro (o no hay), la sala sigue', () => {
    const r = fake(5000, () => 8000);
    expect(pollRoom(r, 5000, () => {})).toBe(true);
    expect(r.polls).toBe(1);
    const done = fake(5000, () => Number.POSITIVE_INFINITY);
    expect(pollRoom(done, 6000, () => {})).toBe(true);
  });

  it('poll lanza: rota (con el error en el registro)', () => {
    const r = fake(5000, () => 'throw');
    const log: string[] = [];
    expect(pollRoom(r, 5000, (l) => log.push(l))).toBe(false);
    expect(r.polls).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0]).toContain('fallo de prueba');
  });

  it('el plazo no avanza tras poll (vencido otra vez, o NaN): rota', () => {
    const log: string[] = [];
    expect(pollRoom(fake(5000, () => 5000), 5000, (l) => log.push(l))).toBe(false);
    expect(pollRoom(fake(5000, () => 4000), 6000, (l) => log.push(l))).toBe(false);
    expect(pollRoom(fake(Number.NaN, () => Number.NaN), 6000, (l) => log.push(l))).toBe(false);
    expect(log.length).toBe(3);
  });

  it('nextDeadline lanza: rota', () => {
    const r = {
      poll(): void {},
      nextDeadline(): number {
        throw new Error('sin plazo');
      },
    };
    expect(pollRoom(r, 0, () => {})).toBe(false);
  });

  it('el texto para los jugadores dice qué hacer', () => {
    expect(ROOM_BROKEN_TEXT).toBe('La sala falló: crea otra sala');
  });
});
