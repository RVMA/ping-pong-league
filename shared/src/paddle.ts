/**
 * Raqueta con inercia [§3.2]: persigue al objetivo con velocidad y aceleración máximas en el
 * plano horizontal (x, z). No sigue al cursor 1:1. La altura es automática (ver hit.ts: alcance).
 */
import type { GameConfig } from './config.ts';

export interface PaddleKinematics {
  pos: { x: number; z: number };
  vel: { x: number; z: number };
}

/**
 * Avanza la raqueta dt segundos de tiempo REAL hacia (tx, tz) del mundo.
 * Comportamiento "arrive": acelera hasta maxSpeed y frena a tiempo para no pasarse.
 */
export function stepPaddle(p: PaddleKinematics, tx: number, tz: number, dt: number, pc: GameConfig['paddle'], speedFactor = 1): void {
  const maxSpeed = pc.maxSpeed * speedFactor;
  const maxAccel = pc.maxAccel;
  const dx = tx - p.pos.x;
  const dz = tz - p.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  let desX = 0;
  let desZ = 0;
  if (dist > 1e-5) {
    // Velocidad con la que todavía se puede frenar en `dist` con maxAccel.
    const brake = Math.sqrt(2 * maxAccel * dist);
    const speed = Math.min(maxSpeed, brake, dist / dt);
    desX = (dx / dist) * speed;
    desZ = (dz / dist) * speed;
  }
  let dvx = desX - p.vel.x;
  let dvz = desZ - p.vel.z;
  const dv = Math.sqrt(dvx * dvx + dvz * dvz);
  const maxDv = maxAccel * dt;
  if (dv > maxDv) {
    dvx *= maxDv / dv;
    dvz *= maxDv / dv;
  }
  p.vel.x += dvx;
  p.vel.z += dvz;
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
}
