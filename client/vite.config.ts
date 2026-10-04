import { defineConfig } from 'vite';

// Puerto del servidor de juego (V0.3): el cliente le habla por el mismo origen (/ws) gracias al proxy WebSocket.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const gamePort = env.PPP_PORT ?? '5180';

export default defineConfig({
  server: {
    port: 5173,
    // 127.0.0.1 y no «localhost»: en Node, localhost puede resolverse a ::1 y el servidor escucha en IPv4.
    proxy: { '/ws': { target: `ws://127.0.0.1:${gamePort}`, ws: true } },
  },
  build: { target: 'es2022' },
});
