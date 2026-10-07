# Ping Pong PvP — prototipo V0.3 (netcode: cada uno golpea en su tiempo)

Juego de ping pong para navegador contra un bot, en local o **por la red** (V0.3). V0.1 (cerrada, `v0.1.0`) probó el **tacto del golpe con el
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

- Diseño vigente (v5): [`ping_pong_pvp_gameplay_design_v5.md`](ping_pong_pvp_gameplay_design_v5.md). Versiones anteriores en [`docs/archive/`](docs/archive/)
- Análisis de V0.3 y propuestas: [`docs/analisis_v0.3.md`](docs/analisis_v0.3.md) (V0.2 y V0.2b: [`docs/analisis_v0.2.md`](docs/analisis_v0.2.md); V0.1: [`docs/analisis_v0.1.md`](docs/analisis_v0.1.md))
- Plan de implementación de V0.3: [`docs/superpowers/plans/2026-10-03-v0.3-netcode.md`](docs/superpowers/plans/2026-10-03-v0.3-netcode.md)

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

### Jugar online contra el bot remoto (V0.3)

`http://localhost:5173/?online=1&ping=100` — mismo juego, mismos controles y mismo feedback que en local, pero el bot
vive en el servidor y se conecta por WebSocket como cualquier jugador. `ping` es tu ping simulado (ms de ida y vuelta);
el del bot es el mismo salvo que pongas `botping`. Junto a tu nombre y al del bot verás **el ping de cada uno** (media de
las 5 últimas medidas, cada 2 s): verde por debajo de 60 ms, amarillo hasta 120, rojo por encima, con el aviso
«Conexión inestable». En red no hay pausa. Si se corta la conexión, aparece «Conexión perdida» y vuelves al menú.

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Tests unitarios de `shared/` y del servidor (`server/`, con sockets reales) (Vitest) |
| `npm run typecheck` | Comprobación de tipos de `shared/` (sin DOM), `client/` y `server/` |
| `npm run server` | Solo el servidor de juego (`node server/src/main.ts`), sin cliente |
| `node server/scripts/net-bots.ts medium medium 30 7 100 0.1` | **Partidos de bots por la red** (sockets reales, sin navegador): dificultad, dificultad, nº de partidos, semilla, ping (ms) y variación. Golpes por punto, motivos y causas de los puntos, discrepancias cliente-servidor, CPU del servidor por golpe, bytes/s por jugador, frenado de la bola que se aleja. Mismas semillas que `shot-stats` para comparar con local |
| `node scripts/ws-check.mjs` | Con `npm run dev` arrancado: comprueba que el proxy `/ws` llega al servidor (`hello` → `welcome`) |
| `npm run build` | Build de producción en `client/dist/` |
| `npm run sim -- medium hard 7` | Partido bot contra bot en Node, sin navegador (dificultad0, dificultad1, semilla, [gameSpeed]). Muestra también golpes por tipo y la causa de cada punto perdido |
| `node shared/scripts/shot-stats.ts medium medium 30 7` | Estadística de varios partidos (dificultades, nº de partidos, semilla): velocidad y altura por tipo de golpe, partes del margen, cómo acaban los puntos y causas de «¿por qué fallé?». Para ajustar valores |
| `node shared/scripts/mix-vs.ts medium 200 1 topspin` | ¿Hay un golpe dominante? Un bot que siempre pide el mismo golpe (`topspin`, `normal`, `slice` o `smash`) contra uno de la misma calidad que mezcla golpes: games y puntos ganados, errores y ganadores por tipo |
| `PPP_CFG='{"shotTypes":{"topspin":{"timingGain":0.6}}}' node shared/scripts/…` | Los dos scripts anteriores aceptan valores de la config por variable de entorno, para probar ajustes sin editar `config.ts` |
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
| Calibrar la latencia | Botón «Calibrar latencia» en la pantalla de inicio: 12 bolas, click cuando lleguen al centro de la raqueta. Se guarda en este navegador |
| «¿Por qué fallé?» | Activado por defecto; se apaga en la pantalla de inicio («Explicar mis errores») |
| Sacar | Click para lanzar la bola (o esperar 1 s) y click cuando baje |
| Datos de precisión y del golpe (tipo, potencia, teclas en el click, cruce, spin) | `D` |
| Pausa | `Esc` |

Lectura del spin: la bola gira con su spin real (costura naranja y logos) y deja un trail de color por tipo de
efecto: **naranja** = topspin, **cian** = backspin, **magenta** = lateral, **blanco** = bola sin efecto muy
rápida (smash).

Resultado del golpe: junto a tu raqueta, la calidad y debajo qué salió y con qué fuerza («TOPSPIN completo»,
«SLICE reducido · persiguiendo», «SMASH completo · bola baja para el smash», «NORMAL · pulsaste W después del
click»). Una ráfaga de chispas del color del golpe sale de la raqueta: muchas con ¡Perfecto!, algunas con Bien, pocas
y grises con un golpe débil.

## Parámetros de playtest (URL)

`http://localhost:5173/?speed=0.65&bot=hard&debug=1`

| Parámetro | Efecto |
|---|---|
| `speed` | `gameSpeed` (escala de tiempo de la bola). Por defecto 0.75 |
| `radius` | Radio de juego de la raqueta en metros. Por defecto 0.14 |
| `pspeed`, `paccel` | Velocidad (m/s) y aceleración (m/s²) máximas de la raqueta. Por defecto 6 y 60 |
| `bot` | `easy`, `medium` o `hard` |
| `debug=1` | Muestra el panel de precisión desde el inicio |
| `autostart=1` | Empieza sin menú |
| `seed` | Semilla del bot (partidas reproducibles) |
| `offset` | Desfase de latencia en ms, en lugar del calibrado (por ejemplo `offset=0` para pruebas) |
| `why` | `0` / `1` desactiva o activa «¿por qué fallé?» (en lugar de lo guardado) |
| `reduce` | `1` reduce el temblor de cámara y los destellos (sin ráfagas de chispas). Por defecto sigue la preferencia «reducir movimiento» del sistema; `0` la ignora |
| `online=1` | **V0.3**: juega en red contra el bot remoto (necesita el servidor: `npm run dev`) |
| `ping` | Tu ping simulado en ms (ida y vuelta, repartido en los dos sentidos). Por defecto 0; máximo 500 |
| `botping` | El ping simulado del bot. Por defecto, el mismo que `ping` |
| `jitter` | Variación de la latencia simulada, en fracción: 0.1 = ±10 % (por defecto). Nunca reordena mensajes |

En `online=1`, `bot`, `seed`, `offset`, `debug` y `autostart` funcionan igual. Los parámetros que cambian el juego
(`speed`, `radius`, `pspeed`, `paccel`) no valen online: el servidor compara el hash de la configuración y rechaza
la conexión si no coincide.

Todos los valores ajustables están en un único archivo: [`shared/src/config.ts`](shared/src/config.ts)
(secciones `spin`, `shotTypes`, `block` y `bot.difficulties.*.shots` para V0.2; en V0.2b, `shotTypes.powerByTier`,
`chasingPower`, `topspin` / `slice` / `smash` y `presentation.sparks`; en V0.3, `net`: frecuencias, ping, frenado de
la bola que se aleja, validación, temporizadores y latencia simulada).

## Estructura

```text
shared/   Lógica del juego en TypeScript puro (sin DOM): física (Magnus, bote con spin), teclas → tipo de golpe y
          calidad → potencia (stroke.ts), objetivos del golpe y solver con spin, bloqueo, "¿por qué fallé?", reglas,
          simulación y bot. Se ejecuta tal cual en Node (type stripping).
  src/click.ts             Piezas del click que comparten local, cliente, servidor y bot.
  src/net/                 Red (V0.3), pura y con tests: protocolo y validación de mensajes, hash de la config,
                           vuelos (flight.ts), resolución del golpe, reloj de la bola que se aleja (brake.ts), ping,
                           latencia simulada, validación del servidor, partida de cliente (client-match.ts) y
                           partida de servidor (server-match.ts).
server/   Servidor de juego (Node + `ws`, sin compilar): una sala por jugador con el ServerMatch como autoridad, latencia
          simulada por conexión y el bot remoto (bot-client.ts), que se conecta por WebSocket como un cliente más.
  scripts/net-bots.ts      Partidos de bots por la red y sus medidas.
client/   Three.js + Vite: escena (spin visible, trail y chispas), traductor ratón + teclas → InputIntent, bucle de
          120 Hz, HUD (barra de teclas, ping), audio. game/session.ts (partida local) y net/online-session.ts (en red)
          dan al juego la misma vista.
  src/assets/manifest.ts   Manifiesto único de assets (rutas fijas, ver abajo).
  e2e/                     Scripts de Playwright que juegan contra el bot en un navegador real, con ratón y
                           teclado reales (keys-check.js: golpes con teclas y ±30 ms de error de timing, textos,
                           barra y chispas; shots-check.js: los cuatro golpes, el bloqueo y "¿por qué fallé?";
                           net-check.js: V0.3 online contra el bot remoto con ping 0/50/100/150).
                           Se ejecutan con `npm run dev` arrancado, con browser_run_code de Playwright MCP.
scripts/  dev.mjs (arranque conjunto de `npm run dev`) y ws-check.mjs.
docs/     Análisis, planes, capturas de la verificación (docs/screenshots/v0.3/) y versiones anteriores del diseño.
```

## Sustituir el arte y los sonidos

Los assets se cargan desde `client/src/assets/` con las rutas del §18.1. Para cambiar uno, reemplaza
el archivo **con el mismo nombre**; no hay que tocar código.

- `characters/<power|defender>/portrait.png`, `select.png`, `paddle.png`; el color de acento está en `manifest.ts`.
- `ui/logo.png`, `arena/background.jpg`.
- Sonidos: `sfx/<nombre>.ogg` (o `.mp3`) con los nombres de §16 (`bounce_table`, `hit_perfect`,
  `streak_1` … `streak_4`, `net`, `whiff`…) y los de V0.2 por tipo de golpe (`hit_topspin`, `hit_slice`,
  `hit_smash`, `hit_block`). Si un archivo no existe, se sintetiza con WebAudio.
  Tras añadir un archivo nuevo, reinicia `npm run dev`.
