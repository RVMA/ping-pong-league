// Comprobación del arranque conjunto: abre ws://localhost:5173/ws (proxy de Vite → servidor de juego), envía un hello
// válido y espera `welcome`. Uso: node scripts/ws-check.mjs  (con `npm run dev` arrancado).
import { configHash, makeConfig, PROTOCOL_VERSION } from '@ppp/shared';
import { WebSocket } from 'ws';

const url = process.argv[2] ?? 'ws://localhost:5173/ws';
const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.log('FALLO: sin respuesta');
  process.exit(1);
}, 4000);
ws.on('open', () => ws.send(JSON.stringify({ k: 'hello', v: PROTOCOL_VERSION, h: configHash(makeConfig()), r: 'player', p: 0, bp: 0, j: 0, d: 'medium', s: 1, o: 0 })));
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.k === 'welcome') {
    console.log(`OK: welcome (sala ${m.room}, lado ${m.side})`);
    clearTimeout(timer);
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
ws.on('error', (e) => {
  console.log(`FALLO: ${e.message}`);
  process.exit(1);
});
