# V0.3 — Netcode: «cada uno golpea en su tiempo»

Implementa la fase V0.3 del juego "Ping Pong PvP" siguiendo el plan de implementación
[`docs/superpowers/plans/2026-10-03-v0.3-netcode.md`](../superpowers/plans/2026-10-03-v0.3-netcode.md), y después escribe el análisis
retroactivo y las propuestas.

## Contexto
- Lee antes de empezar:
  - El documento de diseño vigente, `ping_pong_pvp_gameplay_design_v4.md`: completo, y con atención §3.1, §4.2, §5.2–§5.3, §13, §15.1, §17 y §21. El §25 resume los cambios v3 → v4.
  - `docs/analisis_v0.2.md`: §5.1 (riesgos para V0.3), B.7 (requisitos de multijugador) y B.11 (cierre de V0.2).
  - `README.md`.
- Estado del código:
  - V0.2 está cerrada y etiquetada (`v0.2.0`).
  - 179 tests en `shared/`; E2E en `client/e2e/`, que se ejecutan con Playwright MCP (`browser_run_code`) con `npm run dev` arrancado.
- Leyenda del diseño:
  - ✅ = decidido por el autor; no se cambia sin consultar.
  - 🟡 = propuesta base: puedes ajustar valores si lo justificas.
  - ❓ = abierto: usa la propuesta de §24 y regístralo.
- Preferencias del autor:
  - Aplica siempre las **mejores prácticas** y optimiza **rendimiento y jugabilidad**.
  - Precisión exigente (timing y posición) y riesgo legible.
  - Instrucciones de playtest concretas: URL completa, qué hacer y qué mirar.

## Decisiones del autor para V0.3 (2026-10-03)
1. **Modelo de red: «cada uno golpea en su tiempo»** (§17.2 ✅). Ningún jugador pierde tiempo de reacción ni precisión por el ping:
   - cada bola entre dos golpes es un **vuelo** (estado de salida + física determinista) y cada jugador lo mide con su propio **reloj de vuelo**;
   - **tu golpe** empieza tu vuelo nuevo al instante (predicción local) y el feedback no espera a la red;
   - **el vuelo del rival** empieza para ti **cuando recibes su golpe**, a velocidad real, y tu click se mide en el reloj de ese vuelo, igual que en local;
   - **la bola que se aleja** se frena poco a poco en tu pantalla para llegar a la zona del rival cuando se espera su golpe (tu ping + el suyo). Si su golpe llega antes, se adelanta suavemente (~80 ms); si no llega, sigue su trayectoria real;
   - **coste aceptado**: los rallies duran algo más que en local (con 100 ms de ping, la bola que se aleja va ~25 % más lenta en ese tramo; con 150 ms, ~40 %);
   - **la raqueta del rival** se dibuja con su posición (30 Hz, interpolada) en ese mismo tiempo frenado.
2. **Alcance de las pruebas**: el autor juega **solo, en su lado (abajo), contra un bot remoto** que se conecta al servidor por WebSocket como cualquier cliente. La partida entre dos personas (mundo espejado del lado 1), las salas y jugar por internet son **V0.4**.
3. **Servidor propio** con Node + WebSocket (librería `ws`) y la simulación de `shared/` como autoridad. Colyseus no, por ahora (§17.1).
4. **Latencia simulada** de 50 / 100 / 150 ms de ping, con algo de variación, configurable por URL.
5. **Las teclas de golpe solo viajan dentro del evento de golpe**: el rival nunca recibe qué tecla mantienes antes de golpear (§13 ✅).

## Alcance
- **`server/`** (workspace nuevo `@ppp/server`):
  - servidor WebSocket en Node ≥ 22.18, ejecutado sin compilar (type stripping, como `shared/scripts/`);
  - una partida por conexión humana, contra un bot remoto que el servidor arranca solo (conectado por WebSocket a sí mismo, con su propia latencia simulada);
  - autoridad sobre puntos, reglas, validación y estado de salida oficial de cada vuelo;
  - servidor **por eventos**: calcula cada vuelo al recibir el golpe y usa temporizadores para «no devuelta»; no simula a 120 Hz todo el rato.
- **`shared/src/net/`** (lógica de red pura, sin DOM ni sockets, determinista, con tests):
  - protocolo tipado y validación defensiva de cada mensaje entrante;
  - vuelos: muestreo determinista a 120 Hz desde el estado de salida, contactos y resultado según las reglas;
  - curva de frenado de la bola que se aleja;
  - reloj y ping;
  - validación del golpe en el servidor;
  - **partida de cliente** (predicción, reloj de vuelo, construcción de eventos, corrección), usada igual por el navegador y por el bot remoto;
  - **partida de servidor** (autoridad).
- **`shared/` (refactor dirigido):**
  - extraer de `Simulation` las piezas puras que cliente, servidor y bot deben compartir: evaluación del click contra un vuelo, factor de «colocado» a partir de muestras de la raqueta y posición fija del golpe;
  - hacer que `Bot` dependa de una interfaz mínima de lectura (no de `Simulation`), para que juegue igual en local y en red;
  - **el modo local no cambia de comportamiento**: los 179 tests siguen en verde sin tocar sus expectativas.
- **`client/`:**
  - modo online con `?online=1`: misma escena, mismo HUD y mismo feedback (los eventos online tienen la forma de los `SimEvent` locales, para reutilizar mensajes, sonidos, chispas y «¿por qué fallé?»);
  - raqueta del rival desde la red;
  - aviso «Conexión perdida» y vuelta al menú si se corta;
  - **ping de los dos jugadores en el HUD** (§15.1: cada 2 s, media de las últimas 5, colores con texto, aviso por encima de 120 ms);
  - sin `online=1`, el juego local de siempre.
- **Desarrollo:**
  - `npm run dev` arranca cliente y servidor con un script que cierra los dos al salir (en este Windows, el `node vite.js` hijo sobrevive si no);
  - el cliente habla con el servidor por el mismo origen (proxy WebSocket de Vite).
- **Fuera de alcance:** salas con código, partido completo, warm-up, reconexión, dos personas, mundo espejado, jugar por internet, Momentum, especiales, anti-cheat (✅ fuera).

## Parámetros de URL nuevos
- `online=1`: modo en red contra el bot remoto.
- `ping=<ms>`: tu ping simulado (por defecto 0).
- `botping=<ms>`: el del bot (por defecto, el mismo que `ping`).
- `jitter=<fracción>`: variación (por defecto 0.1 = ±10 %, sin reordenar mensajes).
- `bot=easy|medium|hard`, `seed`, `offset`, `debug=1`, `autostart=1`: como en local.

## Requisitos técnicos
- **Determinismo (§17.6):** el mismo vuelo da la misma trayectoria bit a bit en cliente, bot y servidor. Quien golpea predice su vuelo con **el mismo evento** que envía (ya cuantizado), así su predicción y la del servidor coinciden. En la simulación, prohibido `Math.sin/cos/exp/pow`.
- **Configuración única** (`shared/src/config.ts`):
  - sección nueva `net`: frecuencias, ping, frenado, márgenes de validación, temporizadores y latencia simulada;
  - el cliente envía el **hash de la config** al conectarse y el servidor rechaza la conexión si no coincide.
- **Mensajes:** JSON compacto (claves cortas, posiciones en mm), con un campo de versión del protocolo. Cada mensaje entrante se valida: tipo, rangos y números finitos. Un mensaje inválido se descarta y se registra; nunca lanza excepciones.
- **Presupuestos de rendimiento** (se miden y se reportan):
  - servidor: < 1 ms de CPU por golpe (p99);
  - por jugador: < 2 KB/s de subida y < 3 KB/s de bajada;
  - cliente: 60 fps sostenidos, sin asignaciones por frame en la ruta de red y render (estructuras reutilizadas);
  - el feedback del golpe propio aparece en el mismo frame del click, como en local.
- **Jugabilidad** (se mide y se reporta):
  - factor de frenado medio y máximo de la bola que se aleja con cada ping;
  - número de correcciones del servidor (objetivo: 0 en condiciones normales);
  - ningún salto visible de la bola en pantalla (distancia máxima por frame).
- **Arquitectura:** la lógica va en `shared/` (sin DOM); el cliente solo presenta y traduce la entrada; el servidor solo transporta y aplica la autoridad. Archivos pequeños con una responsabilidad clara.
- **TDD:** test que falla primero para cada pieza pura nueva.

## Verificación
1. **Tests unitarios** (`npm test`): los 179 de antes en verde, más tests de cada pieza nueva:
   - protocolo (codificar y decodificar; rechaza mensajes malformados);
   - vuelo (bit a bit igual que la simulación local);
   - curva de frenado (monótona, pendiente acotada, identidad sin ping, llega a tiempo);
   - validación (rechaza alcance y tiempos imposibles);
   - partida de cliente + partida de servidor **en memoria, con un transporte falso que retrasa los mensajes**: bot contra bot con ping 0/100/150 → **0 discrepancias** entre lo que predicen los clientes y lo que decide el servidor, y mismos resultados que en local con la misma semilla;
   - determinismo.
2. **Partidos de bots por la red** (Node, sockets reales, sin navegador; script nuevo del estilo de `shot-stats`), 30 partidas Normal contra Normal con ping 0, 100 y 150 y ±10 % de variación:
   - golpes por punto ±10 % de los de local (`node shared/scripts/shot-stats.ts medium medium 30 7`);
   - 100 % de los puntos perdidos con causa nombrada;
   - 0 discrepancias;
   - CPU por golpe del servidor y bytes por segundo por jugador.
3. **Criterio de aceptación de V0.3** (E2E en Chromium, `client/e2e/net-check.js`):
   - ratón y teclado **reales** de Playwright, sin gestos sintéticos dentro de la página, con **±30 ms** de error de timing aleatorio con semilla (como `client/e2e/keys-check.js`), contra el bot remoto con ping 0, 50, 100 y 150;
   - el Δt medio con 100 ms se aleja **≤ 10 ms** del de 0 ms, según la evaluación del servidor;
   - se reportan también el reparto PERFECT/GOOD/débil, los tipos de golpe (pedido = salido), el frenado, las correcciones y los fps;
   - capturas en `docs/screenshots/v0.3/` (HUD con el ping, bola que se aleja, raqueta del rival golpeando);
   - consola sin errores.
4. **Regresión:** el modo local no cambia. Pasan `client/e2e/keys-check.js` y `autoplay-rally.js`; sus capturas no sustituyen a las de V0.2: guárdalas en `docs/screenshots/v0.3/regresion/` y restaura las de V0.1 y V0.2 con git.
5. Typecheck (`shared/`, `client/`, `server/`) y build limpios.

## Cuidado
- **No borres nada que contenga enlaces a `node_modules`**: los workspaces enlazan `client/`, `shared/` (y ahora `server/`). Para comparar con versiones anteriores, usa `git show <tag>:<ruta>`.
- Al terminar, cierra los procesos `node` que queden escuchando (Vite en 5173 y el servidor) y comprueba que los puertos quedan libres.
- Commits pequeños por hito en `master`. No etiquetes.

## Entrega
- **`docs/analisis_v0.3.md`**, con la estructura de los análisis anteriores:
  1. Trazabilidad de V0.3 (§21 de la v4): implementado, parcial o no, con el archivo de cada punto.
  2. Evidencia: las tablas de la verificación.
  3. Desviaciones respecto a la v4 y valores 🟡 elegidos o cambiados (valor → motivo).
  4. Revisión de §17.2 a la luz de V0.3: qué se confirma, qué genera dudas y qué falta.
  5. Riesgos para V0.4: dos personas, mundo espejado, salas, reconexión, internet.
  6. Propuestas de cambio al diseño, numeradas desde P49, **sin modificarlo**.
- **README:**
  - cómo jugar online;
  - parámetros nuevos;
  - comandos nuevos (servidor, partidos de bots por la red);
  - estructura con `server/`.
- **Al autor, en el mensaje final:**
  - cómo arrancar;
  - una checklist de playtest de 5–8 puntos con la URL completa, qué hacer y qué mirar exactamente. Por ejemplo: jugar con ping 0 y luego 100 y 150 y comparar; mirar el HUD; ver si la bola que se aleja molesta; ver si la raqueta del rival «golpea» la bola en pantalla.
