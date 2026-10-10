/**
 * Lo que el Worker y el Durable Object hacen con un WebSocket antes de que llegue a la sala (V0.4, Decisiones 12 y
 * 14): medir un mensaje (16 KB como mucho) y cerrar con un `err` en español que el navegador puede leer.
 */
import { type ErrCode, encode } from '@ppp/shared';
import { ERR_TEXT } from '../policy.ts';

/** Códigos de cierre tras un `err` (violación de la política) y por un mensaje demasiado grande. */
export const POLICY_CLOSE = 1008;
export const TOO_BIG_CLOSE = 1009;
const utf8 = new TextEncoder();

/**
 * Bytes de un mensaje, exactos hasta donde importan para el tope `max`: un texto solo se codifica (UTF-8) si su
 * longitud no lo decide ya (≤ max/3 caracteres siempre cabe; más de `max` nunca).
 */
export function messageBytes(data: string | ArrayBuffer, max: number): number {
  if (typeof data !== 'string') return data.byteLength;
  if (data.length * 3 <= max || data.length > max) return data.length;
  return utf8.encode(data).byteLength;
}

/** `err` con su texto y cierre (Decisión 14). */
export function sendErr(ws: WebSocket, code: ErrCode, text: string, closeCode = POLICY_CLOSE): void {
  try {
    ws.send(encode({ k: 'err', m: code, d: text }));
    ws.close(closeCode, code);
  } catch {
    // ya cerrado
  }
}

/** Respuesta 101 con un socket que solo lleva el `err` y se cierra: un 4xx antes de abrir no llega legible al navegador. */
export function rejectSocket(code: ErrCode, text: string = ERR_TEXT[code]): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  sendErr(pair[1], code, text);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
