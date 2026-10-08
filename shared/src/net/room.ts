/**
 * La sala de dos personas (V0.4) [§14; Decisiones 2, 3 y 5–11 del plan]. Lógica pura con tiempo virtual: los servidores
 * (Node y el Durable Object) solo le pasan los mensajes con su instante de llegada y ponen UN temporizador a
 * `nextDeadline()` que llama a `poll`.
 *
 * Fases: esperando rival → warm-up (práctica: `GameAuthority` sin marcador) → ambos Listos → cuenta atrás de 3 s → partido
 * (una `GameAuthority` por game, con `between` de 4 s entre games) → `mend` con estadísticas y vuelta al warm-up con los
 * Listos a 0 (revancha = Listo otra vez). El número de rally nunca vuelve atrás en toda la vida de la sala.
 *
 * Plazos (todos en `nextDeadline()`): cuenta atrás, entre games, aviso y timeout del Listo (solo mientras uno espera al
 * otro, §14.2 ✅), reserva de 30 s del hueco de quien se desconecta y el de la autoridad (respaldo, o fin del vuelo del
 * ausente). Un `poll` tardío los atiende en orden.
 *
 * Desconexión (socket cerrado sin `leave`): el hueco se guarda 30 s desde el corte. En el partido, la autoridad lo da por
 * ausente (el punto en juego acaba al terminar el vuelo que le toca, P56) y la sala se pausa en cuanto no hay vuelo; al
 * volver con su token, cuenta atrás de 3 s y `resume`; si no vuelve, abandono. En espera, warm-up o cuenta atrás de
 * inicio, la misma reserva (la práctica se pausa y la cuenta atrás se cancela). `leave` libera el hueco sin reserva; en
 * el partido es abandono inmediato. Con el token de una conexión aún abierta (pestaña duplicada), la nueva sustituye a la
 * vieja sin pausa.
 *
 * La sala manda `welcome`, `room` (solo cuando cambia lo que enseña), `mend` y `bye`, y contesta los `ping`; `start`,
 * `toss`, `fl`, `pt`, la raqueta… salen de la autoridad. Nunca usa `Math.random` ni `Date.now`: el azar y los tokens
 * llegan en `RoomDeps` y el tiempo como `now`. Los huecos y el transporte están en `room-seats.ts`; las cuentas del
 * partido y el `mend`, en `match-tally.ts`.
 */
import type { GameConfig, MatchMode } from '../config.ts';
import type { Side } from '../types.ts';
import { MatchTally, type MatchRow } from './match-tally.ts';
import type { C2S, ErrCode, HelloMsg, RoomMsg, RoomPhase, S2C } from './protocol.ts';
import { RoomSeats } from './room-seats.ts';
import { type GameAuthority, type MatchRecord, ServerMatch } from './server-match.ts';

export type { MatchRow } from './match-tally.ts';

export interface RoomDeps {
  cfg: GameConfig;
  code: string;
  mode: MatchMode;
  send(to: Side, msg: S2C): void;
  /** Cierra la conexión de ese lado (después de un `bye` o un `err`). */
  drop(to: Side): void;
  newToken(): string;
  /** Azar del sorteo del primer saque (crypto en los servidores; mulberry32 en los tests). */
  random(): number;
  /** Fábrica de la autoridad de cada game (por defecto ServerMatch; un falso en los tests). */
  makeAuthority?(send: (to: Side, msg: S2C) => void): GameAuthority;
  log?(line: string): void;
}

export type JoinResult = { ok: true; side: Side; resumed: boolean } | { ok: false; err: ErrCode };

export interface RoomRecord {
  /** Un partido por fila: modo, primer saque, ganador, motivo y sus games acabados. */
  matches: MatchRow[];
  /**
   * Una línea por evento de sala (nunca por mensaje): 'join 0', 'rejoin 1', 'replace 0', 'disconnect 1', 'leave 0',
   * 'expire 1', 'ready 0', 'unready 1', 'rt 1 1', 'warn', 'timeout 1', 'warmup 0' (quién saca), 'countdown', 'cancel',
   * 'match 1' (primer saque), 'game 2', 'gameover 2 0' (game y ganador), 'between', 'pause 1' (ausentes),
   * 'countdown resume', 'resume', 'mend 0' (ganador), 'abandon 1' (quien abandona), 'closed'.
   */
  events: { at: number; what: string }[];
  /** Una por game y por warm-up, en orden. */
  authorities: MatchRecord[];
}

type Due = 'auth' | 'between' | 'count' | 'warn' | 'timeout' | 'expire0' | 'expire1';

/** Plazos en el orden en que se atienden si vencen a la vez. */
const DUES: readonly Due[] = ['auth', 'between', 'count', 'warn', 'timeout', 'expire0', 'expire1'];
const SIDES: readonly Side[] = [0, 1];
const INF = Number.POSITIVE_INFINITY;
/** Plazos atendidos como mucho en una llamada (cada uno avanza el estado: es solo una red de seguridad). */
const MAX_STEPS = 32;

const other = (s: Side): Side => (s === 0 ? 1 : 0);

export class RoomCore {
  readonly code: string;
  readonly mode: MatchMode;
  readonly record: RoomRecord = { matches: [], events: [], authorities: [] };
  private readonly deps: RoomDeps;
  private readonly cfg: GameConfig;
  private readonly seats: RoomSeats;
  private ph: RoomPhase = 'waiting';
  /** Autoridad del warm-up o del game en curso (null esperando rival). */
  private auth: GameAuthority | null = null;
  /** Lados que la autoridad actual da por ausentes: al acabar el punto en juego, la sala para y vuelve a sincronizar. */
  private readonly absent: [boolean, boolean] = [false, false];
  /** n del siguiente rally cuando no hay autoridad: el `rally` de la última retirada. */
  private rallyBase = 0;
  /** La cuenta atrás de empezar el partido o la de volver tras una pausa. */
  private countdownKind: 'start' | 'resume' = 'start';
  private countdownAt = INF;
  private betweenAt = INF;
  /** `readySince` del Listo cuyo aviso ya salió. */
  private warnedFor: number | null = null;
  /** Perdedor del último partido de esta pareja: saca primero en el warm-up (null: el lado 0). */
  private lastLoser: Side | null = null;
  private match: MatchTally | null = null;
  private everJoined = false;
  /** Reloj de la llamada en curso: lo usan los callbacks de la autoridad, que no traen `now`. */
  private now = 0;

  constructor(deps: RoomDeps) {
    this.deps = deps;
    this.cfg = deps.cfg;
    this.code = deps.code;
    this.mode = deps.mode;
    this.seats = new RoomSeats(deps);
  }

  get phase(): RoomPhase {
    return this.ph;
  }

  /** Sin jugadores ni huecos reservados (después de haber tenido alguno): el servidor la libera. */
  get closed(): boolean {
    return this.everJoined && this.seats.players === 0;
  }

  /** Huecos ocupados (conectados o reservados). */
  get players(): number {
    return this.seats.players;
  }

  /**
   * Entra un jugador nuevo, o vuelve uno con su token (`resumed`). Manda `welcome`, `room` y lo que toque (el `start`
   * del warm-up, la cuenta atrás de vuelta…). Si falla, no manda nada: el servidor contesta `err` y cierra.
   *
   * Contrato con el servidor, que es quien sabe qué conexión es cada lado:
   *  - durante `join`, un `send(side, …)` a un lado sin conexión registrada va a la conexión que está entrando; si sale
   *    bien, el servidor registra esa conexión para `res.side`;
   *  - pestaña duplicada (el token es de un lado aún conectado): la sala manda primero `bye` a la conexión vieja y llama
   *    a `drop(side)`; el servidor la cierra y la olvida EN ESE MOMENTO, así lo que sigue (`welcome`, `room`…) va a la
   *    nueva;
   *  - tras un `drop(side)` (pestaña duplicada, timeout del Listo, `leave`), el cierre de esa conexión vieja NO se
   *    notifica con `disconnect` y sus mensajes ya no se pasan a `receive`: el lado puede ser ya de otra conexión.
   */
  join(hello: HelloMsg, now: number): JoinResult {
    this.begin(now);
    if (this.closed) return { ok: false, err: 'room' };
    const known = hello.tk === undefined ? null : this.seats.sideOfToken(hello.tk);
    const res = known === null ? this.enter(hello) : this.rejoin(known, hello);
    this.syncRoom();
    return res;
  }

  /** Socket cerrado sin `leave`: se reserva el hueco 30 s. */
  disconnect(side: Side, now: number): void {
    this.begin(now);
    if (!this.seats.connected(side)) return;
    this.seats.reserve(side, now + this.cfg.room.reconnectMs);
    this.event(`disconnect ${side}`);
    switch (this.ph) {
      case 'warmup':
        this.seats.at(side).ready = false;
        this.auth?.pause();
        break;
      case 'countdown':
        if (this.countdownKind === 'start') {
          this.seats.at(side).ready = false;
          this.event('cancel');
          this.enterWarmup();
        } else {
          this.markAbsent(side);
          this.enterPaused();
        }
        break;
      case 'match':
        // El punto en juego acaba solo (P56); si no hay vuelo, la pausa empieza ya.
        this.markAbsent(side);
        this.auth?.poll(now);
        this.holdIfIdle();
        break;
      case 'paused':
        this.markAbsent(side);
        break;
      // waiting y between: solo la reserva (el game siguiente empieza en pausa si sigue fuera).
    }
    this.syncRoom();
  }

  receive(side: Side, msg: C2S, now: number): void {
    this.begin(now);
    if (!this.seats.connected(side)) return;
    switch (msg.k) {
      case 'ping':
        if (this.seats.ping(side, msg)) this.auth?.setPing(side, msg.a);
        break;
      case 'rdy':
        this.onReady(side, msg.on === 1);
        break;
      case 'rt':
        this.onReadTest(side, msg.on === 1);
        break;
      case 'leave':
        this.onLeave(side);
        break;
      case 'p':
        // La raqueta se reenvía en cualquier fase con autoridad (la envoltura de `send` la descarta si el rival no está).
        this.auth?.receive(side, msg, now);
        break;
      case 'toss':
      case 'hit':
      case 'wf':
      case 'end':
        // En cuenta atrás, entre games o en pausa no llegan a la autoridad.
        if (this.ph === 'warmup' || this.ph === 'match') this.auth?.receive(side, msg, now);
        break;
      // hello y again: nada dentro de una sala.
    }
    this.syncRoom();
  }

  /** Atiende los plazos vencidos (lo llama el temporizador del servidor a `nextDeadline()`). */
  poll(now: number): void {
    this.begin(now);
    this.syncRoom();
  }

  /** El plazo más cercano (Infinity si no hay ninguno). */
  nextDeadline(): number {
    let t = INF;
    for (const d of DUES) t = Math.min(t, this.timeOf(d));
    return t;
  }

  // ——— Plazos ———

  /** Fija el reloj de la llamada y atiende, en orden, los plazos vencidos hasta `now`. */
  private begin(now: number): void {
    this.now = now;
    for (let i = 0; i < MAX_STEPS; i++) {
      let due: Due | null = null;
      let at = INF;
      for (const d of DUES) {
        const t = this.timeOf(d);
        if (t <= now && t < at) {
          due = d;
          at = t;
        }
      }
      if (due === null) return;
      this.fire(due);
    }
  }

  private timeOf(d: Due): number {
    const ready = this.ph === 'warmup' ? this.seats.onlyReady() : null;
    const since = ready === null ? INF : this.seats.at(ready).readySince;
    switch (d) {
      case 'auth':
        return this.auth ? this.auth.nextDeadline() : INF;
      case 'between':
        return this.ph === 'between' ? this.betweenAt : INF;
      case 'count':
        return this.ph === 'countdown' ? this.countdownAt : INF;
      case 'warn':
        return since !== this.warnedFor ? since + this.cfg.room.warmupWarnMs : INF;
      case 'timeout':
        return since + this.cfg.room.warmupTimeoutMs;
      case 'expire0':
        return this.seats.reserveEnd(0);
      case 'expire1':
        return this.seats.reserveEnd(1);
    }
  }

  private fire(d: Due): void {
    if (d === 'auth') this.auth?.poll(this.now);
    else if (d === 'between') this.nextGame();
    else if (d === 'count') this.countdownEnd();
    else if (d === 'warn') this.warn();
    else if (d === 'timeout') this.readyTimeout();
    else this.expire(d === 'expire0' ? 0 : 1);
  }

  // ——— Entrar, volver, irse ———

  private enter(hello: HelloMsg): JoinResult {
    const s = this.seats.freeSide();
    if (s === null) return { ok: false, err: 'full' };
    this.seats.sit(s, hello.nm);
    this.everJoined = true;
    this.event(`join ${s}`);
    this.seats.welcome(s);
    if (this.seats.get(other(s))) this.enterWarmup();
    this.seats.sendPings(s);
    return { ok: true, side: s, resumed: false };
  }

  private rejoin(s: Side, hello: HelloMsg): JoinResult {
    const replaced = this.seats.connected(s);
    if (replaced) {
      // Pestaña duplicada: la conexión nueva sustituye a la vieja y la sala sigue sin pausa.
      this.seats.send(s, { k: 'bye', m: 'Conectado desde otra pestaña' });
      this.seats.drop(s);
    }
    this.seats.renew(s, hello.nm);
    this.event(`${replaced ? 'replace' : 'rejoin'} ${s}`);
    this.seats.welcome(s);
    this.resync(s, replaced);
    this.seats.sendPings(s);
    return { ok: true, side: s, resumed: true };
  }

  /** Lo que necesita la conexión que vuelve (o sustituye a otra) para tener el estado de la sala. */
  private resync(s: Side, replaced: boolean): void {
    switch (this.ph) {
      case 'warmup':
        // Práctica: se reanuda con un `start` a los dos (corta el rally en juego, que no cuenta).
        if (this.seats.allConnected) {
          this.syncRoom();
          this.auth?.resume(this.now);
        }
        return;
      case 'match':
        // La conexión nueva no tiene el vuelo en juego: acaba como si no devolviera y, sin vuelo, cuenta atrás y resume.
        if (replaced) {
          this.markAbsent(s);
          this.auth?.poll(this.now);
        }
        this.holdIfIdle();
        return;
      case 'paused':
        this.clearAbsentConnected();
        if (this.seats.allConnected) this.enterCountdown('resume');
        return;
      // waiting, countdown y between: el estado llega con el `room` y con el siguiente `start`.
    }
  }

  private onLeave(s: Side): void {
    this.seats.at(s).connected = false;
    this.event(`leave ${s}`);
    this.seats.drop(s);
    this.release(s);
  }

  /** Venció la reserva de un desconectado. */
  private expire(s: Side): void {
    if (!this.inMatch()) this.event(`expire ${s}`);
    this.release(s);
  }

  /** El hueco queda libre (sin reserva): en el partido es abandono; luego, a esperar rival (o se cierra la sala). */
  private release(s: Side): void {
    if (this.inMatch()) this.endMatch(other(s), 'abandon');
    this.seats.free(s);
    // Pareja nueva: el warm-up vuelve a empezar sacando el lado 0.
    this.lastLoser = null;
    if (this.seats.players) {
      this.enterWaiting();
      return;
    }
    this.retire();
    this.ph = 'waiting';
    this.countdownAt = this.betweenAt = INF;
    this.event('closed');
  }

  // ——— Listo y prueba de lectura ———

  private onReady(s: Side, on: boolean): void {
    const seat = this.seats.at(s);
    if (this.ph === 'warmup') {
      if (seat.ready === on) return;
      seat.ready = on;
      if (on) seat.readySince = this.now;
      this.event(`${on ? 'ready' : 'unready'} ${s}`);
      if (on && this.seats.bothReady() && this.seats.allConnected) this.enterCountdown('start');
      return;
    }
    if (this.ph === 'countdown' && this.countdownKind === 'start' && !on && seat.ready) {
      seat.ready = false;
      this.event(`unready ${s}`);
      this.event('cancel');
      this.enterWarmup();
    }
  }

  private onReadTest(s: Side, on: boolean): void {
    // Solo antes del partido (§13.1): en el partido no hay prueba de lectura.
    if (!(this.ph === 'waiting' || this.ph === 'warmup' || (this.ph === 'countdown' && this.countdownKind === 'start'))) return;
    const seat = this.seats.at(s);
    if (seat.readTest === on) return;
    seat.readTest = on;
    this.event(`rt ${s} ${on ? 1 : 0}`);
  }

  private warn(): void {
    const s = this.seats.onlyReady();
    if (s === null) return;
    this.warnedFor = this.seats.at(s).readySince;
    this.event('warn');
    this.syncRoom();
  }

  /** El Listo de uno lleva 180 s esperando: el que no está Listo sale (sin reserva) y el otro pierde su Listo. */
  private readyTimeout(): void {
    const s = this.seats.onlyReady();
    if (s === null) return;
    const late = other(s);
    this.event(`timeout ${late}`);
    if (this.seats.connected(late)) {
      this.seats.send(late, { k: 'bye', m: 'No diste a Listo a tiempo' });
      this.seats.drop(late);
      this.seats.at(late).connected = false;
    }
    this.release(late);
  }

  // ——— Fases ———

  private enterWaiting(): void {
    this.retire();
    this.ph = 'waiting';
    this.countdownAt = this.betweenAt = INF;
    this.seats.clearReady();
    this.syncRoom();
  }

  /** Práctica nueva (warm-up): saca el lado 0, o el que perdió el último partido. En pausa si falta alguien. */
  private enterWarmup(): void {
    this.ph = 'warmup';
    this.countdownAt = this.betweenAt = INF;
    const fs = this.lastLoser ?? 0;
    const a = this.newAuthority();
    this.event(`warmup ${fs}`);
    this.syncRoom();
    a.start(this.now, { firstServer: fs, n0: this.rallyBase, practice: true, game: 0 });
    if (!this.seats.allConnected) a.pause();
  }

  private enterCountdown(kind: 'start' | 'resume'): void {
    this.ph = 'countdown';
    this.countdownKind = kind;
    this.countdownAt = this.now + (kind === 'start' ? this.cfg.room.countdownMs : this.cfg.room.resumeCountdownMs);
    // El rally del warm-up se corta: lo que llegue de él ya es pasado (Decisión 6).
    if (kind === 'start') this.auth?.pause();
    this.event(kind === 'start' ? 'countdown' : 'countdown resume');
    this.syncRoom();
  }

  private countdownEnd(): void {
    this.countdownAt = INF;
    if (this.countdownKind === 'start') {
      this.match = new MatchTally(this.deps.random() < 0.5 ? 0 : 1, this.mode, this.cfg);
      this.seats.clearReadTest();
      this.event(`match ${this.match.first}`);
      this.beginGame();
      return;
    }
    this.ph = 'match';
    this.event('resume');
    this.syncRoom();
    this.auth?.resume(this.now);
  }

  private enterPaused(): void {
    this.ph = 'paused';
    this.countdownAt = INF;
    this.event(`pause ${this.seats.away().join(' ')}`);
    this.syncRoom();
  }

  /** En el partido sin vuelo en juego y con alguien ausente (o que acaba de volver): parar y volver a sincronizar. */
  private holdIfIdle(): void {
    const a = this.auth;
    if (this.ph !== 'match' || !a || a.busy || !(this.absent[0] || this.absent[1])) return;
    a.pause();
    this.clearAbsentConnected();
    if (this.seats.allConnected) this.enterCountdown('resume');
    else this.enterPaused();
  }

  private nextGame(): void {
    this.betweenAt = INF;
    if (this.match) this.match.game += 1;
    this.beginGame();
  }

  /** La autoridad del game en curso; empieza en pausa si falta alguien (vuelta tras el `between`). */
  private beginGame(): void {
    const m = this.match;
    if (!m) return;
    const all = this.seats.allConnected;
    if (all) {
      this.ph = 'match';
      this.syncRoom();
    }
    const a = this.newAuthority();
    m.addGame(a.record);
    this.event(`game ${m.game}`);
    a.start(this.now, { firstServer: m.firstServer, n0: this.rallyBase, practice: false, game: m.game });
    if (all) return;
    a.pause();
    for (const s of this.seats.away()) this.markAbsent(s);
    this.enterPaused();
  }

  private onGameOver(winner: Side, score: [number, number]): void {
    const m = this.match;
    if (this.ph !== 'match' || !m) return;
    this.event(`gameover ${m.game} ${winner}`);
    const mw = m.gameOver(winner, score);
    if (mw !== null) {
      this.endMatch(mw, 'score');
      this.enterWarmup();
      return;
    }
    this.ph = 'between';
    this.betweenAt = this.now + this.cfg.room.betweenGamesMs;
    this.event('between');
    this.syncRoom();
  }

  /** `mend` a los presentes y registro del partido; los Listos vuelven a 0. */
  private endMatch(winner: Side, why: 'score' | 'abandon'): void {
    const m = this.match;
    if (!m) return;
    const { mend, row } = m.finish(winner, why);
    this.seats.both(mend);
    this.record.matches.push(row);
    this.event(why === 'score' ? `mend ${winner}` : `abandon ${other(winner)}`);
    this.lastLoser = other(winner);
    this.match = null;
    this.retire();
    this.countdownAt = this.betweenAt = INF;
    this.seats.clearReady();
  }

  /** En el partido (también entre games, en pausa y en la cuenta atrás de vuelta): irse es abandonar. */
  private inMatch(): boolean {
    return this.ph === 'match' || this.ph === 'between' || this.ph === 'paused' || (this.ph === 'countdown' && this.countdownKind === 'resume');
  }

  // ——— Autoridad ———

  /**
   * Retira la autoridad actual y crea otra, con los pings conocidos. Lo que haga una autoridad retirada (mensajes,
   * callbacks) ya no sale de la sala, aunque ocurra dentro de su propio `receive` (re-entrada: un fin de partido que
   * arranca el warm-up dentro del `receive` del último golpe).
   */
  private newAuthority(): GameAuthority {
    this.retire();
    let self: GameAuthority | null = null;
    const send = (to: Side, msg: S2C): void => {
      if (self !== null && self === this.auth) this.seats.send(to, msg);
    };
    const a = this.deps.makeAuthority ? this.deps.makeAuthority(send) : new ServerMatch(this.cfg, { send, log: (line) => this.deps.log?.(`[${this.code}] ${line}`) });
    self = a;
    // El fin del game (pm.go ≠ −1) lo atiende onGameOver, que llega justo después.
    a.onPoint = (pm) => {
      if (a === this.auth && pm.go === -1) this.holdIfIdle();
    };
    a.onGameOver = (w, sc) => {
      if (a === this.auth) this.onGameOver(w, sc);
    };
    for (const s of SIDES) if (this.seats.pings[s] >= 0) a.setPing(s, this.seats.pings[s]);
    this.auth = a;
    this.record.authorities.push(a.record);
    return a;
  }

  private retire(): void {
    if (!this.auth) return;
    this.rallyBase = this.auth.rally;
    this.auth = null;
    this.absent[0] = this.absent[1] = false;
  }

  private markAbsent(s: Side): void {
    this.absent[s] = true;
    this.auth?.setAbsent(s, true);
  }

  private clearAbsentConnected(): void {
    for (const s of SIDES) {
      if (!this.absent[s] || !this.seats.connected(s)) continue;
      this.absent[s] = false;
      this.auth?.setAbsent(s, false);
    }
  }

  // ——— Lo que enseña `room` ———

  private syncRoom(): void {
    const [dk, at] = this.deadlineShown();
    this.seats.sync({ ph: this.ph, gw: this.match ? this.match.gw : [0, 0], dk, at }, this.now);
  }

  /** El plazo que enseña `room` y cuándo vence. */
  private deadlineShown(): [RoomMsg['dk'], number] {
    switch (this.ph) {
      case 'countdown':
        return ['count', this.countdownAt];
      case 'between':
        return ['between', this.betweenAt];
      case 'paused':
        return ['pause', this.seats.firstReserveEnd()];
      case 'warmup': {
        const r = this.seats.firstReserveEnd();
        if (r < INF) return ['pause', r];
        const s = this.seats.onlyReady();
        const since = s === null ? null : this.seats.at(s).readySince;
        return since !== null && since === this.warnedFor ? ['ready', since + this.cfg.room.warmupTimeoutMs] : ['', INF];
      }
      default:
        return ['', INF];
    }
  }

  private event(what: string): void {
    this.record.events.push({ at: this.now, what });
    this.deps.log?.(`[${this.code}] ${what}`);
  }
}
