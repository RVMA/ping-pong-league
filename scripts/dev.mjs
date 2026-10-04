// `npm run dev`: cliente (Vite, por su API) y servidor de juego en UN SOLO proceso de Node. Así, al cerrar este proceso
// se cierran los dos: no queda ningún `node vite.js` hijo vivo (en Windows sobrevivía al parar `npm run dev`).
// También se cierra si muere el proceso que lo lanzó (npm o la terminal) y con Ctrl+C.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const gamePort = Number(process.env.PPP_PORT ?? 5180);
const { startServer } = await import('../server/src/server.ts');
const game = await startServer({ port: gamePort });
const vite = await createServer({ root: fileURLToPath(new URL('../client/', import.meta.url)), configFile: fileURLToPath(new URL('../client/vite.config.ts', import.meta.url)) });
await vite.listen();
vite.printUrls();
console.log(`  ➜  Servidor de juego: ws://localhost:${game.port}/ws (el cliente lo usa por el mismo origen: /ws)`);
console.log('  ➜  Online contra el bot remoto: añade ?online=1 (y ping=100, botping, jitter) a la URL');

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(watchdog);
  await Promise.allSettled([vite.close(), game.close()]);
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, shutdown);
// Si muere el proceso padre (npm, la terminal o la tarea que lo arrancó), este también se cierra.
const parent = process.ppid;
const watchdog = setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    shutdown();
  }
}, 1000);
