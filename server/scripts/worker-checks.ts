/**
 * Comprobaciones de la puerta del Worker de Cloudflare (V0.4) contra `wrangler dev` o el publicado: el origen (403 antes
 * de abrir el socket) y cada error que el usuario tiene que leer (`err` en español y cierre: rutas, bot, latencia
 * simulada, sala inexistente o llena, tamaño, ritmo, `hello` que no llega), además de crear, unirse, la pestaña
 * duplicada y que la reserva de un hueco vence aunque nadie vuelva a escribir. El servidor Node de desarrollo da otros textos a propósito (bot remoto y latencia simulada): no es para él.
 *
 *   node server/scripts/worker-checks.ts <ws(s)://…/ws>
 *   p. ej.: node server/scripts/worker-checks.ts ws://localhost:8787/ws
 *
 * Una línea por comprobación (OK/FALLA); el código de salida es 1 si alguna falla. Tarda ~35 s (la reserva de 30 s de
 * un hueco, a la vez que el plazo de 10 s del `hello`).
 */
import { configHash, type ErrCode, type HelloMsg, makeConfig, PROTOCOL_VERSION, type S2C } from '@ppp/shared';
import { WebSocket } from 'ws';

const base = process.argv[2];
if (!base || !/^wss?:\/\/.+\/ws$/.test(base)) {
  console.error('Uso: node server/scripts/worker-checks.ts <ws(s)://…/ws>');
  process.exit(2);
}
const cfg = makeConfig();
/** Lo que se espera del plazo del `hello` del Worker (10 s) más margen. */
const HELLO_WAIT_MS = 13_000;

/** Una conexión de prueba: lo que recibe, cómo se cerró y el estado HTTP si no se abrió. */
class Probe {
  readonly got: S2C[] = [];
  closeCode = -1;
  status = 0;
  readonly ws: WebSocket;
  private readonly closed: Promise<void>;

  constructor(route: string, origin?: string) {
    this.ws = new WebSocket(`${base}${route}`, origin ? { headers: { Origin: origin } } : {});
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('unexpected-response', (_req, res) => {
      this.status = res.statusCode ?? 0;
      this.ws.terminate();
    });
    this.ws.on('error', () => {});
    this.closed = new Promise((res) => this.ws.on('close', (code) => {
      this.closeCode = code;
      res();
    }));
  }

  opened(): Promise<boolean> {
    return new Promise((res) => {
      if (this.ws.readyState === WebSocket.OPEN) return res(true);
      this.ws.once('open', () => res(true));
      this.ws.once('close', () => res(false));
    });
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Espera al cierre (como mucho `ms`). */
  async ended(ms = 5000): Promise<void> {
    await Promise.race([this.closed, new Promise((res) => setTimeout(res, ms))]);
  }

  /** Espera a recibir un mensaje de tipo `k` (como mucho `ms`). */
  async first<K extends S2C['k']>(k: K, ms = 5000): Promise<Extract<S2C, { k: K }> | undefined> {
    const t0 = Date.now();
    for (;;) {
      const m = this.got.find((x) => x.k === k);
      if (m || Date.now() - t0 > ms || this.closeCode !== -1) return m as Extract<S2C, { k: K }> | undefined;
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  get err(): string {
    const e = this.got.find((x) => x.k === 'err');
    return e && e.k === 'err' ? `${e.m}: ${e.d}` : '(sin err)';
  }
}

function hello(over: Partial<HelloMsg> = {}): HelloMsg {
  return { k: 'hello', v: PROTOCOL_VERSION, h: configHash(cfg), r: 'player', nm: 'Prueba', p: 0, bp: 0, j: 0, sp: 0, d: 'medium', s: 1, o: 0, ...over };
}

let failed = 0;
function check(name: string, ok: boolean, got: string): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${name} → ${got}`);
}

/** Abre la ruta, manda `send` (si hay) y comprueba el `err` (código y texto) y el cierre. */
async function expectErr(name: string, route: string, code: ErrCode, text: string, send?: unknown, closeCode = 1008, wait = 5000): Promise<void> {
  const p = new Probe(route);
  await p.opened();
  if (send !== undefined) p.send(send);
  await p.ended(wait);
  check(name, p.err === `${code}: ${text}` && p.closeCode === closeCode, `${p.err} (cierre ${p.closeCode})`);
}

const host = new URL(base.replace(/^ws/, 'http')).host;
const own = `${base.startsWith('wss') ? 'https' : 'http'}://${host}`;

// Origen (Decisión 13).
const evil = new Probe('?create=quick', 'http://evil.example');
await evil.ended();
check('origen ajeno → 403 antes de abrir', evil.status === 403, `HTTP ${evil.status}`);
const mine = new Probe('?create=quick', own);
const mineOpen = await mine.opened();
mine.ws.close();
check(`origen propio (${own}) → se abre`, mineOpen, mineOpen ? 'abierto' : `HTTP ${mine.status}`);

// Rutas (Decisiones 1, 16 y 20).
await expectErr('?bot=medium', '?bot=medium', 'route', 'Contra el bot se juega en local');
await expectErr('?room=b-1 (sala de bot de Node)', '?room=b-1', 'route', 'Código de sala no válido');
await expectErr('?room=AB0D', '?room=AB0D', 'route', 'Código de sala no válido');
await expectErr('?room=abc (3 letras)', '?room=abc', 'route', 'Código de sala no válido');
await expectErr('?create=mega', '?create=mega', 'route', 'Modo de partido no válido (quick, standard o full)');
await expectErr('sin ruta', '', 'route', 'Falta la ruta: /ws?create=<modo>, /ws?room=<código> o /ws?bot=<dificultad>');
await expectErr('?room=ZZZZ (sin sala)', '?room=ZZZZ', 'room', 'Sala inexistente');

// El `hello` (Decisión 14: sin latencia simulada ni bot remoto en producción).
const latency = 'La latencia simulada solo existe en el servidor de desarrollo';
await expectErr('hello con p: 100', '?create=quick', 'params', latency, hello({ p: 100 }));
await expectErr('hello con j: 0.1', '?create=quick', 'params', latency, hello({ j: 0.1 }));
await expectErr('hello con sp: 0.01', '?create=quick', 'params', latency, hello({ sp: 0.01 }));
await expectErr("hello con r: 'bot'", '?create=quick', 'params', 'Contra el bot se juega en local', hello({ r: 'bot' }));
await expectErr('hello con otra config', '?create=quick', 'config', 'Configuración del juego distinta de la del servidor (¿parámetros de URL como speed o radius?)', hello({ h: '00000000' }));
await expectErr('primer mensaje que no es hello', '?create=quick', 'proto', 'Mensaje inválido', { k: 'rdy', on: 1 });

// Crear, unirse (con minúsculas y espacios), llena, pestaña duplicada.
const a = new Probe('?create=quick');
await a.opened();
a.send(hello({ nm: 'Ana' }));
const wa = await a.first('welcome');
const code = wa?.room ?? '';
check('crear: welcome con código de 4 letras, lado 0', /^[A-HJ-NP-Z]{4}$/.test(code) && wa?.side === 0 && wa?.md === 'quick', JSON.stringify(wa));
const b = new Probe(`?room=${encodeURIComponent(` ${code.toLowerCase()} `)}`);
await b.opened();
b.send(hello({ nm: 'Bea' }));
const wb = await b.first('welcome');
const startB = await b.first('start');
check('unirse con el código en minúsculas y espacios: lado 1 y warm-up', wb?.side === 1 && startB?.wu === 1, `${JSON.stringify(wb)} ${JSON.stringify(startB)}`);
await expectErr('tercer jugador', `?room=${code}`, 'full', 'Sala llena', hello({ nm: 'Cris' }));
const dup = new Probe(`?room=${code}`);
await dup.opened();
dup.send(hello({ nm: 'Ana', tk: wa?.tk }));
const wd = await dup.first('welcome');
await a.ended();
const bye = a.got.find((m) => m.k === 'bye');
check('pestaña duplicada: bye a la vieja y la nueva ocupa el lado 0', wd?.side === 0 && bye?.k === 'bye' && bye.m === 'Conectado desde otra pestaña' && a.closeCode !== -1, `${JSON.stringify(bye)} cierre ${a.closeCode}; ${JSON.stringify(wd)}`);

// Tamaño (16 KB) y ritmo (200 de ráfaga, 100/s), ya dentro de la sala.
b.send(JSON.stringify({ k: 'ping', i: 1, t: 1, a: -1, pad: 'x'.repeat(cfg.room.maxMessageBytes) }));
await b.ended();
check('mensaje de más de 16 KB → err y cierre 1009', b.err === 'proto: Mensaje demasiado grande (16 KB como mucho)' && b.closeCode === 1009, `${b.err} (cierre ${b.closeCode})`);
for (let i = 0; i < 500; i++) dup.send({ k: 'ping', i, t: i, a: -1 });
await dup.ended();
check('500 mensajes de golpe → err rate y cierre', dup.err === 'rate: Demasiados mensajes: conexión cerrada' && dup.closeCode === 1008, `${dup.err} (cierre ${dup.closeCode})`);

/**
 * Tras cerrar a un jugador por un mensaje enorme, sin más mensajes de nadie, la reserva de su hueco vence a los 30 s:
 * el otro ve la sala esperando rival (el temporizador se programa también tras un cierre).
 */
async function reserveExpires(): Promise<void> {
  const host2 = new Probe('?create=quick');
  await host2.opened();
  host2.send(hello({ nm: 'Ana' }));
  const w = await host2.first('welcome');
  const guest = new Probe(`?room=${w?.room ?? ''}`);
  await guest.opened();
  guest.send(hello({ nm: 'Bea' }));
  await guest.first('start');
  guest.send('x'.repeat(cfg.room.maxMessageBytes + 1));
  await guest.ended();
  const t0 = Date.now();
  const seen = host2.got.length;
  const freed = () => host2.got.slice(seen).some((m) => m.k === 'room' && m.ph === 'waiting' && m.pl[1] === null);
  while (!freed() && Date.now() - t0 < cfg.room.reconnectMs + 5000) await new Promise((res) => setTimeout(res, 100));
  const s = (Date.now() - t0) / 1000;
  host2.ws.close();
  check('cerrado por tamaño y nadie más escribe: su hueco se libera a los 30 s', freed() && s > 25, freed() ? `sala esperando rival a los ${s.toFixed(1)} s` : 'el hueco sigue reservado');
}

// Una conexión que no se presenta (a la vez que la reserva anterior).
const t0 = Date.now();
await Promise.all([
  reserveExpires(),
  (async () => {
    await expectErr('sin hello en 10 s', '?create=quick', 'proto', 'La conexión no se presentó a tiempo: recarga la página', undefined, 1008, HELLO_WAIT_MS);
    console.log(`      (cerrada a los ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  })(),
]);

console.log(failed ? `${failed} comprobaciones FALLAN` : 'todas las comprobaciones OK');
process.exit(failed ? 1 : 0);
