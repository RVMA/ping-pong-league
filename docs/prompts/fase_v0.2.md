Implementa la fase V0.2 del juego "Ping Pong PvP" y después haz un análisis retroactivo y una propuesta de cambios.

## Contexto
- Documento de diseño vigente (v3): `ping_pong_pvp_gameplay_design_v3.md` (raíz del proyecto). Léelo completo antes de empezar. El §25 resume los cambios v2→v3; las versiones anteriores están en `docs/archive/`.
- Estado del código: V0.1 está cerrada y etiquetada (`v0.1.0`). Lee `README.md` y `docs/analisis_v0.1.md`, sobre todo §5 (riesgos para V0.2) y §8–§10 (playtests del autor y cierre).
- Leyenda del documento:
  - ✅ = decidido por el autor (no cambiar sin consultar).
  - 🟡 = propuesta base (puedes ajustar valores si lo justificas).
  - ❓ = abierto (usa la propuesta actual de §24 y regístralo, no lo decidas por tu cuenta).
  - ⚠️ = cambio sobre una decisión ✅ que ya está implementado pero pendiente de aprobación (P5 y P6): no lo deshagas ni lo amplíes sin consultar.
- Preferencias del autor, según sus playtests:
  - Precisión exigente: no relajar la ventana de posición ni agrandar la raqueta sin preguntar.
  - Riesgo legible: cada error con una causa que se pueda nombrar.
  - Ritmo rápido (`gameSpeed` 0.75).
  - Instrucciones de playtest concretas, con URLs completas y qué mirar exactamente.

## Parte 1 — Implementación de V0.2 (solo V0.2, ver §21)
Alcance:
- Gesto → tipo de golpe (normal, topspin, slice, smash) según §4.6, con la regla de "colocado" para todos los golpes (pregunta abierta 11: usa la propuesta y regístralo).
  - El slice es el cruce de §4.5 por encima de un umbral de velocidad del gesto.
  - El umbral del smash es relativo a la red.
- Potencia por la velocidad del gesto (§4.7).
- Spin: efecto Magnus y bote con intercambio spin↔velocidad (§7.1). El estado de la bola ya transporta `spin`.
- Solver de tiro con spin: 3 incógnitas y Magnus incluido en la simulación que resuelve (§7.5), determinista y con número fijo de iteraciones.
- Spin visible: logo o costura en la bola que rota según el spin real, más un trail de color por tipo de efecto (§2.2).
- Bloqueo con Space (§8):
  - misma medición de timing y posición que el golpe;
  - raqueta al 50 % de su velocidad máxima mientras se mantiene;
  - devuelve con la energía de la bola entrante;
  - un bloqueo PERFECT invierte parte del spin.
- "¿Por qué fallé?" completo (§2.2), sobre la base que ya hay en `client/src/ui/texts.ts`.
- Bot que usa los nuevos golpes y el bloqueo, con distribución por dificultad.
- Sin Momentum: el +5 % del bloqueo PERFECT se queda solo como valor en el config.

Requisitos técnicos:
- Sigue la arquitectura existente:
  - La lógica va en `shared/`: sin DOM, determinista según §17.6, paso fijo de 120 Hz, ejecutable en Node sin compilar.
  - El cliente solo hace presentación e input.
  - La lógica del juego solo consume `InputIntent`.
- Todos los valores ajustables nuevos van en el archivo de configuración único `shared/src/config.ts`.
- No rompas lo que ya funciona: los 95 tests de `shared/` y los scripts E2E de `client/e2e/` deben seguir pasando. Si cambias un comportamiento a propósito, actualiza el test y explica por qué.
- Placeholders y sonidos como en V0.1: manifiesto de assets y síntesis con WebAudio si no hay archivos.
- Fuera de alcance: servidor, multijugador, salas, Momentum, especiales, trackpad/táctil, anti-cheat.
- Commits pequeños por hito en `master`. No etiquetes `v0.2.0` hasta que el autor cierre la fase.

Proceso:
- Primero presenta un plan breve por hitos y empieza a ejecutarlo sin esperar confirmación. Detente a preguntar solo si algo choca con una decisión ✅ o ⚠️, o si un ❓ bloquea el avance.
- Tests unitarios para `shared/`:
  - Magnus: el topspin cae antes, el backspin sostiene y el lateral curva.
  - Bote con spin.
  - Clasificación de gestos y regla de "colocado".
  - Solver con spin: bota en el objetivo con el margen pedido.
  - Bloqueo.
  - Umbral del smash.
  - Determinismo.
- Usa el partido bot contra bot sin navegador (`npm run sim -- medium medium 7`) para ajustar valores. Objetivo: rallies medios de 6 o más golpes en Normal y un reparto razonable de puntos entre red, fuera y no devuelta.
- Verifica en el navegador real: arranca el servidor de desarrollo y juega contra el bot con Playwright (los scripts de `client/e2e/` sirven de base), probando los cuatro golpes y el bloqueo. Saca capturas en `docs/screenshots/v0.2/`.
  - Playwright no puede enviar movimientos de ratón a menos de ~10 ms de intervalo: los gestos rápidos se despachan dentro de la página como en `client/e2e/aim-check.js`.
  - Los scripts usan `?offset=0` para ignorar la calibración de latencia guardada.
  - No declares nada terminado sin esa evidencia.

## Parte 2 — Análisis retroactivo
Escribe `docs/analisis_v0.2.md` con:
1. Trazabilidad: cada punto de V0.2 del §21 → implementado / parcial / no implementado, con el archivo correspondiente.
2. Desviaciones respecto a la v3: qué se implementó distinto y por qué. Valores 🟡 que cambiaste (valor del documento → valor final → motivo).
3. Revisión de los cambios v2→v3 (§25) a la luz de V0.2: cuáles se confirman, cuáles generan dudas y cuáles faltan o sobran.
4. Problemas y riesgos descubiertos al implementar, sobre todo los que afecten a V0.3 (netcode) y V0.5 (Momentum y especiales).

## Parte 3 — Propuesta de cambios
En el mismo documento, una sección con una tabla de cambios propuestos al documento de diseño: sección afectada, cambio, motivo, impacto y prioridad.
- Los cambios sobre decisiones ✅ deben ir marcados como "requiere aprobación del autor".
- Propón una respuesta para cada pregunta abierta de §24 que la implementación haya aclarado, sobre todo la 1, la 9, la 10 y la 11.
- NO modifiques el documento de diseño: solo propón.

## Entrega final
Al terminar, dame:
- cómo arrancar el juego;
- una checklist de playtest manual de 5–10 puntos para probar el feel de los nuevos golpes y del bloqueo. En cada punto, la URL completa, qué hacer y qué mirar exactamente (juego con ratón y sé usar el panel D);
- un resumen de las propuestas más importantes.
