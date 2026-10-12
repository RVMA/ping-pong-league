# Análisis retroactivo de V0.4 (partido PvP) y propuesta de cambios

> Documento de diseño analizado: v5 (`ping_pong_pvp_gameplay_design_v5.md`, 2026-10-06).
> Implementación: commits posteriores a `46414e9` en `master` (de `c393fe9` a `05fbd63`, y la tanda de arreglos de la
> revisión final, de `0f17070` a `9040d69`: §3.2 filas 12–15), siguiendo el plan
> [`docs/superpowers/plans/2026-10-06-v0.4-partido-pvp.md`](superpowers/plans/2026-10-06-v0.4-partido-pvp.md) y el prompt
> [`docs/prompts/fase_v0.4.md`](prompts/fase_v0.4.md). Sin etiqueta: la fase la cierra el autor.
> **La publicación en Cloudflare está pendiente** (Task 14): la hace el autor (`npx wrangler login` y `npm run deploy`).
> Este documento **no modifica** el diseño: describe lo implementado y propone cambios (desde P60).
> Marcas: ✅ decidido por el autor · 🟡 propuesta base · ❓ abierto.

---

## 0. Resumen

- **V0.4 está implementada completa salvo la publicación** (§21): salas con código de 4 letras y enlace, lobby con
  nombre y calibración, warm-up sin marcador, Listo con Shift, cuenta atrás, partido por games (Rápido, **Estándar** por
  defecto, Completo), estadísticas y revancha, pausa y reconexión con token por pestaña, abandono, **mundo espejado del
  lado 1**, bola de canto, P54, **prueba de lectura** y piloto automático. La lógica de la sala es pura (`shared/`) y la
  transportan dos servidores: el Node de desarrollo y un **Worker de Cloudflare con un Durable Object por sala**, que ya
  funciona en local con `wrangler dev`. **Falta publicarlo** (lo hace el autor) y el playtest entre dos personas.
- **0 discrepancias** (correcciones de los clientes y rechazos del servidor) en 80 partidos Estándar de bots por salas
  (pings 0/0, 100/100, 50/150 y 100/100 con picos de TCP), en 5 Rápido contra `wrangler dev`, en más de 600 partidas
  en memoria (con reconexiones, abandonos y picos) y en todos los E2E con dos navegadores.
- **Presupuestos:** CPU por golpe p99 0.60–0.71 ms (< 1 ms); por jugador ≤ 0.87 KB/s de subida y ≤ 1.03 KB/s de
  bajada (< 2 y < 3 KB/s); 60 fps en los dos lados; golpes por punto +2.1 … +4.6 % de los de local (±10 %); 100 % de
  causas con nombre.
- **El lado 1 es tan preciso como el lado 0:** con entrada real y ±30 ms de error, Δt medio +3.0 ms (ping 0) y +2.2 ms
  (ping 100) frente a −0.4 ms del lado 0: 3.4 ms de diferencia (límite 10).
- **Reconexión:** el estado llega **4 ms** después de reabrirse el socket (límite 1 s); el abandono, a los **30.0 s**.
- **Coste en Cloudflare:** 31 mensajes/s por jugador → **11 152–11 179 peticiones de Durable Objects por hora de
  partido → 8.9–9.0 h de juego al día** en el plan gratuito. Cumple (≥ 8 h), con poco margen (~7 %).
- **Hallazgos más importantes:**
  1. Las pruebas con salas encontraron fallos reales que el juego publicado habría tenido: el **último punto del partido
     no se veía** en un cliente, un **`end` tras un golpe tardío** se rechazaba (fallo de V0.3), los **saques válidos se
     rechazaban con picos de TCP**, una **ráfaga de mensajes de raqueta tras un parón** expulsaba al jugador por ritmo y
     el **Worker no liberaba un hueco** cerrado por tamaño o ritmo. Todos arreglados con su test (§3.2).
  2. El arreglo de los saques cambia una validación de V0.3 (el click «en el futuro» ya no se aplica al saque): **el
     autor debe confirmarlo** (§3.4).
  3. **Una pestaña oculta en tu saque deja al rival esperando** sin límite ni aviso: el servidor no tiene plazo de saque
     (P60).
  4. Con picos de TCP la bola puede **saltar 22–34 cm** en un tick al llegar tarde el golpe del rival (sin picos,
     ≤ 5 cm). Es el mecanismo de V0.3; falta ver con qué frecuencia pasa en internet (P63).
  5. El margen de coste es corto, y la revisión final encontró que se gastaba en balde: una pestaña visible en la sala
     de espera seguía mandando la raqueta a 30 Hz. **Arreglado** (P66, `0f17070`, `e3845df`): ahora solo manda el
     ping (~90 peticiones/h). Lo que queda abierto es la **duración** de los Durable Objects con salas abiertas sin
     jugar (P70, a medir tras publicar).

---

## 1. Trazabilidad de V0.4 (§21 de la v5 y «Alcance» del prompt)

| Punto | Estado | Dónde |
|---|---|---|
| Salas con código de 4 letras (sin I ni O) y enlace `?room=ABCD`; unirse nunca crea una sala | ✅ Implementado | `shared/src/net/route.ts` (rutas, códigos, nombres), `shared/src/net/room.ts`; cliente `client/src/net/online-session.ts` (la URL pasa a `?room=` tras entrar) |
| Lobby: nombre, crear sala con modo, unirse por código o enlace, calibración, contra el bot en local | ✅ | `client/src/ui/lobby.ts`, `client/src/game/room-flow.ts` |
| Sala de espera: código, copiar enlace, jugadores con ping y Listo, calibración | ✅ | `client/src/ui/room-ui.ts` |
| Fases: esperando rival → warm-up → cuenta atrás → partido (games, entre games) → estadísticas y warm-up | ✅ | `RoomCore` en `shared/src/net/room.ts` (+ `room-seats.ts`, `match-tally.ts`), tiempo virtual |
| Warm-up sin marcador, saca quien perdió la bola; Listo (Shift 0.6 s o botón); 3-2-1-GO | ✅ | `room.ts`; `ServerMatch` en modo práctica; `client/src/game/room-logic.ts` (`ReadyHold`), `room-flow.ts` |
| Timeout del warm-up solo mientras uno espera (3 min, aviso a los 2:30) ✅ | ✅ (tests con tiempo virtual; en el navegador, solo inyectado) | `room.ts` |
| Partido por games en `ServerMatch` y `ClientMatch`: `n` que nunca se reinicia, reanudación con el marcador, receptor ausente pierde al acabar el vuelo | ✅ | `shared/src/net/server-match.ts` (`GameAuthority`), `client-match.ts`, `match.ts` |
| Modos Rápido / Estándar ✅ / Completo; primer saque por sorteo; alternancia por game | ✅ | `config.room.gamesToWin`, `match.ts` (`firstServerOfGame`) |
| Pausa por desconexión (30 s), reconexión con token por pestaña, abandono, pestaña duplicada | ✅ | `room.ts`; `online-session.ts` (token en `sessionStorage`, reintentos) |
| Estadísticas del partido y revancha | ✅ | `shared/src/net/match-stats.ts`; panel en `room-ui.ts` |
| **Dos personas: lado 1 con mundo espejado**, «Tú» a la izquierda | ✅ | `client/src/game/view-side.ts`, `client/src/render/world.ts` (`setViewSide`), `client/src/ui/hud.ts` (`setLocalSide`), `client/src/input/mouse.ts` (`setSide`) |
| Protocolo v2: ruta en la URL del WebSocket, mensajes de sala y estadísticas, validación de cada mensaje | ✅ | `shared/src/net/protocol.ts`, `validate.ts`, `route.ts` |
| Servidor Node con salas (desarrollo): origen, ritmo, 16 KB, latencia simulada con picos | ✅ | `server/src/server.ts`, `room-host.ts`, `policy.ts`, `peer.ts`, `shared/src/net/rate.ts`, `latency.ts` |
| Worker de Cloudflare con un Durable Object por sala; el Worker sirve el cliente; `wrangler dev` | ✅ | `server/src/worker/index.ts`, `room-do.ts`, `sockets.ts`, `wrangler.jsonc`; scripts `cf:dev`, `cf:types`, `deploy` |
| Servidor publicado: solo WebSockets del propio origen, 16 KB, límite de ritmo, sin latencia simulada ni bot, nada en disco, un temporizador al siguiente plazo | ✅ | `server/src/worker/index.ts`, `room-do.ts`, `server/src/policy.ts` |
| Nombres limpios en el servidor (sin control ni invisibles, 1–16 caracteres) y siempre como texto en el cliente | ✅ | `route.ts` (`cleanName`); cliente con `textContent` (`setText`) |
| **Publicación en Cloudflare** | **Pendiente (Task 14, la hace el autor)** | Pasos en el README y en §2.8 |
| Bola de canto (aristas y esquinas, solo `+ − × ÷` y `Math.sqrt`); lateral = bola muerta | ✅ | `shared/src/physics.ts`, `rules.ts` (`SIDE`), `why.ts` (`TABLE_SIDE`), `sim.ts`; «¡Canto!» en `client/src/game/game.ts` |
| P54: profundidad mínima del bote y límite del solver | ✅ | `shared/src/shot.ts`, `config.ts` |
| Prueba de lectura (local y en el warm-up) | ✅ (herramienta) | `shared/src/read-test.ts`; `client/src/game/read-flow.ts`, `client/src/ui/read-ui.ts` |
| Piloto automático (`?autoplay=`) | ✅ | `client/src/game/auto-player.ts` (`AutoPlayer`, `PilotSeat`) |
| Reconexión automática del cliente | ✅ | `online-session.ts` (0.5, 1, 2, 4, 4… s durante 30 s) |
| Partidos de bots por salas contra cualquier servidor | ✅ | `server/scripts/room-bots.ts`; además `server/scripts/worker-checks.ts` |
| E2E de V0.4 | ✅ | `client/e2e/room-check.js`, `side1-check.js`, `read-check.js` |
| Config única: `room`, `presentation.readTest`, `shot.minLandingDepth`, `shotTypes.solverMaxSpeed`, `net.latency.spike` | ✅ | `shared/src/config.ts` |
| Borrar `client/src/game/0` | ✅ | `c393fe9` |
| Criterio: partido completo PvP entre dos personas **por internet** sin incidencias | Pendiente (publicar + playtest) | §7, puntos 1–3 |
| Criterio: el jugador nombra el golpe del rival en ≥ 80 % | Pendiente (playtest entre dos) | La herramienta da el % exacto (§2.6); §7, punto 10 |
| Criterio: 0 discrepancias en bots por salas (también contra el publicado) | ✅ Node y `wrangler dev`; publicado pendiente | §2.4, §2.5 |
| Criterio: el lado 1 tan preciso como el lado 0; presupuestos de V0.3; coste en el plan gratuito | ✅ (coste estimado; medida en producción pendiente) | §2.6, §2.7 |
| Personajes, Momentum y especiales; matchmaking; anti-cheat; táctil; guardar salas | Fuera de alcance | — (ver §5) |

---

## 2. Evidencia

### 2.1 Tests

| Qué | Resultado |
|---|---|
| `npm test` | **380** en `shared/` (259 de antes + 121), **24** en `server/` (6 + 18: sockets reales y `policy.test.ts`) y **37** en `client/` (nuevos); con la tanda de arreglos de la revisión final (§3.2, filas 12–15) |
| P54 (`shot-limits.test.ts`) | Profundidad cruda negativa → parte `minDepth`; el golpe va a la red con causa `EARLY`; velocidad ≤ 25 m/s; en 30 partidos de bots la velocidad máxima pasa de **151.98** a 23.5 m/s |
| Bola de canto (`edge.test.ts`) | Arista lateral y de fondo, lateral por debajo, 1.5 r sin contacto, esquina, spin intacto, sin aristas con `table: false`; reglas (canto válido, lateral antes y después del bote, saque); determinismo bit a bit con un canto y un lateral; un lateral real por `Simulation` acaba en `SIDE` |
| Protocolo v2 y rutas | Ida y vuelta de los mensajes nuevos, casos malformados, fuzz; códigos mal escritos (minúsculas, espacios, `0` por `O`, 3 o 5 letras, vacío); nombres hostiles (control, invisibles, bidi, 200 caracteres) |
| Partido por games (`server-match.test.ts`, `client-match.test.ts`, `match.test.ts`) | Práctica sin marcador; `n` monótono (mensajes pasados ignorados, no rechazados); pausa y reanudación con el marcador; ausente que pierde al acabar el vuelo; 24 puntos a 13-11 con un solo fin de game |
| Sala (`room.test.ts`, 28 tests) | Cada fila de la tabla de fases con su orden de mensajes; reconexión, abandono, timeout, pestaña duplicada, reentrada; plazos tardíos en orden; `room` solo cuando cambia algo; integración con el `ServerMatch` real; registro acotado (`retain`) |
| Estadísticas, ritmo, prueba de lectura | `match-stats` (% PERFECT, racha, red, puntos); cubo de fichas (200, 100/s; 32 msg/s 10 min sin límite); `read-test` (primera tecla, sin respuesta, 30 golpes, el saque no cuenta) |
| Red en memoria con salas y picos (`room-network.test.ts`) | 7 escenarios con el codec real (§2.3) |
| Servidor Node (`rooms.test.ts`, 12 tests) | Crear y unirse; cada `err` con su texto; origen (403 antes de abrir); ritmo; reconexión y pestaña duplicada; `leave` con ping 200; 17 KB → 1009; picos; bot de V0.3; un Rápido acortado por sockets (el de 11 puntos pasó, en 143.7 s); `close()` sin restos; sala rota (un `poll` que lanza o un plazo que no avanza → «La sala falló» a los dos, sala borrada, un solo `poll`) |
| Sala rota en los dos servidores (`policy.test.ts`, 6 tests) | `pollRoom`, la decisión común de Node y del Durable Object: sin plazo vencido no llama a `poll`; rota si `poll` o `nextDeadline` lanzan, o si el plazo sigue vencido (o es NaN) tras atenderlo. Es la prueba del Durable Object: `worker-checks.ts` es de caja negra y no puede romper una sala |
| Cliente (`client/test/`) | Reintentos, Listo con Shift, relojes, textos de sala; cámara y vista del lado 1; ponerse al día por tramos; piloto y lector en los dos lados; reanudación del piloto tras reconectar; raqueta callada en la sala de espera y keepalive; campo del código; prueba de lectura con algún Listo y su aviso |
| Typecheck (`shared/` sin DOM ni Node, `client/`, `server/` y el Worker) y build | Limpios |

### 2.2 P54 y bola de canto (bots Normal contra Normal, semilla 7)

`npm run sim -- medium medium 7` da **lo mismo** en los tres puntos (11-9, 157.3 s): la partida de referencia no pasa
por ningún caso límite. `node shared/scripts/shot-stats.ts medium medium 30 7` (`docs/evidence/v0.4/`):

| Medida | Antes (`46414e9`) | Con P54 (`c393fe9`) | Con P54 y canto (`757321e`) |
|---|---|---|---|
| Golpes por punto | 6.19 | 6.19 | 6.08 |
| Puntos a la red | 190 (34 %) | 212 (38 %) | 216 (38 %) |
| Bote en el propio campo (`OWN_SIDE`) | 23 (4 %) | 1 (0 %) | 1 (0 %) |
| `NET:EARLY` / `OWN_SIDE:EARLY` | 165 / 22 | 187 / 0 | 187 / 0 |
| Topspin: velocidad media / al techo | 10.5 m/s / 27 % | 10.2 m/s / 29 % | 10.2 m/s / 29 % |
| Velocidad de salida máxima | **151.98 m/s** (test (d) en rojo) | 23.5 m/s (topspin) | 23.5 m/s |
| Cantos válidos / laterales | — | — | **16 / 0** en 30 partidos |
| Causas con nombre | 533/533 | 533/533 | 544/544 |

- **P54 hace lo previsto:** los 22 topspin débiles muy pronto que botaban en su propio campo van a la red con
  `NET:EARLY`; ningún golpe normal llega al tope de 25 m/s (el máximo es 23.5).
- **El canto** sale ~0.5 veces por partido. Las pequeñas diferencias de la última columna son divergencia caótica (un
  canto cambia ese rally y los siguientes), no un cambio de los golpes: las velocidades por tipo no se mueven.

### 2.3 Red en memoria con salas y picos de TCP (tiempo virtual, codec real)

`shared/test/net/room-network.test.ts`: dos bots, la sala real (`RoomCore` + `ServerMatch`), una cola de latencia por
sentido y conexión. Los picos son de TCP: con probabilidad `spike`, un mensaje se retrasa 100–300 ms y retiene a los que
van detrás, sin reordenar.

| Escenario | Games | Puntos / golpes | Correcciones | Rechazos | Mayor salto por tick |
|---|---|---|---|---|---|
| Estándar, 0/0 | 13-11, 8-11, 11-8 | 62 / 343 | 0 | 0 | 0.08 cm |
| Estándar, 100/100 ±10 % | igual | 62 / 343 | 0 | 0 | 1.09 cm |
| Estándar, 50/150 ±10 % | igual | 62 / 343 | 0 | 0 | 1.00 cm |
| Reconexión en el game 1, 100/100 | 8-11, 11-6, 11-3 | 50 / 280 | 0 | 0 | 1.27 cm |
| Abandono, Rápido 100/100 | — | 5 / 22 | 0 | 0 | 0.52 cm |
| **Picos 2 %**, Estándar 100/100 | 9-11, 11-9, 8-11 | 60 / 416 | 0 | 0 | **22.0 cm** |
| Rápido 150/50, picos 2 %, reconecta el lado 0 (×2, determinista) | 3-11 | 14 / 65 | 0 | 0 | 16.7 cm |

- **Reconexión:** el punto en juego se cierra **1 027 ms** después del corte, al acabar el vuelo que le tocaba al
  ausente (no a los 3 s del respaldo); pausa en ese instante, vuelta a los +2 054 ms, cuenta atrás y reanudación a los
  +5 054 ms con `start {n 9, g 1, sc [2,3]}`, el marcador del servidor. Ni punto doble ni salto (1.27 cm).
- **Abandono:** el `mend` llega a los **30 000 ms** exactos del corte.
- **Barridos (no se suben al repositorio):** 48 Estándar (12 pares de semillas × 2 pings × con y sin picos), 160
  repeticiones de los escenarios de reconexión y abandono, 96 reconexiones en el game 2 y **300 Rápido** (5 718 puntos):
  **0 discrepancias**. Mayor salto: ≤ 2.2 cm sin picos; 22.4 cm con picos en los Estándar y 31.2 cm en los Rápido.

### 2.4 Partidos de bots por salas (servidor Node, sockets reales)

`node server/scripts/room-bots.ts local 20 standard medium medium 7 <ping0> <ping1> 0.1 [0.02]`: 20 partidos Estándar
Normal contra Normal; el bot A crea la sala, el B entra con el código, 2 puntos de warm-up, Listo, partido. Referencia
local: `shot-stats medium medium 30 7` → **6.08 golpes por punto**. Evidencia en `docs/evidence/v0.4/room-bots-*.txt`.

| Medida | 0/0 | 100/100 | 50/150 | 100/100 + picos 2 % | Criterio |
|---|---|---|---|---|---|
| Partidos acabados | **20/20** | **20/20** | **20/20** | **20/20** | 20/20 ✅ |
| Golpes por punto (media) | 6.36 (+4.6 %) | 6.36 (+4.6 %) | 6.21 (+2.1 %) | 6.23 (+2.5 %) | ±10 % ✅ |
| Puntos (solo partido) | 947 | 979 | 980 | 983 | — |
| Causas con nombre (sin `TOSS_MISSED`) | 900/900 | 924/924 | 921/921 | 918/918 | 100 % ✅ |
| Discrepancias (correcciones + `rj`) | **0** | **0** | **0** | **0** | 0 ✅ |
| Rechazos en todo el registro (warm-up incluido) | 0 | 0 | 0 | 0 | — |
| Primer saque de cada game alternado · saque de cada punto según las reglas | 20/20 · 1790/1790 | 20/20 · 1854/1854 | 20/20 · 1856/1856 | 20/20 · 1862/1862 | ✅ |
| Marcadores iguales en los dos clientes (`pt`, puntos enseñados y `mend`) | 20/20 | 20/20 | 20/20 | 20/20 | ✅ |
| Duración por punto | 7.96 s | 8.62 s (+8.3 %) | 8.49 s (+6.6 %) | 8.83 s (+10.9 %) | coste aceptado ✅ |
| Ping medido: media / p95 / máx | 17.6 / 32 / 50 ms | 120.6 / 136 / 155 ms | 120.2 / 186 / 209 ms | 154 / 324 / 651 ms | — |
| Subida por jugador: media (máx) | 791 (820) B/s | 789 (816) | 787 (813) | 787 (814) | < 2 KB/s ✅ |
| Bajada por jugador: media (máx) | 893 (934) B/s | 877 (921) | 872 (909) | 867 (911) | < 3 KB/s ✅ |
| Mensajes/s por jugador: subida / bajada | 31.0 / 32.5 | 31.0 / 32.5 | 31.0 / 32.4 | 31.0 / 32.4 | — |
| Peticiones de Durable Objects por hora de partido | **11 174** | **11 159** | **11 157** | **11 152** | ≤ 12 000 ✅ |
| Frenado de la bola que se aleja: medio / máx | 6.2 / 34.8 % | 26.2 / 75 % | 26.2 / 75 % | 33.0 / 75 % | — |
| Mayor salto de la bola en pantalla | 3.9 cm | 4.5 cm | 5.0 cm | **34.0 cm** | — |
| CPU por golpe, autoridad: p50 / **p99** / máx | 0.11 / **0.60** / 10.4 ms | 0.13 / **0.67** / 1.7 ms | 0.14 / **0.71** / 15.7 ms | 0.14 / **0.71** / 15.6 ms | p99 < 1 ms ✅ |
| CPU por golpe, todo el `receive` de la sala: p99 | 0.62 ms | 0.72 ms | 0.72 ms | 0.74 ms | p99 < 1 ms ✅ |

- **Golpes por punto:** sumando las cuatro corridas, 3 889 puntos dan 6.29 (+3.4 %). La referencia de 30 partidos es
  una muestra pequeña: 300 partidos locales dan 6.33–6.39 según la semilla, así que las salas están dentro de la
  variación de local. La red no cambia la longitud de los rallies.
- **Ping a 0/0:** ~18 ms, no 0: el servidor y hasta 20 bots (10 partidos a la vez) comparten un bucle de 1 ms en el
  mismo proceso. Por eso el frenado tampoco es 0.
- **Frenado** con 100/100: 26.2 / 75 %, igual que V0.3 (25.8 / 75 %). Con picos sube al 33 %: el freno usa el ping
  medido, que los picos inflan.
- **CPU:** el máximo (10–16 ms, ~1 golpe de cada 6 400) no es recolección de memoria (comprobado con un observador de
  GC); apunta a que Windows desplaza el hilo (un cuanto son 15.6 ms). No mueve el p99.
- **Regresión de V0.3** (`net-bots.ts medium medium 30 7 100 0.1`, contra el bot remoto): 6.16 golpes por punto (+1.3 %),
  0 correcciones y 0 rechazos, 536/536 causas, CPU p99 0.62 ms, 776 / 860 B/s, frenado 26.1 / 75 %.
- **Primera corrida:** 950/951 causas con nombre: un `OUT:UNKNOWN` (§3.2, fila 5). Reproducido en local (1 de cada
  ~5 300 puntos) y arreglado; la corrida de antes del arreglo está en `room-bots-0-0-pre-fix.txt`.

### 2.5 Worker de Cloudflare en local (`wrangler dev`)

`npm run cf:dev` (wrangler 4.149.0, `compatibility_date` 2026-10-10): el mismo Worker y Durable Object que se
publicarán, con el cliente de producción.

| Prueba | Resultado |
|---|---|
| `room-bots.ts ws://localhost:8787/ws 5 quick medium medium 7` | **5/5** acabados; **0** discrepancias; 89/89 causas con nombre; saque de cada punto 182/182; marcadores iguales 5/5; 780 (814) / 876 (931) B/s; 31.0 / 32.6 mensajes/s; **11 179 peticiones/h → 8.9 h al día**; golpes por punto 5.73 (−5.8 % sobre 96 puntos: solo estadística con una muestra tan pequeña) |
| `worker-checks.ts ws://localhost:8787/ws` | **23/23**: 403 para un origen ajeno antes de abrir; los errores de ruta, de `hello` (latencia simulada, bot, otra config, primer mensaje que no es `hello`), sala inexistente y llena con su texto y cierre 1008; crear, unirse con el código en minúsculas y espacios, pestaña duplicada; 17 KB → cierre 1009; 500 mensajes → `rate`; sin `hello` → cerrado a los 10 s; un hueco cerrado por tamaño se libera a los ~30 s |
| `/` en Chromium | La página carga desde el Worker; 0 errores de consola; `?bot=` y `?room=ZZZZ` llegan legibles al navegador |
| `wrangler deploy --dry-run` | 131.14 KiB (39.82 KiB gzip), ~1.3 % del límite de 3 MB; solo importa `cloudflare:workers` (sin APIs de Node) |

### 2.6 E2E en Chromium (Playwright MCP, ratón y teclado reales)

El segundo jugador va siempre en **otra ventana**: una pestaña de fondo dibuja a 30 fps o menos (en un caso, 26 fps
durante el partido), aunque una sonda corta diga 60. Evidencia en `docs/evidence/v0.4/e2e-*.json`.

**`room-check.js`** (dos jugadores con `?autoplay=medium`; Shift real 700 ms para el Listo):

| Medida | Servidor Node | `wrangler dev` |
|---|---|---|
| Lobby → crear → unirse por enlace → warm-up → Listo → cuenta atrás → partido → estadísticas → warm-up | ✅ (Rápido 11-6) | ✅ (Rápido 11-5) |
| Correcciones | 0 / 0 | 0 / 0 |
| `pt` del servidor, marcador enseñado y `mend` (con estadísticas y `rj`) iguales en los dos | ✅ | ✅ |
| Nombre hostil `<img src=x onerror=alert(1)>` | Se ve como texto («img src=x onerro», limpio en el servidor), 0 elementos, 0 diálogos | igual |
| Recargar B en mitad del partido: socket abierto → `room` con la cuenta atrás | **4.0 ms** (A ve «Esperando a Beto… 0:30» a los 20 ms) | **4.1 ms** |
| Marcador al volver | El del servidor (1-2), y el partido sigue hasta 2-1 | igual |
| Cerrar B → abandono | **30.033 s** | **30.005 s** |
| Pestaña «oculta» (rAF de B parado 10 s) | Sin pausa para A, socket abierto; B se pone al día en 6 frames (≤ 2 s por frame), ≤ 17.4 ms entre frames; mismo marcador. Le tocaba sacar a B: A esperó los 10 s sin aviso (§4) | igual, con la bola yendo hacia B: el respaldo cierra el punto; 1 corrección `rejected` por corrida porque el piloto de B golpeó en el tramo repuesto (con el ratón no pasa; P62) |
| fps | 60 / 60 | 60 / 60 |
| Consola | 0 errores y 0 avisos | 0; registro de wrangler limpio |

**`side1-check.js`** (B en el lado 1 con ratón y teclado reales, ±30 ms de error con la semilla de `net-check.js`,
20 golpes por ping rotando W / Q / E / sin tecla / Espacio, contra el piloto Difícil):

| Ping | Δt medio lado 1 | \|Δt\| medio | Lado 0 (`net-check.js`, mismo build) | PERFECT / GOOD | Pedido = salido | Correcciones |
|---|---|---|---|---|---|---|
| 0 | **+3.0 ms** | 17.2 ms | −0.4 ms | 15 / 5 | 16/16 + bloqueos 4/4 | 0 |
| 100 | **+2.2 ms** | 18.0 ms | −0.4 ms | 15 / 5 | 16/16 + bloqueos 4/4 | 0 |

- **|Δt(100) − Δt(0)| = 0.8 ms ≤ 10** ✅ y **|lado 1 − lado 0| = 3.4 ms ≤ 10** ✅ (ruido de Playwright: ±3 ms).
- Cámara del lado 1 en z −3.45 (la del lado 0, en +3.45); el mismo píxel del ratón da el mismo objetivo en coordenadas
  del jugador en los dos lados; un slice PERFECT de B bota en el mismo punto del mundo (x −0.61) en las dos pantallas.
  Marcador de bote: 0 frames de ~1 300 en el partido.
- Frenado medio / máx: 6 / 21 % (ping 0) y 19 / 68 % (ping 100); mayor salto 2.4 / 2.6 cm; el golpe propio sale
  0–9 ms después de su contacto; 60 fps; 835–864 B/s de subida y 993–1019 B/s de bajada.

**`read-check.js`:** contra el bot Difícil (`?read=1&bot=hard&offset=0`), teclas reales con 24 respuestas correctas y 6
incorrectas planeadas → el panel dice **80 %**, «Acertaste 24 de los 30», y la tabla de confusiones coincide celda a
celda con lo planeado. Golpes del bot: 14 normal, 11 topspin, 4 smash, 1 slice, **0 bloqueos**. En una sala, el rival ve
«Ana está haciendo la prueba de lectura: mezcla golpes», el Listo de quien hace la prueba está bloqueado y «Dejar la
prueba» lo limpia. Esto prueba la herramienta; **el criterio ≥ 80 % lo da el playtest entre dos personas.**

**Regresión de V0.3:**

| Script (sin cambios) | V0.3 | V0.4 | Veredicto |
|---|---|---|---|
| `net-check.js` (online contra el bot remoto) | Δt +2.2 / −2.2 / −1.1 / −2.8 ms; 16/16; bloqueos 4/4; 0 correcciones | Δt −0.4 / −2.8 / −0.4 / +1.4 ms (criterio: 0.0 ms); 16/16; 4/4; 0 correcciones; salto ≤ 1.9 cm; 60 fps | ✅ |
| `keys-check.js` (local) | normal 9/9, slice 5/5, topspin 9/9, bloqueo 4/4; 2 de 3 smash sin evento (arnés) | normal 9/9, slice 5/5, topspin 8/8, **smash 3/3**, bloqueo 5/5; los seis casos con su texto; Tab y `reduce=1` | ✅ |
| `autoplay-rally.js` (local) | Rallies de hasta 13 golpes; ±10 ms | Rallies de hasta 12; medido − provocado: máx 12 ms; 60 fps | ✅ |

La bajada de `net-check` con ping 0 es 1027 B/s (859 en V0.3), dentro del presupuesto de 3 KB/s.

Capturas en `docs/screenshots/v0.4/` (las de la regresión, en `regresion/`; las anteriores se restauraron con git):

| Archivo | Contenido |
|---|---|
| `lobby.png`, `room-waiting.png` | Lobby; sala de espera con el código y el enlace |
| `warmup.png`, `countdown.png` | Warm-up con el nombre hostil como texto; «3» con los dos Listo |
| `pause.png`, `between.png` | «Esperando a Beto… 0:30» a 1-2; «Game 1 para Ana · 11-9 · Games 1-0 / Game 2 en 0:03» |
| `match-end.png` | Estadísticas del partido, «tú» primero |
| `side1-view.png` | El lado 1 en mitad del partido: su raqueta abajo, «Beto · tú» a la izquierda |
| `read-test.png`, `read-result.png`, `read-banner.png` | Leyenda de la prueba (12/30); resultado con la tabla; el aviso en la sala del rival |

### 2.7 Coste en Cloudflare (plan gratuito)

El plan gratuito da 100 000 peticiones de Durable Objects al día; cada WebSocket abierto cuenta 1 y los mensajes
**entrantes** cuentan 1 de cada 20 (los salientes no cuentan).

| Medida | Valor | Fuente |
|---|---|---|
| Mensajes entrantes por jugador | **31.0/s**: raqueta a 30 Hz + ping cada 2 s + `toss`, `hit`, `wf`, `end` | room-bots (5 corridas) |
| Peticiones por hora de partido (2 × 31 × 3600 ÷ 20 + 2 conexiones) | **11 152–11 179** (máx 11 183 en un partido) | room-bots Node y `wrangler dev` |
| Horas de partido al día | **8.9–9.0** | ≥ 8 h ✅ |
| Margen | ~7 % por debajo de 12 000/h (criterio del script); 8 h exactas serían 12 500/h | — |
| Una pestaña sola en la sala de espera (p. ej. tras irse el rival) | **~90/h**: solo el ping cada 2 s (1 800 mensajes ÷ 20); antes del arreglo P66, ~5 400/h por la raqueta a 30 Hz | cálculo; arreglo `0f17070`, `e3845df` |
| Worker | 131.14 KiB (39.82 KiB gzip), ~1.3 % de 3 MB; el cliente (12 archivos, 944 KB) va aparte como Static Assets | dry-run |
| Una corrida de `worker-checks` | ~30 peticiones | Task 9 |

Es lo que estimaba el diseño (§17.7: ~31 mensajes/s, ~11 000/h, ~9 h). Dos matices: el **warm-up gasta lo mismo que el
partido** (los dos mandan la raqueta a 30 Hz), y si se pasa el límite las operaciones fallan hasta medianoche UTC. No se
midió la **duración** (GB-s) de los Durable Objects, el otro límite del plan gratuito: una sala abierta cuenta aunque
nadie juegue (P70, §2.8).

### 2.8 Producción: pendiente

El autor no ha iniciado sesión en Cloudflare (`npx wrangler whoami`: «You are not authenticated»), así que la Task 14
queda pendiente. Cuando despliegue (`npx wrangler login`, `npm run deploy`; pasos en el README), se medirá esto:

| Medida (Task 14) | Cómo | Resultado |
|---|---|---|
| Puerta del Worker publicado | `node server/scripts/worker-checks.ts wss://ping-pong-masters.<subdominio>.workers.dev/ws` (23 comprobaciones) | pendiente |
| 10 partidos Rápido de bots por salas: acabados, discrepancias, ping medido, bytes y mensajes/s, peticiones por hora, mayor salto | `node server/scripts/room-bots.ts wss://ping-pong-masters.<subdominio>.workers.dev/ws 10 quick medium medium 7` → 10/10 y 0 discrepancias | pendiente |
| Consola del navegador en la URL publicada | Playwright: lobby sin errores; una sala con `room-check.js` corto (Rápido, autoplay; `#parts=main`, sin capturas) | pendiente |
| Reconexión y abandono en Cloudflare | `room-check.js` con `#parts=main,reconnect,abandon` (en `wrangler dev`: 4.1 ms y 30.005 s) | pendiente |
| Registro del Worker durante las pruebas | `npx wrangler tail`: sin excepciones; «Network connection lost» se anota aparte (§4) | pendiente |
| Peticiones y duración de los Durable Objects del día | Panel de Cloudflare | pendiente |
| Duración (GB-s) de una sala abierta sin jugar (P70) | Una pestaña sola en la sala de espera durante 1 h, sin otras salas; el panel de Cloudflare antes y después (GB-s y peticiones). Se espera ≈ 450 GB-s (0.125 GB × 3 600 s) y ~90 peticiones | pendiente |

---

## 3. Desviaciones respecto a la v5 y valores 🟡

### 3.1 Implementado de forma distinta o más concreta

Incluye las decisiones que la sesión tomó en nombre del autor durante la implementación («rulings»).

| # | Tema (§) | v5 / plan | Implementado | Motivo |
|---|---|---|---|---|
| 1 | Pestaña duplicada (§14.4) | «La conexión nueva sustituye a la vieja»; «sin pausa» | `bye` a la vieja; el punto en juego acaba como si no la devolviera y después **cuenta atrás «Reanudando» de 3 s**, sin fase `paused`, sin reserva de 30 s y sin que el rival vea al jugador desconectado | La pestaña nueva no tiene el estado del vuelo y el modelo no puede reanudar a mitad de vuelo (P56) |
| 2 | Primer saque del warm-up (§14.2) | «Saca quien perdió la bola»; tras un partido, el que lo perdió | Con una pareja nueva, el **lado 0**; el perdedor del último partido solo si es la misma pareja (revancha); tras un abandono, el lado 0 | «El que lo perdió» solo tiene sentido entre los mismos dos |
| 3 | Plazo de Listo y prueba de lectura (§14.2 ✅, §13.1) | — | El plazo de 3 min **sigue corriendo** mientras el que no está listo hace la prueba; mientras la haces, tu Listo está bloqueado. Mitigación en el cliente (revisión final, `9040d69`): la prueba **no se ofrece si alguno ya está Listo** (con el Listo del rival corre el plazo), y si el rival da a Listo con la prueba en marcha, el aviso de las 2:30 dice «Deja la prueba y da a Listo en 0:SS o saldrás de la sala» | Aceptado para V0.4: la prueba dura ~1 min contra el bot; el plazo del servidor no cambia (P61) |
| 4 | Warm-up con alguien ausente (§14.4) | «El hueco también se guarda 30 s» | El peloteo se para (el que se queda ve «Esperando a X… 0:27»); puede dar a Listo y el plazo de Listo sigue; el Listo del ausente se pierde (no en una pestaña duplicada) | El ausente no puede devolver; sin parar, el otro sacaría solo |
| 5 | Validación del saque (§17.3, P51) | Click «no en el futuro»: como mucho el tiempo desde que se envió el vuelo + 60 ms | **No se aplica al golpe de saque**; el click sigue acotado a (0, fin del lanzamiento] | El lanzamiento lo empieza el cliente: la única referencia del servidor es su llegada, y un pico de TCP hacía fallar saques legítimos (§3.4) |
| 6 | Lateral de la mesa (§6.4) | Bola muerta, punto para el rival | Motivo de punto `SIDE` y causa propia de «¿por qué fallé?» (`TABLE_SIDE`: «Lateral. La bola tocó el lateral de la mesa, no la superficie.»); también en el saque (en lugar de falta de saque) | 100 % de causas con nombre |
| 7 | Mensajes de rallies cortados (§17.2) | `n` monótono | Una pausa o la cuenta atrás cortan el rally y suben `n`; lo que llega de ese rally se **ignora** (no es un rechazo) | `rj` y «0 discrepancias» no se ensucian con los cortes legítimos |
| 8 | La vista no saca sola cuando no se puede jugar | — | `ClientMatch.held`: sin lanzamiento en la cuenta atrás, la pausa, la sala de espera, con el rival ausente ni detrás de las estadísticas; al soltarlo, el saque automático cuenta desde ese momento | Si no, el cliente lanzaba y perdía un saque que el servidor no estaba arbitrando |
| 9 | Ritmo de la raqueta (§17.2: 30 Hz) | — | **Como mucho un `p` por frame**: por debajo de 30 fps la raqueta va al ritmo de los frames; tras un parón sale un `p` en vez de una ráfaga | La ráfaga tras calibrar en la sala de espera (~30 `p` por segundo de parón) disparaba el límite de ritmo |
| 10 | Pestaña que vuelve (Review Focus 4) | Ponerse al día por tramos | Si la vista va > 2 s atrasada, como mucho 240 ticks (2 s) por frame; constantes del cliente (`view-side.ts`), no de `config.ts` | En la config cambiarían el hash |
| 11 | «Tú» a la izquierda (§2.1, §15) | Marcador | También los Listo y la **tabla de estadísticas** en orden [tú, rival]; el título y «Games 2-1», primero el ganador | §15 «Sala»: «Tú» siempre a la izquierda |
| 12 | Textos en una sala | — | «el rival», no su nombre («Punto. El rival no golpeó su saque.») | Siempre gramatical; sin nombres hostiles o de 16 caracteres en los avisos |
| 13 | Mundo espejado (§2.1, P59) | Cámara del lado 1 en su extremo | Además giran el suelo, las vallas y las luces; la cara de la raqueta del lado 1 se corrigió (estaba al revés) | Sin ello, el lado 1 no tenía valla al fondo y la luz venía de detrás de la red |
| 14 | Prueba de lectura (§13.1) | Tu raqueta devuelve sola; «a veces una bola alta» | `?read=1` abre un panel con las teclas y «Empezar» (`autostart=1` lo salta); «Dejar la prueba»; las devoluciones débiles del lector son **siempre tardías** (bola alta, flag `lateWeak` del bot, que ninguna dificultad usa) | Ver las teclas antes de la primera bola; desbloquear el audio, que es una pista de lectura; que la bola débil dé un smash y no vaya a la red |
| 15 | Piloto automático | — | Declara desfase 0 (sus clicks llevan su instante exacto) | Medir sin el desfase calibrado |
| 16 | Reintentos del cliente | 0.5, 1, 2, 4, 4… s durante 30 s | Además: un intento sin `welcome` en 5 s se abandona; si nada sale por el socket en 20 s (antes del primer `start`, con la raqueta callada en la sala de espera o con la pestaña oculta), un `ping` lo mantiene vivo (se mira cada 5 s; antes de la revisión final, solo antes del primer `start`) | Una red caída puede no cerrar el socket; los proxies cortan sockets inactivos |
| 17 | Durable Object | — | Plazo de **10 s para el `hello`** (no en Node); `r: 'bot'` → «Contra el bot se juega en local»; registro acotado (últimos 64 eventos, 16 partidos y 100 entradas de diagnóstico por game: `rj` se satura en 100) y presupuesto de líneas de registro por sala | Un socket que no se presenta no puede retener un código; memoria y registros acotados en una sala de horas |
| 18 | Ping en el HUD (§15.1) | — | Oculto hasta el primer `start` (también en `?online=1` de V0.3) | No enseñar «… ms» detrás de «Conectando…» |
| 19 | Fin de game y de partido | — | El aviso de entre games y el panel de estadísticas salen cuando tu pantalla termina de enseñar el último punto (o a los 2.5 s / 4 s); por abandono, al instante | El último punto no se tapa |

### 3.2 Fallos encontrados por las pruebas (arreglados, con su test)

| # | Fallo | Cómo apareció | Arreglo | Commit |
|---|---|---|---|---|
| 1 | **El último punto del partido no se veía** en uno de los clientes (ni el marcador final ni el fin de game) | Red en memoria: `pt`, `mend`, `room` y el `start` del warm-up llegan en el mismo instante y el `start` reseteaba la vista | El cliente retiene el `start` hasta que termina de enseñar el punto | `ad10665` |
| 2 | **`end` tras un golpe tardío** en el mismo vuelo → rechazo `stale`. **Fallo de V0.3** (1 de 60 partidas con ping 0) | Barrido de reconexiones; se reproduce sin red de salas | Quien ya respondió a un vuelo con un golpe no manda `end` | `ad10665` |
| 3 | **Saques válidos rechazados** con picos de TCP (8 en el escenario con picos) | Red en memoria con picos | §3.1 fila 5 y §3.4 | `ad10665` |
| 4 | Mensajes de un rally cortado contados como rechazos | Revisión de Task 4 | §3.1 fila 7 | `54fd921` |
| 5 | **Causa sin nombre** (`OUT:UNKNOWN`, 1 de ~5 300 puntos): saque débil, pronto y muy cruzado, planeado 1–13 mm dentro de la banda e inalcanzable | Primera corrida de room-bots (950/951) | La causa es la parte que empujó el objetivo hacia la línea al menos lo que le quedaba de margen (`CROSS_EARLY`, `POWER_LATE`…) | `b91efc7` |
| 6 | **Worker:** tras cerrar a un jugador por tamaño o ritmo, el temporizador de la reserva no se reprogramaba (el hueco no caducaba) | Revisión propia + `worker-checks` (comprobado con una mutación) | Cada camino de un mensaje acaba en `settle()` | `426fc87` |
| 7 | **Ráfaga de `p` tras un parón** (calibrar en la sala de espera) → `err rate` y expulsión | Revisión de Task 10 | §3.1 fila 9 | `6a57d31` |
| 8 | **La vista sacaba sola detrás de las estadísticas** | Revisión de Task 10 | §3.1 fila 8 | `6a57d31` |
| 9 | Bucle de render por frame tras un corte entre games | Revisión de Task 10 | El respaldo de 2.5 s se dispara una vez | `6a57d31` |
| 10 | Lado 1: el anillo del cursor en la mitad equivocada, la raqueta propia al revés, la calibración vista desde el otro extremo | Prueba en el navegador | Cursor en coordenadas del mundo; cara girada; la calibración siempre desde el lado 0 | `8730ac1` |
| 11 | El piloto no devolvía tras una reconexión (estado del reloj viejo) | Test del piloto | El piloto empieza de cero con cada vista nueva | `908c54c` |
| 12 | **Raqueta a 30 Hz en la sala de espera** tras irse el rival (~5 400 peticiones/h por una pestaña abierta) y, con la pestaña callada u oculta, ningún keepalive | Escribiendo este análisis; revisión final | `ClientMatch.setQuiet` (sin `p`, el ping sigue) con cada `room` en `waiting`; keepalive por el último envío (P66, §3.1 fila 16). En Chromium (`npm run dev`, dos ventanas): en el warm-up 90 `p` en 3 s; tras salir el rival, **0 `p` y 5 pings en 10 s**; con un rival nuevo, otra vez 30 Hz. Y 10 Rápido de bots por salas (0/0): 10/10, 0 discrepancias, golpes/punto +6.6 %, CPU p99 0.87 / 0.98 ms, 11 177 peticiones/h | `0f17070`, `e3845df` |
| 13 | **Temporizador en bucle** si `RoomCore.poll` lanzaba o un plazo no avanzaba: el Durable Object se reprogramaba a 0 ms sin fin y Node llamaba a `poll` (y registraba la pila) cada 1 ms | Revisión de Task 9; revisión final | `pollRoom` (`policy.ts`, común a los dos): la sala rota se cierra con `err` «La sala falló: crea otra sala» a los dos y se olvida | `b644775` |
| 14 | El campo del código cortaba lo pegado: « tkjv» → «TKJ» | Revisión de Task 10 | Admite 12 caracteres y se limpia (sin espacios, mayúsculas, 4 letras) | `28359ad` |
| 15 | La prueba de lectura se ofrecía con el rival Listo (corre el plazo) y el aviso pedía un Listo bloqueado | Revisión final | §3.1 fila 3 | `9040d69` |

### 3.3 Valores 🟡 elegidos (`shared/src/config.ts`)

| Valor | Elegido | Motivo |
|---|---|---|
| `room.codeLength` / `codeAlphabet` | 4 / sin I ni O (24⁴ = 331 776 códigos) | §14.1 |
| `room.defaultMode` / `gamesToWin` | `standard` ✅ / Rápido 1, Estándar 2, Completo 3 | §10.3 |
| `room.readyHoldMs` | 600 | §3.3 (Shift 0.6 s) |
| `room.countdownMs` / `resumeCountdownMs` | 3000 / 3000 | 3-2-1-GO; «Reanudando» 3-2-1 |
| `room.betweenGamesMs` | 4000 | §10.3 |
| `room.warmupTimeoutMs` / `warmupWarnMs` | 180 000 / 150 000 ✅ | §14.2 |
| `room.reconnectMs` | 30 000 | §14.4 |
| `room.nameMaxLength` | 16 | §14.1 |
| `room.rate` | 200 de golpe, 100/s | Un cliente normal manda ~32/s; 10 min a 32/s nunca llegan al límite |
| `room.maxMessageBytes` | 16 384 | §17.3 |
| `shot.minLandingDepth` | 0.05 de media mesa | P54 (prompt) |
| `shotTypes.solverMaxSpeed` | 25 m/s de simulación | P54 (prompt); el golpe más rápido de los bots sale a 23.5 |
| `net.latency.spike` | `maxProb` 0.2, retraso 100–300 ms | Pérdidas de TCP; las pruebas usan 0.02 |
| `presentation.readTest` | 30 golpes; devolución automática 50 % PERFECT, 30 % GOOD, 20 % débil tardía | §13.1; sin fallos al aire, para que el lector no pierda la mitad de los puntos (pierde ≤ 35 % por error propio contra el Difícil) |
| Fuera de la config (cliente o Worker, no cambian el juego) | Ponerse al día: > 2 s de atraso, 240 ticks por frame; intento de conexión: 5 s; keepalive: tras 20 s sin enviar nada (se mira cada 5 s); `hello` en el Worker: 10 s; crear sala: 8 códigos al azar (Worker) o 32 (Node) | En la config cambiarían el hash |

### 3.4 Tests anteriores cuya expectativa cambió

El prompt solo permitía cambios por P54 o por la bola de canto. La bola de canto no cambió ninguno. Hay tres:

| Test | Antes | Ahora | Motivo |
|---|---|---|---|
| `shot.test.ts` «bota en el objetivo … desde posiciones variadas» | Config por defecto | La misma prueba y las mismas aserciones con una config local `solverMaxSpeed: 60` | **P54.** Mide la precisión del Newton, no el tope: desde (−0.9, 0.6 m, 2.4) con margen 0.05 hacen falta 25.3 m/s |
| `solver-spin.test.ts` «… con topspin, backspin y lateral» | Config por defecto | Igual, con `solverMaxSpeed: 60` | **P54.** Con 450 rad/s de topspin (por encima del máximo del juego, 340) y margen 0.06 hacen falta 40 m/s. Ningún golpe real llega ahí (máx 23.5 m/s) |
| `server-match.test.ts` «rechaza un click «en el futuro»» | Un **golpe de saque** que llegaba 200 ms antes de (llegada del lanzamiento + t) se rechazaba (`time`) | Reescrito: el límite se prueba donde vale su premisa, con el click del **lado 1 sobre el vuelo de saque que mandó el servidor** (sigue rechazado `time`). Nuevo test: un saque cuyo lanzamiento llegó 300 ms tarde por un pico **se acepta**, y un click después del final del lanzamiento sigue rechazado | **No es P54 ni la bola de canto** (§3.1 fila 5). La única referencia del servidor para un lanzamiento es cuándo le llegó; un pico de TCP en el `toss` hace que el `hit`, que llega justo detrás, parezca «del futuro», y un saque legítimo se perdía. El cliente ya controla cuándo lanza, así que ese límite no protegía nada; el click sigue acotado a (0, fin del lanzamiento]. Con anti-cheat fuera de alcance ✅. **Pide la confirmación del autor**; la alternativa sería una tolerancia de unos 300 ms (el pico máximo), que dos picos seguidos aún superarían |

Otros tests anteriores cambiaron solo por el protocolo, sin tocar expectativas: los `hello`/`start` de los tests de
red (versión 2), `server.test.ts` (la ruta `/ws?bot=medium` es obligatoria y las salas de bot están en `botRooms`) y los
tests de latencia, que pasaron de `ping.test.ts` a `latency.test.ts`.

---

## 4. Revisión de §14 y §17.7 a la luz de V0.4

**Se confirma (§14):**
- **El flujo de §14.1 funciona de punta a punta** entre dos navegadores, en Node y en `wrangler dev`: lobby → crear →
  unirse por enlace → warm-up → Listo con Shift → 3-2-1-GO → games → estadísticas → warm-up, con 0 correcciones y el
  mismo marcador y las mismas estadísticas en los dos.
- **P56 (§14.4) funciona como se diseñó:** el punto en juego acaba al terminar el vuelo del ausente (1 s después del
  corte, no a los 3 s del respaldo), la pausa empieza antes del siguiente saque, el estado llega en 4 ms tras reabrirse
  el socket y la partida sigue con el marcador del servidor; el abandono, a los 30.0 s. Recargar la pestaña siempre fue
  «desconexión → vuelta», nunca el camino de la pestaña duplicada.
- **§14.2:** warm-up sin marcador, saca quien perdió la bola, marcador de bote solo en el warm-up. **§14.3:**
  estadísticas de los dos y revancha con Listo.
- **La pestaña oculta no es una desconexión:** el socket sigue abierto, el rival no ve pausa y, al volver, la vista se
  pone al día en 6 frames sin tirones (≤ 17.4 ms entre frames) y sin ráfaga de mensajes.

**Se confirma (§17.7):**
- **La lógica de sala pura es la misma en todas partes:** `RoomCore` corre igual en Node (`room-host.ts`), en el
  Durable Object (`room-do.ts`) y en la red en memoria; los servidores solo transportan y ponen un temporizador al
  siguiente plazo. Por eso 600 partidas en memoria y 80 por sockets dicen algo del Worker.
- **Un Durable Object por sala, sin hibernación ni disco**, y el Worker sirviendo el cliente por el mismo origen
  funcionan en `wrangler dev` con los mismos resultados que Node (0 discrepancias, 4.1 ms, 30.005 s).
- **El coste es el estimado:** 31.0 mensajes/s → ~11 170/h → ~9 h de juego al día.
- **La CPU se mide en Node** (el reloj del Worker no avanza mientras ejecuta): p99 0.60–0.71 ms por golpe.

**Genera dudas:**
- **Pestaña oculta en tu propio saque.** §14.4 dice «quien no está mirando simplemente no devuelve la bola», y es así
  cuando la bola va hacia él (el respaldo cierra el punto). Pero si le toca sacar, el servidor **no tiene plazo** en el
  estado de saque: el rival ve la bola en la mano del otro, sin aviso, mientras la pestaña siga oculta (medido: 10 s a
  1-0 sin nada). En Chrome real una pestaña oculta no ejecuta el juego en absoluto. → P60.
- **«Uncaught Error: Network connection lost.»** sale en el registro de `workerd` cuando un socket se cierra **antes de
  mandar ningún mensaje** (rechazos de ruta, un `hello` que no llega en 10 s, un cliente que muere de golpe). No es de
  nuestro código (todo `send`/`close` va en try/catch, sin promesas sueltas) y la sala queda bien; un cliente real
  manda `hello` al abrir. En producción puede verse como «exception» en Workers Logs: vigilarlo con `npx wrangler tail`
  y contarlo aparte de las excepciones reales.
- **Expulsión del Durable Object con los dos huecos reservados.** Si los dos jugadores se van a la vez, al objeto solo
  le queda un `setTimeout` pendiente. Se aceptó porque la sala se cierra a los 30 s y un objeto inactivo se expulsa más
  tarde; si no fuera así, quien vuelve vería «Sala inexistente». Comprobarlo en producción: quitar la red a los dos a la
  vez unos 20 s (los clientes reintentan solos) y ver que vuelven a la sala.
- **El margen de coste es del 7 %**, y se gasta también fuera del partido: el warm-up cuesta lo mismo. Una pestaña
  **visible** en la sala de espera después de irse el rival seguía mandando la raqueta a 30 Hz (~5 400 peticiones/h por
  nada): **arreglado** en la revisión final (P66, `0f17070`, `e3845df`; ahora ~90/h, solo el ping). Lo que queda: la
  **duración** (GB-s) de los Durable Objects, que el plan gratuito también limita (13 000 GB-s al día). Sin hibernación
  (Decisión 15), una sala con un socket abierto cuenta 0.125 GB × 3 600 s = **450 GB-s por hora**, juegue alguien o no:
  8 h de partido son ~3 600 GB-s, pero una sala olvidada abierta (una pestaña sola en la sala de espera, día y noche)
  podría agotar la cuota del día. → P70 (medirlo tras publicar, §2.8).
- **El mayor salto de la bola con picos de TCP: 22–34 cm en un tick** (peor 31 cm en 300 partidas en memoria), frente a
  ≤ 5 cm sin picos. Es el mecanismo de V0.3: si el golpe del rival llega después del contacto previsto, la pantalla ya
  lo pasó; el vuelo nuevo empieza en el contacto y la diferencia se funde en 80 ms. Pasa en unas pocas devoluciones por
  ciento cuando hay picos. Cuántos picos hay en internet de verdad no se sabe: medirlo en producción y mirarlo en el
  playtest. → P63.
- **El lateral puede mandar la bola por debajo de la mesa:** las caras verticales no se modelan (el lateral es la arista
  vista desde abajo), así que la respuesta de un `side` puede ir hacia dentro, y durante el aviso del punto la bola
  puede atravesar la mesa y dar más botes o «¡Canto!». Es raro (0 laterales y 16 cantos en 30 partidos). → P65.
- **El plazo de Listo corre durante la prueba de lectura** (§3.1 fila 3). La revisión final lo mitigó en el cliente:
  la prueba ya no se ofrece si alguno está Listo, y si el rival da a Listo durante la prueba, el aviso pide dejarla.
  Queda el caso de un lector lento al que el rival le da a Listo a mitad de prueba: tiene 3 min y el aviso a las 2:30.
  → P61 (que el servidor pare el plazo) sigue como propuesta.
- **Contra el bot, la prueba de lectura nunca enseña un bloqueo**: el bot solo bloquea bolas rápidas o con mucho spin
  (≥ 8.5 m/s o ≥ 250 rad/s) y el lector devuelve normales. El 80 % contra el bot no mide el «5 Bloqueo». → P64.
- **Alcance del cursor:** en una ventana de 720 px de alto, el borde inferior corresponde a ~2.3 m de fondo, pero la
  raqueta llega a 2.7 m: una bola alta y profunda solo se puede coger antes de su punto más alto (en `side1-check`, un
  bloqueo planeado a 2.35 m caía en y = 745 px, fuera de la ventana). Vale para los dos lados. → P68.
- **Dos jugadores en el mismo PC** necesitan dos ventanas visibles, no dos pestañas: una pestaña de fondo dibuja a
  30 fps o menos (Chromium con Playwright) y en Chrome normal una pestaña oculta se para.

**Falta:**
- **Publicar** (Task 14) y medir en producción: ping real, bytes con `wss`, mayor salto con la red de verdad, consola y
  `wrangler tail` (§2.8).
- **El criterio de §21** («un partido completo PvP entre dos personas por internet sin incidencias») y la **prueba de
  lectura ≥ 80 % entre dos personas**: solo los cierra el playtest (§7).
- En vivo no se vieron el **aviso del plazo de Listo** (2:30; solo inyectado) ni el keepalive de 20 s contra un borde de
  Cloudflare inactivo (en local, la pestaña sola en la sala de espera manda solo pings: §3.2 fila 12).
- Un jugador **ausente cuando el partido acaba por puntos** no recibe las estadísticas (vuelve al warm-up sin ellas).
  → P69.
- ~~Si la sala lanzara una excepción en `poll`, el Durable Object reprogramaría su temporizador a 0 ms una y otra vez~~
  **Resuelto** en la revisión final (`b644775`): si `poll` lanza o un plazo no avanza tras atenderlo (también si
  `RoomCore` se rinde tras su tope de 32 pasos), el Durable Object y el servidor Node **cierran la sala** con `err`
  «La sala falló: crea otra sala» a los dos y una línea de registro, en vez de reprogramar a 0 ms (o cada 1 ms en Node)
  sin fin. Cerrar y no esperar: un plazo roto se volvería a atender con cada mensaje. Probado en Node con sockets y,
  para el Durable Object, con la decisión común (`pollRoom`, `policy.test.ts`).

---

## 5. Riesgos para V0.5 (Momentum, especiales y POWER sobre el modelo de vuelos)

1. **Momentum sin mensajes nuevos.** El servidor ya recalcula la calidad de cada golpe, el spin del vuelo que llega y
   el número de golpe del rally: puede calcular todo §11.1 y mandarlo dentro de `fl` y `pt` (los mensajes salientes no
   cuentan en el coste). El cliente puede predecir su Momentum como predice su vuelo y adoptar el oficial; la
   discrepancia solo aparece si el servidor resuelve el golpe de otra forma (tardío, rechazado). La sala tiene que
   aplicar §11.3 y §14.2: 0 en el warm-up, la mitad en `between`, 0 en `mend`, y el `start` de reanudación debe llevar
   el Momentum de los dos.
2. **Especiales que duran «3 golpes» (Overdrive, Wall).** Cliente y servidor tienen que contarlos igual: ¿consume un
   fallo al aire?, ¿un saque, un bloqueo?, ¿sigue tras el punto, tras una pausa o entre games? Si discrepan, el vuelo
   que predice quien golpea no es el oficial y hay una corrección visible. Cada regla sin definir es una fuente nueva de
   discrepancias para el criterio «0». Conviene que el estado del especial viaje en el evento de golpe y que el servidor
   lo valide.
3. **La validación de §17.3 no conoce los especiales.** Overdrive mueve la raqueta un 30 % más rápido; el servidor
   comprueba el alcance a 6 m/s (+3 cm) desde la última muestra (30 Hz): en 33 ms la raqueta puede llegar ~6 cm más
   lejos de lo que el servidor admite, y rechazaría golpes legítimos justo con el especial. La validación tiene que usar
   los límites del personaje y del especial activo en ese golpe, y comprobar el Momentum (§17.3).
4. **La activación (R) y la lectura.** `InputIntent.special` es un instante del reloj de partida, pero en red cada uno
   golpea en el reloj de su vuelo: la activación tiene que anclarse a un vuelo, como el golpe. Y hay que decidir si
   viaja sola (el rival ve «ESPECIAL» antes del golpe: lectura, §13) o dentro del golpe (como las teclas ✅, el rival solo
   ve el efecto).
5. **Golpes más rápidos, más freno al límite.** +15 % de velocidad (Overdrive) y el Cannon Serve acortan los vuelos; en
   vuelos cortos el freno ya llega a su límite (75 % con 100/100). Cuando no da tiempo, la bola llega a la zona del
   rival antes que su golpe y aparece el salto de §4 (hasta 34 cm con picos). Los saltos se concentrarían en los
   momentos especiales. Medirlo con `room-bots` y especiales a 100/100 y 50/150.
6. **Shift: Listo y saque especial.** §3.3 dice que no se solapan porque «en el warm-up no hay saques reales», pero en
   V0.4 el warm-up sí tiene saques (de práctica). Sin poderes en el warm-up (§14.2) no hay conflicto, pero durante la
   cuenta atrás mantener Shift 0.6 s **quita el Listo y cancela la cuenta atrás**: quien lo mantenga para preparar su
   primer saque especial pararía el partido. → P67.
7. **El saque especial y el lanzamiento.** Tras el cambio de §3.4, el servidor ya no acota el golpe de saque por la
   llegada del `toss`; solo por el final del vuelo de lanzamiento. Si el saque especial no tuviera lanzamiento (se
   ejecuta al soltar Shift), su instante lo fijaría solo el cliente. Sin anti-cheat ✅ es aceptable, pero conviene que
   siga habiendo un vuelo de lanzamiento (o un límite equivalente).
8. **El presupuesto de mensajes.** Con un 7 % de margen, cualquier mensaje periódico nuevo del cliente (por ejemplo,
   sincronizar el Momentum 5 veces por segundo: ~+900 peticiones/h) baja de 8 h. Los especiales tienen que ir en los
   mensajes que ya existen (golpe, lanzamiento); la activación de R es rara y no cuenta.
9. **Personajes en la sala.** §14.1 pone la selección de personaje entre la espera y el warm-up: es una fase nueva de
   `RoomCore`. El personaje es estado de cada jugador, no config (no entra en el hash): la autoridad tiene que evaluar
   con modificadores por lado (ventana PERFECT ±20 %, velocidad ±10 %), y el `welcome`/`start` de una reconexión deben
   llevarlos.
10. **Pruebas.** Para que «0 discrepancias» siga significando algo, el bot tiene que usar Momentum y especiales en
    `room-bots` y en la red en memoria, y la prueba de lectura tendrá que decidir si incluye golpes especiales.
11. **`game.ts` pasó de 888 a 1 026 líneas** en V0.4 aunque el flujo de sala va aparte. El HUD de V0.5 (barras de
    Momentum, «ESPECIAL LISTO») debería ir en archivos propios desde el principio.

---

## 6. Propuestas de cambio al diseño (sin modificarlo)

| # | Sección | Cambio propuesto | Motivo | Impacto | Prioridad | Estado |
|---|---|---|---|---|---|---|
| P60 | §14.4 🟡 | **Plazo de saque en el servidor (en el partido):** si quien saca no lanza a tiempo (desde el punto anterior: el aviso del punto, 1.6 s, + el saque automático, 1 s, + su ping + un respaldo de ~3 s), el servidor le da el punto al rival (`TOSS_MISSED`), lo mismo que habría hecho su cliente; y el rival ve «Beto no responde» mientras espera | Con la pestaña oculta en tu saque, el rival espera sin límite ni aviso (§4); con esto, quien no mira pierde sus saques igual que no devuelve las bolas | Bajo | Alta (antes de jugar por internet) | 🟡 libre |
| P61 | §14.2 ✅ (plazo) / §13.1 | Mientras el que no está listo hace la prueba de lectura, el plazo de Listo se detiene (en el servidor) | El plazo corre durante la prueba (~1 min contra el bot, más entre dos). El cliente ya no ofrece la prueba con algún Listo y el aviso pide dejarla (`9040d69`); queda el lector lento al que el rival le da a Listo a mitad de prueba | Bajo | Baja | Requiere aprobación (toca el plazo ✅) |
| P62 | §14.4 🟡 / §16 | **Ponerse al día en silencio:** mientras la vista va más de 2 s atrasada, sin sonidos ni avisos de los eventos repuestos, y el piloto automático no golpea | Tras 10 s oculta, los sonidos y avisos de esos 10 s suenan en ~6 frames; el piloto golpeó en el tramo repuesto y produjo 1 corrección | Bajo | Baja | 🟡 libre |
| P63 | §17.2 ✅ (detalle 🟡) | **Salto tras un pico de TCP:** cuando el golpe del rival llega después del contacto previsto, fundir la diferencia en un tiempo proporcional a la distancia (no en 80 ms fijos); alternativa: seguir frenando un poco tras el contacto previsto | Con picos del 2 %, saltos de 22–34 cm en un tick (sin picos, ≤ 5 cm). Decidir tras medir el salto en producción y verlo en el playtest | Bajo | Media (tras medir) | 🟡 libre (la fusión); requiere aprobación si se sigue frenando (toca el «valle» ✅, P49) |
| P64 | §13.1 ✅ (detalle 🟡) | En la prueba de lectura contra el bot, el rival **bloquea** una parte de las bolas (p. ej. 15 %) aunque no sean rápidas | Contra el bot el bloqueo no sale nunca (0 de 124 golpes en 4 min), así que el 80 % local no mide el «5» | Bajo | Baja | 🟡 libre |
| P65 | §6.4 / §7.4 🟡 | **Caras verticales de la mesa:** modelar el lateral como un plano, o dejar de mover y dibujar la bola tras un contacto lateral (ya es bola muerta) | La respuesta de un lateral puede mandar la bola por debajo de la mesa y producir más botes o «¡Canto!» durante el aviso | Bajo | Baja | 🟡 libre |
| P66 | §17.7 🟡 | **No mandar la raqueta cuando nadie la ve:** sin `p` en la sala de espera; queda el ping cada 2 s (o el keepalive) | El margen de coste es del 7 %; una pestaña visible en la sala de espera tras irse el rival gastaba ~5 400 peticiones/h. Detrás del panel de estadísticas la raqueta sigue saliendo: el rival está en el warm-up y la ve; tras un error el socket ya está cerrado | Bajo | — | ✅ **Resuelto** en la revisión final (`0f17070`, `e3845df`): ~90 peticiones/h en la sala de espera |
| P67 | §3.3 🟡 (Listo) | **Durante la cuenta atrás, Shift no quita el Listo**; solo el botón «Quitar Listo» | En V0.5 Shift será también el saque especial: mantenerlo en el 3-2-1 para preparar el primer saque cancelaría el partido | Bajo | Media (V0.5) | 🟡 libre |
| P68 | §2.1 / §3.2 🟡 | **Alcance del cursor:** encuadrar la cámara para que se vea hasta 2.7 m de fondo con 16:9, o que el objetivo siga bajando cuando el ratón llega al borde de la ventana (captura del puntero) | Con 720 px de alto el borde inferior está a ~2.3 m y la raqueta llega a 2.7 m: las bolas altas y profundas solo se cogen antes de su punto más alto | Medio (cámara y sensación) | Baja (mirarlo en el playtest) | 🟡 libre |
| P69 | §14.3 🟡 | Si un jugador estaba ausente cuando el partido acabó por puntos, al volver (dentro de los 30 s) recibe las estadísticas del partido | Hoy vuelve al warm-up sin saber el resultado | Bajo | Baja | 🟡 libre |
| P70 | §17.7 🟡 / §14.2 ✅ | **Duración de los Durable Objects (GB-s) con salas abiertas sin jugar.** Primero medir (Task 14, §2.8: una pestaña sola en la sala de espera 1 h y el panel). Si se confirma, un **límite de inactividad para una sala que espera sola** (🟡, p. ej. `room.waitingIdleMs` = 10 min → `bye` «Sala cerrada: nadie entró»). Un límite para el warm-up toca la Decisión 3 / §14.2 ✅ («si ninguno está listo, se puede pelotear sin límite») y necesita al autor | El plan gratuito da 13 000 GB-s al día. Sin hibernación (Decisión 15), una sala con un socket abierto cuenta ≈ 0.125 GB × 3 600 s = **450 GB-s por hora**, juegue alguien o no: 8 h de partido ≈ 3 600 GB-s, pero una sala olvidada abierta día y noche (~10 800 GB-s) agota la cuota del día con muy poco juego más. Mientras tanto, el README pide cerrar la pestaña de la sala al dejar de jugar | Bajo | Media (tras medir) | 🟡 libre (sala de espera); requiere aprobación (warm-up) |

---

## 7. Checklist de playtest de V0.4

**Dónde:** con la versión publicada, `https://ping-pong-masters.<tu-subdominio>.workers.dev/` (el subdominio lo eliges
al desplegar; sustitúyelo en todas las URLs). Sin publicar, en local con `npm run dev` y **dos ventanas una al lado de
la otra** con `http://localhost:5173/` (no dos pestañas: la de fondo no ejecuta el juego). Antes, los dos: «Calibrar
latencia» en el lobby (`offset=0` en la URL lo anula para comparar). En cualquier momento, **`D`** abre el panel con el
ping, el frenado, el Δt medio y las correcciones (deberían ser 0).

1. **Crear y unirse por enlace.** Tú: `https://ping-pong-masters.<tu-subdominio>.workers.dev/` → tu nombre → Estándar →
   «Crear sala» → «Copiar enlace» y se lo mandas. Tu rival abre el enlace
   (`https://ping-pong-masters.<tu-subdominio>.workers.dev/?room=ABCD`); si no tiene nombre guardado, se lo pide.
   **Mira:** código de 4 letras sin I ni O; tu URL pasa a `?room=ABCD`; los dos nombres con su ping (verde < 60 ms,
   amarillo hasta 120, rojo por encima). Probad también a escribir el código en minúsculas en «Unirse» y uno que no
   exista («Sala inexistente»).
2. **Listo con Shift y la cuenta atrás.** En la misma sala, peloteáis un rato y cada uno mantiene **Shift**. **Mira:** el
   anillo se llena en 0.6 s y un toque corto no cuenta; con los dos listos, 3-2-1-GO con sonido; el marcador de bote
   se ve en el warm-up y desaparece en el partido; mantener Shift otra vez quita el Listo (y para la cuenta atrás).
3. **Un partido Estándar entero entre dos personas por internet.** En
   `https://ping-pong-masters.<tu-subdominio>.workers.dev/?room=ABCD`, jugad al mejor de 3. **Mira:** que no pase nada
   raro (un punto que no se cierra, la bola que salta, un marcador distinto en las dos pantallas); entre games, «Game 1
   para … · 11-7 · Games 1-0» y «Game 2 en 0:03», y que el primer saque cambie; al final, las mismas estadísticas en
   los dos (% PERFECT, racha máxima, errores en la red, puntos); «Seguir» os devuelve al warm-up y la revancha es dar a
   Listo otra vez. **Si sale una bola de canto:** «¡Canto!» en gris con un sonido seco y el punto sigue; si toca el
   lateral, punto para el rival con «Lateral…». Anota las correcciones de `D`.
4. **La vista del lado 1.** Quien entra con el enlace juega en el lado 1. **Mira (él):** su raqueta abajo y «Tú» a la
   izquierda del marcador; ratón a la derecha = raqueta a la derecha; un slice suyo que en su pantalla se va a su
   derecha, en la tuya se va a tu izquierda (estáis frente a frente). Cambiad los papeles en otra sala (`https://ping-pong-masters.<tu-subdominio>.workers.dev/`, «Crear
   sala» el otro): ¿los dos lados se sienten igual de precisos?
5. **La bola que se aleja, frenada.** Durante el partido, tras cada golpe tuyo mira tu bola camino del rival. **Mira:**
   ¿se nota más lenta a mitad de camino? ¿molesta? En `D`, «frenado» (con 200 ms sumando los dos pings, ~25 % de media;
   hasta 75 % en vuelos cortos). Sin otra persona, con ping simulado: ventana A
   `http://localhost:5173/?name=Ana&ping=150` → «Crear sala»; ventana B
   `http://localhost:5173/?room=ABCD&name=Bot&autoplay=medium&ping=150`, con el código de la ventana A en lugar de
   `ABCD` (el bot mueve esa raqueta; en el warm-up ya se ve). Si molesta, es el valor a revisar (`net.brake.minSpeed`,
   P57).
6. **La raqueta del rival golpeando la bola.** En el partido, fíjate en la raqueta del rival cuando devuelve. **Mira:**
   ¿la bola llega a su raqueta justo cuando golpea, o la ves golpear «al aire»? ¿la bola da un salto al salir de su
   raqueta? Con más ping se ve mejor; si ves saltos, apunta cuántos por game (P63).
7. **Tus PERFECT con ping real frente a local.** Primero un game contra el bot en local:
   `http://localhost:5173/?bot=medium`; en `D` apunta el «Δt medio» y cuántos ¡Perfecto! y Bien. Luego, en el partido
   por internet (`https://ping-pong-masters.<tu-subdominio>.workers.dev/?room=ABCD`), lo mismo. **Mira:** el Δt medio y
   el reparto deberían parecerse (con el ratón de Playwright, el ping cambió el Δt medio en menos de 1 ms); la bola que
   te llega va a la misma velocidad que en local; el % PERFECT de las estadísticas del final.
8. **El smash del rival.** Pide a tu rival que haga smash (E con la bola alta) en el partido. **Mira:** ¿te da tiempo a
   reaccionar igual que contra el bot Difícil en local (`http://localhost:5173/?bot=hard`)? ¿la bola sale de su raqueta
   sin salto?
9. **Recargar la pestaña a mitad de partido.** En mitad de un game, uno pulsa F5 en
   `https://ping-pong-masters.<tu-subdominio>.workers.dev/?room=ABCD`. **Mira:** el otro ve «Esperando a … 0:30»; el
   que recarga vuelve en el mismo lado y con el mismo marcador, y tras «Reanudando» 3-2-1 se sigue con el siguiente
   saque (el punto en juego acaba como si el que recargó no devolviera la bola). Después, que uno cierre la pestaña: a los 30 s el otro gana por
   abandono.
10. **La prueba de lectura entre dos (≥ 80 %).** En el warm-up de la sala, sin ningún Listo (con uno, el botón no se
    ofrece), uno pulsa «Prueba de lectura» (el otro **no debe dar a Listo** mientras tanto: el plazo de 3 min
    correría). El otro ve «X está haciendo la prueba de lectura: mezcla golpes» y mezcla normal, W topspin, Q slice,
    E smash (con bola alta) y Espacio bloqueo. Quien mide no golpea:
    su raqueta devuelve sola y él nombra cada golpe con **1** normal · **2** topspin · **3** slice · **4** smash ·
    **5** bloqueo mientras viene la bola; 30 golpes. **Mira:** el % final (criterio ≥ 80 %), la tabla de confusiones y
    sobre todo el bloqueo, que contra el bot (`http://localhost:5173/?read=1&bot=hard`) no sale nunca. Cambiad los
    papeles.
