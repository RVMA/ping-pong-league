# V0.4 — Partido PvP (salas, dos personas, publicado en Cloudflare)

Implementa la fase V0.4 del juego "Ping Pong PvP" siguiendo el plan de implementación
[`docs/superpowers/plans/2026-10-06-v0.4-partido-pvp.md`](../superpowers/plans/2026-10-06-v0.4-partido-pvp.md), y después escribe el
análisis retroactivo y las propuestas.

## Contexto
- Lee antes de empezar:
  - El documento de diseño vigente, `ping_pong_pvp_gameplay_design_v5.md`: completo, y con atención a §2.1, §3.3, §3.7,
    §6.4, §7.4–§7.5, §10.3, §13.1, §14, §15, §17 (sobre todo §17.2 y §17.7) y §21. El §25 resume los cambios v4 → v5.
  - `docs/analisis_v0.3.md`: §4 (revisión de §17.2), §5 (riesgos para V0.4) y §8 (cierre de V0.3 y decisiones para V0.4).
  - `README.md`.
  - La memoria del proyecto.
- Estado del código:
  - V0.3 está cerrada y etiquetada (`v0.3.0`).
  - 259 tests en `shared/` y 6 en `server/` (sockets reales).
  - E2E en `client/e2e/`: se ejecutan con Playwright MCP (`browser_run_code`) con `npm run dev` arrancado.
- Leyenda del diseño:
  - ✅ = decidido por el autor; no se cambia sin consultar.
  - 🟡 = propuesta base: puedes ajustar valores si lo justificas.
  - ❓ = abierto: usa la propuesta de §24 y regístralo.
- Preferencias del autor:
  - Aplica siempre las **mejores prácticas** y optimiza **rendimiento y jugabilidad**.
  - Precisión exigente (timing y posición) y riesgo legible.
  - Instrucciones de playtest concretas: URL completa, qué hacer y qué mirar.

## Decisiones del autor para V0.4 (2026-10-06)
1. **Publicar en Cloudflare, sin túnel a su PC** (§17.1 ✅, §17.7): Workers + Durable Objects, **un Durable Object por
   sala**, WebSocket con `wss`, y el **mismo Worker sirve el cliente** (Static Assets). El servidor Node + `ws` de V0.3 se
   queda para desarrollo y pruebas (latencia simulada, bot remoto, mediciones de CPU). La lógica de la sala es pura y la
   comparten los dos. **El despliegue lo hace el autor** (o la sesión, solo si el autor ya ha iniciado sesión en
   Cloudflare y lo autoriza en ese momento).
2. **Modo por defecto al crear sala: Estándar** (mejor de 3) (§10.3 ✅).
3. **Timeout del warm-up solo mientras uno espera** (§14.2 ✅): si uno da a Listo y el otro no lo da en 3 min (aviso a
   los 2:30), el que no está listo sale de la sala; el otro sigue con el código abierto. Si ninguno está listo, se puede
   pelotear sin límite.
4. **La lectura del rival se mide con la «prueba de lectura»** (§13.1 ✅): tu raqueta devuelve sola, el rival mezcla
   golpes y tú nombras cada golpe suyo con 1 normal · 2 topspin · 3 slice · 4 smash · 5 bloqueo. 30 golpes. Vale contra
   el bot en local y en el warm-up de una sala.
5. **P54: corregir** (§7.5 ✅): profundidad mínima del bote (0.05 de media mesa) y límite de velocidad del solver (25 m/s
   de simulación). Cambia el juego local solo en ese caso límite.
6. **P49 y P58 aprobadas** (bola que se aleja en «valle»; en red no hay pausa) y `net.brake.minSpeed` se queda en 0.25.
   Ya están implementadas: no se tocan.
7. Aceptadas las propuestas base de la planificación (ya escritas en el diseño v5):
   - sin selección de personaje hasta V0.5;
   - código de sala de 4 letras sin I ni O, enlace `?room=ABCD` y nombre en el lobby;
   - primer saque del partido por sorteo; en cada game saca primero quien recibió primero en el anterior;
   - desconexión: el punto en juego acaba solo, pausa de hasta 30 s antes del siguiente saque, reconexión con token
     (por pestaña) y estado, o abandono;
   - tras el partido, estadísticas y vuelta al warm-up (revancha = Listo otra vez);
   - mundo espejado solo de dibujo (cámara del lado 1 en su extremo; «Tú» a la izquierda del marcador);
   - bola de canto válida en la arista superior; el lateral es bola muerta;
   - Listo = mantener Shift 0.6 s o botón; en el warm-up saca quien perdió la bola;
   - online contra el bot solo en el servidor de desarrollo;
   - borrar el archivo vacío `client/src/game/0`.

## Alcance
- **Salas** (`shared/src/net/room.ts`, lógica pura con tiempo virtual):
  - fases: esperando rival → warm-up → cuenta atrás → partido (games, entre games) → estadísticas y warm-up otra vez;
  - pausa y reconexión;
  - Listo, timeout del warm-up, abandono, revancha.
- **Partido por games** en `ServerMatch` y `ClientMatch`:
  - número de rally que nunca se reinicia en la sala;
  - warm-up sin marcador;
  - reanudación con el marcador;
  - el receptor ausente pierde el punto al acabar el vuelo.
- **Protocolo v2:** la ruta va en la URL del WebSocket (`/ws?create=<modo>`, `/ws?room=<código>` y, solo en desarrollo,
  `/ws?bot=<dificultad>`); además, mensajes de sala y estadísticas.
- **Servidor Node** con salas (desarrollo), **Worker de Cloudflare** con un Durable Object por sala (producción) y
  `wrangler dev` para probarlo en local.
- **Cliente:**
  - lobby (nombre, crear sala con modo, unirse por código o enlace, calibración, contra el bot en local);
  - sala de espera (código, copiar enlace, jugadores con ping y Listo);
  - warm-up con Listo (Shift 0.6 s), cuenta atrás 3-2-1-GO, entre games, pausa por desconexión, estadísticas;
  - reconexión automática;
  - mundo espejado del lado 1;
  - piloto automático (`?autoplay=`) y prueba de lectura.
- **Física y reglas:** bola de canto (aristas y esquinas de la mesa) y P54.
- **Pruebas de red:**
  - picos de latencia de TCP simulados (`spike`);
  - script de partidos de bots por salas contra cualquier servidor (Node, `wrangler dev` o el publicado).
- **Fuera de alcance:**
  - personajes, Momentum y especiales (V0.5);
  - matchmaking público y servidores por región;
  - anti-cheat (✅ fuera);
  - táctil y trackpad (V0.7);
  - guardar salas en disco.

## Parámetros de URL nuevos
- `room=ABCD`: unirse a la sala (minúsculas valen). Tras crear una sala, la URL pasa a `?room=<código>`, así recargar
  la pestaña reconecta.
- `create=quick|standard|full`: crear una sala nada más abrir (para pruebas; el lobby lo hace con botones).
- `name=<texto>`: nombre del jugador (para pruebas; si no, el guardado o el del lobby).
- `autoplay=easy|medium|hard`: el bot mueve tu raqueta (pruebas E2E y demostraciones).
- `read=1`: prueba de lectura contra el bot en local (con `bot=`).
- `spike=<probabilidad>`: picos de latencia de TCP simulados en tu conexión (solo en el servidor de desarrollo, como
  `ping` y `jitter`).
- Siguen: `online=1` (contra el bot remoto, solo desarrollo), `ping`, `botping`, `jitter`, `bot`, `seed`, `offset`,
  `debug`, `autostart`, `why`, `reduce`.

## Requisitos técnicos
- **Determinismo (§17.6):** las aristas de la mesa y P54 solo usan `+ − × ÷` y `Math.sqrt`. El vuelo sigue siendo bit
  a bit igual en cliente, servidor y simulación local (tests de `flight.test.ts`).
- **Configuración única** (`shared/src/config.ts`):
  - secciones nuevas `room` (códigos, modos, tiempos de Listo, cuenta atrás, entre games, timeout, reconexión, nombre,
    ritmo y tamaño de mensajes) y `presentation.readTest`;
  - `shot.minLandingDepth` y `shotTypes.solverMaxSpeed` para P54;
  - `net.latency.spike` para los picos.
- **Mensajes:**
  - el protocolo pasa a la versión 2;
  - cada mensaje entrante se valida (tipo, rangos, números finitos, longitud); un mensaje inválido se descarta y se
    registra, nunca lanza;
  - los nombres se limpian en el servidor (sin caracteres de control, 1–16 caracteres) y el cliente los muestra siempre
    como texto, nunca como HTML.
- **Servidor publicado:**
  - solo WebSockets con `Origin` de la propia página (o sin `Origin`: scripts);
  - mensajes de 16 KB como máximo y límite de ritmo por conexión;
  - sin latencia simulada ni bot remoto;
  - sin guardar nada en disco;
  - temporizadores solo al siguiente plazo (nada de bucles continuos).
- **Presupuestos de rendimiento** (se miden y se reportan):
  - servidor: < 1 ms de CPU por golpe (p99, servidor Node);
  - por jugador: < 2 KB/s de subida y < 3 KB/s de bajada en el partido;
  - cliente: 60 fps sostenidos en los dos lados, sin asignaciones por frame en la ruta de red y render; la interfaz
    de sala solo toca el DOM cuando cambia algo;
  - Cloudflare: mensajes por segundo por jugador → peticiones de Durable Objects por hora de partido; cabe en el plan
    gratuito (100 000 al día, mensajes entrantes a 1/20) con ≥ 8 h de juego al día;
  - reconexión: el estado llega en < 1 s tras reabrirse el socket.
- **Jugabilidad** (se mide y se reporta):
  - 0 discrepancias (correcciones de los clientes y rechazos del servidor), también con pings distintos y con picos;
  - el lado 1 tan preciso como el lado 0;
  - frenado medio y máximo de la bola que se aleja con la suma de los dos pings;
  - golpes por punto ±10 % de los de local;
  - mayor salto de la bola en pantalla.
- **Arquitectura:**
  - la lógica va en `shared/` (sin DOM ni Node);
  - los dos servidores solo transportan, ponen temporizadores y aplican la autoridad;
  - el cliente solo presenta y traduce la entrada;
  - archivos pequeños con una responsabilidad clara: `game.ts` ya tiene 880 líneas, así que el flujo de sala va en
    archivos propios.
- **TDD:** test que falla primero para cada pieza pura nueva.

## Verificación
1. **Tests unitarios** (`npm test`):
   - los 259 + 6 de antes en verde; si P54 o la bola de canto cambian alguna expectativa, se justifica una por una en el
     análisis;
   - tests nuevos de cada pieza: P54, aristas, protocolo v2, rutas y códigos, partido por games, sala con tiempo
     virtual, estadísticas, límite de ritmo, prueba de lectura;
   - red en memoria con salas y picos.
2. **Partidos de bots por salas** (`server/scripts/room-bots.ts`):
   - en el servidor Node, 20 partidos Estándar Normal contra Normal con pings 0/0, 100/100 y 50/150 (±10 %), y otra
     tanda con picos;
   - criterios: 0 discrepancias; golpes por punto ±10 % de la referencia local; 100 % de causas con nombre;
     alternancia correcta del saque por game; CPU p99 < 1 ms; bytes por jugador dentro del presupuesto;
   - también 5 partidos Rápido contra `wrangler dev`.
3. **E2E en Chromium** (Playwright MCP, ratón y teclado reales donde importa la precisión):
   - `room-check.js`: dos pestañas, lobby → crear → unirse por enlace → warm-up → Listo con Shift → cuenta atrás →
     partido completo → estadísticas → warm-up; recargar una pestaña en mitad del partido → pausa → se reanuda con el
     marcador; cerrar una pestaña → abandono a los 30 s; también contra `wrangler dev`;
   - `side1-check.js`: el lado 1 con entrada real y ±30 ms de error contra el piloto automático, con ping 0 y 100;
     |Δt(100) − Δt(0)| ≤ 10 ms y Δt del lado 1 a ≤ 10 ms del lado 0;
   - `read-check.js`: la prueba de lectura da el % correcto y la tabla de confusiones;
   - capturas en `docs/screenshots/v0.4/`; consola sin errores.
4. **Regresión:** `keys-check.js`, `autoplay-rally.js` (local) y `net-check.js` (online contra el bot remoto) pasan.
   Sus capturas van a `docs/screenshots/v0.4/regresion/`; restaura las anteriores con git.
5. **Producción** (después de que el autor despliegue):
   - 10 partidos Rápido de bots por salas contra la URL publicada: 0 discrepancias, ping medido, bytes y mensajes por
     segundo;
   - la consola del navegador sin errores en la URL publicada.
6. Typecheck (`shared/`, `client/`, `server/` y el Worker) y build limpios; `wrangler deploy --dry-run` sin errores.

## Cuidado
- **No borres nada que contenga enlaces a `node_modules`**: los workspaces enlazan `client/`, `shared/` y `server/`.
  Para comparar con versiones anteriores, usa `git show <tag>:<ruta>`.
- **Nada de despliegues ni cuentas sin el autor:**
  - `wrangler login` lo hace el autor (abre el navegador);
  - `npm run deploy` solo con su permiso explícito en ese momento;
  - un despliegue corta las salas abiertas.
- Al terminar, cierra los procesos `node` y `workerd` que queden escuchando (5173, 5180, 8787) y comprueba que los
  puertos quedan libres.
- Commits pequeños por hito en `master`. No etiquetes.

## Entrega
- **`docs/analisis_v0.4.md`**, con la estructura de los análisis anteriores:
  1. Trazabilidad de V0.4 (§21 de la v5): implementado, parcial o no, con el archivo de cada punto.
  2. Evidencia: las tablas de la verificación (también producción y coste en Cloudflare).
  3. Desviaciones respecto a la v5 y valores 🟡 elegidos o cambiados (valor → motivo). Incluye los tests anteriores
     cuya expectativa cambió por P54 o por la bola de canto.
  4. Revisión de §14 y §17.7 a la luz de V0.4: qué se confirma, qué genera dudas y qué falta.
  5. Riesgos para V0.5 (Momentum, especiales y POWER sobre el modelo de vuelos).
  6. Propuestas de cambio al diseño, numeradas desde P60, **sin modificarlo**.
  7. Checklist de playtest de V0.4.
- **README:**
  - cómo jugar con otra persona (local y publicado);
  - cómo desplegar en Cloudflare (pasos del autor);
  - parámetros y comandos nuevos;
  - estructura con el Worker.
- **Al autor, en el mensaje final:**
  - cómo arrancar en local;
  - cómo desplegar (o la URL, si ya está publicado);
  - una checklist de playtest de 8–10 puntos con la URL completa, qué hacer y qué mirar exactamente. Incluye los puntos
    de sensación de V0.3 que no se probaron (§8 del análisis de V0.3): la bola que se aleja frenada, la raqueta del
    rival golpeando la bola, los PERFECT con ping real y el smash del rival. Y la prueba de lectura entre dos personas
    (≥ 80 %).
