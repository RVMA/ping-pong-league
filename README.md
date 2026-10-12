# Ping Pong PvP — prototipo V0.4 (partido PvP: salas, dos personas, Cloudflare)

Juego de ping pong para navegador **entre dos personas** (V0.4) o contra un bot, en local o por la red. V0.1 (cerrada, `v0.1.0`) probó el **tacto del golpe con el
ratón**: raqueta con inercia, golpe por click con medición de timing (ms) y posición (% del radio) y feedback
estilo *Paper Mario TTYD*. V0.2 (§21 del diseño) añadió el **golpe completo**: tipos de golpe (normal, topspin,
slice, smash), potencia, spin con efecto Magnus y bote con spin, spin visible, bloqueo con Espacio y «¿por qué
fallé?» completo. **V0.2b** (tras el playtest de V0.2): el tipo de golpe se elige con **teclas** (Q, W, E) en lugar de
con gestos del ratón, la potencia sale de la **calidad del golpe** (se premia el PERFECT) y hay barra de teclas y
chispas que dicen qué golpe tienes preparado y qué salió.

**V0.3** añade el **netcode** (§17.2 del diseño, «cada uno golpea en su tiempo»): un servidor propio (Node +
WebSocket) con la simulación compartida como autoridad y el jugador contra un **bot remoto** que se conecta por la
red, con latencia simulada. Cada bola entre dos golpes es un *vuelo* que cada jugador mide con su propio reloj: tu
golpe empieza tu vuelo al instante (sin esperar a la red), el golpe del rival empieza para ti cuando lo recibes y lo ves
a velocidad real, y la bola que se aleja se frena en tu pantalla lo justo para llegar a su raqueta cuando llega su golpe.
Nadie pierde tiempo de reacción ni precisión por el ping; a cambio, los rallies duran algo más.

**V0.4** añade el **partido entre dos personas** (§14 y §17.7 del diseño): salas privadas con código de 4 letras y
enlace, lobby con tu nombre y la calibración, warm-up sin marcador, Listo (mantener Shift), cuenta atrás 3-2-1-GO,
partido por games (Rápido, **Estándar** por defecto o Completo), estadísticas al final y revancha. Quien entra en
segundo lugar juega en el lado 1 con el mundo girado: los dos se ven abajo y «Tú» siempre a la izquierda del marcador.
Si se corta la conexión o recargas la pestaña, el punto en juego acaba solo, la partida se pausa hasta 30 s y sigue con
el marcador. La lógica de la sala es pura (`shared/`) y la usan dos servidores: el Node de desarrollo y un **Worker de
Cloudflare** con un Durable Object por sala, que además sirve el cliente. También: bola de canto, la corrección de P54
(un topspin débil muy pronto salía a ~151 m/s), la **prueba de lectura** (nombras el golpe del rival con 1–5) y un
piloto automático para pruebas.

- Diseño vigente (v5): [`ping_pong_pvp_gameplay_design_v5.md`](ping_pong_pvp_gameplay_design_v5.md). Versiones anteriores en [`docs/archive/`](docs/archive/)
- Análisis de V0.4 y propuestas: [`docs/analisis_v0.4.md`](docs/analisis_v0.4.md) (V0.3: [`docs/analisis_v0.3.md`](docs/analisis_v0.3.md); V0.2 y V0.2b: [`docs/analisis_v0.2.md`](docs/analisis_v0.2.md); V0.1: [`docs/analisis_v0.1.md`](docs/analisis_v0.1.md))
- Plan de implementación de V0.4: [`docs/superpowers/plans/2026-10-06-v0.4-partido-pvp.md`](docs/superpowers/plans/2026-10-06-v0.4-partido-pvp.md)

## Arrancar

Requisitos: Node ≥ 22.18 (probado con Node 24).

```bash
npm install
npm run dev          # cliente en http://localhost:5173 y servidor de juego en ws://localhost:5180/ws
```

`npm run dev` arranca **en un solo proceso** el cliente (Vite) y el servidor de juego; al pararlo (Ctrl+C, o si muere
la terminal que lo lanzó) se cierran los dos. El cliente habla con el servidor por el mismo origen (`/ws`, proxy
WebSocket de Vite). Puerto del servidor: variable `PPP_PORT` (por defecto 5180); por defecto solo escucha en esta
máquina (127.0.0.1); `PPP_HOST` cambia la interfaz.

Para probar lo mismo que se publica en Cloudflare: `npm run cf:dev` compila el cliente y arranca el Worker con
`wrangler dev` en `http://localhost:8787/` (Worker y Durable Objects en local, sin cuenta). No admite latencia simulada
ni el bot remoto, como el publicado.

### Jugar con otra persona (V0.4)

**Publicado** (cuando el autor lo despliegue, ver abajo): abre `https://ping-pong-masters.<subdominio>.workers.dev/`,
escribe tu nombre, elige el modo y pulsa «Crear sala». Pásale a tu rival el enlace («Copiar enlace»:
`…/?room=ABCD`) o el código, que puede escribir en «Unirse» (minúsculas valen).

**En local, en este PC** (con `npm run dev`): **dos ventanas del navegador una al lado de la otra**, las dos con
`http://localhost:5173/`. Una crea la sala y la otra entra con el enlace. Usa ventanas visibles y no pestañas: una
pestaña de fondo (o una ventana tapada) no ejecuta el juego, así que ese jugador no saca ni devuelve. El nombre del lobby
se guarda por navegador: con `?name=` distingues a los dos. Para tener rival sin otra persona, abre la segunda ventana
con `?autoplay=medium` (el bot mueve esa raqueta). Para jugar con alguien en otro equipo, publícalo.

En la sala:
- **Sala de espera:** el código, el enlace, los dos nombres con su ping y «Calibrar latencia».
- **Warm-up:** peloteo libre sin marcador; saca quien perdió la bola; se ve el marcador de bote. **Listo**: mantén
  **Shift 0.6 s** (se llena un anillo) o pulsa «Listo»; otra vez para quitarlo. Con los dos listos, 3-2-1-GO. Si uno da
  a Listo y el otro no en 3 min (aviso a los 2:30), el que no está listo sale de la sala.
- **Partido:** 4 s entre games, con el resultado del game. Al final, las estadísticas de los dos (% PERFECT, racha
  máxima, errores en la red, puntos); «Seguir» vuelve al warm-up y la revancha es dar a Listo otra vez.
- **Desconexión:** el punto en juego acaba solo y la partida se pausa hasta 30 s («Esperando a Beto… 0:27»).
  **Recargar la pestaña reconecta** (el token de la sala se guarda por pestaña); si la conexión se corta sola, el
  cliente reintenta. Si no vuelve en 30 s, pierde por abandono. Una pestaña duplicada sustituye a la vieja.
- En red no hay pausa (`Esc` solo pausa en local). Una pestaña oculta no pausa: quien no mira no devuelve la bola.

### Prueba de lectura (V0.4)

Mide si nombras el golpe del rival (§13.1 del diseño): tu raqueta devuelve sola y tú pulsas **1** normal · **2**
topspin · **3** slice · **4** smash · **5** bloqueo mientras viene su bola. 30 golpes (los saques no cuentan); al final,
el % de aciertos sobre los respondidos y la tabla de confusiones. Contra el bot: `http://localhost:5173/?read=1&bot=hard`.
Entre dos: botón «Prueba de lectura» en el warm-up de una sala; el rival ve «Ana está haciendo la prueba de lectura:
mezcla golpes». Contra el bot no sale el bloqueo (el bot solo bloquea bolas rápidas o con mucho spin).

### Jugar online contra el bot remoto (V0.3)

`http://localhost:5173/?online=1&ping=100` — mismo juego, mismos controles y mismo feedback que en local, pero el bot
vive en el servidor y se conecta por WebSocket como cualquier jugador. `ping` es tu ping simulado (ms de ida y vuelta);
el del bot es el mismo salvo que pongas `botping`. Junto a tu nombre y al del bot verás **el ping de cada uno** (media de
las 5 últimas medidas, cada 2 s): verde por debajo de 60 ms, amarillo hasta 120, rojo por encima, con el aviso
«Conexión inestable». Si se corta la conexión, aparece «Conexión perdida» y vuelves al menú. Solo existe en el servidor
de desarrollo (`npm run dev`); en el publicado, contra el bot se juega en local.

### Publicar en Cloudflare (lo hace el autor)

1. Cuenta gratuita de Cloudflare en https://dash.cloudflare.com/sign-up (si no la tienes).
2. `npx wrangler login` en la carpeta del proyecto (abre el navegador para autorizar).
3. `npm run deploy` (compila el cliente y publica el Worker, los Durable Objects y el cliente). La primera vez Wrangler
   puede pedir que elijas el subdominio `workers.dev` de la cuenta. Al terminar imprime la URL:
   `https://ping-pong-masters.<subdominio>.workers.dev`.

Después, las comprobaciones contra lo publicado:

```bash
node server/scripts/worker-checks.ts wss://ping-pong-masters.<subdominio>.workers.dev/ws
node server/scripts/room-bots.ts wss://ping-pong-masters.<subdominio>.workers.dev/ws 10 quick medium medium 7
npx wrangler tail    # registro en vivo del Worker mientras pruebas
```

- **Un despliegue nuevo corta las salas abiertas** (viven en memoria): quien estaba dentro ve «Sala inexistente» y
  hay que crear otra.
- Coste en el plan gratuito: 100 000 peticiones de Durable Objects al día; los mensajes que mandan los jugadores
  cuentan 1 de cada 20. Un partido gasta unas 11 200 por hora: ~9 h de juego al día (el warm-up gasta lo mismo). Si se
  pasa, las salas fallan hasta medianoche UTC.

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Tests unitarios (Vitest) de `shared/` (379), del servidor (`server/`, 17, con sockets reales) y del cliente (`client/`, 32) |
| `npm run typecheck` | Comprobación de tipos de `shared/` (sin DOM), `client/`, `server/` y el Worker |
| `npm run server` | Solo el servidor de juego (`node server/src/main.ts`), sin cliente |
| `npm run cf:dev` | **V0.4**: compila el cliente y arranca el Worker con `wrangler dev` en `http://localhost:8787/` (lo mismo que el publicado, en local) |
| `npm run cf:types` | Regenera los tipos del Worker (`server/worker-configuration.d.ts`) tras cambiar `wrangler.jsonc` |
| `npm run deploy` | Compila y publica en Cloudflare (necesita `npx wrangler login`; lo hace el autor) |
| `node server/scripts/room-bots.ts local 20 standard medium medium 7 100 100 0.1 0.02` | **Partidos de bots por salas** (también `npm run room-bots -- …`): destino (`local` = servidor Node en este proceso, con latencia simulada; o una URL `ws://localhost:8787/ws`, `wss://…/ws`), nº de partidos, modo, dificultades, semilla y, en `local`, ping de cada bot, variación y probabilidad de picos de TCP. El bot A crea la sala y el B entra con el código. Partidos acabados, golpes por punto frente a local, causas, discrepancias, saque, marcadores, ping medido, bytes y mensajes/s, peticiones de Durable Objects por hora, frenado, mayor salto de la bola y, en `local`, CPU por golpe. Sale con 1 si falla un criterio de la fase |
| `node server/scripts/worker-checks.ts ws://localhost:8787/ws` | Comprobaciones de la puerta del Worker (`wrangler dev` o publicado): origen, cada error con su texto, crear y unirse, pestaña duplicada, tamaño, ritmo, plazo del `hello` y reserva de 30 s. ~35 s |
| `node server/scripts/net-bots.ts medium medium 30 7 100 0.1` | **Partidos de bots por la red contra el bot remoto** (V0.3; sockets reales, sin navegador): dificultad, dificultad, nº de partidos, semilla, ping (ms) y variación. Golpes por punto, motivos y causas de los puntos, discrepancias cliente-servidor, CPU del servidor por golpe, bytes/s por jugador, frenado de la bola que se aleja. Mismas semillas que `shot-stats` para comparar con local |
| `node scripts/ws-check.mjs` | Con `npm run dev` arrancado: comprueba que el proxy `/ws` llega al servidor (`hello` → `welcome`) |
| `npm run build` | Build de producción en `client/dist/` |
| `npm run sim -- medium hard 7` | Partido bot contra bot en Node, sin navegador (dificultad0, dificultad1, semilla, [gameSpeed]). Muestra también golpes por tipo y la causa de cada punto perdido |
| `node shared/scripts/shot-stats.ts medium medium 30 7` | Estadística de varios partidos (dificultades, nº de partidos, semilla): velocidad y altura por tipo de golpe, velocidad de salida máxima, cantos, partes del margen, cómo acaban los puntos y causas de «¿por qué fallé?». Para ajustar valores |
| `node shared/scripts/mix-vs.ts medium 200 1 topspin` | ¿Hay un golpe dominante? Un bot que siempre pide el mismo golpe (`topspin`, `normal`, `slice` o `smash`) contra uno de la misma calidad que mezcla golpes: games y puntos ganados, errores y ganadores por tipo |
| `PPP_CFG='{"shotTypes":{"topspin":{"timingGain":0.6}}}' node shared/scripts/…` | Los dos scripts anteriores (y `room-bots`) aceptan valores de la config por variable de entorno, para probar ajustes sin editar `config.ts` |
| `npm run placeholders -w client` | Regenera las imágenes placeholder |

## Controles

| Acción | Control |
|---|---|
| Mover la raqueta | Ratón (la raqueta persigue al cursor con inercia) |
| Golpear | Click izquierdo cuando la bola llega a la raqueta |
| Tipo de golpe | **Mantén una tecla y haz click**: cuenta la tecla que esté pulsada en el instante del click. Sin tecla, golpe normal. Con varias, manda smash > topspin > slice |
| — **Q** Slice | Curva y va a la banda: hacia el lado al que cruzas o, sin cruce, hacia fuera del lado donde golpeas. Algo pronto, se pasa de ángulo y sale por la banda |
| — **W** Topspin | Más rápido y cae antes. Desde una bola muy baja, a la red; claramente tarde, se va largo |
| — **E** Smash | Con la bola a más de 15 cm sobre la cinta: muy rápido. Con la bola baja, a la red |
| Fuerza del golpe | Sale de la **calidad**: ¡Perfecto! = golpe completo; Bien = reducido; pronto, tarde o con el borde = flojo y más arriesgado. Si llegas persiguiendo la bola, la mitad |
| Cruzar la bola | Con la raqueta **ya colocada**, un gesto lateral seco del ratón al hacer click (vale con cualquier golpe). Pronto te pasas de ángulo; tarde no llegas a cruzar. Persiguiendo, la bola sale recta |
| Bloqueo | Mantén **Espacio** y haz click. Devuelve con la fuerza de la bola que llega; mientras mantienes Espacio, la raqueta va al 50 % |
| Barra de teclas | Abajo a la izquierda durante la partida; la tecla mantenida se ilumina y el contorno de tu raqueta toma el color del golpe. **Tab** la muestra u oculta (se guarda en este navegador) |
| Listo (warm-up de una sala) | Mantén **Shift 0.6 s** (se llena un anillo) o pulsa «Listo»; otra vez para quitarlo |
| Nombrar el golpe del rival (prueba de lectura) | **1** normal · **2** topspin · **3** slice · **4** smash · **5** bloqueo |
| Calibrar la latencia | Botón «Calibrar latencia» en el lobby y en la sala mientras esperas rival: 12 bolas, click cuando lleguen al centro de la raqueta. Se guarda en este navegador |
| «¿Por qué fallé?» | Activado por defecto; se apaga en el lobby («Explicar mis errores») |
| Sacar | Click para lanzar la bola (o esperar 1 s) y click cuando baje |
| Datos de precisión y del golpe (tipo, potencia, teclas en el click, cruce, spin), ping y frenado | `D` |
| Pausa | `Esc`, solo en local (en red no hay pausa) |

Lectura del spin: la bola gira con su spin real (costura naranja y logos) y deja un trail de color por tipo de
efecto: **naranja** = topspin, **cian** = backspin, **magenta** = lateral, **blanco** = bola sin efecto muy
rápida (smash).

Resultado del golpe: junto a tu raqueta, la calidad y debajo qué salió y con qué fuerza («TOPSPIN completo»,
«SLICE reducido · persiguiendo», «SMASH completo · bola baja para el smash», «NORMAL · pulsaste W después del
click»). Una ráfaga de chispas del color del golpe sale de la raqueta: muchas con ¡Perfecto!, algunas con Bien, pocas
y grises con un golpe débil. Una bola que toca la arista de la mesa es un **canto** válido («¡Canto!» y un sonido seco);
si toca el lateral, por debajo de la arista, es bola muerta.

## Parámetros de playtest (URL)

`http://localhost:5173/?speed=0.65&bot=hard&debug=1`

| Parámetro | Efecto |
|---|---|
| `speed` | `gameSpeed` (escala de tiempo de la bola). Por defecto 0.75 |
| `radius` | Radio de juego de la raqueta en metros. Por defecto 0.14 |
| `pspeed`, `paccel` | Velocidad (m/s) y aceleración (m/s²) máximas de la raqueta. Por defecto 6 y 60 |
| `bot` | `easy`, `medium` o `hard` |
| `debug=1` | Muestra el panel de precisión desde el inicio |
| `autostart=1` | Empieza sin menú (con `read=1`, la prueba de lectura sin su panel de inicio) |
| `seed` | Semilla del bot (partidas reproducibles) |
| `offset` | Desfase de latencia en ms, en lugar del calibrado (por ejemplo `offset=0` para pruebas) |
| `why` | `0` / `1` desactiva o activa «¿por qué fallé?» (en lugar de lo guardado) |
| `reduce` | `1` reduce el temblor de cámara y los destellos (sin ráfagas de chispas). Por defecto sigue la preferencia «reducir movimiento» del sistema; `0` la ignora |
| `room=ABCD` | **V0.4**: entrar en esa sala (minúsculas valen). Tras crear una sala o entrar, la URL pasa a `?room=<código>`, así recargar la pestaña reconecta |
| `create` | **V0.4**: `quick`, `standard` o `full` crea una sala nada más abrir (para pruebas; el lobby lo hace con botones) |
| `name` | **V0.4**: tu nombre (1–16 caracteres; si no, el guardado o el del lobby) |
| `autoplay` | **V0.4**: `easy`, `medium` o `hard`, el bot mueve tu raqueta (pruebas E2E y demostraciones); en local, online o en una sala |
| `read=1` | **V0.4**: prueba de lectura contra el bot en local (con `bot=`) |
| `online=1` | **V0.3**: juega en red contra el bot remoto (necesita el servidor de desarrollo: `npm run dev`) |
| `ping` | Tu ping simulado en ms (ida y vuelta, repartido en los dos sentidos). Por defecto 0; máximo 500 |
| `botping` | El ping simulado del bot. Por defecto, el mismo que `ping` |
| `jitter` | Variación de la latencia simulada, en fracción: 0.1 = ±10 % (por defecto contra el bot o con `ping`). Nunca reordena mensajes |
| `spike` | **V0.4**: probabilidad de un pico de latencia de TCP (100–300 ms, retiene a los mensajes que vienen detrás) en cada mensaje; máximo 0.2. Por defecto 0 |

En `online=1`, `bot`, `seed`, `offset`, `debug` y `autostart` funcionan igual. Los parámetros que cambian el juego
(`speed`, `radius`, `pspeed`, `paccel`) no valen online: el servidor compara el hash de la configuración y rechaza
la conexión si no coincide. `ping`, `jitter` y `spike` también valen en una sala, **solo con el servidor de
desarrollo**: el Worker (`cf:dev` o publicado) rechaza la latencia simulada.

Todos los valores ajustables están en un único archivo: [`shared/src/config.ts`](shared/src/config.ts)
(secciones `spin`, `shotTypes`, `block` y `bot.difficulties.*.shots` para V0.2; en V0.2b, `shotTypes.powerByTier`,
`chasingPower`, `topspin` / `slice` / `smash` y `presentation.sparks`; en V0.3, `net`: frecuencias, ping, frenado de
la bola que se aleja, validación, temporizadores y latencia simulada; en V0.4, `room`: código, modos, Listo, cuenta
atrás, entre games, plazo del warm-up, reconexión, nombre, ritmo y tamaño de los mensajes; `presentation.readTest`;
`shot.minLandingDepth` y `shotTypes.solverMaxSpeed` (P54); y `net.latency.spike`).

## Estructura

```text
shared/   Lógica del juego en TypeScript puro (sin DOM): física (Magnus, bote con spin, aristas de la mesa), teclas →
          tipo de golpe y calidad → potencia (stroke.ts), objetivos del golpe y solver con spin, bloqueo, "¿por qué
          fallé?", reglas, simulación, bot y prueba de lectura (read-test.ts). Se ejecuta tal cual en Node (type
          stripping).
  src/click.ts             Piezas del click que comparten local, cliente, servidor y bot.
  src/net/                 Red, pura y con tests: protocolo v2 y validación de mensajes, rutas, códigos y nombres
                           (route.ts), hash de la config, vuelos (flight.ts), resolución del golpe, reloj de la bola
                           que se aleja (brake.ts), ping, latencia simulada con picos, validación del servidor, partida
                           de cliente (client-match.ts) y de servidor por games (server-match.ts, match.ts), y la
                           sala (room.ts, room-seats.ts, match-tally.ts, match-stats.ts, rate.ts): fases, Listo,
                           cuenta atrás, pausa, reconexión y abandono, con tiempo virtual.
server/   Servidores de juego (sin compilar). Los dos transportan la misma sala de shared/ y ponen un temporizador al
          siguiente plazo.
  src/server.ts, room-host.ts, policy.ts, peer.ts
                           Servidor Node + `ws` (desarrollo y pruebas): salas con código, origen, límite de ritmo,
                           latencia simulada y el bot remoto de V0.3 (bot-client.ts), que se conecta por WebSocket.
  src/worker/              Worker de Cloudflare (producción): index.ts (ruta /ws → un Durable Object por sala; el
                           resto, el cliente como Static Assets) y room-do.ts (la sala en el Durable Object).
  scripts/                 room-bots.ts (partidos de bots por salas contra cualquier servidor), worker-checks.ts
                           (puerta del Worker) y net-bots.ts (contra el bot remoto).
client/   Three.js + Vite: escena (spin visible, trail y chispas), traductor ratón + teclas → InputIntent, bucle de
          120 Hz, HUD (barra de teclas, ping), audio. game/session.ts (partida local) y net/online-session.ts (en red:
          rutas, sala, token por pestaña, reintentos) dan al juego la misma vista. Flujo de sala en archivos propios:
          game/room-flow.ts y room-logic.ts, ui/lobby.ts y room-ui.ts; vista del lado 1 en game/view-side.ts; piloto
          automático (game/auto-player.ts) y prueba de lectura (game/read-flow.ts, ui/read-ui.ts).
  src/assets/manifest.ts   Manifiesto único de assets (rutas fijas, ver abajo).
  test/                    Tests del cliente (Vitest): lógica de sala, vista del lado 1, piloto y prueba de lectura.
  e2e/                     Scripts de Playwright que juegan en un navegador real, con ratón y teclado reales
                           (keys-check.js: golpes con teclas y ±30 ms de error de timing, textos, barra y chispas;
                           shots-check.js: los cuatro golpes, el bloqueo y "¿por qué fallé?"; net-check.js: V0.3
                           online contra el bot remoto con ping 0/50/100/150; room-check.js: dos jugadores en una
                           sala, reconexión y abandono, también contra wrangler dev; side1-check.js: precisión del
                           lado 1; read-check.js: prueba de lectura). Se ejecutan con `npm run dev` (o `npm run
                           cf:dev`) arrancado, con browser_run_code de Playwright MCP.
scripts/  dev.mjs (arranque conjunto de `npm run dev`) y ws-check.mjs.
wrangler.jsonc   Configuración del Worker: nombre, Durable Object `RoomDO`, Static Assets (client/dist).
docs/     Análisis, planes, capturas (docs/screenshots/v0.4/), evidencia medida (docs/evidence/v0.4/) y versiones
          anteriores del diseño.
```

## Sustituir el arte y los sonidos

Los assets se cargan desde `client/src/assets/` con las rutas del §18.1. Para cambiar uno, reemplaza
el archivo **con el mismo nombre**; no hay que tocar código.

- `characters/<power|defender>/portrait.png`, `select.png`, `paddle.png`; el color de acento está en `manifest.ts`.
- `ui/logo.png`, `arena/background.jpg`.
- Sonidos: `sfx/<nombre>.ogg` (o `.mp3`) con los nombres de §16 (`bounce_table`, `hit_perfect`,
  `streak_1` … `streak_4`, `net`, `whiff`, `edge`, `countdown`, `go`…) y los de V0.2 por tipo de golpe (`hit_topspin`,
  `hit_slice`, `hit_smash`, `hit_block`). Si un archivo no existe, se sintetiza con WebAudio.
  Tras añadir un archivo nuevo, reinicia `npm run dev`.
