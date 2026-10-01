# Ping Pong PvP — prototipo V0.1 (feel local)

Juego de ping pong para navegador contra un bot. Esta fase (V0.1 del §21 del documento de diseño)
sirve para probar el **tacto del golpe con el ratón**: raqueta con inercia, golpe por click con
medición de timing (ms) y posición (% del radio) y feedback estilo *Paper Mario TTYD*.

- Diseño vigente: [`ping_pong_pvp_gameplay_design (1).md`](ping_pong_pvp_gameplay_design%20(1).md)
- Análisis de la implementación y propuestas: [`docs/analisis_v0.1.md`](docs/analisis_v0.1.md)

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
| `npm run sim -- medium hard 7` | Partido bot contra bot en Node, sin navegador (dificultad0, dificultad1, semilla, [gameSpeed]) |
| `npm run placeholders -w client` | Regenera las imágenes placeholder |

## Controles

| Acción | Control |
|---|---|
| Mover la raqueta | Ratón (la raqueta persigue al cursor con inercia) |
| Golpear | Click izquierdo cuando la bola llega a la raqueta |
| Cruzar la bola | Con la raqueta ya colocada, mover el ratón hacia un lado al hacer click (si llegas persiguiendo la bola, sale recta) |
| Sacar | Click para lanzar la bola (o esperar 1 s) y click cuando baje |
| Datos de precisión (último golpe y medias de los últimos 20) | `D` |
| Pausa | `Esc` |

## Parámetros de playtest (URL)

`http://localhost:5173/?speed=0.65&bot=hard&debug=1`

| Parámetro | Efecto |
|---|---|
| `speed` | `gameSpeed` (escala de tiempo de la bola). Por defecto 0.7 |
| `radius` | Radio de juego de la raqueta en metros. Por defecto 0.14 |
| `pspeed`, `paccel` | Velocidad (m/s) y aceleración (m/s²) máximas de la raqueta. Por defecto 6 y 60 |
| `bot` | `easy`, `medium` o `hard` |
| `debug=1` | Muestra el panel de precisión desde el inicio |
| `autostart=1` | Empieza sin menú |
| `seed` | Semilla del bot (partidas reproducibles) |

Todos los valores ajustables están en un único archivo: [`shared/src/config.ts`](shared/src/config.ts).

## Estructura

```text
shared/   Lógica del juego en TypeScript puro (sin DOM): física, golpe, reglas, simulación y bot.
          Se ejecuta tal cual en Node (type stripping) → reutilizable por el servidor de V0.3.
client/   Three.js + Vite: escena, traductor ratón → InputIntent, bucle de 120 Hz, HUD, audio.
  src/assets/manifest.ts   Manifiesto único de assets (rutas fijas, ver abajo).
  e2e/                     Scripts de Playwright que juegan contra el bot con eventos de ratón reales.
docs/     Análisis, capturas de la verificación y la versión anterior del diseño.
```

## Sustituir el arte y los sonidos

Los assets se cargan desde `client/src/assets/` con las rutas del §18.1. Para cambiar uno, reemplaza
el archivo **con el mismo nombre**; no hay que tocar código.

- `characters/<power|defender>/portrait.png`, `select.png`, `paddle.png`; el color de acento está en `manifest.ts`.
- `ui/logo.png`, `arena/background.jpg`.
- Sonidos: `sfx/<nombre>.ogg` (o `.mp3`) con los nombres de §16 (`bounce_table`, `hit_perfect`,
  `streak_1` … `streak_4`, `net`, `whiff`…). Si un archivo no existe, se sintetiza con WebAudio.
  Tras añadir un archivo nuevo, reinicia `npm run dev`.
