/**
 * Bucle compartido del proceso: cada ~1 ms llama a las tareas registradas con el instante actual (performance.now).
 * Lo usan las colas de latencia simulada, los temporizadores de las salas y los bots remotos (sus ticks de 120 Hz se
 * ponen al día con el reloj real en cada vuelta).
 */
export type TickTask = (now: number) => void;

export class Ticker {
  private readonly tasks = new Set<TickTask>();
  private timer: ReturnType<typeof setInterval> | null = null;

  add(task: TickTask): void {
    this.tasks.add(task);
    if (!this.timer) this.timer = setInterval(this.loop, 1);
  }

  remove(task: TickTask): void {
    this.tasks.delete(task);
    if (!this.tasks.size && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private readonly loop = (): void => {
    const now = performance.now();
    for (const t of this.tasks) {
      try {
        t(now);
      } catch (e) {
        console.error('[ticker]', e);
      }
    }
  };
}

/** Bucle único del proceso. */
export const ticker = new Ticker();
