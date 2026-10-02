# Análisis retroactivo de V0.2 y propuesta de cambios

> Documento de diseño analizado: v3 (`ping_pong_pvp_gameplay_design_v3.md`, 2026-10-01).
> Implementación: commits posteriores a `2d8ae72` en `master` (de `f6bc46b` en adelante). Sin etiqueta `v0.2.0`: la fase la cierra el autor.
> Este documento **no modifica** el diseño: describe lo implementado y propone cambios.
> Marcas: ✅ decidido por el autor · 🟡 propuesta base · ❓ abierto · ⚠️ cambio sobre ✅ pendiente de aprobación.

---

## 0. Resumen

- **V0.2 está implementada completa** (§21): tipos de golpe por gesto con la regla de «colocado», potencia, Magnus y bote con spin, solver de 3 incógnitas con Magnus, spin visible, bloqueo, «¿por qué fallé?» completo y bot con los golpes nuevos. Lo único pendiente es lo que exige un playtest humano (el criterio de aceptación de §21 se mide en playtest).
- **Evidencia:**
  - 164 tests en `shared/` (95 de V0.1 + 69 nuevos).
  - Partidos bot contra bot: 30 partidas Normal contra Normal con **7.44 golpes por punto** de media (mediana 6) y reparto red 39 % / no devuelta 48 % / fuera 7 %.
  - E2E en Chromium real: los cuatro golpes, el bloqueo (también invirtiendo un topspin) y los textos de «¿por qué fallé?».
  - Los 4 E2E de V0.1 pasan como regresión.
- **Hallazgos de diseño más importantes:**
  1. Con un objetivo de **margen fijo**, desde una bola alta el golpe normal sale casi tan rápido como un smash, y golpear **pronto** sale *más rápido* que PERFECT (rompe P5). Hace falta un **techo de ritmo por tipo de golpe** (§3.1-3).
  2. El smash y el bloqueo se definen mejor por **ritmo** (velocidad + bote) que por margen. Así la red sale de la geometría y el umbral del smash es nítido.
  3. **Cada error se puede nombrar:** guardando los objetivos del golpe como suma de partes con nombre, el 100 % de los puntos perdidos por error en 30 partidas (571/571) recibe una causa concreta.
  4. Bloquear **lejos de la mesa** una bola normal devuelve un globo (40–80 cm sobre la cinta). Es coherente con §8 («bola fácil»), pero no con cómo se bloquea en el ping pong real.
  5. El documento no dice **cómo se dispara el bloqueo**. Se implementa como «click con Espacio mantenido», que encaja con el evento de red de §17.2 (requiere aprobación porque toca §3.3 ✅).

---

## 1. Evidencia de verificación

| Qué | Resultado |
|---|---|
| Tests unitarios (`npm test`) | **164/164**: Magnus, bote con spin, conversiones de spin, solver con spin, gesto → tipo, regla de «colocado» (en la simulación), topspin, slice, smash y su umbral, potencia, «ningún error más rápido que PERFECT» por tipo, bloqueo (también en la simulación), «¿por qué fallé?», uso de golpes por el bot y determinismo (bola con spin bit a bit, solver con spin, partido completo) |
| Typecheck de `shared/` sin DOM ni Node, `client/` y build | Sin errores |
| `npm run sim -- medium medium 7` | 11-8; **6.79 golpes por punto**; 747 ms entre golpes. Muestra los golpes por tipo y la causa de cada punto perdido |
| `node shared/scripts/shot-stats.ts medium medium 30 7` | **7.44 golpes por punto** (mediana 6, p90 16); 757 ms entre golpes. Red 39 %, no devuelta 48 %, fuera 7 %, saque fallido 5 %. **571/571 puntos perdidos con causa nombrada**. `v0.1.0` con las mismas 30 partidas: 9.25 (mediana 7) |
| Velocidad horizontal de salida (reales, a `gameSpeed` 0.75) | Normal 5.8 m/s · Slice 6.1 · Bloqueo 6.9 (contra bolas rápidas) · **Topspin 7.6** · **Smash 10.9** |
| Otras dificultades (10 partidas) | Fácil–Fácil 3.20 golpes/punto (V0.1: 3.46); Difícil–Difícil 9.36 (V0.1: 13.2: ahora el difícil ataca); Normal–Difícil 6.22 |
| Coste del solver con spin (Node) | 0.03–0.08 ms por golpe; 800/800 golpes variados convergen |
| E2E `client/e2e/shots-check.js` (Chromium, bot Normal) | Todos PERFECT y con el contacto real igual al planificado. **Topspin** 205–283 rad/s a 6.7–8.1 m/s; **slice** con 161–274 rad/s de lateral, bota a 0.68 m del centro; **smash** con la bola 25 cm sobre la cinta, a 10.1 m/s; **bloqueo** de un topspin de 208 rad/s → sale con **−114** (backspin, trail cian); **normal**. Llegando persiguiendo, el gesto de topspin o slice da golpe normal (aimFactor 0): la regla de «colocado» funciona |
| E2E de errores (avisos reales) | «Red. Smash con la bola por debajo de la cinta (hacen falta 15 cm por encima).» · «Fuera. Slice pronto (−56 ms): te pasaste de ángulo.» · «Red. Golpeaste pronto (−100 ms): la bola sale más baja.» · «Fuera. Cruzaste golpeando pronto: te pasaste de ángulo.» · «Fallaste el golpe: click 392 ms pronto.» · «No llegaste a golpearla. Topspin del bot: tras botar sale más rápida y baja.» |
| Spin visible | En el navegador, la malla de la bola gira sobre el **eje del spin real** (coseno 1.000) a la velocidad esperada (`|ω|·gameSpeed·0.05`; medido 1.75–1.79 rad/s frente a 1.87–1.93) |
| Regresión E2E de V0.1 | `autoplay-rally`: rallies de hasta 20 golpes, Δt medidos iguales a los provocados (±10 ms). `aim-check`: colocado → cruza 29–48 cm; persiguiendo → recta. `autoplay-errors`: game 1-11 con los errores provocados. `calibration-check`: **+43 ms** y luego 12/12 PERFECT con Δt medio de +0 ms. Capturas en `docs/screenshots/v0.2/regresion/` |
| Consola del navegador | 0 errores. Un aviso conocido de V0.1: el AudioContext espera al primer gesto con `?autostart=1` |

Capturas (`docs/screenshots/v0.2/`):

| Archivo | Contenido |
|---|---|
| `01-menu.png` | Menú con las instrucciones de V0.2 y el interruptor de «¿por qué fallé?» |
| `shot-topspin-*`, `shot-slice-*`, `shot-smash-*`, `shot-normal-*` | Cada golpe con su trail (naranja, magenta, blanco) y la etiqueta del tipo |
| `shot-block-*`, `shot-block_topspin-*` | Bloqueo: globo contra bola lenta; backspin con trail cian contra topspin |
| `why-*.png` | Avisos de «¿por qué fallé?» |
| `02-game-over.png` | Golpes por tipo y bolas fuera en la pantalla final |

**Incidencia de la prueba:** en la primera pasada del E2E, un smash marcado como «bola alta» se dio con la bola a 2.6 cm sobre la cinta. Una prueba dirigida (3 smashes) dio el contacto **exactamente** a la altura predicha, y en las pasadas siguientes el contacto coincidió siempre con lo planificado. Lo atribuyo a que el script eligió el golpe con una consulta del estado anterior; el script ahora registra la altura planificada (`plannedAbove`).

---

## 2. Trazabilidad de V0.2 (§21)

| Punto de V0.2 | Estado | Dónde |
|---|---|---|
| Gesto → tipo de golpe (normal, topspin, slice, smash) | ✔ Implementado | `shared/src/gesture.ts` (`classifyGesture`: dirección dominante del gesto y umbrales en `config.shotTypes`); `shared/src/shot.ts` (`planShot`) |
| Regla de «colocado» para todos los golpes (❓11, propuesta actual) | ✔ Implementado | `shared/src/sim.ts`: el gesto entero (vx **y** vy) se multiplica por `aimFactor`; persiguiendo es 0 → golpe normal y recto. La posición se mide con la raqueta de antes del gesto en cualquier dirección (`clickPaddlePos`). Tests en `shot-types.test.ts` |
| Slice = cruce por encima de un umbral | ✔ Implementado | `gesture.ts` (`sliceThreshold` 2.5 alturas/s; el cruce satura a ~1.8); `shot.ts` (efecto lateral, más ángulo, menos margen) |
| Umbral del smash relativo a la red | ✔ Implementado | `shot.ts`: `aboveTape` = parte inferior de la bola sobre la cinta en el contacto; por debajo de 15 cm la bola baja más empinada → red (`smash.lowDepthPerM`). Tests desde 1.0, 1.6 y 2.3 m de profundidad |
| Potencia por velocidad del gesto (§4.7) | ✔ Implementado | `gesture.ts` (potencia 0..1 desde el umbral); `shot.ts`: bote más profundo, más bajo, desviaciones de timing ×(1 + 0.6·p) y tarde + potencia = larga |
| Spin: Magnus y bote con intercambio spin↔velocidad (§7.1) | ✔ Implementado | `shared/src/physics.ts` (`stepBall`: Magnus `k·(ω×v)`, decaimiento; `respond('table')`: impulso de fricción en el punto de contacto, esfera hueca); `shared/src/spin.ts` (spin del mundo ↔ topspin/lateral relativo). Tests en `spin.test.ts` |
| Solver con spin: 3 incógnitas, Magnus dentro, determinista (§7.5) | ✔ Implementado | `shot.ts` (`solveShot`: Newton 3×3 sobre velocidad horizontal, vertical y lateral, sin trigonometría; regla de Cramer; 12 iteraciones como máximo; estimación inicial con el topspin como gravedad extra y compensación de la deriva lateral). Tests en `solver-spin.test.ts` |
| Spin visible: logo/costura que rota con el spin real + trail por tipo (§2.2) | ✔ Implementado | `client/src/render/world.ts` (`ballTexture`, giro por cuaterniones sobre el eje real; clase `Trail`); `client/src/game/game.ts` (`trailStyle`); colores y escala en `config.presentation` |
| Bloqueo con Space (§8): misma medición, raqueta al 50 %, energía entrante, PERFECT invierte spin | ✔ Implementado | `client/src/input/mouse.ts` (Espacio → `InputIntent.block`); `sim.ts` (raqueta al 50 % mientras se mantiene, click con Espacio = bloqueo); `shot.ts` (`planBlock`); `config.block`. Tests en `block.test.ts` |
| «¿Por qué fallé?» completo (§2.2), desactivable | ✔ Implementado | `shared/src/why.ts` (`diagnose`: la parte decisiva del desglose de objetivos); `client/src/ui/texts.ts` (redacción con ms y cm); interruptor en el menú (`settings.ts`, `hud.ts`) y `?why=0`. Tests en `why.test.ts` |
| Bot que usa los nuevos golpes y el bloqueo, con distribución por dificultad | ✔ Implementado | `shared/src/bot.ts` (`pickShot`, `gesture`, bloqueo en el punto más alto, smash esperando la bola alta); `config.bot.difficulties.*.shots` |
| Sin Momentum: +5 % del bloqueo PERFECT solo en el config | ✔ | `config.momentum.perfectBlock` (sin uso) |
| Placeholders y sonidos | ✔ | Sonidos sintetizados `hit_topspin`, `hit_slice`, `hit_smash`, `hit_block` (`client/src/audio/audio.ts`), sustituibles por archivo con el manifiesto (`client/src/assets/manifest.ts`) |
| Valores en el config único | ✔ | `shared/src/config.ts`: secciones `spin`, `shotTypes`, `block`, `bot.difficulties.*.shots`, `presentation.spin*/trail*` |
| **Criterio:** ¿un golpe malo a la red se entiende? | ◐ Parcial | Automático: 571/571 puntos perdidos con causa nombrada; los textos dicen la causa con su número. Que **una persona** lo entienda: playtest |
| **Criterio:** los cuatro golpes se distinguen en juego (≥ 80 % del tipo del rival; ≥ 80 % de la causa propia) | ◐ Parcial | Señales: trail de color, giro de la bola, sonido por tipo y ritmo (smash ~1.9 veces y topspin ~1.3 veces la velocidad de un normal). La etiqueta del tipo se muestra solo en los golpes **propios**, para no invalidar la medida. Pendiente de playtest (checklist en §7) |

**Fuera de alcance, sin implementar** (por el enunciado): servidor y multijugador, salas, Momentum, especiales, trackpad y táctil (incluidos los modificadores W/S de §3.4), anti-cheat.

---

## 3. Desviaciones respecto a la v3

### 3.1 Implementado de forma distinta o más concreta

1. **Disparo del bloqueo.** §3.3 ✅ dice «Bloqueo: Space (mantener)» y §8 «usa la misma medición de timing y posición», pero no dice qué instante se mide. Se implementa como **click con Espacio mantenido**: el click da el instante, como en cualquier golpe. Mantener Espacio pone la raqueta al 50 %. Encaja con el evento de red de §17.2 (`{t_click, posición, swing, block}`). Alternativa descartada: usar el momento de pulsar Espacio, porque entonces «mantener» no significaría nada.
2. **Smash como objetivo de ritmo.** §7.5 ⚠️ habla de objetivos de margen y bote. Con un margen fijo, desde una bola alta el solver no tiene solución (la trayectoria con gravedad nunca pasa por debajo de la recta contacto–bote) o da velocidades absurdas. El smash pide **velocidad horizontal y bote**; el margen sale de la geometría (cuerda + flecha de la parábola). El umbral de 15 cm se aplica haciendo la bola **más empinada** (bote más corto), no bajando el margen: así la red llega de verdad y se puede resolver desde cualquier profundidad.
3. **Techo de ritmo por tipo** (concepto nuevo). Desde una bola alta, el margen de 11 cm de un golpe normal implica un tiro casi plano y muy rápido: el normal se convertía en un smash. Además, «pronto = más bajo» daba **más** velocidad que PERFECT (se midió 17 m/s en un slice pronto frente a 9.5). Cada tipo tiene una velocidad máxima: normal 9.5, slice 10, topspin 10 + 1.2·potencia (m/s de simulación, equivalente sin drag). Con error de timing, el techo baja hasta un 20 %. Desde bolas normales (≤ 0.3 m) no actúa: el 2 % de los golpes normales en los partidos de bots, con un efecto medio de menos de 1 mm.
4. **Bloqueo como objetivo de ritmo**: velocidad = factor × velocidad horizontal de llegada (PERFECT 0.85, GOOD 0.95, débil 1.0: PERFECT «reduce la velocidad recibida»), bote recto y margen geométrico. Pronto = más corto (red); tarde = más alto y lento.
5. **Spin entrante y bloqueo no PERFECT** (añadido): el topspin no absorbido levanta la bola y la alarga (puede salir larga); el backspin la hunde (red). Es una causa legible («Bloqueaste un topspin sin absorberlo: se fue largo.») y da sentido a leer el spin del rival.
6. **El spin entrante no afecta a los golpes activos** (simplificación): solo al bloqueo. Leer el spin sirve para colocarse (bote y curva) y para decidir si bloquear. Ver propuesta P36.
7. **Bote con spin, modelo de «agarre»:** el bote elimina una fracción del deslizamiento del punto de contacto (`tableGrip` 0.2). Con spin 0 reproduce exactamente el −8 % de V0.1. §7.1 dice «el topspin acelera tras el bote»: físicamente solo pasa si la superficie gira más rápido de lo que avanza la bola (R·ω > v). Con los valores del juego (160–340 rad/s; R·ω = 3.2–6.8 m/s frente a 8–10 m/s), **el topspin frena menos** que un golpe plano y el Magnus lo mantiene bajo; con topspin más fuerte sí acelera (test). Ver P25.
8. **Potencia (§4.7 ✅, detalle):** además de más velocidad, menos margen y más sensibilidad al timing, **tarde + potencia = bola larga** (`powerLateLong` 0.9). Es lo único que hace real el «más riesgo de bola fuera» ✅: la curva de timing de V0.1 acorta la bola tarde (LATE = «bola fácil» ✅), así que sin esto no habría fuera por potencia. Requiere aprobación porque añade una consecuencia al LATE ✅ (P23).
9. **Etiqueta del tipo de golpe solo en los golpes propios.** La del rival se lee en la bola (trail, giro, sonido, ritmo); si se mostrara, la medida del criterio de V0.2 («nombra el tipo del rival en ≥ 80 %») no tendría sentido.
10. **Sonido por tipo de golpe** (añadido a §16): `hit_topspin`, `hit_slice`, `hit_smash`, `hit_block`.
11. **Spin por tipo:** topspin 160–340 rad/s; slice 150–350 de lateral + 80 de backspin («corte» con curva); smash 50 de topspin; normal sin spin (como en V0.1). PERFECT controla el spin: GOOD da el 85 % y débil el 60 % (§4.3 ✅ «mejor control del spin»).
12. **Spin visible:** la bola gira sobre su eje real a una fracción de su velocidad real (`spinVisualScale` 0.05; sin escala, 45 rev/s se verían estroboscópicas). Trail: naranja = topspin, cian = backspin, magenta = lateral, blanco tenue = bola plana muy rápida (smash). Los colores se cambiaron tras la primera prueba: con mezcla aditiva sobre la mesa azul, el naranja salía blanquecino y el violeta parecía azul.

### 3.2 Valores 🟡: documento → final

**Ningún valor numérico 🟡 que ya estaba en el documento ha cambiado.** V0.2 define valores que el documento no tenía:

| Parámetro (sección) | Documento | Final | Motivo |
|---|---|---|---|
| Umbral del smash (§4.6) | «más de ~15 cm por encima de la cinta» | 15 cm, medido con la **parte inferior** de la bola | Mismo valor; se fija la referencia |
| Raqueta con Space (§8) | 50 % | 50 % (3 m/s) | — |
| Fricción del bote (§7.1) | «sin spin, −8 %» | `tableGrip` 0.2 → −8 % sin spin | Mismo resultado con el modelo de spin |
| Magnus (§7.1) | Sin valor | `magnusK` 0.0035; decaimiento 0.1/s | Orden de magnitud real (≈ 0.003–0.004) |
| Umbrales del gesto (§4.6) | Sin valor | Topspin 1.2 y smash 1.2 alturas/s (vertical dominante); slice 2.5 (lateral dominante); potencia máxima a 4 / 4 / 5 | El cruce a tope (§4.5) satura a ~1.8: el slice queda claramente por encima |
| Potencia (§4.7) | Sin valor | Bote +0.06, margen −3 cm, desviaciones de timing ×(1 + 0.6·p), tarde + potencia +0.9·p·l | Ver §3.1-8 |
| Smash | Sin valor | Ritmo 13–16 m/s (equivalente sin drag) | ~1.9 veces un normal |
| Slice | Sin valor | Hasta 8 cm de la banda (cruce: 10 cm); −2 cm de margen con potencia | «Más ángulo, poco margen» |
| Bloqueo (§8) | Sin valores | Ritmo ×0.85 / 0.95 / 1.0 (PERFECT/GOOD/débil); PERFECT invierte el 50 % del spin | «PERFECT reduce la velocidad recibida» |
| Mezcla de golpes del bot (§17.5) | Sin valores | Fácil 10 / 5 % topspin/slice, smash 35 % si bola alta; Normal 22 / 10 %, 60 %; Difícil 35 / 18 %, 85 %; bloqueo 15 / 30 / 35 % contra bolas rápidas o con spin | Ajustado con partidos sin cabeza |

**Ajustes durante la implementación** (para que el autor vea qué se movió y por qué):

| Valor | Inicial → final | Motivo (partidos de bots) |
|---|---|---|
| Spin del topspin y techo de ritmo | 250–500 rad/s, techo 12 + 2·p → **160–340**, **10 + 1.2·p** | Salía a 1.6 veces un normal y el 20 % eran ganadores directos: el bot no llegaba con 240 ms de reacción |
| Margen del slice a la banda | 4 cm → **8 cm** | Un slice GOOD descentrado o algo pronto salía demasiadas veces |
| Tarde + potencia → larga | 0.3 → **0.9** | Con 0.3 ningún golpe salía largo: no existía el «riesgo de bola fuera» de §4.7 |
| Ritmo del smash | 10–13 → **13–16** | Corrección de unidades: el normal PERFECT sale a ~7.6 m/s de simulación (5.6 reales), no a 5.6 |
| Smash malo del bot | 4 / 2 / 0 % → **3 / 0.5 / 0 %** | Se tiraba en cada devolución sin bola alta: sumaba ~2 % de errores por golpe |
| Alargamiento del bloqueo débil | 0.0004 → **0.0007** por rad/s | Bloquear un topspin no salía nunca largo: el riesgo era invisible |

### 3.3 Tests de V0.1 cambiados a propósito

| Test | Cambio | Por qué |
|---|---|---|
| `shot.test.ts` «riesgo de ángulo al cruzar» | Gesto lateral 4 → **2** alturas/s | En V0.2 un gesto de 4 ya es **slice** (umbral 2.5). El «cruce a tope» de V0.1 se consigue con 2.0 (puntería saturada: (2.0 − 0.5)·0.5 = 0.75 m > 0.66 m). Lo que comprueban los tests no cambia |
| `sim.test.ts` «cruzar no cuesta posición» | `clickPaddlePos` recibe el gesto completo `{vx, vy}` | La regla de «colocado» vale ahora para cualquier dirección del gesto |

El resto de los 95 tests de V0.1 pasa sin cambios.

---

## 4. Revisión de los cambios v2 → v3 (§25) a la luz de V0.2

| Cambio de §25 | Veredicto | Comentario |
|---|---|---|
| Leyenda con ⚠️ | **Confirmado** | Útil: V0.2 amplía P5 y P6 a los golpes nuevos y lo deja marcado (§6) |
| Pilar: precisión exigente y riesgo legible ✅ | **Confirmado con fuerza** | El desglose de objetivos en partes con nombre permite nombrar la causa del 100 % de los errores en 30 partidas. Duda: con más fuentes de riesgo (potencia, tipo, spin entrante) hay más causas posibles; los textos deben seguir siendo cortos |
| Zona de golpe en ms y % del radio | **Confirmado** | El bloqueo usa exactamente la misma medición (test) |
| Radio de juego 14 cm | **Confirmado** | Sin cambios. El gesto no cuesta posición si estabas colocado |
| Instante del contacto | **Confirmado** | Vale igual para smash y bloqueo; la raqueta queda fija en la posición de antes del gesto |
| Nivel «débil» | **Confirmado** | — |
| Efectos de la calidad: curva continua, bola baja, ⚠️ EARLY más corto (P5) | **Confirmado y ampliado** | El criterio de P5 se aplica a todos los tipos, con un test por tipo. **Detectó dos fallos reales** (slice y smash pronto más rápidos que PERFECT) que llevaron al techo de ritmo |
| Riesgo de red: cruza cero hacia −85 ms | **Confirmado con matiz** | Vale para el golpe normal. Con potencia, la sensibilidad al timing adelanta la red (un topspin a tope va a la red hacia −60/−70 ms). Es lo que pide §4.7 ✅, pero conviene escribirlo |
| Dirección: gesto lateral solo colocado ✅; riesgo en el ángulo ✅ | **Confirmado** | El cruce no cambia (`aim-check` igual que en V0.1) y el slice hereda el riesgo de ángulo. Duda: 2.5 alturas/s para el slice no está validado con un ratón real; el panel D enseña `vx` para calibrarlo |
| Tipo de golpe: «colocado» para todos, slice = cruce + umbral, smash relativo a la red | **Confirmado** | Implementado tal cual. En el E2E, llegar corriendo convierte topspin y slice en golpes normales, como se pretende. Duda: el smash suele hacerse llegando a la bola alta; si en el playtest frustra, que el smash pida solo estar «medio colocado» (P36b) |
| Calibración de latencia ✅ | **Confirmado** | Sin cambios; la regresión mide +43 ms y 12/12 PERFECT |
| `InputIntent` con unidades | **Confirmado** | `swing.vy` y `block` ya se usan; `modifiers` sigue sin uso (V0.7) |
| Raqueta 6 m/s, 60 m/s² | **Confirmado** | Con Espacio, 3 m/s |
| `gameSpeed` 0.75 ✅ | **Confirmado con duda** | Topspin a 7.6 m/s reales y smash a 10.9: el smash deja unos 0.45 s de reacción. Validar en playtest |
| ⚠️ Objetivos + solver + física (P6) | **Confirmado y ampliado** | El solver con Magnus (3 incógnitas) cumple bote ±1 cm y margen ±5 mm con topspin, backspin y lateral. Se amplía con **objetivos de ritmo** (smash, bloqueo) y **techos de ritmo** por tipo (P24) |
| Saque normal | **Sin cambios** | Sin tipo ni spin (el saque con spin es el especial de V0.5) |
| Legibilidad (§2.2) | **Confirmado con dudas** | La bola real se dibuja con 3 cm de radio: desde la cámara trasera el logo se ve poco a media mesa y **el trail lleva casi todo el peso** de la lectura. Duda de accesibilidad: el trail usa color; el eje de giro y el sonido son la información sin color |
| Panel D | **Confirmado** | Ampliado con tipo, potencia, gesto, spin de salida y último golpe del bot. Imprescindible para ajustar los umbrales del gesto en el playtest |
| Pasivos ±20 % | Sin evidencia | V0.5–V0.6 |
| Netcode por eventos de golpe (§17.2) | **Confirmado** | `{t_click, posición fija, swing (vx, vy), block}` basta para reproducir tipo, potencia y bloqueo; el spin entrante ya está en el estado compartido. Requisitos nuevos en §5.1 |
| Determinismo (§17.6) | **Confirmado** | Magnus, bote con spin y solver 3×3 (regla de Cramer) solo usan `+ − × ÷ √`. Tests bit a bit. El giro visual del cliente usa trigonometría, pero no es simulación |
| Bot como banco de pruebas | **Confirmado con fuerza** | Encontró: el smash malo del bot tirado en cada golpe, el topspin demasiado rápido, el slice demasiado arriesgado, el bloqueo bajo contra smash (punto de intercepción) y el riesgo de bloqueo largo invisible |
| Assets por manifiesto | **Confirmado** | Los sonidos nuevos entran sin tocar código |
| Roadmap: V0.2 | **Confirmado** | Todo el contenido de V0.2 está; los criterios se miden en playtest |
| Modos de match | Sin evidencia | — |

**Falta en la v3** (lo que V0.2 tuvo que decidir):
- Qué instante mide el bloqueo (P20).
- La clasificación concreta del gesto: dirección dominante, umbrales y unidades; puntería en topspin y smash diagonales (P21).
- Qué hace la potencia en concreto (P23).
- Qué spin lleva cada tipo y cuánto.
- Cómo se define la velocidad del smash y del bloqueo (P22, P26).
- El techo de ritmo (P24).
- Si el spin entrante afecta a los golpes activos (P36).
- Qué significa «mucho spin» para el Momentum (P32).
- Colores del trail y sonidos por tipo (P27, P28).

**Sobra o conviene revisar:**
- «El topspin acelera tras el bote» (§7.1): solo con un spin muy alto (P25).
- «El bloqueo devuelve con la energía de la bola entrante» sin decir **dónde** se bloquea: lejos de la mesa da globos (P26b).
- Los modificadores W/S de §3.4 (forzar topspin o slice) no dicen qué potencia tendrían (P35).

---

## 5. Problemas y riesgos descubiertos

### 5.1 Para V0.3 (netcode)

1. **El evento de golpe debe llevar el gesto completo y el bloqueo.** El tipo y la potencia se recalculan a partir de `swing` (vx, vy) × factor de «colocado». Una discrepancia en el historial de velocidades de la raqueta (ventana de 270 a 150 ms antes del click) ya no solo cambia la puntería: **cambia el tipo de golpe**, y un topspin pasaría a ser normal. Ese historial tiene que formar parte del estado rebobinable (ya anotado en V0.1, ahora con más impacto).
2. **El Espacio mantenido afecta al movimiento.** La raqueta va al 50 % mientras se mantiene, así que la validación de alcance (§17.3) necesita saber en qué intervalos estuvo mantenido: hay que transmitirlo de forma continua, no solo en el evento.
3. **El smash acorta el tiempo de reacción.** A 10.9 m/s reales la bola llega en ~0.45 s. Con 100 ms de latencia, el evento del smash llega cuando la bola va por un tercio del camino. El contacto diferido (hasta 120 ms en clicks pronto) no ayuda al receptor. Riesgo alto: probablemente hará falta predecir en el cliente del receptor a partir del evento y corregir, y medirlo en V0.3 con 100 y 150 ms.
4. **El `swing` no se puede validar.** Un cliente modificado podría enviar siempre la potencia y el gesto ideales. El anti-cheat está fuera de alcance ✅, pero lo anoto: el gesto es la entrada menos verificable.
5. **Coste del servidor:** el solver con spin cuesta 0.03–0.08 ms por golpe y converge siempre en los casos probados. No es un riesgo.
6. **Determinismo con spin:** las trayectorias con Magnus son más sensibles a pequeñas diferencias (el spin multiplica la velocidad), pero solo hay operaciones básicas y los tests son bit a bit. Mantener el hash de config (§17.6): ahora incluye 3 secciones nuevas.

### 5.2 Para V0.5 (Momentum y especiales)

1. **«Devolver un smash o una bola con mucho spin» (+5 %)** necesita una definición: proponer |spin relativo| ≥ 250 rad/s, o tipo SMASH o TOPSPIN con potencia ≥ 0.5 (P32). Los eventos ya llevan el tipo y el spin entrante.
2. **«Más velocidad de golpe»** (pasivo de POWER +10 %, Overdrive +15 %) **no es un multiplicador directo** con el modelo de objetivos (P6): la velocidad es una consecuencia del margen y del bote. Los techos de ritmo y el ritmo del smash son el lugar natural para aplicarlo (P33). Si se multiplicara la velocidad tras el solver, la bola dejaría de botar donde debe.
3. **Wall (DEFENDER):** «un bloqueo GOOD cuenta como PERFECT». En este modelo el PERFECT también frena la bola e invierte el spin: Wall sería fuerte contra topspin. Validar.
4. **Saque especial con spin (§9.2):** el solver del saque (dos fases y bote en tu campo) se ha probado sin spin. Con spin, el bote en tu campo cambia el spin y la estimación inicial no lo tiene en cuenta: hay riesgo de que no converja. Hace falta un test antes de V0.5.
5. **Ghost Serve (TRICKSTER):** el giro visual ya es independiente de la física (`spinVisualScale`), así que ocultarlo unos frames es trivial.

### 5.3 Generales y de playtest

1. **Los umbrales del gesto no están validados con un ratón real.** Se miden en alturas de pantalla por segundo, que normaliza por resolución, pero no por DPI ni por sensibilidad del ratón. Si los topspin salen sin querer o el slice cuesta, el panel D enseña `vx`/`vy` de cada golpe para ajustar `shotTypes.*Threshold`.
2. **Bloquear lejos de la mesa da globos.** Una bola normal bloqueada desde 1.8–2.5 m vuelve a 3–4 m/s reales y pasa 40–80 cm sobre la cinta. Es coherente con §8 («bola fácil»), pero en el ping pong real se bloquea junto a la mesa (P26b).
3. **Fuera es la causa menos frecuente** (7 % en Normal, 36 % en Difícil). Es consecuencia de dos decisiones ✅: pronto = red y tarde = bola fácil. El fuera solo sale del ángulo (cruce o slice pronto), del borde, de la potencia tarde y del bloqueo de topspin. Si el autor quiere más bolas largas, el mando es `powerLateLong`.
4. **La lectura del spin depende casi del todo del trail:** a media mesa la bola mide pocos píxeles. Si en el playtest no se distinguen los golpes, opciones baratas: escala visual de la bola algo mayor en vuelo rápido o un trail más largo.
5. **Archivo suelto** `client/src/game/0` (vacío, versionado desde V0.1): sobra y se puede borrar.

---

## 6. Propuesta de cambios al documento de diseño

> No se ha modificado el documento. Numeración a continuación de la de V0.1 (P1–P19). «Requiere aprobación» = toca una decisión ✅ o amplía una ⚠️.

| # | Sección | Cambio propuesto | Motivo | Impacto | Prioridad | Aprobación |
|---|---|---|---|---|---|---|
| P20 | §3.3, §8 | **Bloqueo = click con Espacio mantenido.** Mantener Espacio pone la raqueta al 50 %; el click da el instante (misma medición que un golpe) | El documento no dice qué instante mide el bloqueo; así encaja con el evento de §17.2 (`block`) | Medio (control) | Alta | **Requiere aprobación del autor** (amplía la fila ✅ de §3.3) |
| P21 | §4.6 | Escribir la clasificación: gesto escalado por «colocado»; **dirección dominante**: lateral → slice si ≥ 2.5 alturas/s (por debajo, cruce); vertical → topspin si sube ≥ 1.2, smash si baja ≥ 1.2. La componente lateral apunta también en topspin y smash. Potencia de 0 a 1 entre el umbral y 4 / 4 / 5 | Sin esto cada implementación clasificaría distinto (y el servidor debe recalcularlo igual) | Medio | Alta | 🟡 libre |
| P22 | §4.6 | **Smash = objetivo de ritmo** (velocidad + bote): el margen sale de la geometría. Umbral: parte inferior de la bola ≥ 15 cm sobre la cinta; por debajo, la bola baja más empinada y va a la red. Pronto = más corto; tarde = más alto y lento | Con margen fijo, desde una bola alta no hay solución o sale a velocidad absurda; el umbral queda nítido desde cualquier profundidad | Medio | Alta | 🟡 libre (la fila ✅ «recompensa, no botón de ganar» se mantiene) |
| P23 | §4.7, §4.3 | Concretar la potencia: bote más profundo y más bajo, desviaciones de timing ×(1 + 0.6·p) y **tarde + potencia = bola larga** | §4.7 ✅ pide «más riesgo de red o de bola fuera»; sin la última regla no hay fuera por potencia, porque el LATE ✅ acorta la bola | Medio | Alta | **Requiere aprobación del autor** (añade una consecuencia al LATE ✅ de §4.3) |
| P24 | §7.5, §4.3 | **Techo de ritmo por tipo** (normal 9.5, slice 10, topspin 10 + 1.2·p m/s de simulación; −20 % con error de timing). El margen pedido nunca da un tiro más rápido que el techo | Desde una bola alta el normal sería un smash, y «pronto» sería más rápido que PERFECT (rompía P5) | Medio | Alta | **Requiere aprobación del autor** (amplía P6 ⚠️) |
| P25 | §7.1 | Reescribir el bote: «el bote elimina parte del deslizamiento del punto de contacto: el topspin **frena menos** (y acelera si gira más rápido de lo que avanza), el backspin frena más; sin spin, −8 %» | La frase actual solo se cumple con spin muy alto | Bajo | Media | 🟡 libre |
| P26 | §8 | Detallar el bloqueo: ritmo = 0.85 / 0.95 / 1.0 × la velocidad de llegada (PERFECT / GOOD / débil); bola recta; PERFECT invierte el 50 % del spin; **sin PERFECT, el topspin entrante la alarga y el backspin la hunde**; pronto = corto (red), tarde = alto | Define «la energía de la bola entrante» y da al bloqueo un riesgo legible ligado a leer el spin | Medio | Alta | 🟡 libre (§8 es 🟡) |
| P26b | §8 | Proponer para el playtest: con Espacio, que la raqueta **se acerque a la mesa** (profundidad objetivo como máximo ~1.2 m), como un bloqueo real | Lejos de la mesa, bloquear una bola normal da un globo (40–80 cm sobre la cinta) | Medio | Media (tras el playtest) | 🟡 libre |
| P27 | §2.2 | Detallar el spin visible: giro sobre el eje real a una fracción fija de la velocidad real; trail **naranja** = topspin, **cian** = backspin, **magenta** = lateral, **blanco** = plana y muy rápida; la etiqueta del tipo solo en los golpes propios | Colores probados sobre la mesa azul; etiquetar el golpe del rival invalidaría el criterio de V0.2 | Bajo | Media | 🟡 libre |
| P28 | §16 | Añadir `hit_topspin`, `hit_slice`, `hit_smash`, `hit_block` | Distinguir los golpes también de oído (criterio de V0.2) | Bajo | Baja | 🟡 libre |
| P29 | §2.2 | «¿Por qué fallé?»: la causa es la **parte decisiva** del objetivo del golpe (sin ella habría entrado); lista de causas (pronto, bola baja, topspin desde bola baja, potencia, margen del slice o del cruce, smash bajo, smash o bloqueo pronto, backspin bloqueado, bola rápida bloqueada baja, ángulo, borde, potencia tarde, topspin bloqueado; fallo al aire pronto, tarde, fuera de la raqueta o de alcance) con su número (ms, cm) | Hace medible «cada error con una causa que se pueda nombrar» | Bajo | Media | 🟡 libre |
| P30 | §17.5 | Añadir a la tabla del bot la mezcla de golpes por dificultad (§3.2) y que el bot bloquee en el punto más alto y espere la bola alta para el smash | Valores ajustados con partidos sin cabeza | Bajo | Baja | 🟡 libre |
| P31 | §17.2, §17.3 | El evento lleva `swing (vx, vy)` y `block`. El historial de velocidades de la raqueta **y** los intervalos con Espacio mantenido forman parte del estado rebobinable y de la validación | Ver §5.1-1 y §5.1-2 | Medio | Alta (V0.3) | 🟡 libre |
| P32 | §11.1 | «Mucho spin» = \|spin relativo\| ≥ 250 rad/s; «smash» = tipo SMASH (sale del evento) | Las fuentes de Momentum deben ser calculables | Bajo | Media (V0.5) | 🟡 libre |
| P33 | §12.3 | Los bonos de «velocidad de golpe» (POWER +10 %, Overdrive +15 %) se aplican a los **techos de ritmo y al ritmo del smash**, no multiplicando la velocidad | Con objetivos + solver, multiplicar la velocidad movería el bote | Medio | Media (V0.5) | 🟡 libre (personajes 🟡) |
| P34 | §21 | Criterios medibles de V0.2 también sin cabeza: «≥ 95 % de los puntos perdidos por error con causa nombrada» y «Normal contra Normal ≥ 6 golpes por punto (30 partidas)» como regresión | Hoy dan 100 % y 7.44 | Bajo | Baja | 🟡 libre |
| P35 | §3.4 | Modificadores W/S (trackpad): forzar el tipo con potencia fija 0.5 y la misma regla de «colocado» | El documento no dice qué potencia darían | Bajo | Baja (V0.7) | 🟡 libre |
| P36 | §4.6 | Dejar explícito que **el spin entrante solo afecta al bloqueo**; decidir tras el playtest si un golpe activo contra mucho spin debe tener riesgo propio (p. ej. el backspin baja el margen de un golpe normal) | Leer el spin hoy sirve para colocarse y decidir si bloquear; si no basta, la lectura del rival pierde peso | Medio | Media (tras el playtest) | 🟡 libre |
| P36b | §4.6 | Si en el playtest frustra que el smash exija estar colocado, que pida solo «medio colocado» (factor ≥ 0.5) | Los smashes reales se hacen llegando a la bola alta | Bajo | Baja (tras el playtest) | 🟡 libre (es la ❓11) |

### Respuestas propuestas a §24 que la implementación ha aclarado

| # | Pregunta | Respuesta propuesta | Base |
|---|---|---|---|
| 1 | ¿Profundidad elegible? | **Sí a la propuesta: sin control explícito.** En V0.2 la profundidad sale del timing, de la potencia (+6 % de media mesa a tope, y larga si además es tarde) y del tipo (smash 0.9; bloqueo 0.72). La potencia ya es un control de profundidad de hecho, ligado al riesgo; no hace falta un mando aparte | `config.shotTypes`, tests de potencia |
| 9 | ⚠️ P5: ¿EARLY más corto, para que ningún error dé más velocidad que PERFECT? | **Aprobar.** En V0.2 el criterio se aplicó a los cuatro golpes con un test por tipo y **encontró dos fallos reales** (slice y smash pronto salían más rápidos que PERFECT). Sin P5, golpear pronto sería una ventaja en los golpes nuevos | `shot-types.test.ts` («ningún error de timing da más velocidad que un PERFECT…») |
| 10 | ⚠️ P6: ¿modelo «objetivos + solver + física»? | **Aprobar, con la ampliación de P22 y P24.** Con Magnus dentro, el solver de 3 incógnitas cumple bote ±1 cm y margen ±5 mm con cualquier spin, y la red sigue siendo física real. Además hace posible «¿por qué fallé?»: como cada objetivo es una suma de partes, el 100 % de los errores tiene causa. Con un ángulo de raqueta simulado no habría cómo nombrarla | `solver-spin.test.ts`, `why.test.ts`, 571/571 en partidos de bots |
| 11 | ¿«Colocado» para todos los golpes? | **Sí, mantenerlo** (implementado así). Persiguiendo, cualquier gesto da un golpe normal y recto; el E2E lo confirma. Añade una lectura del rival (llega corriendo → no puede atacar). Único matiz para el playtest: el smash (P36b) | E2E: topspin y slice persiguiendo → normal con aimFactor 0 |
| 12 | ¿Calibración obligatoria? | Sin novedades en V0.2: sigue la propuesta (sugerida, no obligatoria) | — |

Las preguntas 2 (timeout del warm-up), 3 (personajes), 4 (coste del saque especial), 5 (nombre del saque de SPEED), 6 (CONTROL/DEFENDER) y 7 (modo por defecto) **no se aclaran** con V0.2.

---

## 7. Checklist de playtest de V0.2

Arrancar con `npm run dev` (ver README). En todos los puntos sirve el panel `D`: muestra el tipo de golpe, la potencia, el gesto medido (`vx`/`vy` en alturas de pantalla por segundo), el spin de salida y el último golpe del bot.

1. **Topspin** — `http://localhost:5173/?bot=easy&debug=1`. Colócate donde va a botar la bola y quédate quieto un momento. Al hacer click, mueve el ratón seco **hacia arriba**.
   - Mirar: etiqueta «TOPSPIN» bajo el mensaje, trail **naranja**, panel D «Tipo: Topspin · potencia X %» y `vy ≥ 1.2`.
   - ¿Se nota más rápido que un normal y que cae antes? ¿Te salen topspin sin querer al recolocarte en profundidad? Mira `vy` en esos golpes.
2. **Slice y cruce** — misma URL. Gesto lateral moderado (cruce) y luego uno muy rápido (slice).
   - Mirar: el cruce no lleva etiqueta; el slice lleva «SLICE», trail **magenta**, la bola curva hacia el lado del gesto y bota cerca de la banda; `vx` en el panel (umbral 2.5).
   - Golpea un slice algo pronto: «Fuera. Slice pronto (−XX ms): te pasaste de ángulo.»
3. **Smash** — `http://localhost:5173/?bot=easy&debug=1`. Espera una bola que bote alta (la sombra lejos de la bola). Colócate donde está más alta y haz un gesto seco **hacia abajo**.
   - Mirar: «SMASH», trail blanco, bola muy rápida.
   - Prueba también con una bola baja: «Red. Smash con la bola baja: X cm sobre la cinta (hacen falta 15).»
4. **Regla de «colocado»** — misma URL. Llega corriendo a la bola y haz cualquier gesto.
   - Mirar: panel D «Puntería: recta (persiguiendo)» y «Tipo: Normal».
   - ¿Se entiende? ¿Frustra sobre todo en el smash?
5. **Bloqueo contra topspin** — `http://localhost:5173/?bot=hard&debug=1` (el bot difícil hace más topspin y smash). Cuando llegue una bola con trail naranja, **mantén Espacio** y haz click a tiempo.
   - Mirar: la raqueta va más lenta mientras mantienes, etiqueta «BLOQUEO», y con PERFECT la bola vuelve con trail **cian** (panel D: «Spin de salida top −…»).
6. **Bloqueo: riesgos** — misma URL.
   - Bloquea un topspin descentrado o tarde: «Fuera. Bloqueaste un topspin sin absorberlo: se fue largo.»
   - Bloquea una bola normal lejos de la mesa: ¿el globo que sale te parece bien o preferirías que el bloqueo te acercara a la mesa (P26b)?
7. **Potencia** — `http://localhost:5173/?bot=medium&debug=1`. Haz topspins con gesto suave y con gesto muy rápido (panel D: potencia).
   - ¿Se nota la diferencia de velocidad? ¿El riesgo (a tope, pronto → red antes; tarde → larga) se siente justo?
8. **Leer al rival** (criterio de V0.2) — `http://localhost:5173/?bot=medium` (sin panel). Durante 2–3 minutos, di en voz alta el golpe del bot antes de que bote: normal, topspin, slice, smash o bloqueo.
   - Comprueba después con `D` («Bot: último golpe»). ¿Aciertas ≥ 8 de cada 10? ¿Qué te ayuda más: el color del trail, el giro de la bola, el sonido o la velocidad?
9. **«¿Por qué fallé?»** — `http://localhost:5173/?bot=medium`. Juega un game. Tras cada punto perdido, ¿la frase coincide con lo que crees que pasó?
   - Prueba a desactivarlo en el menú («Explicar mis errores: no») y vuelve a activarlo.
10. **Ritmo con los golpes nuevos** — `http://localhost:5173/?bot=hard`. ¿Te da tiempo a reaccionar al smash y al topspin del bot a `gameSpeed` 0.75? Si no, prueba `http://localhost:5173/?bot=hard&speed=0.7` y compara.
