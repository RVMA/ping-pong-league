/**
 * Reglas del rally, del saque y del marcador [§9.3, §10].
 * Funciones puras sobre estado plano: el servidor (V0.3) será la autoridad usando este mismo código.
 */
import type { GameConfig } from './config.ts';
import type { BallContact } from './physics.ts';
import type { Side } from './types.ts';

export type PointReason =
  | 'NET' // la bola no pasó la red
  | 'OUT' // no botó en el campo rival
  | 'OWN_SIDE' // botó en el propio campo tras golpear (rally)
  | 'DOUBLE_BOUNCE' // dos botes en el campo del receptor
  | 'MISSED' // el receptor no la devolvió
  | 'VOLLEY' // golpeó antes de que botara en su campo
  | 'SERVE_FAULT' // saque que no bota primero en el campo propio
  | 'TOSS_MISSED'; // la bola del saque cayó sin golpearla

export interface RallyState {
  /** Quién golpeó por última vez (null antes del saque). */
  lastHitter: Side | null;
  /** El último golpe fue el saque. */
  isServe: boolean;
  /** Lados de los botes en la mesa desde el último golpe. */
  bounces: Side[];
  /** La bola tocó la red desde el último golpe. */
  netTouched: boolean;
  /** Golpes válidos en el rally (incluye el saque). */
  hits: number;
}

export type RuleOutcome = { kind: 'point'; winner: Side; reason: PointReason } | { kind: 'let' } | null;

export function newRally(): RallyState {
  return { lastHitter: null, isServe: false, bounces: [], netTouched: false, hits: 0 };
}

function other(s: Side): Side {
  return s === 0 ? 1 : 0;
}

/** Aplica un contacto de la bola (mesa, red, suelo) al estado del rally. */
export function applyContact(r: RallyState, c: BallContact): RuleOutcome {
  if (r.lastHitter === null) return null;
  const H = r.lastHitter;
  const O = other(H);
  if (c.kind === 'net') {
    r.netTouched = true;
    return null;
  }
  // Razón cuando el golpeador falla: si tocó la red y no llegó al otro lado, es "red".
  const hitterFault = (fallback: PointReason): RuleOutcome => ({
    kind: 'point',
    winner: O,
    reason: r.netTouched && !r.bounces.includes(O) ? 'NET' : fallback,
  });

  if (c.kind === 'table') {
    const S = c.side;
    if (r.isServe) {
      if (r.bounces.length === 0) {
        if (S === H) {
          r.bounces.push(S);
          return null;
        }
        return { kind: 'point', winner: O, reason: 'SERVE_FAULT' };
      }
      if (r.bounces.length === 1) {
        if (S === O) {
          if (r.netTouched) return { kind: 'let' };
          r.bounces.push(S);
          return null;
        }
        return hitterFault('SERVE_FAULT');
      }
      // Ya botó en ambos campos: un segundo bote en el receptor es doble bote.
      return { kind: 'point', winner: H, reason: 'DOUBLE_BOUNCE' };
    }
    if (r.bounces.length === 0) {
      if (S === O) {
        r.bounces.push(S);
        return null;
      }
      return hitterFault('OWN_SIDE');
    }
    return { kind: 'point', winner: H, reason: 'DOUBLE_BOUNCE' };
  }

  // Suelo.
  const validBounces = r.isServe ? 2 : 1;
  if (r.bounces.length >= validBounces) return { kind: 'point', winner: H, reason: 'MISSED' };
  if (r.isServe && r.bounces.length === 0) return hitterFault('SERVE_FAULT');
  return hitterFault('OUT');
}

/**
 * ¿Puede `player` golpear ahora según las reglas? Si no, devuelve la falta (volea).
 * Se llama en el instante del contacto.
 */
export function checkStrike(r: RallyState, player: Side): RuleOutcome {
  if (r.lastHitter === null || r.lastHitter === player) return null;
  const needed = r.isServe ? 2 : 1;
  const bouncedOnMine = r.bounces.length >= needed && r.bounces[r.bounces.length - 1] === player;
  if (!bouncedOnMine) return { kind: 'point', winner: r.lastHitter, reason: 'VOLLEY' };
  return null;
}

/** Registra un golpe válido. */
export function registerStrike(r: RallyState, player: Side, serve: boolean): void {
  r.lastHitter = player;
  r.isServe = serve;
  r.bounces = [];
  r.netTouched = false;
  r.hits += 1;
}

export function isGameOver(score: [number, number], rules: GameConfig['rules']): Side | null {
  for (const s of [0, 1] as Side[]) {
    const mine = score[s];
    const theirs = score[other(s)];
    if (mine >= rules.pointsToWin && mine - theirs >= rules.winBy) return s;
  }
  return null;
}

/** Quién saca dado el marcador [§9.3]: cada `serveEvery` puntos; desde 10-10, cada punto. */
export function serverFor(score: [number, number], firstServer: Side, rules: GameConfig['rules']): Side {
  const total = score[0] + score[1];
  const deuceAt = (rules.pointsToWin - 1) * 2;
  let turn: number;
  if (score[0] >= rules.pointsToWin - 1 && score[1] >= rules.pointsToWin - 1) {
    turn = Math.floor(deuceAt / rules.serveEvery) + (total - deuceAt);
  } else {
    turn = Math.floor(total / rules.serveEvery);
  }
  return turn % 2 === 0 ? firstServer : other(firstServer);
}
