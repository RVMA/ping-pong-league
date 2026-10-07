/**
 * Validación en el servidor [§17.3]: solo comprobaciones de plausibilidad (el anti-cheat está fuera de alcance ✅).
 *  - la conexión: versión del protocolo, misma config (hash), parámetros de latencia simulada y desfase declarado;
 *  - la raqueta del golpe: dentro de sus límites y alcanzable desde su última posición enviada a su velocidad máxima;
 *  - el click: dentro del vuelo al que responde y no más tarde de lo que el jugador pudo verlo.
 */
import { type GameConfig, tickMs } from '../config.ts';
import { type Side, sideSign } from '../types.ts';
import { configHash } from './config-hash.ts';
import { type ErrCode, type HelloMsg, PROTOCOL_VERSION } from './protocol.ts';

/** Desfase de latencia declarado dentro de [latencyOffsetMin, latencyOffsetMax] [§3.7]. */
export function validOffset(o: number, cfg: GameConfig): boolean {
  return o >= cfg.input.latencyOffsetMin && o <= cfg.input.latencyOffsetMax;
}

/** null si se acepta la conexión; si no, el código de error. */
export function validHello(h: HelloMsg, cfg: GameConfig): ErrCode | null {
  if (h.v !== PROTOCOL_VERSION) return 'version';
  if (h.h !== configHash(cfg)) return 'config';
  const lat = cfg.net.latency;
  if (h.p > lat.maxPingMs || h.bp > lat.maxPingMs || h.j > lat.maxJitter || h.sp > lat.spike.maxProb || !validOffset(h.o, cfg)) return 'params';
  return null;
}

/** Raqueta (mundo) dentro de sus límites para ese lado; al sacar, detrás de la línea de fondo y dentro del ancho. */
export function validPaddleBounds(pos: { x: number; z: number }, side: Side, serve: boolean, cfg: GameConfig): boolean {
  const pc = cfg.paddle;
  const tol = cfg.net.validation.boundsToleranceM;
  const sgn = sideSign(side);
  const x = pos.x * sgn;
  const z = pos.z * sgn;
  if (Math.abs(x) > pc.maxLateral + tol || z < pc.minDepth - tol || z > pc.maxDepth + tol) return false;
  if (serve && (z < pc.serveMinDepth - tol || Math.abs(x) > pc.serveMaxLateral + tol)) return false;
  return true;
}

/** La raqueta pudo ir de `from` a `to` (tiempo de rally en ms, posiciones en m) a su velocidad máxima. */
export function validReach(from: { r: number; x: number; z: number } | null, to: { r: number; x: number; z: number }, cfg: GameConfig): boolean {
  if (!from) return true;
  const dt = Math.max(0, to.r - from.r) / 1000;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.sqrt(dx * dx + dz * dz) <= cfg.paddle.maxSpeed * dt + cfg.net.validation.reachToleranceM;
}

/**
 * Click en `tMs` del vuelo: después de que empiece, no después del paso en que el vuelo acaba (`endIndex`) y no más
 * tarde de lo que pudo verse: desde que el servidor envió el vuelo han pasado `elapsedMs` (más una tolerancia).
 */
export function validClickTime(tMs: number, endIndex: number, elapsedMs: number, cfg: GameConfig): boolean {
  if (!(tMs > 0)) return false;
  if (tMs > endIndex * tickMs(cfg) + 1e-6) return false;
  return tMs <= elapsedMs + cfg.net.validation.futureToleranceMs;
}
