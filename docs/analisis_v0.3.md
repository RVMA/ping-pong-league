# Análisis retroactivo de V0.3 (netcode) y propuesta de cambios

> Documento de diseño analizado: v4 (`ping_pong_pvp_gameplay_design_v4.md`, 2026-10-03).
> Implementación: commits posteriores a `effe724` en `master` (de `f14751d` en adelante), siguiendo el plan
> [`docs/superpowers/plans/2026-10-03-v0.3-netcode.md`](superpowers/plans/2026-10-03-v0.3-netcode.md). Sin etiqueta: la fase la cierra el autor.
> Este documento **no modifica** el diseño: describe lo implementado y propone cambios (desde P49).
> Marcas: ✅ decidido por el autor · 🟡 propuesta base · ❓ abierto.

---

## 0. Resumen

- **V0.3 está implementada completa** (§21): servidor propio (Node + `ws`) con la simulación compartida como autoridad,
  modelo **«cada uno golpea en su tiempo»** (vuelos con reloj propio, bola que se aleja frenada, raqueta del rival en el
  tiempo frenado, estado de salida oficial, validación y corrección suave), el jugador contra un **bot remoto** conectado
  por WebSocket, **latencia simulada** configurable por URL y **ping de los dos jugadores** en el HUD.
- **El criterio de aceptación se cumple:** con ratón y teclado reales y ±30 ms de error, el Δt medio con ping 100 queda a
  **3.3 ms** del de ping 0 (límite 10 ms). Con 0/50/100/150 ms: +2.2 / −2.2 / −1.1 / −2.8 ms.
- **0 discrepancias** entre clientes y servidor en 90 partidos de bots por sockets reales (30 por ping) y en 120 partidas
  en memoria; los golpes por punto quedan a +3–5 % de los de local; el 100 % de los puntos perdidos tiene causa con
  nombre; el servidor gasta 0.52–0.56 ms por golpe (p99); cada jugador usa < 0.82 KB/s de subida y < 1.01 KB/s de
  bajada; el cliente va a 60 fps.
- **Con ping 0 la partida en red es la misma que en local**, golpe a golpe (tests con 3 semillas): la lógica de red no
  cambia el juego, solo lo reparte.
- **Hallazgos de diseño más importantes:**
  1. Frenar la bola «más lenta hacia el rival» (hasta el contacto) obliga a **acelerarla** cuando el rival golpea antes o
     después de lo previsto (hasta 3.6×, saltos de 13–19 cm por tick). Se cambió a un **«valle»**: la bola se frena a mitad
     de camino y vuelve a velocidad real justo al llegar a la zona del rival, ya con el retraso acumulado; a partir de ahí,
     golpee el rival cuando golpee, todo se ve a velocidad real. La media del tramo frenado es la prevista (~25 % con
     ping 100, ~34 % con 150) (§3, P49).
  2. El fin del punto no necesita temporizadores: el **receptor** sabe que no devolvió la bola y lo dice (`end`); los
     desenlaces que el receptor no puede cambiar (red, bote en el propio campo) los cierra el servidor en el acto (P50).
  3. La raqueta del golpe es la del **tick en que se procesa el click**, hasta 8 ms después del click: medirla en el
     instante del click producía falsos «no pudo llegar» (P51).
  4. Un fallo heredado de V0.2, no de la red: un **topspin débil muy pronto** pide botar en su propio campo y el solver
     devuelve ~151 m/s (la bola cruza 1 m en un tick). Pasa igual en local (P54).

---

## 1. Trazabilidad de V0.3 (§21 de la v4)

| Punto de §21 / del prompt | Estado | Dónde |
|---|---|---|
| `server/` con Node + WebSocket y la simulación compartida como autoridad | ✅ Implementado | `server/src/server.ts`, `room.ts`, `peer.ts`; autoridad en `shared/src/net/server-match.ts` |
| Servidor por eventos: calcula cada vuelo al recibir el golpe; nada de 120 Hz continuos | ✅ | `ServerMatch.onHit` (resuelve el golpe y calcula el vuelo nuevo); el fin del punto llega por `end` o por desenlace seguro; temporizador solo de respaldo (`poll`) |
| Vuelos: muestreo determinista a 120 Hz, contactos y resultado según las reglas | ✅ | `shared/src/net/flight.ts` (bit a bit igual que `Simulation`, test) |
| Reloj de vuelo de cada jugador | ✅ | `ClientMatch` (`T0`, `stepIdx`, rally time `R`) |
| Tu golpe empieza tu vuelo al instante (predicción local), feedback sin esperar a la red | ✅ | `ClientMatch.handleClick` + `applyMyHit`; E2E: el golpe propio sale en su tick de contacto (0–9 ms), como en local |
| El vuelo del rival empieza cuando recibes su golpe, a velocidad real; tu click se mide en su reloj | ✅ | `ClientMatch.onFlight` / `applyRivalSwitch`; E2E: Δt igual con cualquier ping |
| Bola que se aleja frenada (tu ping + el suyo), con límite; se adelanta si su golpe llega antes; si no llega, sigue su trayectoria | ✅ con cambio de perfil (§3) | `shared/src/net/brake.ts` (`DisplayClock`: valle, `resume`) |
| Raqueta del rival a 30 Hz, interpolada en el tiempo frenado | ✅ | `ClientMatch.updateRivalPaddle`, `sendPaddle` |
| Validación y estado de salida oficial; corrección suave sin borrar el mensaje | ✅ | `shared/src/net/validate.ts`, `ServerMatch`, `ClientMatch.compareOfficial` + `renderBall` (fusión en 80 ms) |
| Jugador (abajo) contra un bot remoto conectado por la red | ✅ | `server/src/bot-client.ts` (el servidor lo arranca y se conecta por WebSocket a sí mismo) |
| Latencia simulada 50/100/150 con variación, por URL | ✅ | `shared/src/net/latency.ts`, `server/src/peer.ts`, parámetros `ping`, `botping`, `jitter` (`client/src/game/settings.ts`) |
| Ping de los dos en el HUD (§15.1: cada 2 s, media de 5, colores con texto, aviso > 120) | ✅ | `shared/src/net/ping.ts`, `client/src/ui/hud.ts` (`setPings`) |
| Protocolo tipado, validación defensiva de cada mensaje | ✅ | `shared/src/net/protocol.ts` (fuzz de 2 000 mensajes mutados sin excepciones) |
| Config única con sección `net` y hash de config al conectar | ✅ | `shared/src/config.ts` (`net`), `shared/src/net/config-hash.ts`, `validHello` |
| Las teclas solo viajan dentro del golpe (§13 ✅) | ✅ | `PadMsg` = `[n, r, x, z]`; test: ningún mensaje salvo `hit` lleva teclas |
| Refactor: evaluación del click, «colocado» y posición fija extraídos de `Simulation` | ✅ | `shared/src/click.ts` (salida de `sim` y `shot-stats` idéntica a antes) |
| `Bot` sobre una interfaz mínima de lectura | ✅ | `BotView` en `shared/src/bot.ts` |
| Modo local sin cambios | ✅ | 179 tests anteriores intactos; `keys-check` y `autoplay-rally` pasan |
| Cliente online `?online=1` con la misma escena, HUD y feedback | ✅ | `client/src/game/session.ts`, `client/src/net/online-session.ts`, `client/src/game/game.ts` |
| «Conexión perdida» y vuelta al menú | ✅ | `Game.onNetStatus`, `Hud.showConnection` (test de servidor: `bye` al caerse el bot) |
| `npm run dev` arranca cliente y servidor y cierra los dos | ✅ | `scripts/dev.mjs` (un solo proceso + vigilancia del proceso padre); proxy `/ws` en `client/vite.config.ts` |
| Partidos de bots por la red (sockets reales) | ✅ | `server/scripts/net-bots.ts` |
| E2E de aceptación | ✅ | `client/e2e/net-check.js` |
| Dos personas, mundo espejado, salas, internet, reconexión | Fuera de alcance (V0.4) | — (ver §5) |

---

## 2. Evidencia

### 2.1 Tests

| Qué | Resultado |
|---|---|
| `npm test` | **259** en `shared/` (179 de antes, sin tocar sus expectativas, + 80 nuevos) y **6** en `server/` con sockets reales |
| Vuelo bit a bit con la simulación local | Más de 150 vuelos de golpe y 20 lanzamientos de saque: los 9 números del estado coinciden en cada paso (`Object.is`), y también los contactos y el desenlace (`flight.test.ts`) |
| Evaluación del click sobre el vuelo | 150+ clicks reales del partido local: misma calidad, causas, y Δt/posición a < 1e-9 (`flight.test.ts`) |
| Resolución del golpe | 80+ golpes: mismo tipo, potencia, «colocado», índice de contacto y estado de salida a < 1e-9 que `Simulation` (`resolve.test.ts`) |
| Protocolo | Ida y vuelta de cada mensaje; 20 casos malformados rechazados (`1e400`, arrays de 65, tipos cambiados…); fuzz de 2 000 mutaciones sin excepciones |
| Reloj de la bola que se aleja | Identidad sin ping; llega a tiempo; monótono; velocidad entre el límite (0.25) y 1; real cerca de ti; tras el contacto esperado, velocidad real con el retraso acumulado; `retarget` y `resume` sin saltos |
| Red en memoria (bots, tiempo virtual, codec real) | **Ping 0 = local** golpe a golpe en 3 partidos; **0 correcciones y 0 rechazos** con ping 100 y 150 (±10 %); en una búsqueda más amplia, **120 partidas** (40 semillas × ping 50/100/150) sin discrepancias; determinismo (mismos mensajes en dos ejecuciones) |
| Servidor (sockets reales) | Rechaza versión, config y parámetros; se juegan puntos sin rechazos ni correcciones; un mensaje basura se descarta y la partida sigue; si se va el jugador se cierra la sala y el bot; si se cae el bot, el jugador recibe `bye`; sin conexiones, el bucle se duerme; por defecto solo escucha en 127.0.0.1 y corta los mensajes de más de 16 KB |
| Typecheck (`shared/` sin DOM ni Node, `client/`, `server/`) y build | Limpios |

### 2.2 Partidos de bots por la red (sockets reales, sin navegador)

`node server/scripts/net-bots.ts medium medium 30 7 <ping> 0.1`: 30 partidos Normal contra Normal en paralelo, con las
mismas semillas y el mismo primer saque que `shot-stats`. Referencia local: `node shared/scripts/shot-stats.ts medium medium 30 7`
→ **6.19 golpes por punto**. Resultados completos en `docs/evidence/v0.3/`.

| Medida | Ping 0 | Ping 100 | Ping 150 | Criterio |
|---|---|---|---|---|
| Golpes por punto (media) | 6.40 (+3.4 %) | 6.48 (+4.7 %) | 6.40 (+3.4 %) | ±10 % de 6.19 ✅ |
| Puntos jugados | 556 | 548 | 550 | — |
| Causas «¿por qué fallé?» con nombre | 519/519 | 510/510 | 513/513 | 100 % ✅ |
| Discrepancias (correcciones de los clientes + rechazos del servidor) | 0 + 0 | 0 + 0 | 0 + 0 | 0 ✅ |
| CPU del servidor por golpe (p50 / p99 / máx) | 0.10 / 0.52 / 1.79 ms | 0.13 / 0.56 / 1.62 ms | 0.12 / 0.55 / 2.29 ms | p99 < 1 ms ✅ |
| Subida por jugador (media / máx) | 780 / 815 B/s | 777 / 815 B/s | 775 / 808 B/s | < 2 KB/s ✅ |
| Bajada por jugador (media / máx) | 880 / 944 B/s | 864 / 921 B/s | 855 / 908 B/s | < 3 KB/s ✅ |
| Frenado de la bola que se aleja (medio / máximo) | 4.2 / 18.8 % | 25.8 / 75 % | 32.3 / 75 % | — |
| Ping medido (media) | 7.6 ms | 119.7 ms | 166.5 ms | — |
| Duración media del game | 146 s | 157 s (+7.5 %) | 163 s (+11.6 %) | coste aceptado ✅ |

Los máximos de CPU (1.6–2.3 ms) son pausas de recolección de memoria con 30 bots remotos en el mismo proceso; medido
aislado, el trabajo por golpe (resolver el golpe + calcular el vuelo nuevo) es p50 0.08 ms y p99 0.65 ms. Los bytes
cuentan la carga y la cabecera de la trama WebSocket (no TCP/IP).

**Primera pasada:** con ping 100 salió **1 corrección**. Reproducida en memoria, eran dos causas (§3, filas 8 y 9) más
una tercera encontrada al revisar el código (volea propia confirmada antes del contacto). Las tres tienen su test y,
tras arreglarlas, las 90 partidas por la red y las 120 en memoria dan 0.

### 2.3 Criterio de aceptación (E2E en Chromium, `client/e2e/net-check.js`)

Ratón y teclado reales de Playwright, sin gestos sintéticos; ±30 ms de error de timing con semilla (la misma secuencia en
cada ping); 20 golpes por ping contra el bot remoto Normal, rotando W/Q/sin tecla/E/Espacio. Resumen en
`docs/evidence/v0.3/net-check.json`.

| Medida | Ping 0 | Ping 50 | Ping 100 | Ping 150 |
|---|---|---|---|---|
| **Δt medio** (evaluación del servidor = la del cliente, 0 correcciones) | **+2.2 ms** | −2.2 ms | **−1.1 ms** | −2.8 ms |
| \|Δt\| medio | 17.6 ms | 19.1 ms | 17.9 ms | 14.2 ms |
| PERFECT / GOOD / débil / fallo | 14 / 6 / 0 / 0 | 14 / 6 / 0 / 0 | 14 / 6 / 0 / 0 | 17 / 3 / 0 / 0 |
| Golpe pedido = salido (sin bloqueos) | 16/16 | 16/16 | 16/16 | 16/16 |
| Bloqueos | 4/4 | 4/4 | 4/4 | 4/4 |
| Correcciones | 0 | 0 | 0 | 0 |
| Frenado medio / máximo | 5 / 18 % | 17 / 57 % | 27 / 75 % | 34 / 75 % |
| Ping mostrado (tú / bot) | 18 / 10 ms | 66 / 60 ms | 120 / 117 ms | 160 / 162 ms |
| Mayor salto de la bola dibujada (exceso sobre su movimiento, por tick) | 1.2 cm | 1.8 cm | 1.9 cm | 1.8 cm |
| Mayor paso de la bola entre frames | 21 cm | 24 cm | 23 cm | 23 cm |
| fps | 60 | 60 | 60 | 60 |
| Subida / bajada | 767 / 859 B/s | 819 / 1007 B/s | 815 / 979 B/s | 815 / 966 B/s |

- **Criterio de §21:** |Δt(100) − Δt(0)| = **3.3 ms ≤ 10 ms** ✅. La diferencia está dentro del ruido de Playwright
  (±5 ms): la precisión no depende del ping.
- **Feedback del golpe propio:** en los 80 golpes el evento sale en el tick de su contacto (0–9 ms después, como en local).
- **El mayor paso entre frames** (21–24 cm) es el de las bolas rápidas (topspin y smash a 9–11 m/s reales); no hay saltos
  por la red (el exceso sobre el movimiento propio de la bola es ≤ 1.9 cm por tick).
- **Consola:** sin errores (solo el aviso conocido del AudioContext con `autostart=1`).

Capturas (`docs/screenshots/v0.3/`, ping 100):

| Archivo | Contenido |
|---|---|
| `hud-ping.png` | HUD con el ping de los dos (115 / 117 ms, amarillo) junto a sus nombres |
| `outgoing-ball.png` | Bola que se aleja tras un bloqueo, frenada camino del bot |
| `rival-hit.png` | La raqueta del bot golpeando la bola en tu pantalla, con su «Bien» y su ráfaga |

### 2.4 Regresión del modo local

| Prueba | Resultado |
|---|---|
| `client/e2e/keys-check.js` | Normal 9/9, slice 5/5, topspin 9/9, bloqueo 4/4 del tipo pedido; los seis casos explicados con su texto («pulsaste W después del click», «soltaste W antes del click», «persiguiendo», «bola baja para el smash», «Topspin tarde (+95 ms)», «Slice pronto (−72 ms)»); Tab y `reduce=1` como antes. **2 de 3 intentos de smash no llegaron a la bola** (sin evento): tiempos del arnés en esperas largas; una prueba dirigida con el mismo arnés dio 3/3 SMASH PERFECT con la raqueta y la bola exactamente en el punto planificado. La simulación local es idéntica a V0.2 (salidas de `sim` y `shot-stats` sin cambios) |
| `client/e2e/autoplay-rally.js` | Rallies de hasta 13 golpes; Δt medidos iguales a los provocados (±10 ms); 60 fps |

Sus capturas están en `docs/screenshots/v0.3/regresion/` (`keys-*`, `rally-*`); las de V0.1 y V0.2 se restauraron con git.

---

## 3. Desviaciones respecto a la v4 y valores 🟡

### 3.1 Implementado de forma distinta o más concreta

| # | Tema (§) | v4 | Implementado | Motivo |
|---|---|---|---|---|
| 1 | Bola que se aleja (§17.2) | «normal cerca de ti, más lenta hacia el rival»; si su golpe llega antes, «se adelanta suavemente (~80 ms)» | **Valle**: velocidad real hasta el 25 % del contacto esperado, baja linealmente y **vuelve a velocidad real al llegar a la zona del rival** con el retraso (tu ping + el suyo) ya acumulado. Cuando llega su golpe, la bola solo vuelve a velocidad real (rampa de 80 ms), **nunca la supera** | Con «más lenta hasta el contacto», un contacto rival distinto del previsto obligaba a acelerar hasta 3.6× (saltos de 13–19 cm por tick). Con el valle, golpee el rival donde golpee, se ve a velocidad real. La media del tramo frenado es la del diseño (P49) |
| 2 | Fin del punto (§17.2: «usa temporizadores para detectar que nadie devolvió la bola») | Temporizadores | El **receptor** avisa (`end`) cuando su vuelo acaba sin su golpe; si el receptor no puede cambiar el desenlace (red, bote en tu campo), el servidor cierra **al crear el vuelo**; temporizador solo de respaldo (fin del vuelo + ping + 3 s) | Sin esperas fijas: el punto se cierra en cuanto se sabe (P50) |
| 3 | Predicción del desenlace | No detallado | El receptor predice el desenlace del vuelo que le llega; quien golpeó solo los seguros y espera al servidor para el resto (los aplica cuando su pantalla llega a ese punto del vuelo) | Con ping 0 la partida es la misma que en local; con ping, el toast llega cuando la bola llega al suelo en tu pantalla |
| 4 | Validación del alcance (§17.3) | «la raqueta pudo llegar a esa posición … según su posición enviada» | Desde su última muestra (30 Hz) hasta el **tick en que se procesó el click** (no el instante del click), a 6 m/s + 3 cm. Además: límites de la raqueta (y del saque), click dentro del vuelo, click **no «en el futuro»** (≤ tiempo desde que se envió el vuelo + 60 ms) y recuperación de 300 ms tras un fallo en el mismo vuelo | La raqueta del evento es la del tick que procesa el click: medirla en el click daba falsos rechazos (P51) |
| 5 | Qué viaja (§17.2) | Evento de golpe, raqueta 30 Hz, ping | Además: `toss` (lanzamiento del saque), `wf` (fallo al aire, para que el rival lo vea y para la recuperación), `end`, `pings` (las medias de los dos), `again` | Necesarios para el saque, el feedback del rival y el fin del punto |
| 6 | Formato | «JSON compacto, claves cortas, versión del protocolo» | Claves cortas; **la raqueta (30 Hz) como array `[n, r, x, z]`** (r en ms enteros, mm enteros); **la versión se negocia en `hello`/`welcome`** y no va en cada mensaje | Con claves, la raqueta sola ocupaba ~1.7 KB/s de subida; así ~0.8 KB/s (P52) |
| 7 | Cuantización | No detallada | Evento de golpe: mm y ms con 3 decimales, mm/s con 1, gesto con 4; quien golpea predice con el evento ya cuantizado. Estado de salida oficial con todos sus dígitos (JSON los recupera exactos) | Cliente, bot y servidor simulan el mismo vuelo bit a bit |
| 8 | Raqueta del rival | «30 Hz, interpolada, en el tiempo frenado» | Muestras estampadas con el **tiempo de rally** (reloj real de quien la envía); se dibuja interpolada en el tiempo de rally que muestra tu pantalla; si aún no hay muestra, la última | En tu pantalla su raqueta golpea la bola cuando la bola llega a ella (`rival-hit.png`) |
| 9 | Estado oficial de tu golpe | Se corrige si discrepa | Se compara **por índice de vuelo**, aunque tu vista ya haya cerrado el punto (un vuelo propio seguro, p. ej. un bote en tu campo, puede acabar antes de que llegue la confirmación) | Fue la otra corrección de la primera pasada |
| 10 | Pausa | Esc (§3.3) | **Sin pausa en red** (el servidor y el rival siguen); perder el foco tampoco pausa | — |
| 11 | Ping mostrado (§15.1) | «el ping de la sala» | La ida y vuelta medida (estampada al enviarla de verdad, no en el tick): en desarrollo suma ~15 ms a la simulada (proxy de Vite y temporizadores de Windows) | Es la latencia real del montaje; el frenado usa la medida, no la configurada |
| 12 | Hash de la config (§17.6) | «se envía un hash de la config» | FNV-1a sobre la config sin `presentation` ni `feedback`; con `speed=`, `radius=`… el servidor rechaza la conexión con un mensaje claro | `reduce=1` o los textos no cambian el juego |
| 13 | Quién saca primero | El jugador | El jugador; `hello` admite `fs` opcional (lo usa `net-bots` para repetir las semillas y el primer saque de `shot-stats`) | Comparación limpia con local |
| 14 | Otra partida online | — | «Jugar otra vez» con la misma dificultad reinicia contra el mismo bot (`again`); con otra dificultad se reconecta con un bot nuevo | El bot remoto se crea con su dificultad |
| 15 | Servidor | — | Escucha por defecto solo en **127.0.0.1** (`PPP_HOST` para otra interfaz), mensajes de **16 KB** como máximo; un `hit` de quien no es el receptor se descarta sin cerrar el punto | Revisión final: un servidor sin autenticación no debe quedar expuesto en la red local ni aceptar mensajes de 100 MB |

### 3.2 Valores 🟡 elegidos (`shared/src/config.ts`, sección `net`)

| Valor | Elegido | Motivo |
|---|---|---|
| `paddleHz` | 30 | §17.2 |
| `ping.everyMs` / `average` | 2000 / 5 | §15.1 |
| `ping.warmup` / `warmupEveryMs` | 3 medidas cada 250 ms al empezar | Frenar bien desde la primera bola |
| `ping.goodBelowMs` / `warnAboveMs` | 60 / 120 | §15.1 |
| `brake.startFrac` | 0.25 | Velocidad real en el primer cuarto del vuelo («normal cerca de ti»); con 0.25 la media del tramo frenado es ~25 % (P=200) y ~34 % (P=300), las cifras del diseño |
| `brake.minSpeed` | 0.25 | Límite del freno. En vuelos cortos se llega a él (frenado máximo medido 75 %): es el valor a mirar en el playtest |
| `brake.catchUpMs` | 80 | Rampa de vuelta a velocidad real cuando llega el golpe rival («~80 ms») |
| `brake.rampBackMs` | 150 | Vuelta a velocidad real cuando el rival no la devolvió |
| `brake.defaultDepth` | 1.6 m | Profundidad del contacto esperado si aún no se ve la raqueta rival |
| `blendMs` | 80 | Fusión de correcciones y cambios de vuelo con desfase |
| `validation.reachToleranceM` | 0.03 | Muestras a 30 Hz redondeadas a mm y ms |
| `validation.boundsToleranceM` | 0.02 | — |
| `validation.futureToleranceMs` | 60 | Variación ±10 %, granularidad de temporizadores y un tick |
| `timers.fallbackMs` | 3000 | Respaldo; nunca saltó en las pruebas |
| `latency.defaultJitter` / `maxPingMs` / `maxJitter` | 0.1 / 500 / 0.5 | Prompt (±10 %) |
| `quantize` | mm 3 decimales, ms 3, mm/s 1, gesto 4 | Precisión de µm y µs, mensajes cortos |

### 3.3 Tests anteriores

Ninguno de los 179 tests anteriores se tocó. Dos cambios en código existente, solo de rendimiento y con resultados
idénticos (salidas de `npm run sim` y `shot-stats` sin cambios): las opciones de paso de las pruebas del solver son
constantes (antes se creaba un objeto por paso) y `Simulation` delega en `click.ts`.

---

## 4. Revisión de §17.2 a la luz de V0.3

**Se confirma:**
- **Nadie pierde precisión por el ping:** el Δt medio con entrada humana no cambia de 0 a 150 ms (+2.2 → −2.8 ms) y el
  reparto PERFECT/GOOD tampoco. El vuelo que te llega se ve a velocidad real desde que empieza para ti, así que también
  conservas todo el tiempo de reacción (incluido el smash: el riesgo 3 del §5.1 de V0.2 desaparece con este modelo).
- **El feedback no espera a la red:** el golpe propio sale en su tick de contacto.
- **El determinismo basta para el netcode:** cliente, bot y servidor simulan el mismo vuelo bit a bit desde el mismo estado
  de salida; con ping 0 la partida en red reproduce la local golpe a golpe. No hace falta sincronizar relojes: cada
  mensaje habla del vuelo al que pertenece.
- **El servidor por eventos es barato:** ~0.1 ms por golpe; < 1 KB/s por jugador.
- **Coste aceptado:** los games duran +7.5 % con ping 100 y +11.6 % con 150 (bots).

**Genera dudas:**
- **Cómo se ve el frenado.** El valle frena la bola a mitad de camino (mínimo 50 % de velocidad con P=200, 33 % con
  P=300; 25 % en vuelos cortos) y la devuelve a velocidad real cerca del rival. Es más robusto que frenarla hasta el
  contacto, pero el autor imaginaba «más lenta hacia el rival». Solo un playtest dirá si se nota (P49, P57).
- **El fin de punto de quien golpeó llega tarde** cuando el rival no devuelve la bola: tu pantalla espera su posible golpe
  (con ping 150, unos 0.3 s) y luego la bola sigue a velocidad real hasta el suelo, donde sale el aviso.
- **La raqueta del rival** a 30 Hz: en el vuelo que te llega, sus muestras llegan justo a tiempo (sin margen de
  interpolación) y a veces se sostiene la última unos milisegundos. No se ve en las capturas; mirarlo en el playtest.

**Falta (V0.4):** dos personas (los dos ven la bola que se aleja frenada), mundo espejado del lado 1, salas, jugar por
internet (pérdidas, picos de latencia de TCP) y reconexión (§5).

---

## 5. Riesgos para V0.4

1. **Dos personas.** Cada uno ve su bola frenada y la del otro a velocidad real: el modelo ya es simétrico (`ClientMatch`
   funciona en el lado 1: test de la volea), pero el ritmo del rally depende de la **suma** de los dos pings. Con dos
   jugadores a 150 ms, el frenado medio ronda el 34 % y los rallies se alargan ~12 %.
2. **Mundo espejado.** La lógica ya trabaja en coordenadas del jugador (`InputIntent`), y el lado 1 ya juega en red (el bot
   remoto es el lado 1). Falta que el cliente del lado 1 dibuje la mesa espejada (cámara, proyección del cursor, HUD con
   «Tú» a la derecha del marcador si se quiere).
3. **Salas.** `Room` ya separa partida y conexiones, pero hoy cada jugador crea su sala con su bot. Hace falta el código
   de sala, el lobby (con la calibración, §3.7 ✅) y decidir qué pasa con `again` entre dos personas (los dos deben
   aceptar).
4. **Reconexión.** No hay ninguna: si se corta, «Conexión perdida». El modelo de vuelos ayuda (un mensaje de estado con
   rally, vuelo actual y marcador basta para reengancharse), pero hay que pausar (§14.4: hasta 30 s) y el reloj de vuelo
   del que vuelve no puede recuperar un vuelo ya empezado.
5. **Internet.** WebSocket va sobre TCP: una pérdida bloquea los mensajes siguientes (picos de 100–300 ms). El modelo los
   tolera (la bola se funde, sin rebobinar), pero un pico durante un golpe rival puede retrasar su vuelo en tu pantalla. Hay
   que medir con pérdidas simuladas (la cola de latencia admite añadirlas) y publicar el servidor con `wss`.
6. **Confianza en el cliente.** El cliente envía el instante y la posición de su click: el servidor solo comprueba que
   sean plausibles. Un cliente modificado podría enviar siempre el instante ideal. El anti-cheat está fuera de alcance ✅,
   pero entre dos personas este es el agujero principal.
7. **Granularidad de los temporizadores.** En este Windows el servidor añade ~15 ms de latencia (ping medido 120 con 100
   simulados). En un servidor Linux debería bajar; medirlo al publicarlo.
8. **Fallo heredado del solver (no de red).** Un topspin débil muy pronto pide botar en su propio campo (profundidad
   −0.04 de media mesa, margen −16 cm) y el solver devuelve ~151 m/s: la bola cruza 1 m en un tick antes de botar en tu
   campo. Ocurre igual en local; con dos personas se verá (P54).

---

## 6. Propuestas de cambio al diseño (sin modificarlo)

| # | Sección | Cambio propuesto | Motivo | Impacto | Prioridad | Estado |
|---|---|---|---|---|---|---|
| P49 | §17.2 ✅ (detalle 🟡) | Describir la bola que se aleja como un **valle**: velocidad real cerca de ti, se frena a mitad de camino y vuelve a velocidad real al llegar a la zona del rival con el retraso acumulado; cuando llega su golpe, la bola vuelve a velocidad real (nunca más rápida) | Robusto a dónde golpee el rival; sin aceleraciones bruscas; misma media que la descrita | Bajo (texto) | Alta | Requiere aprobación (toca el ✅ «más lenta hacia el rival») |
| P50 | §17.2 🟡 | El fin del punto lo dice el receptor (`end`) o el servidor si el receptor no puede cambiar el desenlace; el temporizador queda de respaldo | Sin esperas fijas | Bajo | Media | 🟡 libre |
| P51 | §17.3 🟡 | La posición de la raqueta del golpe es la del tick que procesa el click (hasta un tick después); validar además el click «en el futuro» y los límites de la raqueta | Evita falsos rechazos y cierra un hueco evidente | Bajo | Media | 🟡 libre |
| P52 | §17.2 🟡 | «Qué viaja»: añadir `toss`, `wf`, `end`, `pings`; la raqueta como `[n, r, x, z]` estampada con el tiempo de rally de quien la envía; la versión del protocolo en `hello` | Lo que hizo falta; ~0.8 KB/s de subida | Bajo | Baja | 🟡 libre |
| P53 | §15.1 ✅ (detalle 🟡) | El ping mostrado es la ida y vuelta medida (no la configurada), y se usa también para frenar | Es lo honesto; en desarrollo suma ~15 ms | Ninguno | Baja | 🟡 libre |
| P54 | §4.3 / §7.5 (V0.2) | Que la profundidad pedida por un golpe muy pronto no baje de ~0.05 de media mesa (la bola va a la red, que es la consecuencia legible del §4.3) y limitar la velocidad que devuelve el solver | Corrige el tiro de ~151 m/s; cambia el juego local en ese caso límite (topspin débil a ≳ −100 ms) | Bajo | Media (antes de V0.4) | Requiere decisión del autor |
| P55 | §17.6 🟡 | El hash de la config cubre solo las secciones de juego (sin `presentation` ni `feedback`); los parámetros de URL que cambian el juego no valen online | Comportamiento actual, sin ambigüedad | Ninguno | Baja | 🟡 libre |
| P56 | §14.4 🟡 (V0.4) | Para reconectar: mensaje de estado (marcador, rally, vuelo actual) y reanudar en el siguiente saque, no a mitad de vuelo | El modelo de vuelos no puede «devolver» un vuelo empezado | Medio | Alta (V0.4) | 🟡 libre |
| P57 | §17.2 🟡 | Revisar `net.brake.minSpeed` (0.25) en el playtest: en vuelos cortos se llega al límite (frenado del 75 %). Alternativa: 0.35 y aceptar que, si no da tiempo, la bola llegue algo antes a la raqueta rival (se funde) | Feel | Bajo | Media | 🟡 libre |
| P58 | §3.3 ✅ | Fila «Pausa»: **solo en local**; en red no hay pausa | Comportamiento implementado | Ninguno | Baja | Requiere aprobación (toca §3.3 ✅) |
| P59 | §2.1 ✅ / §21 (V0.4) | El mundo espejado es solo de presentación: la red ya trabaja en coordenadas del jugador y el lado 1 ya juega en red | Reduce el riesgo de V0.4 | — | Media | Informativa |

---

## 7. Checklist de playtest de V0.3

Con `npm run dev` arrancado. En cada caso: `Esc` no pausa en red; `D` abre el panel con el ping, el frenado y las
correcciones.

1. **Ping 0 como referencia.** `http://localhost:5173/?online=1&ping=0&bot=medium` → «Normal». Juega un game. Mira: el
   ping junto a «Tú» y «Bot» (verde, ~10–20 ms); que se sienta igual que en local (`http://localhost:5173/?bot=medium`).
2. **Ping 100.** `http://localhost:5173/?online=1&ping=100&bot=medium` → un game. Mira: el ping en amarillo (~120 ms);
   tus ¡Perfecto! y Bien deben salir igual de a menudo que con ping 0 (en `D`, «Δt medio» parecido); la bola que te llega
   a la misma velocidad que en local.
3. **Ping 150.** `http://localhost:5173/?online=1&ping=150&bot=medium` → un game. Mira: el ping en rojo y el aviso
   «Conexión inestable…»; si la bola que se aleja **se nota frenada** (dónde: a mitad de camino) y si molesta.
4. **La raqueta del bot golpea la bola.** Con ping 150, fíjate en la raqueta del bot cuando devuelve: ¿la bola llega a su
   raqueta justo cuando la golpea, o se ve golpear «al aire»?
5. **El smash del bot.** Con ping 150 y `bot=hard` (`http://localhost:5173/?online=1&ping=150&bot=hard`): ¿te da tiempo a
   reaccionar a sus smashes igual que en local?
6. **Pings distintos.** `http://localhost:5173/?online=1&ping=50&botping=150` → mira que el HUD muestre ~60 y ~160 ms y
   que tu bola se frene (la suma de los dos manda).
7. **Conexión perdida.** En una partida online, para `npm run dev` (Ctrl+C). Mira: «Conexión perdida» y el botón «Volver
   al menú».
8. **Config distinta.** `http://localhost:5173/?online=1&speed=0.7` → debe salir «No se pudo jugar online» con el motivo
   (configuración distinta de la del servidor).
