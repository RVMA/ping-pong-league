# Análisis retroactivo de V0.1 y propuesta de cambios

> Documento de diseño analizado: `ping_pong_pvp_gameplay_design (1).md` (v2, 2026-09-30).
> Implementación: commits `0daa2e7` … `HEAD` de este repositorio.
> Este documento **no modifica** el diseño: solo describe lo implementado y propone cambios.
> Marcas del diseño: ✅ decidido por el autor · 🟡 propuesta base · ❓ abierto.

---

## 0. Resumen

- V0.1 está implementada completa salvo lo que exige playtest humano: el «¿se siente bien?» del criterio de aceptación no se puede verificar automáticamente (ver checklist en la entrega).
- Evidencia: 77 tests unitarios en `shared/`, partidos bot contra bot sin navegador (en Node puro) y dos pruebas en Chromium real con Playwright usando **eventos de ratón reales**. En ellas se jugó un rally de **51 golpes** contra el bot medio y un game completo hasta 1-11 con errores provocados (capturas en `docs/screenshots/`).
- Hallazgos de diseño más importantes:
  1. La zona de golpe de 1.6 × radio en distancia es incompatible con medir el timing en ms.
  2. El documento no define **cómo se apunta** la bola.
  3. Hace falta una **calibración de latencia visual**, como en los juegos de ritmo.
  4. Con radio de raqueta real, la **posición** es mucho más exigente que el timing.
  5. Sin cuidado, golpear **pronto** daba más velocidad que un PERFECT (corregido).

---

## 1. Evidencia de verificación

| Qué | Resultado |
|---|---|
| Tests unitarios (`npm test`) | 77/77 en verde: calidad del golpe, trayectoria y bote, red (malla y cinta), solver de tiro, reglas, marcador, whiff, saque, determinismo y partido completo |
| Typecheck de `shared/` con `lib: ES2022` y sin tipos de DOM ni Node | Sin errores → la lógica no depende del navegador |
| `node shared/scripts/headless-match.ts` (Node 24, sin compilar) | Medio contra medio: 11-9 y 8-11, **~10 golpes por punto** de media, unos 815 ms entre golpes. Fácil contra difícil: 5-11, 1-11 y 3-11 |
| E2E 1 (`client/e2e/autoplay-rally.js`) | Rally de **51 golpes** (el anterior, 58). Δt medidos frente a los provocados: +85 → +86 ms (LATE), −35 → −31/−43 ms (GOOD). Jitter de Playwright de unos ±10 ms. Racha máxima ×4 (¡EXCELENTE!) |
| E2E 2 (`client/e2e/autoplay-errors.js`) | Game completo 1-11 con errores provocados: red por golpe pronto, borde, tarde y whiff. Aviso «Red. Golpeaste pronto: la bola sale más baja.» y pantalla de fin con estadísticas |
| Audio | Los 17 sonidos de §16 se sintetizan sin errores (0 archivos). Consola sin errores |

Capturas: `01-menu`, `02-incoming`, `03-bounce-marker` (marcador de bote y mensaje del rival),
`rally-shot-02/04/06/09/13` (¡Perfecto!, ¡Genial!, ¡Increíble!), `error-shot-*`, `point-1…4` (motivo del punto),
`04-game-over`, `05-shadow-zoom`.

Las pruebas E2E solo **leen** el estado (`window.__ppp`) para saber dónde y cuándo hacer click,
igual que un jugador mirando la sombra. El input entra por el traductor de ratón real.

---

## 2. Trazabilidad de V0.1 (§21)

| Punto de V0.1 | Estado | Dónde |
|---|---|---|
| Estructura monorepo (`client/`, `shared/`) | ✔ Implementado | `package.json` (npm workspaces), `shared/`, `client/`. `shared/` se ejecuta en Node sin build gracias a `erasableSyntaxOnly` y a importar con `.ts` |
| Mesa, red, bola | ✔ Implementado | Geometría y colisiones en `shared/src/physics.ts` y `config.ts` (`world`); visual en `client/src/render/world.ts` |
| Física básica: gravedad, drag, bote, red | ✔ Implementado | `shared/src/physics.ts`: drag cuadrático, bote con restitución 0.89, malla y **cinta** (net cord), suelo, colisión continua. Tests en `physics.test.ts` y `net.test.ts` |
| Paso fijo de 120 Hz, determinista | ✔ Implementado | `sim.ts`, `config.sim.tickHz`. Solo usa `+ − × ÷ √`. Test de determinismo bit a bit (bola y partido completo) |
| Raqueta con inercia en plano horizontal | ✔ Implementado | `shared/src/paddle.ts` (persecución tipo *arrive*, 4.2 m/s y 30 m/s²) |
| Altura automática | ✔ Implementado | Regla de juego: rango de alcance vertical en la medición (`hit.ts`, `paddle.min/maxReachHeight`). Visual: `client/src/game/game.ts` (`targetHeight`) |
| Cámara trasera fija | ✔ Implementado | `world.ts`, `config.presentation.camera`. Sin espejado: en V0.1 el humano siempre es el lado 0, aunque `InputIntent` ya va en coordenadas de jugador |
| Sombra de la bola | ✔ Implementado | `world.ts`: proyección vertical sobre la mesa o el suelo; tamaño y opacidad según la altura |
| Input de ratón → `InputIntent` | ✔ Implementado | `client/src/input/mouse.ts`. `fire` usa el timestamp del propio evento, no el del frame. `Simulation.step()` solo recibe `[InputIntent, InputIntent]` |
| Golpe por click: timing (ms) y posición (% del radio) | ✔ Implementado | `shared/src/hit.ts` (paso más cercano con precisión sub-tick, historial más predicción), `sim.ts` (`handleClick`). Tests en `hit.test.ts` |
| Calidad = la peor de las dos | ✔ Implementado | `hit.ts` (`classifyHit`, `worstTier`) |
| Efecto de cada calidad (§4.3) | ✔ Implementado | `shared/src/shot.ts` y `config.shot.timingCurve` (curva continua). Borde: desvío determinista y proporcional |
| Whiff y recuperación | ✔ Implementado | `sim.ts`, 300 ms (`hit.whiffLockoutMs`). Test anti-spam en `sim.test.ts` |
| Feedback TTYD: mensajes y sonidos de racha | ✔ Implementado | `game.ts` (`onHit`), `ui/hud.ts`, `audio/audio.ts`: Bien, ¡Perfecto!, ¡Genial!, ¡Increíble!, ¡EXCELENTE!, notas Do-Mi-Sol-Do sintetizadas, etiquetas grises (pronto, tarde, borde, fallo), destello y temblor, mensaje del rival más pequeño. Momentum fuera de alcance |
| Bot simple con 3 dificultades | ✔ Implementado | `shared/src/bot.ts` y `config.bot`: reacción, error de posición y distribución de calidades. Usa la misma física y el mismo evaluador que el humano |
| Marcador de un game a 11 | ✔ Implementado | `shared/src/rules.ts`: a 11 con diferencia de 2 y rotación del saque. Tests en `rules.test.ts` |
| Saque normal simplificado | ✔ Implementado con ajustes | `sim.ts` (lanzamiento automático a 1 s o con click, golpe con medición). Simplificación: la dirección del saque se calcula sola para botar primero en tu campo |
| Manifiesto de assets con placeholders | ✔ Implementado | `client/src/assets/manifest.ts` (descubre los archivos al compilar) y `client/scripts/gen-placeholders.mjs` (generados localmente, sin licencias de terceros) |
| Config único | ✔ Implementado | `shared/src/config.ts`: timing, gameSpeed, radios, raqueta, curvas de tiro, bot, feedback, Momentum (sin usar todavía) y presentación |
| **Criterio:** rally de 6+ golpes controlable | ◐ Parcial | Automático: rallies de 51 y 58 golpes con ratón real; el bot medio supera los 6 golpes en más del 30 % de los puntos (test). Que sea controlable **para una persona** está pendiente del playtest |
| **Criterio:** distingue PERFECT de GOOD sin números | ◐ Parcial | Texto, color y sonido distintos (oro y nota musical frente a blanco y golpe seco). Pendiente de playtest |
| **Criterio:** entiende por qué la bola fue a la red | ◐ Parcial | Etiqueta «pronto» en el golpe y causa en el aviso de fin de punto (versión mínima del «¿por qué fallé?» de V0.2). Pendiente de playtest |

**Adelantado de fases posteriores** (barato y útil para probar): marcador de bote contra el bot (§2.2); reglas de V0.4 (let, volea, doble bote, rotación del saque, bola fuera); «¿por qué fallé?» mínimo; estadísticas de fin (§14.1); panel de precisión (`D`); parámetros de playtest por URL; partido sin cabeza en Node.

**Fuera de alcance, sin implementar:** servidor y multijugador, Momentum, especiales, spin y Magnus (el estado ya lleva `spin`), tipos de golpe por gesto, bloqueo, trackpad y táctil, warm-up, Listo y cuenta atrás, bola de canto, modos al mejor de 3 o 5.

---

## 3. Desviaciones respecto al documento

### 3.1 Valores 🟡 cambiados

| Parámetro (sección) | Documento | Final | Motivo |
|---|---|---|---|
| Zona de golpe (§4.1) | Radio ≈ 1.6 × radio de la raqueta (distancia) | **|Δt| ≤ 120 ms y posición < 100 % del radio** | Con el radio del documento (7.5 cm), la zona mide 12 cm. A la velocidad medida de llegada de la bola (3.2 m/s reales con gameSpeed 0.7), la bola cruza esa zona en ±37 ms: las bandas EARLY y LATE (60–120 ms) de la tabla de §4.2 serían imposibles. Además, una zona en distancia contradice medir en ms «para que sea igual de justo con bolas lentas y rápidas». «Cerca» pasa a medirse en tiempo y en posición |
| Radio de la raqueta (§7.2) | Cara ≈ 15 cm de ancho (r = 7.5 cm) | **Radio de juego 14 cm** (`paddle.radius`; ajustable con `?radius=`) | PERFECT exige posición < 20 % del radio: con 7.5 cm serían 1.5 cm de precisión lateral con ratón, raqueta con inercia y cámara trasera. Aun con 14 cm, PERFECT pide ±2.8 cm laterales frente a ±8 cm de recorrido de la bola en la ventana de ±25 ms. La posición sigue siendo el requisito más duro |
| gameSpeed (§7.3, ❓§24-8) | 0.6–0.75 | **0.7** | Punto medio. Unos 830 ms entre golpes (ver §5.3) |
| Duración del mensaje (§5.2) | ~400 ms | 400 ms; **560 ms solo para ¡EXCELENTE!** | El nivel máximo de racha es raro y merece leerse; sigue siendo sutil |
| Saque (§9.1) | Lanzamiento a ~1 s | 1 s; contacto ideal a **30 cm sobre la mesa**, bola en mano a 15 cm, lanzamiento a 3 m/s | Con el contacto a 12 cm, un click tardío de más de ~60 ms era imposible: la bola caía por debajo de la mesa antes de la ventana de LATE |
| Drag (§7.1) | Sin valor | k = 0.12 /m (el teórico para 40 mm y 2.7 g es ≈ 0.14) | Algo menos de frenado para trayectorias legibles |
| Bot (§17.5) | Medio: 30 % PERFECT y 50 % GOOD | Medio 30/50/15/5 (PERFECT/GOOD/débil/whiff). Fácil 10/45/35/10. Difícil 45/42/10/3 | El difícil con 1 % de whiff daba rallies de más de 200 golpes entre bots |

Sin cambios: ventanas de timing ±25/60/120 ms, posición 20/50/100 %, whiff 300 ms, restitución 0.89, medidas de reglamento y paso de 120 Hz.

### 3.2 Decisiones que el documento no cubría (implementadas como propuesta)

1. **Cuándo ocurre el contacto.** Click pronto: el contacto se aplica en `t_ideal`, cuando la bola llega a la raqueta. Click tarde: se aplica en el mismo instante del click. Mientras tanto, la raqueta queda fija en la posición del click (como mucho 120 ms). La calidad se evalúa **en el click**. Así el golpe se ve coherente y el evento de red queda bien definido (§6, V0.3).
2. **Cómo se convierte la calidad en trayectoria.** La calidad elige **objetivos**: margen sobre la red y profundidad del bote, según una curva continua en Δt. Un solver determinista calcula la velocidad que los cumple con la misma física, y luego la física manda: si el margen pedido es negativo, la bola choca de verdad con la malla o la cinta. No hay azar: la «dispersión pequeña» de GOOD es un desvío proporcional al error de posición.
3. **Dirección del golpe (puntería).** El documento no dice cómo se apunta. En V0.1 se usa el 45 % de la x del punto de contacto más la componente lateral del gesto (`swing.vx`, con zona muerta). Choca con V0.2, donde el gesto lateral sería *slice* (ver propuesta P3).
4. **gameSpeed solo afecta a la bola.** La raqueta se mueve en tiempo real para que ajustar `gameSpeed` no cambie la respuesta del ratón. El documento dice que ralentiza «la simulación».
5. **Nivel «débil».** La fila «EARLY / LATE» de la tabla §4.2 también recoge la posición del 50 al 100 %, que no es ni pronto ni tarde. Internamente es `WEAK` con causas `EARLY`, `LATE` o `EDGE`, y se añade la etiqueta gris «borde».
6. **Saque no golpeado** → punto para el receptor (`TOSS_MISSED`), como en el reglamento.
7. **Golpe bajo.** Golpear la bola por debajo de 12 cm sobre la mesa reduce el margen sobre la red. Así aparece la «posición desfavorable» de §6.1: el último Δt que acaba en red pasa de −110 ms (contacto a 20 cm) a −85 ms (contacto a 5 cm).
8. **Raqueta propia translúcida y con anillos** en el radio del 20 % (PERFECT) y del 50 % (GOOD). Desde la cámara trasera, una raqueta opaca tapa la bola justo en el momento del golpe.
9. **Integrador.** Velocidad con Euler y posición con la velocidad media (trapezoidal): es exacto con gravedad constante. Con Euler semi-implícito, el error era de 1.4 cm en 0.5 s.

---

## 4. Revisión de los cambios v1 → v2 (§25)

| Cambio de §25 | Veredicto | Comentario a la luz de la implementación |
|---|---|---|
| Mapeo del ratón: plano horizontal y altura automática | **Confirmado** | Elimina la ambigüedad 2D→3D. El cursor se proyecta sobre un plano a la altura de la mesa; la profundidad lejana queda comprimida, pero es intuitivo («la raqueta va donde apunto») |
| Raqueta con inercia | **Confirmado, con duda** | Funciona y hace que colocarse cueste. Duda: con cursor visible, el retraso entre cursor y raqueta puede sentirse «pesado». Por eso se dibuja un anillo en el objetivo. Validar 4.2 m/s y 30 m/s² en playtest |
| Click cerca de la bola ✅ | **Confirmado** | Requiere definir «cerca» en tiempo (P1) y cuándo ocurre el contacto (P4) |
| Timing (ms) + posición, peor de las dos ✅ | **Confirmado, con duda** | La medición en ms es robusta (el E2E reproduce los errores introducidos con unos ±10 ms). Duda: la posición es unas 3 veces más exigente que el timing en distancia; PERFECT puede depender casi solo de la posición |
| Escala simétrica EARLY–GOOD–PERFECT–GOOD–LATE | **Confirmado** | Simétrica en la clasificación y asimétrica en la consecuencia (pronto = red, tarde = bola fácil), que es lo que pide §4.3 |
| Feedback TTYD ✅ | **Confirmado** | Implementado tal cual. Nada de hit-stop. El mensaje del rival se ve pequeño en su lado (captura `03`) |
| Whiff con ~300 ms de recuperación | **Confirmado** | El test demuestra que hacer click sin parar no sirve. Ojo: un whiff en el saque puede dejar caer la bola (es intencionado) |
| Power Hit eliminado | **Confirmado** | Sin conflicto: el click es solo el disparo |
| Un único Bloqueo (Space) | Sin evidencia | V0.2 |
| Saque normal definido | **Confirmado, con ajustes** | Hacía falta una altura de contacto mayor (ver 3.1) y definir el saque no golpeado. Falta definir cómo se dirige el saque (en V0.1 es automático) |
| Coste del saque especial 50 % | Sin evidencia | V0.5 |
| Let en el saque | **Confirmado** | Implementado y probado |
| Reglas del rally | **Confirmado** | Implementadas ya en V0.1, son baratas. Riesgo: volea accidental si la raqueta se coloca encima de la mesa (profundidad mínima 0.75 m) |
| Solo Momentum, sin cooldown | Sin evidencia | V0.5. Los valores ya están en el config |
| Antídoto contra la bola de nieve | Sin evidencia | V0.5 |
| 2 personajes ✅ (POWER + DEFENDER 🟡) | **Duda** | Los pasivos de ±5 ms en la ventana PERFECT están por debajo del ruido de entrada y de pantalla (ver §5.4) |
| Wall, Ghost Serve, rasgos mecánicos | Sin evidencia | Fases posteriores |
| Modos de match | Sin evidencia | Datos para ❓7 en §7 |
| Capa `InputIntent` | **Confirmado** | La simulación y el bot solo usan intentos. Falta precisar unidades y reloj (P8) |
| Ping de la sala ✅ | Sin evidencia | V0.3 |
| Ayudas de legibilidad | **Confirmado, con dudas** | La sombra funciona, pero su contraste sobre el azul oscuro se tuvo que reforzar. El marcador de bote ayuda mucho. Falta la oclusión de la propia raqueta (ver 3.2-8) |
| Netcode por eventos de golpe con física compartida | **Confirmado en lo técnico** | Determinismo bit a bit y `shared/` corre en Node sin cambios. Requisitos nuevos en §5.2 |
| Anti-cheat fuera ✅ | Confirmado | — |
| Placeholders con manifiesto y rutas fijas ✅ | **Confirmado** | El manifiesto descubre los archivos al compilar: reemplazar un archivo no exige tocar código y nunca se piden archivos inexistentes |
| Roadmap: bot en V0.1 y netcode en V0.3 | **Confirmado con fuerza** | El partido bot contra bot sin cabeza encontró tres fallos que un humano habría tardado en ver: saque fallido por mala estimación del solver, bot que ignoraba el bote del saque y EARLY más rápido que PERFECT |
| Errata «mejor de 9» | — | — |

**Falta en v2:**
- Cómo se apunta (dirección lateral) y su relación con los tipos de golpe (P3).
- La definición temporal de «cerca de la raqueta» (P1).
- El instante del contacto (P4).
- Qué pasa si el saque no se golpea.
- Las unidades del gesto y el reloj común del timestamp (P8).
- Una calibración de latencia (P7).
- La regla de que ningún error dé más velocidad que PERFECT (P5).
- Qué hacer con la raqueta propia que tapa la bola.

**Sobra o conviene revisar en v2:**
- El radio de zona 1.6 × radio (contradice §4.2).
- El tamaño de raqueta de reglamento como tamaño de juego.
- Los pasivos de ±5 ms (§12.3).

---

## 5. Problemas y riesgos descubiertos

### 5.1 Para V0.2 (spin, red y tipos de golpe)

1. **El solver pasa de 2 a 3 incógnitas.** Hoy la dirección lateral es exacta porque sin Magnus la trayectoria horizontal es recta. Con efecto lateral (slice) y Magnus, el solver necesita también el ángulo lateral (Newton 3×3). Hay más riesgo de que no converja con spin extremo. Mitigación: estimación inicial analítica y número fijo de iteraciones (ya es así).
2. **¿Modifica el spin los objetivos o la física?** Para que «el topspin permite pegar más fuerte manteniendo la bola baja» sea cierto, hay que resolver **con** Magnus (a igual margen y bote, más velocidad) y dejar que el error salga del timing y del gesto. Si se aplica Magnus después del solver, el topspin mandaría la bola a la red de forma arbitraria.
3. **Conflicto entre gesto y puntería.** En V0.1 el gesto lateral apunta. En V0.2 el gesto lateral sería *slice*. Hay que decidirlo antes de V0.2 (P3).
4. **Umbral de red tipo precipicio.** Con un contacto a 20 cm, todo es válido hasta −105 ms (en −105 ms toca la cinta y pasa) y a partir de −110 ms va a la red. Es predecible, pero la zona de «danger» (§6.2) es estrecha. Con spin, la curva de margen tendrá que depender de la potencia para que la red se entienda.
5. **Valores de la cinta (`netCordRestitution` 0.35 y fricción 0.35) estimados a ojo.** Con spin, el comportamiento de la cinta influirá en «entender por qué».
6. **Umbral del smash.** Con altura automática, el umbral de altura del smash (§4.5) debe ser relativo a la red (por ejemplo, contacto a más de 15 cm por encima de la cinta), no a la raqueta.
7. **Oclusión.** La raqueta propia de 28 cm tapa la bola en el último instante; con spin visible (logo y trail) esto empeora. Translucidez y anillos en V0.1; probar también reducir solo el radio visual.

### 5.2 Para V0.3 (netcode)

1. **El contacto diferido ayuda.** Un click pronto aplica el contacto hasta 120 ms después: el evento llega al rival antes de que haga falta. Un click tarde aplica el contacto en el pasado: el servidor tendrá que rebobinar, como ya prevé §17.2.
2. **Reloj común.** `fire` está en ms de un reloj de partida local (`performance.now() − epoch`). En red hace falta estimar el desfase de reloj con el ping y expresar `t_click` en tiempo de servidor. Si no, la ventana de compensación de 150 ms se gasta en desfase.
3. **El servidor necesita el mismo historial.** La evaluación usa historial más predicción. El servidor lo tiene gratis porque simula lo mismo, pero el historial debe formar parte del estado que se rebobina; hoy es un campo privado de `Simulation`.
4. **Reglas de determinismo.** Solo `+ − × ÷ √` en la física, sin `Math.sin/exp/pow`, y config idéntica en cliente y servidor (enviar un hash al entrar en la sala). Magnus usa productos vectoriales, que son seguros.
5. **Cliente del lado 1.** El render asume que el humano es el lado 0 (cámara en +z, raqueta translúcida, mensajes). `InputIntent` ya está en coordenadas de jugador y el traductor admite `side`, pero la escena necesita espejado (§2.1).
6. **Validación de alcance (§17.3).** `stepPaddle` sirve tal cual para comprobar si la raqueta pudo llegar.
7. **Tamaño del evento.** `{t_click, posición bloqueada de la raqueta, swing}` basta para reproducir el golpe; la calidad no hace falta enviarla, se recalcula.

### 5.3 Ritmo medido (bots medios, 1 game por valor)

| gameSpeed | ms entre golpes | Velocidad horizontal de llegada (real) | ±25 ms equivalen a | ±120 ms equivalen a |
|---|---|---|---|---|
| 0.60 | 967 | 2.75 m/s | ±6.9 cm | ±33 cm |
| 0.65 | 891 | 2.98 m/s | ±7.5 cm | ±36 cm |
| **0.70** | **828** | **3.21 m/s** | **±8.0 cm** | **±39 cm** |
| 0.75 | 791 | 3.39 m/s | ±8.5 cm | ±41 cm |

### 5.4 Riesgos generales

1. **Latencia de pantalla y de entrada.** El jugador reacciona a lo que ve: el render interpolado más 1–3 frames de pantalla y el retardo del monitor suman 30–60 ms. Es más que la ventana PERFECT (±25 ms), así que habrá un **sesgo sistemático a LATE**. Todos los juegos de ritmo lo resuelven con una calibración de offset (P7).
2. **Navegadores que redondean timestamps.** Firefox con `privacy.resistFingerprinting` redondea `event.timeStamp` a 16–100 ms, lo que rompe la ventana PERFECT. Conviene detectarlo y avisar.
3. **Volea accidental.** Con la raqueta muy adelantada (0.75 m de la red), un click cuando la bola aún no ha botado es volea y punto perdido. Es correcto según §10.1, pero puede frustrar. El marcador de bote lo mitiga.
4. **Dirección con el gesto.** Al perseguir la bola, el jugador ya mueve el ratón lateralmente: ese movimiento se convierte en puntería sin querer. La zona muerta de 0.35 alturas de pantalla por segundo lo reduce, pero hay que vigilarlo en playtest.
5. **Tamaño del bundle.** 589 kB (154 kB comprimido), casi todo Three.js. Aceptable; se puede dividir más adelante.
6. **Fuentes desde Google Fonts.** Sin conexión, se usan las fuentes de reserva del sistema.

---

## 6. Propuesta de cambios al documento de diseño

> No se ha modificado el documento. La columna «Aprobación» marca los cambios que tocan decisiones ✅.

| # | Sección | Cambio propuesto | Motivo | Impacto | Prioridad | Aprobación |
|---|---|---|---|---|---|---|
| P1 | §4.1 | Sustituir «zona de golpe ≈ 1.6 × radio» por: **el click cuenta si |Δt| ≤ 120 ms y la posición es < 100 % del radio**. El concepto ✅ (click cerca de la bola) no cambia | Una zona en distancia es incompatible con las bandas EARLY y LATE y con medir en ms (ver 3.1) | Bajo (ya implementado) | Alta | 🟡 libre |
| P2 | §4.1, §7.2 | Separar el **radio de juego de la raqueta** (14 cm) de la medida de reglamento (7.5 cm) | Con 7.5 cm, PERFECT exige 1.5 cm de precisión lateral | Bajo | Alta | 🟡 libre |
| P3 | §3.3, §4.5 (nuevo apartado «Dirección») | Definir la puntería: **dirección = componente lateral del gesto**, con zona muerta. En V0.2, el *slice* es el mismo gesto con velocidad por encima de un umbral (más ángulo y efecto lateral). El topspin es la componente vertical. Alternativa: dirección según la posición de la raqueta respecto a la bola | El documento no dice cómo se apunta y el gesto lateral está asignado al slice | Alto (define el control de V0.2) | Alta | **Aprobada por el autor (2026-10-01)** en la variante «el gesto solo apunta si estás colocado» (ver §8) |
| P4 | §4.2 | Añadir «**instante del contacto**»: la calidad se evalúa en el click; el contacto ocurre en `max(t_click, t_ideal)` y la raqueta queda fija entre ambos | Golpe visualmente coherente y evento de red bien definido | Medio (netcode) | Alta | 🟡 libre |
| P5 | §4.3 | Añadir: «**ningún error de timing produce más velocidad que un PERFECT**; EARLY sale más bajo **y más corto**» | Con el mismo bote, menos margen da una trayectoria más plana y más rápida: hacer click pronto quedaba premiado (medido antes de corregirlo: −90 ms a 6.5 m/s frente a PERFECT a 5.4 m/s; ahora −90 ms a 5.3 m/s y PERFECT a 5.6 m/s). Corregido y cubierto por un test | Medio | Alta | **Requiere aprobación del autor** (amplía la fila EARLY ✅) |
| P6 | §7 (nuevo), §6.1 | Documentar el modelo «**objetivos + solver + física**»: la calidad y el gesto eligen margen sobre la red y bote; el solver calcula la velocidad con la misma física; la colisión con la red es real | Hace que la red sea predecible y explicable sin azar; base para el spin en V0.2 | Medio | Media | **Requiere aprobación del autor** (interpreta «la red es física real» ✅ de §6) |
| P7 | §19, §4.2 | **Calibración de latencia**: un offset en ms por jugador (prueba de clicks a ritmo) que se suma a `t_click` antes de medir | La latencia de pantalla (30–60 ms) es mayor que la ventana PERFECT y sesga a LATE | Medio | Alta | **Requiere aprobación del autor** (toca la medición ✅ de §4.2) |
| P8 | §3.1 | Fijar unidades: `swing` en **alturas de pantalla por segundo** y `fire` en **ms del reloj de partida** (sincronizado con el servidor en V0.3) | Sin unidades, cada traductor y el servidor interpretarían distinto | Bajo | Media | 🟡 libre (es detalle de §3.1) |
| P9 | §9.1 | Contacto ideal del saque a ~30 cm sobre la mesa; **saque no golpeado = punto del receptor**; en V0.1 dirección automática (primer bote en tu campo) | Con contacto bajo, el click tardío era imposible; caso no definido | Bajo | Media | 🟡 libre |
| P10 | §7.3 | `gameSpeed` escala **solo la bola**; la raqueta y las ventanas en ms van en tiempo real | Ajustar `gameSpeed` no debe cambiar la respuesta del ratón | Bajo | Media | 🟡 libre |
| P11 | §2.2 | Añadir: **raqueta propia translúcida** con anillos de PERFECT y GOOD | La raqueta tapa la bola desde la cámara trasera; los anillos enseñan qué es «centrado» | Bajo | Media | 🟡 libre |
| P12 | §4.2, §5.1 | Renombrar la fila «EARLY / LATE» como nivel **«débil»** con causas pronto, tarde y borde, y añadir la etiqueta gris «borde» | La fila mezcla timing y posición | Bajo | Baja | 🟡 libre |
| P13 | §21 | Pasar a V0.1 lo ya implementado: let, volea, doble bote, rotación del saque, «¿por qué fallé?» mínimo y estadísticas de fin. V0.4 queda en canto, modos de match y sala | Reflejar el estado real | Bajo | Baja | 🟡 libre |
| P14 | §17.2 | Especificar el evento de golpe: `{t_click (reloj de servidor), posición bloqueada de la raqueta, swing}`; la calidad se recalcula. Aprovechar que un click pronto da hasta 120 ms de margen | Ver 5.2 | Medio | Alta (V0.3) | 🟡 libre |
| P15 | §17.2 | Reglas de **determinismo**: operaciones permitidas, config idéntica (hash) y el historial de la bola como parte del estado rebobinable | Ver 5.2-3 y 5.2-4 | Medio | Alta (V0.3) | 🟡 libre |
| P16 | §12.3 | Pasivos de POWER y DEFENDER: cambiar ±5 ms por **±20 % de la ventana** o por un efecto en la ventana de posición | 5 ms está por debajo del jitter de entrada y de pantalla: no se nota | Bajo | Media (V0.5) | 🟡 libre (personajes 🟡; la elección de 2 personajes ✅ no cambia) |
| P17 | §4.5 | Umbral del smash relativo a la red: contacto a más de ~15 cm sobre la cinta | Con altura automática no hay otra referencia | Bajo | Media (V0.2) | 🟡 libre |
| P18 | §3.2 | Profundidad mínima de la raqueta explícita (hoy 0.75 m desde la red) | Evita voleas accidentales; hasta dónde llega el brazo es una decisión de diseño | Bajo | Baja | 🟡 libre |
| P19 | §21 (criterios V0.1 y V0.2) | Hacer medibles los criterios: «en 10 min de playtest, ≥ 50 % de los puntos con 6+ golpes contra el bot medio» y «≥ 80 % de los jugadores dicen la causa de una red al preguntarles» | Hoy son subjetivos | Bajo | Baja | 🟡 libre |

### Respuestas propuestas a §24 que la implementación ha aclarado

| # | Pregunta | Respuesta propuesta | Base |
|---|---|---|---|
| 1 | ¿Profundidad elegible? | **Sí a la propuesta actual: sin control explícito.** En V0.1 la profundidad ya sale del timing (PERFECT a ~88 % de la media mesa, tarde más corta, pronto corta y baja) y funciona como consecuencia legible. En V0.2 añadir potencia y spin, sin un mando propio | Curva de `config.shot.timingCurve` y tests de §4.3 |
| 3 | ¿POWER y DEFENDER? | Sin cambio en la elección, pero los pasivos de ±5 ms no se notarían (P16) | Jitter medido de unos ±10 ms incluso con entrada sintética |
| 7 | ¿Modo por defecto? | **Estándar (al mejor de 3)**, según la propuesta | Un game de bots medios dura 3.5–4 min (220–233 s); con humanos, más errores lo acortan. Mejor de 3 ≈ 8–12 min, mejor de 5 ≈ 15–20 min. Rápido (1 game) ≈ 3–4 min, bueno para el matchmaking público |
| 8 | ¿Valor final de `gameSpeed`? | **0.7 como punto de partida del playtest**. Decidir entre 0.65 y 0.75 tras el playtest. Probar con `?speed=` | Tabla de §5.3: cada 0.05 son unos 60 ms más o menos de tiempo de reacción entre golpes |

Las preguntas 2 (timeout del warm-up), 4 (coste del saque especial), 5 (nombre del saque de SPEED) y 6 (solapamiento CONTROL/DEFENDER) **no se aclaran** con V0.1 y siguen abiertas.

---

## 8. Playtest 1 del autor (2026-10-01) y cambios

| Pregunta | Respuesta del autor | Cambio aplicado |
|---|---|---|
| Inercia de la raqueta | «Sigue al ratón con un poco de lentitud» | Raqueta más rápida: 4.2 → **6 m/s** y 30 → **60 m/s²**. Para cruzar 1.2 m sigue tardando ~0.3 s (antes 0.43 s). Ajustable con `?pspeed=` y `?paccel=` |
| PERFECT frente a GOOD sin números | Se distinguen bien | — |
| Sesgo de latencia | Leyó «+284 ms, 79 %, PERFECT 14 % de 43». Era **un solo click**, un whiff fuera de ventana, no una media | El panel `D` muestra ahora medias de los últimos 20 golpes: Δt medio sin los clicks a más de 200 ms, pronto/tarde, causa de no PERFECT y posición media. **Pendiente:** repetir la medición para decidir P7 |
| ¿Timing o posición? | «Creo que de la posición, pero me gusta que sea así, más preciso» | Se mantiene el radio de 14 cm y la ventana de posición. El panel ya lo mide (fila «Sin PERFECT por») |
| Red al golpear pronto | «Salió bien, hubo muy pocos hits a la red, no sé si esto es bueno» | Por el pilar ✅ (la red es una de las principales consecuencias de golpear mal), el margen sobre la red cruza cero hacia **−85 ms**: de −60 a −80 ms pasa baja; desde ~−85 ms, cinta o red. Bots medios: la red decide el **40–50 %** de los puntos (antes ~20 %) y los rallies siguen en 6–8.5 golpes de media. Tests nuevos: −100 ms → red; −60/0/+60/+110 → válidos; cogida baja → la red llega antes |
| Ritmo (gameSpeed) | No quedó clara la prueba; 0.7 «no se me hizo tan mal» | Se mantiene 0.7 |
| Cruzar la bola | «Apunto sin querer al perseguir la bola» | **Decisión del autor (P3):** el gesto lateral solo apunta si la raqueta estaba colocada. Se mira su velocidad máxima entre 270 y 150 ms antes del click: ≤ 0.6 m/s apunta del todo, ≥ 1.6 m/s sale recta, y en medio es proporcional (`shared/src/sim.ts`, `aimFactor`). Además, ganancia 0.22 → 0.5 m por altura de pantalla/s y zona muerta 0.35 → 0.5: un gesto seco apunta y un movimiento lento solo recoloca |
| Saque | Se entiende | — |
| Bot | Las dificultades se distinguen | — |

**Verificación de la puntería** (`client/e2e/aim-check.js`, navegador real):
- Persiguiendo la bola hasta el click: factor 0 en 3 de 3 golpes; la bola sale recta (bote ≈ 0.45 × x de contacto).
- Colocado y con un gesto seco a la derecha: factor 1 en 3 de 3; el bote se desplaza 19–26 cm a la derecha.
- El gesto rápido (25 ms) se despacha dentro de la página: Playwright no puede enviar movimientos a menos de ~10 ms de intervalo.
- Tests unitarios: `sim.test.ts` («puntería solo si estás colocado») y `net.test.ts` («golpear pronto se paga»). Total: 86/86 en verde.

**Fallo encontrado en la regresión E2E y corregido.** Si quien saca está fuera del ancho de la mesa (en la prueba, a x = −0.97 porque el cursor quedó ahí), el saque apunta en línea recta y su primer bote cae fuera de su campo: 4 de 5 saques PERFECT fueron falta. Corrección:
- En el saque simplificado, la raqueta de quien saca no pasa de ±0.70 m (`paddle.serveMaxLateral`).
- El objetivo del saque se ajusta para que el primer bote caiga dentro (`keepServeBounceOnTable`).

Tests de regresión en `shot.test.ts` y `sim.test.ts`. Tras la corrección: rallies de 11, 20 y 5 golpes sin faltas de saque.

**Nueva cuestión abierta (decisión del autor):** el gesto de cruzar todavía desplaza la raqueta. En las pruebas, la posición quedó en torno al 50 % del radio, así que **cruzar la bola suele costar el PERFECT**, y el desvío por borde va hacia el lado contrario del gesto, lo que resta parte del ángulo. Hay dos opciones:
- **(a)** Dejarlo así, como riesgo/recompensa: cruzar es un golpe agresivo, coherente con el pilar de §1.
- **(b)** Si estabas colocado, medir la posición con la raqueta de antes del gesto, para que cruzar no penalice la posición. Riesgo: una corrección rápida de última hora contaría como gesto y no como recolocación.
