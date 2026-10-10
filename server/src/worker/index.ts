/**
 * Worker de Cloudflare (producción, V0.4; Decisiones 1, 13, 14, 16 y 20 del plan; §17.7): sirve el cliente (Static
 * Assets, `client/dist`) y lleva cada WebSocket de `/ws` al Durable Object de su sala, uno por código:
 *  - `/ws?create=<modo>`: prueba hasta 8 códigos al azar; el objeto de un código ocupado contesta 409;
 *  - `/ws?room=<código>`: al objeto de ese código, que nunca crea una sala;
 *  - `/ws?bot=…` y las salas de bot `b-<n>` solo existen en el servidor Node de desarrollo.
 * Antes de abrir el socket solo se rechaza lo que no es un WebSocket (426) y un origen ajeno (403); los demás errores
 * que el usuario tiene que leer son un `err` en español por el socket, y su cierre.
 */
import { makeConfig, type MatchMode, newRoomCode, parseRoute } from '@ppp/shared';
import { cryptoRandom, NO_FREE_CODE_TEXT, originAllowed, routeErrorText, WORKER_TEXT } from '../policy.ts';
import { rejectSocket } from './sockets.ts';

export { RoomDO } from './room-do.ts';

const cfg = makeConfig();
/** Códigos al azar que se prueban al crear una sala (hay 24⁴ = 331 776: chocar con uno ocupado es raro). */
const CREATE_TRIES = 8;

function stubFor(env: Env, code: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

/** La misma petición (con sus cabeceras de WebSocket), con el código y, al crear, el modo. */
function forward(req: Request, code: string, mode: MatchMode | null): Request {
  const url = new URL(req.url);
  url.search = mode === null ? `?code=${code}` : `?code=${code}&create=${mode}`;
  return new Request(url.toString(), req);
}

async function toRoom(env: Env, req: Request, code: string, mode: MatchMode | null): Promise<Response> {
  try {
    return await stubFor(env, code).fetch(forward(req, code, mode));
  } catch (e) {
    console.log(`[${code}] el Durable Object falló: ${(e as Error).message}`);
    return rejectSocket('room', WORKER_TEXT.busy);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/ws') return env.ASSETS.fetch(req);
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket esperado', { status: 426 });
    if (!originAllowed(req.headers.get('Origin'), url.host)) return new Response('Origen no permitido', { status: 403 });
    const route = parseRoute(url.search, cfg);
    if (route.kind === 'bot') return rejectSocket('route', WORKER_TEXT.bot);
    if (route.kind === 'bad') return rejectSocket('route', routeErrorText(route.why));
    if (route.kind === 'join') {
      // `b-<n>` es una sala de bot del servidor Node: aquí no es un código.
      if (route.code.startsWith('b-')) return rejectSocket('route');
      return toRoom(env, req, route.code, null);
    }
    for (let i = 0; i < CREATE_TRIES; i++) {
      const res = await toRoom(env, req, newRoomCode(cryptoRandom, cfg), route.mode);
      if (res.status !== 409) return res;
    }
    return rejectSocket('room', NO_FREE_CODE_TEXT);
  },
} satisfies ExportedHandler<Env>;
