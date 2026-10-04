/**
 * Arranque del servidor de juego: `npm run server` (o lo arranca `npm run dev` junto al cliente).
 * Puerto: PPP_PORT o 5180; interfaz: PPP_HOST o 127.0.0.1 (solo esta máquina). El cliente se conecta por el mismo
 * origen (proxy WebSocket de Vite en /ws).
 */
import { startServer } from './server.ts';

const port = Number(process.env.PPP_PORT ?? 5180);
const server = await startServer({ port, host: process.env.PPP_HOST });
console.log(`Servidor de juego en ws://${server.host}:${server.port}/ws`);
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
