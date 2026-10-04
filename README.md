# Ping Pong PvP — prototipo V0.2b (golpes con teclas)

Juego de ping pong para navegador contra un bot. V0.1 (cerrada, `v0.1.0`) probó el **tacto del golpe con el
ratón**: raqueta con inercia, golpe por click con medición de timing (ms) y posición (% del radio) y feedback
estilo *Paper Mario TTYD*. V0.2 (§21 del diseño) añadió el **golpe completo**: tipos de golpe (normal, topspin,
slice, smash), potencia, spin con efecto Magnus y bote con spin, spin visible, bloqueo con Espacio y «¿por qué
fallé?» completo. **V0.2b** (tras el playtest de V0.2): el tipo de golpe se elige con **teclas** (Q, W, E) en lugar de
con gestos del ratón, la potencia sale de la **calidad del golpe** (se premia el PERFECT) y hay barra de teclas y
chispas que dicen qué golpe tienes preparado y qué salió.

- Diseño vigente (v3): [`ping_pong_pvp_gameplay_design_v3.md`](ping_pong_pvp_gameplay_design_v3.md). Versiones anteriores en [`docs/archive/`](docs/archive/)
- Análisis de V0.2 y propuestas: [`docs/analisis_v0.2.md`](docs/analisis_v0.2.md); V0.2b en su apartado final (V0.1: [`docs/analisis_v0.1.md`](docs/analisis_v0.1.md))

## Arrancar

Requisitos: Node ≥ 22.18 (probado con Node 24).

```bash
npm install
npm run dev          # abre http://localhost:5173 (si está ocupado, Vite usa el siguiente puerto)
```

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Tests unitarios de `shared/` (Vitest) |
| `npm run typecheck` | Comprobación de tipos de `shared/` (sin DOM) y `client/` |
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

Todos los valores ajustables están en un único archivo: [`shared/src/config.ts`](shared/src/config.ts)
(secciones `spin`, `shotTypes`, `block` y `bot.difficulties.*.shots` para V0.2; en V0.2b, `shotTypes.powerByTier`,
`chasingPower`, `topspin` / `slice` / `smash` y `presentation.sparks`).

## Estructura

```text
shared/   Lógica del juego en TypeScript puro (sin DOM): física (Magnus, bote con spin), teclas → tipo de golpe y
          calidad → potencia (stroke.ts), objetivos del golpe y solver con spin, bloqueo, "¿por qué fallé?", reglas,
          simulación y bot.
          Se ejecuta tal cual en Node (type stripping) → reutilizable por el servidor de V0.3.
client/   Three.js + Vite: escena (spin visible, trail y chispas), traductor ratón + teclas → InputIntent, bucle de
          120 Hz, HUD (barra de teclas), audio.
  src/assets/manifest.ts   Manifiesto único de assets (rutas fijas, ver abajo).
  e2e/                     Scripts de Playwright que juegan contra el bot en un navegador real, con ratón y
                           teclado reales (keys-check.js: golpes con teclas y ±30 ms de error de timing, textos,
                           barra y chispas; shots-check.js: los cuatro golpes, el bloqueo y "¿por qué fallé?").
                           Se ejecutan con `npm run dev` arrancado, con browser_run_code de Playwright MCP.
docs/     Análisis, capturas de la verificación (docs/screenshots/v0.2b/) y versiones anteriores del diseño.
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
