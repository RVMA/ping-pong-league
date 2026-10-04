/**
 * Resolución de un golpe sobre un vuelo [§4.2, §7.5, §17.2]: del evento de golpe (click en el reloj del vuelo, raqueta,
 * gesto, teclas, bloqueo y muestras de «colocado») al estado de salida del vuelo siguiente. Es el mismo cálculo que
 * Simulation.handleClick + applyHit, y lo hacen igual quien golpea (predicción, con el evento ya cuantizado), el
 * servidor (autoridad) y el rival (para ver el golpe). Como el vuelo es determinista, se puede resolver en el click
 * aunque el contacto llegue hasta 120 ms después.
 */
import { aimFactorFromSpeeds, evaluateClickSamples, fixedHitPos } from '../click.ts';
import { type GameConfig, tickMs } from '../config.ts';
import type { HitEvaluation } from '../hit.ts';
import type { BallState, PhysicsEnv } from '../physics.ts';
import { checkStrike, type RuleOutcome } from '../rules.ts';
import { planShot, type ShotTargets, solveShot } from '../shot.ts';
import { type ShotType, shotFromKeys, type StrokeType, strokePower } from '../stroke.ts';
import type { Side, Vec3 } from '../types.ts';
import { contactIndex, type Flight } from './flight.ts';
import type { HitInput } from './protocol.ts';

export interface ResolvedHit {
  evaluation: HitEvaluation;
  aimFactor: number;
  /** Posición fija con la que se midió (§4.2): la raqueta queda ahí hasta el contacto. */
  hitPos: { x: number; z: number };
  /** Gesto efectivo (× aimFactor). */
  swing: { vx: number; vy: number };
  type: StrokeType;
  shot: ShotType;
  block: boolean;
  serve: boolean;
  power: number;
  /** Contacto en ms del vuelo (max(click, t_ideal)) e índice del estado con el que se golpea. */
  contactMs: number;
  j: number;
  /** El vuelo acaba antes del contacto: el golpe no llega a darse. */
  late: boolean;
  /** Falta en el contacto (volea); null si es válido. */
  foul: RuleOutcome;
  contact: Vec3;
  incoming: { vel: Vec3; spin: Vec3 };
  targets: ShotTargets | null;
  exit: BallState | null;
}

export type HitResult = { kind: 'hit'; hit: ResolvedHit } | { kind: 'whiff'; evaluation: HitEvaluation | null };

/** Resuelve el click de `side` sobre `flight`. Si `side` no es quien puede golpearla, es un fallo sin bola. */
export function resolveHit(flight: Flight, side: Side, h: HitInput, cfg: GameConfig, env: PhysicsEnv, dt: number): HitResult {
  if (side !== flight.receiver) return { kind: 'whiff', evaluation: null };
  const serve = flight.mode === 'toss';
  const fire = h.t;
  const block = h.block && !serve;
  const aimFactor = block ? 0 : aimFactorFromSpeeds(h.speeds, cfg);
  const swing = { vx: h.swingVx * aimFactor, vy: 0 };
  const type: StrokeType = serve ? 'NORMAL' : shotFromKeys(h.keys);
  const hitPos = fixedHitPos(h.pad, h.ref, swing.vx, aimFactor, cfg);
  const evaluation = evaluateClickSamples(flight.clickSamples(fire), side, fire, hitPos, serve, cfg, env);
  if (!evaluation || evaluation.tier === 'WHIFF') return { kind: 'whiff', evaluation };

  const contactMs = Math.max(fire, evaluation.tIdeal);
  const j = contactIndex(contactMs, tickMs(cfg));
  const late = j >= flight.end.i;
  const shot: ShotType = block ? 'BLOCK' : type;
  const power = block ? 0 : strokePower(type, evaluation.tier, aimFactor, cfg);
  const ball: BallState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
  if (!late) flight.readState(j, ball);
  const contact = { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z };
  const incoming = { vel: { ...ball.vel }, spin: { ...ball.spin } };
  const base = { evaluation, aimFactor, hitPos, swing, type, shot, block, serve, power, contactMs, j, late, contact, incoming };
  if (late) return { kind: 'hit', hit: { ...base, foul: null, targets: null, exit: null } };

  const foul = serve ? null : checkStrike(flight.rallyBefore(j), side);
  if (foul) return { kind: 'hit', hit: { ...base, foul, targets: null, exit: null } };
  const targets = planShot(evaluation, contact, { swing, type, aimFactor }, side, cfg, serve, { block, incoming });
  const sol = solveShot(contact, targets, env, dt, cfg);
  const exit: BallState = { pos: { ...contact }, vel: { x: sol.vel.x, y: sol.vel.y, z: sol.vel.z }, spin: { x: targets.spin.x, y: targets.spin.y, z: targets.spin.z } };
  return { kind: 'hit', hit: { ...base, foul: null, targets, exit } };
}
