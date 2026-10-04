# Análisis retroactivo de V0.2 y propuesta de cambios

> Documento de diseño analizado: v3 (`ping_pong_pvp_gameplay_design_v3.md`, 2026-10-01).
> Implementación: commits posteriores a `2d8ae72` en `master` (de `f6bc46b` en adelante). Sin etiqueta `v0.2.0`: la fase la cierra el autor.
> Este documento **no modifica** el diseño: describe lo implementado y propone cambios.
> Marcas: ✅ decidido por el autor · 🟡 propuesta base · ❓ abierto · ⚠️ cambio sobre ✅ pendiente de aprobación.
> **V0.2b** (golpes con teclas y PERFECT premiado, 2026-10-02): ver el apartado final [«V0.2b»](#v02b--golpes-con-teclas-y-perfect-premiado-2026-10-02).

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

---

## V0.2b — Golpes con teclas y PERFECT premiado (2026-10-02)

> Implementación: commits desde `4523bd9` en `master` (después de `b76d8fd`). Sin etiqueta.
> Este apartado **no modifica** el documento de diseño: registra las decisiones del autor y propone los cambios (P37–P47).

### B.0 Resumen

- **Por qué.** En el playtest de V0.2 (2026-10-02) el autor no consiguió ningún topspin, slice ni smash con gestos del ratón. El gesto tenía que cumplir tres cosas a la vez, además de acertar el timing:
  - hacerse en los 150 ms anteriores al click;
  - ser rápido (≥ 1.2 alturas de pantalla/s; el slice, ≥ 2.5);
  - empezar con la raqueta quieta entre 270 y 150 ms antes del click.

  El E2E de V0.2 pasaba porque despachaba gestos sintéticos perfectos: probaba el código, no que una persona pudiera hacerlo.
- **Qué cambia.**
  - El tipo de golpe se elige con **teclas mantenidas en el instante del click**: Q slice, W topspin, E smash (al principio S era el slice; el autor lo cambió a Q el 2026-10-03, B.10); sin tecla, golpe normal; Espacio, bloqueo.
  - La **potencia sale de la calidad**: PERFECT = golpe completo, GOOD = reducido, débil = flojo y más arriesgado.
  - Llegar persiguiendo la bola ya no anula el tipo: **reduce la potencia a la mitad**.
  - El cruce sigue siendo el gesto lateral de V0.1.
  - Feedback nuevo:
    - barra de teclas (Tab);
    - el contorno de la raqueta toma el color del golpe mientras mantienes la tecla (al principio eran chispas alrededor; B.10);
    - ráfaga de chispas al golpear, según la calidad;
    - un texto que dice qué salió, con qué fuerza y por qué salió distinto de lo pedido.
- **Evidencia.**
  - 179 tests en `shared/`: los 164 de antes, salvo 20 que se sustituyeron porque comprobaban el gesto (B.6), más 35 nuevos.
  - Bots Normal contra Normal: **6.2–6.5 golpes por punto** (30 partidas con 3 semillas), **100 %** de los puntos perdidos con causa nombrada (533/533).
  - **Ningún golpe domina**: un bot que siempre da topspin gana el 50.8 % de los puntos contra uno que mezcla (antes del ajuste, el 60.5 % de los games).
  - E2E con **teclado y clicks reales** y ±30 ms de error de timing: **30 de 30** golpes salieron del tipo pedido.
  - Los 4 E2E de V0.1 pasan.
- **Lo más importante para el autor.**
  1. Para el golpe **completo** hace falta PERFECT y llegar colocado. En las tres pasadas del E2E, 1 o 2 de cada 30 golpes salieron «reducido · persiguiendo» porque la raqueta llegó en los últimos 270 ms. El texto lo dice, pero en el playtest hay que ver si se entiende o frustra (B.7).
  2. El **slice** es ahora un golpe con objetivo fijo: va a la banda (62 cm del centro). Contra los bots es el golpe más flojo (42 % de los puntos jugando solo slice), porque el bot lee la curva perfectamente. Contra una persona puede ser distinto.

### B.1 Decisiones del autor (registradas)

Cambian §3.3 ✅ y §4.6–§4.7. Se aplican como decisiones del autor; las propuestas para integrarlas en el documento están en B.8.

| # | Decisión (2026-10-02) | Cómo se ha implementado |
|---|---|---|
| 1 | Tipo de golpe con **teclas mantenidas en el click**: W topspin, S slice, E smash (el 2026-10-03 el autor cambió S por Q, B.10); sin tecla, normal; Espacio, bloqueo; el ratón solo mueve y hace click | `InputIntent.modifiers = { topspin, slice, smash }` (§3.1). Las teclas se **fotografían en el propio evento del click**: una tecla pulsada 5 ms después ya no cuenta. Con varias a la vez, prioridad fija smash > topspin > slice (`shotFromKeys`, `shared/src/stroke.ts`). Espacio + tecla = bloqueo |
| 2 | **Se premia el PERFECT**: la potencia y el spin salen de la calidad, no del gesto; ningún error de timing más rápido que un PERFECT | `strokePower`: PERFECT 1, GOOD 0.5, débil 0.15 (B.3). El spin del topspin y del slice y el ritmo del smash salen de esa potencia. Test por tipo: «ningún error de timing sale más rápido que un PERFECT» |
| 3 | Se mantienen los riesgos legibles | Smash con la bola baja → red. Topspin desde una bola muy baja → red. Slice pronto → fuera por la banda (se rediseñó tras el E2E, B.2). Topspin fuerte y tarde → larga. Los cuatro tienen test y su texto de «¿por qué fallé?» |
| 4 | «Colocado» ya no decide el tipo; persiguiendo, la potencia a la mitad | `potencia = calidad × (0.5 + 0.5 · factor de colocado)`. El cruce sigue necesitando estar colocado (§4.5 ✅) |
| 5 | Cruce: se mantiene el gesto lateral de V0.1 | **Preguntado al empezar (2026-10-02):** el autor eligió mantener el gesto. No hay A/D; el panel de precisión sigue en `D` |
| 6 | Curva del slice: hacia el lado al que cruzas; sin cruce, hacia fuera desde el lado donde golpeas | `sliceDirection` (`shot.ts`). Tests de los dos casos |
| 7 | Sin golpe dominante, comprobado con bots | `shared/scripts/mix-vs.ts`. Se reequilibró el topspin (B.4) |
| 8 | Teclas visibles y feedback del golpe | Barra de teclas, chispas de la tecla mantenida (solo el jugador local), ráfaga por calidad (también la ve el rival), texto del resultado y por qué, accesibilidad (B.2) |

### B.2 Qué cambió y por qué

**`shared/` (lógica, sin DOM, determinista)**

- `gesture.ts` pasa a ser `stroke.ts`:
  - `shotFromKeys` (teclas → tipo);
  - `strokePower` (calidad × colocado → potencia);
  - `powerLevel` (completo / reducido / flojo);
  - `describeStroke` (qué salió y por qué: `CHASING`, `SMASH_LOW`).
  
  Desaparecen `classifyGesture`, los umbrales del gesto y la potencia por velocidad.
- `planShot` recibe `{ swing, type, aimFactor }`:
  - el tipo viene de las teclas;
  - del gesto solo cuenta `vx` (el cruce).
  
  El riesgo de los golpes de ataque **ya no depende de la potencia**. Cada tipo tiene su sensibilidad al timing (topspin 0.8, smash 0.6). Así un golpe de ataque débil es flojo **y** más arriesgado que un golpe normal con el mismo error, como pidió el autor.
- **Slice**:
  - va a un punto fijo cerca de la banda (62 cm del centro, hacia el lado de su curva);
  - su margen sobre la red es tan sensible al timing como el de un golpe normal;
  - su riesgo es el **ángulo**: pronto se abre ×(1 + 0.9·e).
  
  Primera versión: el ángulo se sumaba al cruce y la sensibilidad era la del topspin. **El E2E con entrada humana mostró que un slice pronto iba a la red, no fuera por la banda.** El test unitario solo comprobaba el punto de bote pedido, no que la bola pasara la red. Ahora el test exige que la bola pase la red y bote fuera. Desde el centro sale por la banda a partir de unos −50 ms; cruzado, de −45 ms; desde un lado hacia fuera, de −60 ms. La red solo llega antes, hacia −72 ms.
- **Topspin**: «golpe fuerte y tarde → larga» es ahora un riesgo del topspin (`lateLong` 0.5), no de la potencia, porque un golpe tarde nunca es completo. Un GOOD algo tarde (+45 ms) entra; uno claramente tarde (≳ +75 ms) se va largo.
- Simulación:
  - el click lee `intent.modifiers`;
  - el evento `swing` lleva `keys` y la potencia;
  - la posición del golpe se mide con la raqueta de antes del gesto solo si el gesto **lateral** es seco, como en V0.1: un movimiento vertical vuelve a ser solo recolocación.
- **Bot**: pide su golpe con las mismas teclas (`modifiers`) que mantiene hasta el click, y cruza con el gesto lateral. Su potencia sale de la calidad que saca: desaparecen sus rangos de potencia propios.

**`client/` (solo traduce teclas y presenta)**

- **Traductor**:
  - Q/W/E por código físico;
  - teclas fotografiadas en el evento del click;
  - recuerda una tecla soltada justo antes del click o pulsada justo después (200 ms), para explicarlo.
- **Barra de teclas** (abajo a la izquierda, fuera de la mesa): `Q Slice · W Topspin · E Smash · Espacio Bloqueo`.
  - Visible por defecto.
  - **Tab** la muestra u oculta sin mover el foco, y la preferencia se guarda en el navegador (`ppp.keyBar`).
  - La tecla mantenida se ilumina con el color del golpe; la letra y el nombre siguen ahí (§19).
- **Tecla mantenida**: solo el **contorno** de **tu** raqueta se ilumina con el color del golpe (naranja topspin, magenta slice, blanco smash, cian bloqueo): una franja transparente pegada al borde, por fuera. La del rival no se ilumina nunca.
- **Chispas** (`world.ts`, colores del trail; el normal, dorado):
  - al golpear, una ráfaga de 0.3 s se abre hacia fuera en el plano de la cara: 22 en PERFECT, 10 en GOOD, 4 grises en débil y ninguna en el fallo;
  - mezcla normal, no aditiva: con mezcla aditiva el magenta salía azulado sobre la mesa, lo mismo que pasó con el trail en V0.2.
- **Texto junto a la raqueta**: «¡Perfecto! · TOPSPIN completo», «Bien · SLICE reducido · persiguiendo», «¡Perfecto! · SMASH completo · bola baja para el smash», «Bien · NORMAL · pulsaste W después del click», «soltaste W antes del click». Si la tecla llega después de que aparezca el mensaje, el mensaje se completa.
- **Reducir destellos (§19)**:
  - `?reduce=1`, o la preferencia «reducir movimiento» del sistema;
  - sin ráfagas ni temblor, y las chispas de la tecla quietas;
  - `?reduce=0` ignora la preferencia del sistema.
- **Panel D**: «Teclas en el click», «Tipo · potencia % (completo/reducido/flojo)» y «Gesto lateral (cruce)».
- Menú: instrucciones de V0.2b.

### B.3 Valores elegidos (🟡)

| Parámetro (`shared/src/config.ts`) | Valor | Por qué |
|---|---|---|
| Potencia por calidad `shotTypes.powerByTier` | PERFECT 1 · GOOD 0.5 · débil 0.15 | El PERFECT es la única forma de sacar el golpe completo. GOOD a la mitad se entiende sin números («reducido»). El débil casi no aporta, pero conserva el riesgo del golpe. Con GOOD 0.4 el equilibrio entre golpes era el mismo (B.4); se deja la mitad |
| Persiguiendo `chasingPower` | ×0.5 (factor de colocado 0) | Decisión del autor 4. Proporcional entre 0 y 1 |
| Etiquetas `powerLevels` | completo ≥ 0.95 · reducido ≥ 0.3 · flojo | PERFECT colocado = completo; GOOD, o PERFECT persiguiendo = reducido; débil, o GOOD persiguiendo = flojo |
| Prioridad con varias teclas | smash > topspin > slice | El smash es el golpe más situacional: si está pulsado, es a propósito |
| Ventana del aviso de tecla | 200 ms antes o después del click | Lo que tarda una persona en coordinar tecla y click; más allá ya no es «a destiempo» |
| Sensibilidad al timing | topspin 0.8 · smash 0.6 · slice 0 · normal 0 | El topspin era el golpe dominante con 0.6 (B.4). El riesgo del slice es el ángulo |
| Topspin | spin 100–340 rad/s · techo de ritmo 10 + 1.2·p · tarde → larga 0.5 | Débil: ~136 rad/s, poco más que un normal («flojo»). Completo: 340, como el máximo de V0.2 |
| Slice | objetivo a 0.62 m del centro · se abre pronto 0.9 · lateral 100–350 rad/s · backspin 80 | «Más ángulo» desde cualquier sitio; riesgo «pronto → fuera» legible entre −50 y −72 ms |
| Smash | ritmo 10.5 + 4.5·p (débil ~11.2, GOOD ~12.8, completo 15 m/s de simulación) | El completo, ~2 veces un normal. En V0.2 iba de 13 a 16 por la velocidad del gesto; ahora un smash débil es más lento de verdad |
| Señales `presentation.sparks` | tecla mantenida: una franja de 2.5 cm por fuera del borde (opacidad 0.35) · ráfaga: 22 / 10 / 4 chispas, 300 ms | Se ven al mirar la raqueta sin tapar la bola. Medido en capturas a 1280×720 |

**Desaparecen**:
- los umbrales y la potencia del gesto (`topspinThreshold`, `sliceThreshold`, `smashThreshold`, `…FullPower`);
- `spinByTier`, sustituido por la potencia por calidad;
- `powerTimingGain` y `powerLateLong`, sustituidos por la sensibilidad por tipo y `topspin.lateLong`;
- los rangos de potencia del bot (`bot.difficulties.*.shots.power`).

**Ajustes durante la implementación** (partidos de bots y E2E):

| Valor | Inicial → final | Motivo |
|---|---|---|
| Sensibilidad al timing del topspin | 0.6 → **0.8** | Un bot que siempre daba topspin ganaba el 60.5 % de los games (52.4 % de los puntos) |
| Slice: ángulo | cruce + 0.55 m → **objetivo fijo a 0.62 m** | Con el cruce sumado, el objetivo quedaba pegado a la línea: un GOOD a −40 ms ya salía (falló el 17 % de los slices) |
| Slice: riesgo de timing | sensibilidad 0.6 → 0.3 → **0 + apertura 0.9** | El E2E mostró que el slice pronto iba a la red, no fuera por la banda |
| Potencia del GOOD | 0.5 → 0.4 → **0.5** | Cambiarla no movía el equilibrio entre golpes |
| Chispas | 0.032 m y tenues → **0.075 m** | En la primera captura apenas se veían |

### B.4 Sin golpe dominante (decisión del autor 7)

`node shared/scripts/mix-vs.ts <dificultad> 200 1 <golpe>`: un bot que siempre pide el mismo golpe juega contra uno de la **misma calidad** que usa la mezcla de su dificultad. Alterna lados y saque. Criterio de «gana con claridad»: **≥ 55 % de los puntos o ≥ 60 % de los games** en 200 games.

| Normal contra Normal (200 games) | Puntos del bot de un solo golpe | Games |
|---|---|---|
| Solo topspin, **antes** del ajuste (sensibilidad 0.6) | 52.4 % | **60.5 %** → domina |
| **Solo topspin, final** | **50.8 %** | **53.0 %** |
| Solo normal | 50.7 % | 50.5 % |
| Solo slice | 42.2 % | 24.0 % |
| Solo smash (también con la bola baja) | 11.1 % | 0 % |

- En Fácil, solo topspin gana el 48.1 % de los puntos; en Difícil, el 38.0 % (la mezcla difícil hace smash y bloquea mucho).
- **Por qué se reequilibró con riesgo y no con recompensa.** Bajar la potencia del GOOD (0.5 → 0.4) apenas cambió nada (de 52.4 % a 51.8 % de los puntos), porque la ventaja del topspin no venía de los GOOD. Subir su sensibilidad al timing la quitó sin tocar el topspin PERFECT, que sigue siendo el golpe más fuerte. Esto premia la precisión, que es lo que le gusta al autor.
- **El slice es el golpe más débil contra bots.** Falla el 12 % de las veces y apenas hace ganadores (5 %), como un golpe normal. El bot lee la curva y el ángulo sin error y llega siempre. Contra una persona, el ángulo a la banda y la curva deberían pesar más: es una pregunta para el playtest.

### B.5 Evidencia de verificación

| Qué | Resultado |
|---|---|
| Tests (`npm test`) | **179/179**. Nuevos en `keys.test.ts` (35): teclas → tipo y prioridad; tecla soltada antes del click = normal; el gesto vertical ya no elige; Espacio + tecla = bloqueo; potencia PERFECT > GOOD > débil en velocidad (por tipo) y en spin; un golpe de ataque débil arriesga más que uno normal; ningún error de timing más rápido que PERFECT (4 tipos); persiguiendo = mitad de potencia (también en la simulación); smash bajo → red; topspin bajo → red; slice pronto → fuera (la bola pasa la red y bota fuera); topspin tarde → largo; dirección de la curva del slice; determinismo bit a bit con teclas |
| Typecheck de `shared/` y `client/`, build | Sin errores |
| `shot-stats` Normal contra Normal (30 partidas, semillas 7 / 1 / 99) | **6.19 / 6.49 / 6.53 golpes por punto** (mediana 4–5). Red 34 %, no devuelta 46 %, fuera 11 %, bota en tu campo 4 %, saque fallido 5 %. **533/533** puntos perdidos con causa nombrada |
| Velocidad de salida (m/s reales, `gameSpeed` 0.75) | Normal 5.8 · Slice 6.1 · Bloqueo 6.7 · **Topspin 7.9** · **Smash 10.0** (V0.2: 5.8 / 6.1 / 6.9 / 7.6 / 10.9) |
| Otras dificultades (20 partidas) | Fácil–Fácil 3.23 golpes/punto (V0.2: 3.20) · Difícil–Difícil 9.62 (V0.2: 9.36) · Normal–Difícil 6.47 |
| **E2E con entrada humana** `client/e2e/keys-check.js` (Chromium, bot Normal) | Teclado real (`page.keyboard.down/up`) y clicks reales (`page.mouse`), sin gestos sintéticos, ±30 ms de error aleatorio con semilla. **30/30 golpes salieron del tipo pedido** (9 topspin, 5 slice, 3 smash con la bola a 18–22 cm, 8 normales, 5 bloqueos). 24 PERFECT y 6 GOOD, \|Δt\| medio 16.6 ms. Ráfaga: 22 chispas en PERFECT, 10 en GOOD |
| E2E: casos explicados | Tecla 60 ms después del click → «NORMAL · pulsaste W después del click». Soltada 90 ms antes → «NORMAL · soltaste W antes del click». Persiguiendo → «TOPSPIN flojo · persiguiendo». Smash con la bola baja → «SMASH completo · bola baja para el smash» y «Red. Smash con la bola por debajo de la cinta (hacen falta 15 cm por encima).». Topspin +91 ms → «TOPSPIN flojo», 4 chispas grises y «Fuera. Topspin tarde (+91 ms): se te fue largo.». Slice −58 ms → «Fuera. Slice pronto (−58 ms): te pasaste de ángulo.» |
| E2E: barra y accesibilidad | Las 4 teclas iluminan la barra y el contorno de la raqueta; al soltar, se apagan. Tab oculta y muestra la barra con el foco en `BODY`, guarda `ppp.keyBar` y la preferencia sobrevive a recargar. Con `?reduce=1`: 0 chispas tras 3 golpes |
| `shots-check.js` (V0.2, actualizado a teclas reales) | Topspin, slice, normal y bloqueo pedidos con su tecla. Bloquear un topspin de 160–220 rad/s → **−86 a −116** (backspin, trail cian). Avisos: smash bajo, slice pronto (−68 ms) → fuera, topspin −94 ms → red. En esa pasada el bot no dio ninguna bola alta (≥ 17 cm) para el smash; ese caso está en `keys-check` (3/3) |
| Regresión E2E de V0.1 | `autoplay-rally`: rallies de 8 y 46 golpes, Δt iguales a los provocados (±13 ms). `aim-check`: colocado → cruza 22–67 cm; persiguiendo → recta (factor 0). `autoplay-errors`: game 2-11 con los errores provocados. `calibration-check`: +45 ms y luego 11/11 PERFECT con Δt medio de 0 ms |
| Consola del navegador | 0 errores. El aviso conocido del AudioContext con `?autostart=1` |

Capturas en `docs/screenshots/v0.2b/`:

| Archivo | Contenido |
|---|---|
| `01-menu.png` | Menú con las instrucciones de V0.2b |
| `held-topspin.png`, `held-slice.png`, `held-smash.png`, `held-block.png` | Tecla mantenida: barra iluminada y contorno de la raqueta del color del golpe |
| `shot-*.png` | Cada golpe pedido con su tecla: ráfaga, mensaje («TOPSPIN completo»…) y trail |
| `case-*.png` | Tecla a destiempo, persiguiendo, smash bajo, topspin tarde (chispas grises), slice pronto |
| `keybar-hidden.png` | Barra oculta con Tab |
| `shots-check/` | El E2E de V0.2 con teclas (golpes y «¿por qué fallé?») |
| `regresion/` | Los E2E de V0.1 |

### B.6 Tests cambiados a propósito

| Test (V0.2) | Cambio | Por qué |
|---|---|---|
| `shot-types.test.ts` «gesto → tipo de golpe» (11 casos: clasificación, umbral del slice, potencia por velocidad del gesto) | **Sustituidos** por «teclas → tipo de golpe» (`keys.test.ts`) | El gesto ya no elige el golpe ni la potencia (decisiones 1 y 2) |
| `shot-types.test.ts` «regla de "colocado" para todos los golpes» (2) | **Sustituidos** por «persiguiendo reduce la potencia a la mitad» | Decisión 4: «colocado» ya no decide el tipo |
| `shot-types.test.ts` «potencia [§4.7]» (3: velocidad del gesto → velocidad, sensibilidad y largo) | **Sustituidos** por «potencia por calidad», «un golpe de ataque débil es más arriesgado» y «topspin fuerte y tarde → larga» | La potencia sale de la calidad y el riesgo, del tipo de golpe |
| `shot-types.test.ts` «ningún error de timing da más velocidad que un PERFECT» (4) | **Movidos** a `keys.test.ts` con las mismas comprobaciones | Ahora el tipo va por tecla y la potencia cambia con la calidad: la comprobación es la misma y más exigente |
| `shot-types.test.ts` topspin, slice, smash y «suma de partes» | El tipo se pide con `type` en lugar de con un gesto. «El topspin pega más fuerte manteniendo la bola baja» admite ahora **±1 cm** sobre el margen del normal | Con la potencia completa del PERFECT actúa el techo de ritmo del topspin: sale un 25 % más rápido y pasa 0.8 cm más alto que un normal |
| `shot-types.test.ts` slice | Cruce de 1.2 alturas/s en lugar de gestos de 2.0 y 3.5 | Ya no hay umbral de slice; el cruce es opcional |
| `why.test.ts` (topspin bajo, smash bajo, smash pronto, slice pronto, golpe fuerte y tarde) | El tipo se pide con `type` | Mismo motivo; las causas esperadas no cambian |

El resto de los 164 tests pasa sin cambios. `block.test.ts` también: el bloqueo ignora el gesto y las teclas.

### B.7 Problemas, riesgos y requisitos

1. **Multijugador (requisito para V0.3–V0.4).**
   - El rival **no debe recibir las señales de tecla mantenida antes del golpe** (§13 ✅: el golpe se lee, pero no con certeza). Las teclas viajan **solo dentro del evento de golpe** (`{t_click, posición, swing.vx, block, keys}`), nunca como estado continuo. El cliente del rival no dibuja chispas de tecla.
   - La ráfaga y el mensaje sí se ven, porque ocurren tras el golpe (§5.2).
   - El servidor recalcula la potencia con la calidad y el factor de «colocado»: el historial de velocidades de la raqueta sigue siendo estado rebobinable (§5.1-1). Ahora decide la potencia, no el tipo.
2. **Con teclas, el `swing` deja de ser la entrada más difícil de validar** (§5.1-4). Lo único que el cliente decide es qué tecla había, y eso es legítimo. Anti-cheat sigue fuera de alcance ✅.
3. **Llegar colocado cuesta 270 ms.** En el E2E, 1 o 2 de cada 30 golpes salieron «reducido · persiguiendo» por recolocarse tarde. El texto lo explica, pero puede frustrar si pasa a menudo. Mandos: `shot.aimSettleFromMs` / `aimSettleToMs` (ventana) y `shotTypes.chasingPower`.
4. **Slice débil contra bots** (B.4). Si en el playtest tampoco compensa contra una persona, los mandos son `slice.target` (ángulo) y `slice.sideMax` (curva).
5. **Bote en tu campo.** Con la sensibilidad 0.8, un topspin muy pronto puede botar en tu propio campo: 23 de 559 puntos (4 %) en 30 partidas de bots. Tiene causa y texto («La bola botó en tu campo. Golpeaste pronto…»).
6. **Teclados no QWERTY.** Las teclas son posiciones físicas (`KeyW`, `KeyS`, `KeyE`). En AZERTY la tecla W es la que lleva una Z impresa, pero la barra dice «W». Si hace falta, se puede leer la distribución real con `navigator.keyboard.getLayoutMap()`.
7. Archivo suelto `client/src/game/0` (vacío): sigue ahí; no lo pide esta fase.

### B.8 Propuestas de cambio al documento de diseño (no modificado)

> Continúa la numeración de §6. «Decisión del autor» = ya decidido el 2026-10-02: solo falta escribirlo en el documento.

| # | Sección | Cambio propuesto | Motivo | Aprobación |
|---|---|---|---|---|
| P37 | §3.3 ✅ | Fila «Tipo de golpe»: **teclas mantenidas en el click: Q slice, W topspin, E smash; sin tecla, normal**. Fila nueva «Barra de teclas: Tab (mostrar/ocultar)». «Cruzar la bola» sigue con el gesto lateral ✅ | Playtest de V0.2: el gesto no era factible para una persona | **Decisión del autor** (integrar como ✅) |
| P38 | §3.1 | `modifiers?: { topspin?: boolean; slice?: boolean; smash?: boolean }` (sustituye a `forceTopspin` / `forceSlice`), leídas **en el instante del click**. `swing` solo se usa por `vx` (cruce). Con varias teclas, prioridad smash > topspin > slice | Lo implementado; el servidor debe resolverlo igual | 🟡 libre |
| P39 | §4.6 | Reescribir la tabla: el tipo lo eligen las teclas. «Colocado» ya no decide el tipo: persiguiendo, la potencia a la mitad. Slice: va a la banda (≈ 0.62 m del centro); curva hacia el lado del cruce o, sin cruce, hacia fuera; su riesgo es el ángulo (pronto → fuera). Smash: umbral de 15 cm sin cambios | Decisiones 1, 3, 4 y 6 | **Decisión del autor** (+ valores 🟡) |
| P40 | §4.7 | «La potencia sale de la **calidad** del golpe: PERFECT completo, GOOD reducido, débil flojo. El riesgo es del tipo de golpe (sensibilidad al timing), no de la potencia: un golpe de ataque mal dado es flojo y más arriesgado. Topspin tarde → largo». Quitar «sale de la velocidad del gesto» | Decisión 2; sin esto el riesgo desaparecería en los golpes débiles | **Decisión del autor** (+ valores 🟡) |
| P41 | §4.3 | Fila PERFECT: «potencia máxima disponible» pasa a ser literal (golpe completo). Añadir «GOOD: golpe reducido» y «débil: golpe flojo» | Coherencia con P40 | 🟡 libre |
| P42 | §5 | Feedback del golpe propio en dos líneas: la calidad (como ahora) + qué salió y con qué fuerza, y por qué salió distinto de lo pedido. Barra de teclas en una esquina inferior; chispas con la tecla mantenida; ráfaga por calidad (también la ve el rival) | Decisión 8 | **Decisión del autor** |
| P43 | §13, §17.2 | El evento de golpe lleva `keys`. El rival **no recibe** el estado de las teclas antes del golpe | Decisión 8 (multijugador); ver B.7-1 | **Decisión del autor** (requisito V0.3–V0.4) |
| P44 | §19 | «Reducir destellos» también sin ráfagas, y por defecto según «reducir movimiento» del sistema (URL `reduce=1` hasta que haya opciones). Los «Modificadores W/S» dejan de ser accesibilidad: son el control principal | Decisiones 1 y 8 | 🟡 libre |
| P45 | §3.4, §3.5 | Trackpad: las mismas teclas que el ratón. Táctil (V0.7): tres botones de golpe mantenidos que producen los mismos `modifiers` | El modelo de intento ya lo permite | 🟡 libre |
| P46 | §21 | Criterio nuevo y medible de V0.2: «con entrada humana (teclado y clicks reales, ±30 ms), el tipo pedido sale en ≥ 95 % de los golpes»; y «un bot de un solo golpe no gana ≥ 55 % de los puntos contra la mezcla (200 games)» | Lo que no detectó el E2E de V0.2 | 🟡 libre |
| P47 | §6 de este análisis | **Quedan obsoletas**: P21 (clasificación del gesto), P35 (W/S de trackpad: ahora son el control de todos) y P36b (smash «medio colocado»: el smash ya no exige estar colocado). La pregunta 11 de §24 («¿colocado para todos?») queda **respondida por el autor** (decisión 4) | — | — |

### B.9 Checklist de playtest de V0.2b

Arrancar con `npm run dev` (ver README). Con `debug=1`, el panel `D` muestra «Teclas en el click», «Tipo · potencia» y «Puntería».

1. **Teclas y barra** — `http://localhost:5173/?bot=easy&debug=1`. Durante la partida, sin hacer click, mantén Q, luego W, luego E y luego Espacio.
   - Mirar: la tecla se ilumina abajo a la izquierda y el contorno de tu raqueta toma su color: magenta (Q), naranja (W), blanco (E), cian (Espacio).
   - Pulsa Tab: la barra desaparece; Tab otra vez: vuelve. Recarga la página: se queda como la dejaste.
2. **Topspin** — misma URL. Colócate donde va a llegar la bola un momento antes, mantén W y haz click cuando la bola llegue al centro.
   - Mirar: «¡Perfecto!» y debajo «TOPSPIN completo», muchas chispas naranjas y trail naranja. Con un «Bien»: «TOPSPIN reducido» y menos chispas.
   - ¿Te salen 10 topspin seguidos sin pensar en la tecla? ¿Cuántos salen como querías?
3. **Slice y cruce** — misma URL. Mantén Q y golpea sin mover el ratón; luego mantén Q y haz el gesto lateral al hacer click.
   - Mirar: sin gesto, la bola curva hacia fuera del lado donde golpeas; con gesto, hacia el lado al que cruzas. Trail magenta, bote cerca de la banda.
   - Golpea un slice algo pronto: «Fuera. Slice pronto (−XX ms): te pasaste de ángulo.»
   - Prueba también W + gesto lateral (topspin cruzado).
4. **Smash** — `http://localhost:5173/?bot=easy&debug=1`. Espera una bola que bote alta (la sombra lejos de la bola), mantén E y haz click en lo más alto.
   - Mirar: «SMASH completo», chispas blancas, bola muy rápida.
   - Con una bola baja: «SMASH completo · bola baja para el smash» y luego «Red. Smash con la bola baja…».
5. **Persiguiendo** — misma URL. Llega a la bola en el último momento, con W mantenida.
   - Mirar: «TOPSPIN reducido · persiguiendo» (o «flojo» si además fue un «Bien»); en el panel, «Puntería: recta (persiguiendo)» y «potencia 50 %».
   - ¿Se entiende? ¿Frustra?
6. **Tecla a destiempo** — misma URL.
   - Pulsa W justo **después** del click: «NORMAL · pulsaste W después del click».
   - Suéltala justo **antes**: «NORMAL · soltaste W antes del click».
   - ¿Te ha pasado sin querer en los puntos 2–5?
7. **Riesgo y premio** — `http://localhost:5173/?bot=medium&debug=1`.
   - Haz un topspin claramente tarde: «tarde», «TOPSPIN flojo», pocas chispas grises y «Fuera. Topspin tarde (+XX ms): se te fue largo.»
   - ¿Se nota la diferencia entre un golpe completo, uno reducido y uno flojo? ¿El riesgo te parece justo?
8. **Un game entero** — `http://localhost:5173/?bot=medium`, sin panel.
   - ¿Hay un golpe que usarías siempre? ¿Las chispas o los mensajes te distraen de la bola?
   - Si molestan los destellos, compara con `http://localhost:5173/?bot=medium&reduce=1`.

### B.10 Cambios pedidos por el autor tras la entrega (2026-10-03)

| Cambio | Antes | Ahora | Verificación |
|---|---|---|---|
| **Teclas de golpe** | W topspin · S slice · E smash | **Q slice · W topspin · E smash** (solo cambia S por Q). La barra va en el orden del teclado: `Q Slice · W Topspin · E Smash · Espacio Bloqueo` | E2E `keys-check` con teclado real: 30/30 golpes del tipo pedido (5 slices con Q); S ya no hace nada |
| **Tecla mantenida** | 6 chispas suaves girando alrededor de la raqueta | **Solo el contorno**: una franja transparente del color del golpe, de 2.5 cm, pegada al borde por fuera (opacidad 0.35). La cara y el mango no cambian. Se probó primero iluminar toda la raqueta y después un aro sólido más la franja; el autor pidió «que solo se ilumine el contorno, no toda la raqueta» y luego «solamente la [franja] más transparente». La ráfaga de chispas al golpear no cambia | `held-*.png`: franja magenta (Q), naranja (W), blanca (E), cian (Espacio); al soltar, desaparece. Sobre la mesa azul el naranja se ve algo grisáceo: si cuesta leerlo, el mando es `haloOpacity` |

**Especial (§3.3 ✅: Q).** La Q pasa a ser el slice, así que el Especial de V0.5 necesita otra tecla. El autor eligió **R**, al lado de Q W E (P48). No cambia nada ahora: el Especial aún no existe.

| # | Sección | Cambio propuesto | Motivo | Aprobación |
|---|---|---|---|---|
| P48 | §3.3 ✅ | Fila «Especial»: **R** (antes Q). Q es ahora el slice (P37) | Decisión del autor (2026-10-03) | **Decisión del autor** |

Última pasada del E2E con las teclas nuevas: 23 PERFECT y 7 GOOD con ±30 ms de error (\|Δt\| medio 14.7 ms). Smash con la bola a 18–21 cm. Casos explicados: tecla después del click, tecla soltada antes, persiguiendo («TOPSPIN flojo · persiguiendo»), smash bajo (red), topspin +93 ms (largo) y slice −73 ms («Fuera. Slice pronto (−73 ms): te pasaste de ángulo.»). `shots-check` con Q también pasa: bloqueo de un topspin → −118, smash con la bola a 28 cm, slice pronto (−74 ms) fuera. La regresión `autoplay-rally` de V0.1 sigue pasando.
