/**
 * Traza de un partido LOCAL (Simulation + Bot) troceado en vuelos, para comprobar que los vuelos de red reproducen
 * la simulación local: estados tras cada paso, contactos de cada paso, cómo acabó cada vuelo y los clicks que
 * recibió (con el intento, la raqueta y su historial en el instante del click).
 */
import { Bot } from '../../src/bot.ts';
import { type PaddleSample, settleRef, settleSpeeds } from '../../src/click.ts';
import { type GameConfig, simDt } from '../../src/config.ts';
import type { HitEvaluation } from '../../src/hit.ts';
import { type BallContact, type BallState, cloneBall } from '../../src/physics.ts';
import { newRally, type PointReason, type RallyState, registerStrike } from '../../src/rules.ts';
import { solveShot } from '../../src/shot.ts';
import { Simulation, type SimEvent } from '../../src/sim.ts';
import type { InputIntent, Side } from '../../src/types.ts';

export interface TracedClick {
  side: Side;
  /** Instante absoluto del click (ms de la simulación local). */
  fire: number;
  intent: InputIntent;
  /** Raqueta en el click (tras moverse en ese tick). */
  pad: { x: number; z: number };
  speeds: number[];
  ref: { x: number; z: number } | null;
  swing: Extract<SimEvent, { type: 'swing' }> | null;
  whiff: { evaluation: HitEvaluation | null } | null;
}

export type TracedEnd =
  | { kind: 'point'; winner: Side; reason: PointReason; k: number }
  | { kind: 'let'; k: number }
  | { kind: 'hit'; player: Side; j: number; next: TracedFlight };

export interface TracedFlight {
  mode: 'toss' | 'rally';
  hitter: Side;
  exit: BallState;
  rally: RallyState;
  /** Tick (entero) del índice 0 del vuelo: su instante es tick0 · tickMs. */
  tick0: number;
  states: BallState[];
  contacts: BallContact[][];
  end: TracedEnd | null;
  clicks: TracedClick[];
}

function contactOf(e: SimEvent): BallContact | null {
  if (e.type === 'bounce') return { kind: 'table', pos: e.pos, side: e.side, impactSpeed: e.speed };
  if (e.type === 'net') return { kind: 'net', pos: e.pos, cord: e.cord, fromSide: e.pos.z >= 0 ? 0 : 1 };
  if (e.type === 'floor') return { kind: 'floor', pos: e.pos };
  return null;
}

export function traceLocalMatch(cfg: GameConfig, seeds: [number, number], maxTicks: number): TracedFlight[] {
  const sim = new Simulation(cfg);
  const bots = [new Bot(0, cfg.bot.difficulties.medium, cfg, seeds[0]), new Bot(1, cfg.bot.difficulties.medium, cfg, seeds[1])];
  const flights: TracedFlight[] = [];
  let cur: TracedFlight | null = null;
  for (let n = 0; n < maxTicks && sim.state.phase !== 'gameOver'; n++) {
    const intents: [InputIntent, InputIntent] = [bots[0].think(sim), bots[1].think(sim)];
    const events = sim.step(intents);
    const t = sim.state.tick;
    let stepContacts: BallContact[] = [];
    for (const e of events) {
      if (e.type === 'toss') {
        const b = sim.state.ball;
        const top = cfg.world.tableHeight + cfg.serve.holdHeight;
        const auto = b.vel.y === cfg.serve.tossSpeed && b.pos.y === top;
        const exit: BallState = { pos: { x: b.pos.x, y: top, z: b.pos.z }, vel: { x: 0, y: cfg.serve.tossSpeed, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
        cur = { mode: 'toss', hitter: e.server, exit, rally: newRally(), tick0: auto ? t : t - 1, states: [cloneBall(exit)], contacts: [[]], end: null, clicks: [] };
        flights.push(cur);
        stepContacts = [];
      } else if ((e.type === 'swing' || e.type === 'whiff') && cur) {
        const side = e.player;
        const hist: readonly PaddleSample[] = sim.paddleHistory(side);
        const fire = intents[side].fire!;
        cur.clicks.push({
          side,
          fire,
          intent: intents[side],
          pad: { ...sim.state.paddles[side].pos },
          speeds: [...settleSpeeds(hist, fire, cfg)],
          ref: settleRef(hist, fire, cfg),
          swing: e.type === 'swing' ? e : null,
          whiff: e.type === 'whiff' ? { evaluation: e.evaluation } : null,
        });
      } else if (e.type === 'hit') {
        const vel = solveShot(e.pos, e.targets, sim.env, simDt(cfg), cfg).vel;
        const exit: BallState = { pos: { ...e.pos }, vel, spin: { ...e.targets.spin } };
        const rally = newRally();
        rally.hits = sim.state.rally.hits - 1;
        registerStrike(rally, e.player, e.serve);
        const next: TracedFlight = { mode: 'rally', hitter: e.player, exit, rally, tick0: t - 1, states: [cloneBall(exit)], contacts: [[]], end: null, clicks: [] };
        if (cur) cur.end = { kind: 'hit', player: e.player, j: t - 1 - cur.tick0, next };
        cur = next;
        flights.push(cur);
        stepContacts = [];
      } else if (e.type === 'point' || e.type === 'let') {
        if (cur) {
          cur.states[t - cur.tick0] = cloneBall(sim.state.ball);
          cur.contacts[t - cur.tick0] = stepContacts;
          cur.end = e.type === 'point' ? { kind: 'point', winner: e.winner, reason: e.reason, k: t - cur.tick0 } : { kind: 'let', k: t - cur.tick0 };
        }
        cur = null;
      } else {
        const c = contactOf(e);
        if (c) stepContacts.push(c);
      }
    }
    if (cur) {
      cur.states[t - cur.tick0] = cloneBall(sim.state.ball);
      cur.contacts[t - cur.tick0] = stepContacts;
    }
  }
  return flights;
}
