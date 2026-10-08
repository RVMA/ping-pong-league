/**
 * Reglas de la puerta de los servidores de salas (V0.4), comunes al servidor Node y al Worker de Cloudflare (sin APIs
 * de Node): qué origen se acepta (Decisión 13), qué texto lee el usuario en cada error (Decisión 14) y el azar de la
 * sala (códigos, tokens y sorteo del primer saque con `crypto`, nunca en la simulación).
 */
import type { ErrCode } from '@ppp/shared';

/** Texto en español de cada error que se manda en `err` antes de cerrar el socket. */
export const ERR_TEXT: Record<ErrCode, string> = {
  version: 'Versión del protocolo distinta de la del servidor: recarga la página',
  config: 'Configuración del juego distinta de la del servidor (¿parámetros de URL como speed o radius?)',
  params: 'Parámetros fuera de rango (ping, variación, picos o desfase de latencia)',
  room: 'Sala inexistente',
  full: 'Sala llena',
  proto: 'Mensaje inválido',
  rate: 'Demasiados mensajes: conexión cerrada',
  route: 'Código de sala no válido',
};

/** Texto de una ruta mala según su motivo (`parseRoute` → `{ kind: 'bad', why }`). */
export function routeErrorText(why: string): string {
  switch (why) {
    case 'modo':
      return 'Modo de partido no válido (quick, standard o full)';
    case 'dificultad':
      return 'Dificultad del bot no válida (easy, medium o hard)';
    case 'sin ruta':
      return 'Falta la ruta: /ws?create=<modo>, /ws?room=<código> o /ws?bot=<dificultad>';
    default:
      return ERR_TEXT.route;
  }
}

/**
 * Decisión 13: se acepta un WebSocket sin `Origin` (scripts) o con un `Origin` cuyo host sea el de la propia petición
 * (`Host`), además de los orígenes de `extra` (en Node, el proxy de Vite). Un `Origin` que no es una URL (p. ej. «null»
 * de un iframe aislado o de file://) no vale.
 */
export function originAllowed(origin: string | null | undefined, host: string | null | undefined, extra: readonly string[] = []): boolean {
  if (origin === undefined || origin === null) return true;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
  if (extra.includes(o.origin)) return true;
  if (!host) return false;
  try {
    // El Host leído con el esquema del origen: así «localhost:80» y «localhost» son el mismo para http.
    return new URL(`${o.protocol}//${host}`).host === o.host;
  } catch {
    return false;
  }
}

/** Orígenes del proxy de Vite en desarrollo (el servidor Node los acepta además del propio host). */
export const DEV_ORIGINS: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** Azar uniforme en [0, 1) de `crypto` (sorteo del primer saque, códigos de sala). */
export function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}
