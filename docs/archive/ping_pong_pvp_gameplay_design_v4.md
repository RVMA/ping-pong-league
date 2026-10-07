# 🏓 Ping Pong PvP — Diseño de Gameplay (v4)

> **Versión:** 4.0 — 2026-10-03. Integra V0.2 y V0.2b (golpes con teclas, potencia por calidad), las aprobaciones del autor del 2026-10-03 y el modelo de red elegido para V0.3.
> **Versión anterior:** [`docs/archive/ping_pong_pvp_gameplay_design_v3.md`](docs/archive/ping_pong_pvp_gameplay_design_v3.md) (v2 y v1 en [`docs/archive/`](docs/archive/)).
> **Cambios respecto a v3:** ver sección [25. Registro de cambios](#25-registro-de-cambios-v3--v4).
> **Base de las decisiones:** [`docs/analisis_v0.1.md`](docs/analisis_v0.1.md) y [`docs/analisis_v0.2.md`](docs/analisis_v0.2.md) (§6 propuestas de V0.2; apartado V0.2b: B.1 decisiones, B.8 propuestas, B.10 cambios del autor, B.11 cierre).

### Leyenda de estado

Cada decisión indica de dónde viene, para saber qué se puede cambiar libremente y qué no.

| Marca | Significado |
|---|---|
| ✅ | **Decidido por el autor.** No cambiar sin consultarlo. |
| 🟡 | **Propuesta base.** Se implementa así y se valida en playtest; puede cambiar con justificación. |
| ❓ | **Abierto.** Falta decidir; ver [24. Preguntas abiertas](#24-preguntas-abiertas). |
| ⚠️ | **Propuesta que modifica una decisión ✅.** Ya está implementada en el prototipo, pero **falta la aprobación del autor**. Ver §24. (En v4 no queda ninguna: P5 y P6 se aprobaron el 2026-10-03.) |

---

# 1. Visión

Juego PvP de ping pong para navegador que combina:

- Ping pong real como base.
- Acción rápida en tiempo real.
- Precisión mecánica.
- Lectura del rival.
- Habilidades especiales ligeras.
- Sistema de Momentum.
- Personajes con estilos diferentes.

> **La habilidad importa, pero también leer al rival.**

Las habilidades modifican la forma de jugar el rally sin convertir el juego en un fighting game con una mesa.

### Principio rector ✅

> **Los poderes nunca deben sustituir al ping pong.**

El jugador debe ganar porque:

1. Se posicionó mejor.
2. Leyó al rival.
3. Golpeó correctamente.
4. Gestionó el riesgo.
5. Usó su especial en el momento adecuado.

### Pilar: la red ✅

Cada golpe debe resolver el problema de pasar por encima de la red con suficiente margen. Los golpes agresivos son decisiones de riesgo/recompensa.

> **Si la bola choca con la red, el jugador debe poder entender por qué ocurrió.**

### Pilar: la precisión ✅ (playtest 1)

El autor prefiere que **dar exactamente en el punto sea exigente**: la ventana de posición en la raqueta no se relaja ni la raqueta se agranda sin consultarlo. El riesgo debe ser **legible**: cada error tiene una causa que el jugador puede nombrar (pronto, tarde, borde, baja, ángulo).

---

# 2. Cámara y legibilidad

## 2.1 Perspectiva ✅
Cada jugador se ve a sí mismo en el lado inferior de la mesa, mirando hacia el rival. Cada cliente espeja el mundo, así que los dos jugadores ven la misma perspectiva. 🟡

Cámara en tercera persona, detrás y por encima del jugador, fija (sin seguir a la bola). 🟡

## 2.2 Ayudas de lectura 🟡
Todo el diseño depende de juzgar la **altura** de la bola, y desde una cámara trasera eso es muy difícil. Son obligatorias:

| Ayuda | Descripción | Disponible | Estado |
|---|---|---|---|
| **Sombra de la bola** | Proyectada verticalmente sobre la mesa y el suelo; tamaño y opacidad según la altura. Es la referencia principal de altura. | Siempre | V0.1 |
| **Raqueta propia translúcida con anillos** | Desde la cámara trasera, una raqueta opaca tapa la bola justo al golpear. La propia se dibuja translúcida, con dos anillos: el radio PERFECT (20 %) y el GOOD (50 %). | Siempre | V0.1 |
| **Spin visible** | La costura y los logos giran sobre el **eje del spin real**, a una fracción fija de su velocidad (si no, se verían estroboscópicos). Trail de color por efecto: **naranja** topspin, **cian** backspin, **magenta** lateral, **blanco** bola plana muy rápida (smash). La etiqueta del tipo de golpe solo aparece en los golpes **propios**: el del rival se lee en la bola (§13). | Siempre | V0.2 |
| **Marcador de bote** | Punto donde va a botar la bola. | Solo en práctica y contra el bot | V0.1 |
| **"¿Por qué fallé?"** | Al perder un punto por error propio, una frase breve con la causa y su número (ms, cm): `Red. Golpeaste pronto (−92 ms): la bola sale más baja.`, `Fuera. Slice pronto (−58 ms): te pasaste de ángulo.`, `Red. Smash con la bola baja: 8 cm sobre la cinta (hacen falta 15).`, `Fuera. Topspin tarde (+90 ms): se te fue largo.`… La causa es la **parte decisiva** del objetivo del golpe: sin ella, habría entrado. | Siempre (desactivable en el menú) | Completo en V0.2 |

---

# 3. Input y controles

## 3.1 Modelo común: el "intento de golpe" ✅ (concepto) / 🟡 (detalle)

El juego no lee "el mouse" ni "el dedo". Cada dispositivo se traduce a un **intento** común. La física, el netcode, el servidor y el bot solo ven intentos. Añadir un dispositivo es escribir un traductor nuevo, sin tocar el juego.

```ts
interface InputIntent {
  target: { x: number; z: number }; // objetivo de la raqueta en coordenadas del jugador (m):
                                    //   x lateral (+ = su derecha), z profundidad desde la red (+ = hacia él)
  swing:  { vx: number; vy: number }; // velocidad del gesto en los últimos ~150 ms, en ALTURAS DE PANTALLA
                                      //   POR SEGUNDO (vx + = derecha). Desde V0.2b solo cuenta vx: cruzar (§4.5)
  fire?:  number;                     // instante del disparo en MS DEL RELOJ DE PARTIDA,
                                      //   ya corregido con el desfase de latencia del jugador (§3.7)
  block:  boolean;                    // bloqueo mantenido
  special?: number;                   // instante de activación del especial (mismo reloj)
  specialServe: boolean;              // saque especial mantenido
  modifiers?: { topspin?: boolean; slice?: boolean; smash?: boolean }; // teclas de golpe mantenidas
                                      //   EN EL INSTANTE DEL CLICK (§3.3, §4.6)
}
```

- Las coordenadas de jugador permiten que el mismo intento sirva para ambos lados y para el mundo espejado.
- `fire` usa el timestamp **del propio evento de entrada**, no el del frame en que se procesa.
- Las teclas de golpe se fotografían **en el propio evento del click**: una tecla pulsada 5 ms después ya no cuenta. 🟡
- En red, cada jugador mide sus golpes en el reloj del vuelo que está recibiendo (§17.2).

## 3.2 Movimiento de la raqueta 🟡
- La raqueta **persigue** al objetivo con **velocidad y aceleración máximas**. No sigue al cursor 1:1.
  - Así el posicionamiento cuesta tiempo y es una habilidad real.
  - Da sentido a "quedar mal posicionado".
  - Permite que la movilidad sea un rasgo de personaje.
- Valores: **6 m/s y 60 m/s²** (playtest 1: 4.2 m/s y 30 m/s² se sentían lentos). Cruzar la mesa sigue costando unos 0.3 s.
- La raqueta va en tiempo **real**: `gameSpeed` no la ralentiza (§7.3).
- La raqueta se mueve en un **plano horizontal**: lateral (X) y profundidad (Z).
  - Límites: lateral ±1.3 m.
  - Profundidad de 0.75 m a 2.7 m desde la red. El mínimo evita voleas accidentales por encima de la mesa.
- **La altura de la raqueta es automática**: se ajusta a la altura de la bola. El alcance vertical va de 0 a 0.85 m sobre la mesa; una bola fuera de ese rango cuenta como distancia extra en la medición de posición (§4.2).
- El cursor se proyecta sobre un plano horizontal a la altura de la mesa; un anillo marca el objetivo.

## 3.3 Ratón y teclado (principal) ✅
| Acción | Control |
|---|---|
| Mover raqueta | Mover el ratón (objetivo en el plano) |
| Golpear | Click izquierdo (el disparo) |
| **Tipo de golpe** | **Tecla mantenida en el instante del click: Q slice · W topspin · E smash.** Sin tecla, golpe normal ✅ (V0.2b, 2026-10-02/03) |
| Cruzar la bola | Con la raqueta colocada, gesto lateral seco al hacer click (§4.5) ✅ |
| **Bloqueo** | **Mantener Space y hacer click** ✅ (P20, aprobada el 2026-10-03) |
| Especial | **R** ✅ (2026-10-03; antes Q, que pasó a ser el slice) |
| Saque especial | Shift (mantener durante el saque) |
| Listo (warm-up) | Shift (mantener) |
| Barra de teclas | **Tab** la muestra u oculta (§5.3) ✅ |
| Panel de precisión | D 🟡 |
| Pausa | Esc 🟡 |
| Calibrar latencia | Botón en el lobby de selección de sala (§3.7) ✅ |

- Con varias teclas de golpe a la vez manda una prioridad fija: **smash > topspin > slice**. 🟡
- Espacio + tecla de golpe = bloqueo. 🟡
- Las teclas son **posiciones físicas** (en un teclado AZERTY, la W es la tecla con una Z impresa). 🟡
- Shift tiene dos usos según el contexto: en el warm-up significa "listo" y en el saque, "saque especial". No se solapan, porque en el warm-up no hay saques reales. 🟡

> En v3 el tipo de golpe salía de un gesto del ratón antes del click. En el playtest de V0.2 el autor no consiguió ningún topspin, slice ni smash: el gesto tenía que ser rápido, en los 150 ms previos y con la raqueta quieta justo antes, además de acertar el timing. Las teclas separan **elegir** el golpe de **ejecutarlo**.

## 3.4 Trackpad 🟡
Es el mismo modelo que ratón y teclado: el trackpad mueve la raqueta y hace click; las teclas Q/W/E eligen el golpe. Ajuste propio: **sensibilidad del gesto lateral** (cruce) en opciones, porque en un trackpad los gestos son cortos y lentos.

## 3.5 Táctil (móvil/tablet, horizontal) 🟡
- **Arrastrar el dedo** mueve la raqueta en modo **relativo**, como un trackpad. La raqueta se dibuja desplazada por encima del dedo para que no quede tapada.
- **Levantar el dedo es el disparo**; un deslizamiento lateral rápido justo antes cruza la bola (§4.5).
- **Botones de golpe** en la zona del pulgar libre, mantenidos como las teclas: **Slice**, **Topspin**, **Smash** (producen los mismos `modifiers`), más **Bloqueo**, **Especial**, **Saque especial** y **Listo**.
- Se fuerza la orientación horizontal.

## 3.6 Partidas entre dispositivos 🟡
- **Salas privadas:** cualquier dispositivo contra cualquiera. Junto al nombre de cada jugador se muestra un icono 🖱️/⌨️/📱.
- **Matchmaking público** (futuro): por defecto empareja jugadores con el mismo tipo de input, con opción de abrirlo.

## 3.7 Calibración de latencia ✅ (concepto y ubicación) / 🟡 (detalle)
El jugador reacciona a lo que ve. Entre el estado real de la bola y su click se acumulan el dibujo, la pantalla, el ratón y su propia anticipación: 30–60 ms, **más que la ventana PERFECT**. Sin corregirlo, todos tienden a LATE.

- **Dónde:** en el **lobby de selección de sala** ✅. Mientras no haya salas (V0.1–V0.3), en la pantalla de inicio.
- **Cómo:** 12 bolas llegan al centro de la raqueta del jugador por la misma escena 3D y con el mismo retraso de dibujo que la partida. Velocidad de llegada como en juego (3.4 m/s ±15 %) y salida a intervalos irregulares, para que haya que mirar la bola y no seguir un ritmo.
- **Resultado:** desfase = **mediana** de (click − llegada).
  - Se ignoran los clicks a más de ±250 ms.
  - Hacen falta al menos 2/3 de clicks válidos.
  - El desfase se limita a **[−50, +100] ms**: un desfase inflado regalaría tiempo de reacción en PvP.
- **Aplicación:** el traductor de entrada resta el desfase de cada click. La simulación recibe `fire` ya corregido.
- **Persistencia:** por navegador (la latencia depende del dispositivo). Se puede repetir o cancelar.
- Validado en V0.1: un jugador que siempre hace click 40 ms tarde calibra +43 ms y después juega con Δt medio de +3 ms.

---

# 4. Modelo del golpe

## 4.1 Disparo por click ✅
**El golpe ocurre al hacer click con la bola cerca de la raqueta.** No se golpea por colisión automática: si no haces click, la bola pasa de largo.

**"Cerca" se mide en tiempo y en posición** 🟡: el click cuenta si la bola pasa por el sweet spot a **menos de 120 ms** del click y con la **posición < 100 % del radio**. Si no, es un whiff (§4.4).

> En v2 la zona era "≈ 1.6 × el radio de la raqueta" en distancia. Se sustituye porque una zona en distancia impide las bandas EARLY/LATE: a la velocidad real de la bola, 12 cm se cruzan en ±37 ms. Además contradice medir el timing en ms.

**Radio de juego de la raqueta: 14 cm** 🟡 (validado: "me gusta que sea así, más preciso"). La medida de reglamento (cara ≈ 15 cm, radio 7.5 cm) exigiría 1.5 cm de precisión lateral para un PERFECT. Aun con 14 cm, la posición es el requisito más duro: ±2.8 cm de posición frente a ±8.5 cm de recorrido de la bola en la ventana de ±25 ms.

## 4.2 Medición de precisión ✅ (concepto) / 🟡 (valores)
**Se recompensa a quien da exactamente en el punto.** En el instante del click se busca el paso más cercano de la bola al sweet spot, usando el historial y la predicción determinista, con precisión inferior a un tick. Esa distancia se separa en dos componentes:

```text
                trayectoria de la bola
                        │
             early ◄────┼────► late        ← componente a lo largo de la trayectoria = TIMING
                        │
              ┌─────────●─────────┐
              │      sweet spot   │        ← componente perpendicular = POSICIÓN
              └───────────────────┘
                     raqueta
```

- **Timing (ms):** `Δt = t_click − t_ideal`, donde `t_ideal` es el instante en que la bola pasa más cerca del sweet spot. Se mide en **milisegundos reales**, no en distancia, para que sea igual de justo con bolas lentas y rápidas.
- **Posición (% del radio de la raqueta):** distancia perpendicular entre la bola y el sweet spot en `t_ideal`.
  - En el rally se mide en el plano horizontal, porque la altura es automática.
  - En el saque se mide en 3D, porque la altura del sweet spot es fija.
- **Calidad final = la peor de las dos.** Para un PERFECT hay que estar bien colocado **y** hacer click a tiempo.
- Si el jugador **estaba colocado** y el gesto **lateral** es un swing seco, la posición se mide con la raqueta **de antes del gesto** (§4.5): cruzar no cuenta como recolocación. Un movimiento vertical es solo recolocación.

### Ventanas 🟡

| Calidad | Timing | Posición |
|---|---|---|
| **PERFECT** | ±25 ms | < 20 % del radio |
| **GOOD** | ±60 ms | < 50 % |
| **DÉBIL** (pronto, tarde o borde) | ±120 ms | < 100 % |
| **WHIFF** (fallo) | fuera de lo anterior | fuera de la raqueta |

La escala de timing es simétrica: `EARLY – GOOD – PERFECT – GOOD – LATE`. La consecuencia física no lo es: pronto es arriesgado y tarde es pasivo (§4.3).

> En v2 la fila "EARLY / LATE" mezclaba timing y posición. Ahora el nivel se llama **débil** y su causa se muestra con una etiqueta: *pronto*, *tarde* o *borde*.

### Instante del contacto 🟡
- La calidad se evalúa **en el click**: el feedback no espera.
- El contacto ocurre en `max(t_click, t_ideal)`:
  - Click pronto: la bola llega a la raqueta y el golpe ocurre al llegar.
  - Click tarde: el golpe ocurre en el instante del click.
- Entre el click y el contacto (como mucho 120 ms) la raqueta queda fija.
- Esto define el evento de golpe de red (§17.2).

## 4.3 Efecto de cada calidad 🟡 (con filas ✅)

La calidad elige los **objetivos** del tiro (margen sobre la red y profundidad del bote, según una **curva continua en Δt**) y la **potencia** de los golpes de ataque (§4.7). La física ejecuta el tiro (§7.5). Por eso no hay saltos bruscos entre niveles y cada error es proporcional.

| Calidad | Efecto en la trayectoria |
|---|---|
| **PERFECT** | Mínima dispersión, **golpe completo** (potencia 1: todo el spin y la velocidad del tipo), más Momentum. **No elimina el riesgo de red**: la física sigue mandando. ✅ |
| **GOOD** | Golpe estable, dispersión pequeña, **golpe reducido** (potencia 0.5). ✅ (V0.2b) |
| **Débil** | **Golpe flojo** (potencia 0.15) y, en los golpes de ataque, **más arriesgado** que un golpe normal con el mismo error (§4.6). ✅ (V0.2b) |
| **EARLY** | Ángulo más cerrado, trayectoria **más baja** → más riesgo de red. ✅ Además, la bola sale **más corta**, de modo que **ningún error de timing da más velocidad que un PERFECT** ✅ (P5, aprobada el 2026-10-03; un test por tipo de golpe lo comprueba). |
| **LATE** | Trayectoria **más alta**, menos velocidad → bola fácil para que el rival ataque. ✅ |
| **Golpe con el borde** (posición > 50 %) | La bola sale desviada hacia el lado del impacto. Es **predecible, no aleatorio**: el desvío es proporcional a la distancia al centro (`0.12·min(p, 0.5) + 0.9·max(0, p − 0.5)` m). |
| **Bola cogida baja** (< 12 cm sobre la mesa) | Menos margen sobre la red ("posición desfavorable", §6.1): el umbral de red de EARLY se adelanta (de ~−110 a ~−85 ms). |

**P5 (aprobada el 2026-10-03).** Sin esta regla, menos margen con el mismo bote daba una trayectoria más plana y **más rápida**: hacer click pronto quedaba premiado (−90 ms a 6.5 m/s frente a PERFECT a 5.4 m/s). En V0.2 el mismo criterio encontró dos fallos reales (slice y smash pronto más rápidos que PERFECT).

### Curva de timing del golpe (V0.1) 🟡

| Δt (ms) | −120 | −90 | −60 | −25 | 0 | +25 | +60 | +120 |
|---|---|---|---|---|---|---|---|---|
| Margen sobre la cinta (m) | −0.07 | −0.01 | 0.05 | 0.115 | 0.11 | 0.14 | 0.30 | 0.55 |
| Profundidad (fracción de media mesa) | 0.30 | 0.42 | 0.58 | 0.82 | 0.88 | 0.82 | 0.74 | 0.68 |

El margen cruza cero hacia **−85 ms**: de −60 a −80 ms la bola pasa baja; desde ~−85 ms, cinta o red. Playtest 2: "lo justo".

## 4.4 Whiff y recuperación 🟡
Hacer click con la bola fuera de la ventana produce un **whiff**: la raqueta hace la animación del swing y queda **300 ms sin poder golpear**. Sin esto, el mejor truco sería hacer click sin parar. Golpear a una bola que no viene hacia ti también es un whiff.

## 4.5 Dirección (cruzar la bola) ✅ (concepto) / 🟡 (valores)

**Decisión del autor (playtest 1):** el gesto lateral **solo apunta si la raqueta estaba colocada**. Si llegas persiguiendo la bola, sale recta.

- **Colocado:** la velocidad máxima de la raqueta entre 270 y 150 ms antes del click.
  - ≤ 0.6 m/s → puntería completa.
  - ≥ 1.6 m/s → la bola sale recta.
  - Entre ambos, proporcional.
- **Gesto seco frente a movimiento lento:** la parte del gesto por encima de una zona muerta (0.5 alturas de pantalla/s) desplaza el objetivo 0.5 m por cada altura de pantalla/s. Un golpe de muñeca rápido apunta; un movimiento lento solo recoloca. La inercia de la raqueta ayuda: en 25 ms apenas se mueve 2 cm.
- **Dirección base:** sin gesto, la bola va al 45 % de la x del punto de contacto ("recta" desde donde golpeas). El objetivo limpio queda siempre 10 cm dentro de la banda.

**El riesgo de cruzar está en el ángulo, no en la posición** ✅ (elegido por delegación del autor con el criterio "balanceada, riesgosa y divertida"; aprobado al cerrar V0.1). Valores 🟡:
- Estando colocado, el gesto no te cuesta posición (§4.2).
- **Pronto + cruzado:** te pasas de ángulo; el cruce crece hasta un +60 % al final de la ventana débil. Un cruce a tope con GOOD a −60 ms sale por la banda.
- **Tarde + cruzado:** no llegas a cruzar; el cruce se reduce hasta un −70 %. La bola queda centrada y fácil.
- Dentro de la ventana PERFECT el ángulo sale exacto.
- Un cruce a tope deja **2 cm menos** de margen sobre la red (como el slice: "poco margen").
- El aviso del punto lo explica: «Fuera. Cruzaste golpeando pronto: te pasaste de ángulo.»
- El **slice** usa el mismo riesgo de ángulo, abriéndose más al golpear pronto (§4.6).

Es la misma lógica que la altura: pronto es arriesgado, tarde es pasivo.

## 4.6 Tipo de golpe por tecla ✅ (V0.2b) / 🟡 (valores)
El tipo de golpe lo elige la **tecla mantenida en el instante del click** (§3.3). El ratón mueve, hace click y cruza.

| Tecla | Golpe | Características | Riesgo |
|---|---|---|---|
| — (ninguna) | **Normal** | Trayectoria estable. Sin potencia ni spin. | Bajo riesgo, baja recompensa. Techo de ritmo 9.5 m/s de simulación (§7.5). |
| **W** | **Topspin** | Golpear más fuerte manteniendo la bola baja: el Magnus la hace caer antes. Spin de 100 a 340 rad/s según la potencia. | Desde una bola muy baja → **red** ✅. **Claramente tarde → larga** ✅ (≳ +75 ms; un GOOD algo tarde todavía entra). Sensibilidad al timing ×1.8. |
| **Q** | **Slice** | Corte con curva lateral y algo de backspin, con **más ángulo**: va a la banda (≈ 0.62 m del centro) hacia el lado de su curva, desde donde golpees. | **Pronto → fuera por la banda** ✅ (se pasa de ángulo desde ≈ −50 ms en el centro, −45 cruzado, −60 desde un lado hacia fuera; antes de ≈ −72 ms, red). Poco margen sobre la red. |
| **E** | **Smash** | Muy rápido (ritmo 10.5 + 4.5·potencia m/s de simulación: ~2 veces un normal completo). Es una recompensa, no un botón de "ganar". ✅ | Con la parte inferior de la bola a **menos de 15 cm sobre la cinta** → la bola baja más empinada y va a la **red** ✅. Pronto: más corto y empinado. |
| Space | **Bloqueo** | Ver sección 8. | — |

- **Curva del slice** ✅: hacia el lado al que cruzas; sin cruce, hacia fuera desde el lado donde golpeas.
- **«Colocado» ya no decide el tipo** ✅ (las teclas son deliberadas): llegar **persiguiendo** la bola reduce la potencia **a la mitad** (proporcional entre colocado y persiguiendo). Cruzar sigue necesitando estar colocado (§4.5).
- **El riesgo es del tipo de golpe, no de la potencia** 🟡: las desviaciones de la curva de timing crecen ×(1 + sensibilidad) — topspin 0.8, smash 0.6, slice 0 (su riesgo es el ángulo). Así **un golpe de ataque débil sale flojo y además más arriesgado** ✅.
- **Sin golpe dominante** ✅: un bot que siempre pide el mismo golpe no debe ganar con claridad (≥ 55 % de los puntos o ≥ 60 % de los games en 200 games) a uno que mezcla. Medido en V0.2b: solo topspin 50.8 % de los puntos, solo normal 50.7 %, solo slice 42.2 %, solo smash 11.1 % (`shared/scripts/mix-vs.ts`).
- El umbral del smash es **relativo a la red**: parte inferior de la bola sobre la cinta en el contacto (con altura automática no hay otra referencia fiable). 🟡

## 4.7 Potencia ✅ (V0.2b) / 🟡 (valores)
La potencia (0–1) sale de la **calidad del golpe**, no de la velocidad de un gesto: **se premia el PERFECT** ✅.

| Calidad | Potencia | Etiqueta |
|---|---|---|
| PERFECT | 1 | «completo» |
| GOOD | 0.5 | «reducido» |
| Débil | 0.15 | «flojo» |

- Persiguiendo la bola, × 0.5 ✅ (§4.6).
- Qué hace la potencia 🟡: más spin, más velocidad (techo de ritmo del topspin 10 + 1.2·p; ritmo del smash 10.5 + 4.5·p), bote algo más profundo (+0.06·p de media mesa) y algo más bajo sobre la red (−0.03·p m).
- El golpe normal no tiene potencia. Ningún error de timing da más velocidad que un PERFECT ✅ (P5).

> **Eliminado en v2:** el "Power Hit" de mantener el click para cargar. Chocaba con usar el click como disparo de timing.
> **Eliminado en v4:** la potencia por velocidad del gesto (v3). Un golpe mal dado nunca puede ser el más fuerte.

---

# 5. Feedback de golpe (estilo Paper Mario TTYD) ✅ (concepto) / 🟡 (detalle)

Cada golpe bueno muestra un mensaje pequeño y sutil con un sonido. Las rachas suben de nivel como las acciones encadenadas de *Paper Mario: The Thousand-Year Door*. Validado en el playtest 1: PERFECT y GOOD se distinguen sin mirar números.

## 5.1 Dos capas
1. **Calidad del golpe:** GOOD muestra "Bien"; PERFECT muestra "¡Perfecto!".
2. **Racha de PERFECT consecutivos dentro del mismo rally:** el mensaje sube de nivel y el sonido sube de tono.

| Racha | Mensaje | Sonido | Momentum |
|---|---|---|---|
| GOOD | *Bien* | golpe limpio | +3 % |
| PERFECT ×1 | *¡Perfecto!* | golpe + nota 1 (Do) | +8 % |
| PERFECT ×2 | *¡Genial!* | nota 2 (Mi) | +10 % |
| PERFECT ×3 | *¡Increíble!* | nota 3 (Sol) | +12 % |
| PERFECT ×4+ | ***¡EXCELENTE!*** | nota 4 (Do agudo) + brillo | +15 % |

- La racha **se rompe** con cualquier golpe que no sea PERFECT (también un whiff) o al terminar el punto.
- Un golpe débil no muestra mensaje celebratorio, solo una **etiqueta gris pequeña**: "pronto", "tarde", "borde" o "fallo" (whiff). Ayuda a entender los errores sin hacer ruido.

## 5.2 Reglas de sutileza
- El texto aparece **pequeño junto a la raqueta**, sube y se desvanece en ~400 ms (¡EXCELENTE!, 560 ms). **Nunca en el centro de la pantalla**, porque la bola ya viene de vuelta.
- **Nada de hit-stop real** (congelar la simulación). En PvP desincronizaría a los jugadores. El impacto se transmite solo con efectos: destello, un pequeño temblor de cámara y el sonido.
- **El rival también ve tus mensajes**, más pequeños y en su lado de la mesa. Genera presión y suma a los mind games.
- Los colores de calidad siempre van con texto (accesibilidad, §19).

## 5.3 Señales del tipo de golpe ✅ (V0.2b) / 🟡 (valores)
- **Texto del resultado:** debajo de la calidad, qué salió y con qué fuerza, y por qué salió distinto de lo pedido: «TOPSPIN completo», «SLICE reducido · persiguiendo», «SMASH completo · bola baja para el smash», «NORMAL · pulsaste W después del click», «NORMAL · soltaste W antes del click», «BLOQUEO». Solo en los golpes propios.
- **Barra de teclas** en la esquina inferior izquierda (nunca sobre la mesa): `Q Slice · W Topspin · E Smash · Espacio Bloqueo`. La tecla mantenida se ilumina con el color del golpe; la letra y el nombre siempre están. Visible por defecto; **Tab** la muestra u oculta, se guarda por navegador y durante la partida no mueve el foco.
- **Tecla mantenida:** solo el **contorno** de tu raqueta se ilumina, con una franja transparente del color del golpe pegada al borde (2.5 cm, opacidad 0.35). Nada de partículas alrededor ni de iluminar toda la raqueta (autor, 2026-10-03). **Solo la ve el jugador local**: el rival nunca ve tus teclas antes del golpe (§13, §17.2).
- **Ráfaga al golpear:** chispas del color del golpe (el normal, dorado) que salen de la raqueta y se abren hacia fuera durante ~0.3 s, sin tapar la bola: **22 con PERFECT, 10 con GOOD, 4 grises con un golpe débil, ninguna en un fallo**. La ve también el rival, porque ocurre tras el golpe (como sus mensajes, §5.2).
- Colores (los del trail): naranja topspin, magenta slice, blanco smash, cian bloqueo.

---

# 6. La red y la trayectoria ✅

## 6.1 La red es física real
La red es un colisionador real (malla y cinta) y una de las principales consecuencias de golpear mal. Un jugador puede perder un punto porque:

- golpeó demasiado pronto o demasiado tarde;
- aplicó demasiado ángulo, efecto o potencia;
- golpeó desde una posición desfavorable (bola baja) o con el borde;
- intentó un smash con la bola demasiado baja.

## 6.2 Margen sobre la red (clearance)
No basta con comprobar si la bola "cruza". Hay tres zonas conceptuales:

| Zona | Significado |
|---|---|
| 🔴 **Danger** | Pasa muy cerca de la red. Pequeñas variaciones de spin, timing o posición provocan un choque. |
| 🟡 **Safe** | Pasa con un margen razonable. |
| 🟢 **Ideal** | Margen seguro y buena profundidad. |

La decisión del jugador: *¿intento un golpe agresivo cerca de la red o juego seguro?*

## 6.3 Error de altura
- **Demasiado bajo** → red.
- **Demasiado alto** → fácil de devolver, o fuera de la mesa.
- **Bien ajustado** → trayectoria óptima.

## 6.4 Toques de red 🟡
- **Net cord en el rally:** si la bola toca la cinta y pasa al lado del rival, **es válida**. Aporta drama (implementado: rozando la cinta por encima de su línea, la bola pasa; por debajo, vuelve).
- **Toque de red en el saque:** ver 9.3 (let).
- **Bola de canto (edge ball):** si toca el borde superior de la mesa, es válida (V0.4).

---

# 7. Física 🟡

Física **propia y simple**, sin motor genérico. Un motor genérico no aporta nada aquí y complica el determinismo.

## 7.1 Fuerzas
- Gravedad.
- Resistencia del aire: drag cuadrático `a = −k·|v|·v`, k = 0.12 /m (el teórico para 40 mm y 2.7 g es ≈ 0.14).
- **Efecto Magnus** (spin → curva): el topspin hace caer antes la bola, el backspin la sostiene y el lateral la curva. (V0.2)
- Bote en la mesa con restitución vertical (0.89) y fricción tangencial que elimina parte del **deslizamiento del punto de contacto** e intercambia spin por velocidad: el topspin **frena menos** (y acelera si gira más rápido de lo que avanza), el backspin frena más; sin spin, −8 % de velocidad horizontal como en V0.1. 🟡 (P25)

## 7.2 Medidas de referencia (reglamento real)
| Elemento | Valor |
|---|---|
| Mesa | 2.74 m × 1.525 m, superficie a 0.76 m del suelo |
| Red | 15.25 cm de alto; sobresale 15.25 cm por cada lado |
| Bola | 40 mm de diámetro, 2.7 g (se dibuja 1.5× más grande para que se vea; la física usa la real) |
| Restitución vertical mesa | ≈ 0.89 |
| Raqueta (cara) | ≈ 15 cm de ancho de reglamento; **radio de juego 14 cm** (§4.1) |

## 7.3 Velocidad del juego ✅ (valor) / 🟡 (mecanismo)
En el ping pong real la bola cruza la mesa en 0.2–0.3 s, demasiado rápido para un mouse. Una **escala de tiempo global** (`gameSpeed`) ralentiza **la bola** sin alterar la forma de sus trayectorias.

- **`gameSpeed` = 0.75** ✅ (elegido por el autor en el playtest 2). Da unos 790 ms entre golpes y una llegada de 3.4 m/s reales.
- Solo afecta a la bola. La raqueta, las ventanas en ms y los retardos van en tiempo real, para que ajustar `gameSpeed` no cambie la respuesta del ratón.

## 7.4 Simulación
- Paso fijo (*fixed timestep*) de **120 Hz**.
- Velocidad con Euler y posición con la velocidad media del paso (trapezoidal), exacta con gravedad constante.
- Colisión continua a lo largo del paso con mesa, malla, cinta y suelo.
- Mismo código de física en cliente, servidor y bot (paquete `shared/`, sin DOM, ejecutable en Node sin compilar).
- Entre golpe y golpe la bola es **balística y determinista**: su trayectoria depende solo del estado tras el último golpe.
- Reglas de determinismo en §17.6.

## 7.5 Del golpe a la trayectoria: objetivos + solver + física ✅ (P6, aprobada el 2026-10-03)

1. La **calidad**, el **tipo de golpe** y el **cruce** eligen **objetivos**: margen de la bola sobre la cinta y punto de bote en el campo rival (§4.3–§4.7). Cada objetivo se guarda como **suma de partes con nombre** (timing, bola baja, potencia, ángulo, smash bajo…): es lo que permite decir «¿por qué fallé?».
2. Un **solver determinista** (Newton 3×3 con diferencias finitas sobre trayectorias simuladas con la misma física, **Magnus incluido**, número fijo de iteraciones) calcula la velocidad inicial que cumple esos objetivos.
3. **La física ejecuta el tiro**: si el margen pedido es negativo, la bola choca de verdad con la malla o la cinta.

No hay azar: la "dispersión pequeña" de GOOD es un desvío proporcional al error. Así la red es predecible y explicable. La colisión es real; el tiro se diseña por objetivos en vez de salir de un ángulo de raqueta simulado.

- **Objetivos de ritmo** (smash y bloqueo) 🟡 (P22, P26): piden **velocidad horizontal y bote**; el margen sale de la geometría (cuerda contacto → bote más la flecha de la parábola). Con un margen fijo, desde una bola alta no había solución o salían velocidades absurdas.
- **Techo de ritmo por tipo** ✅ (P24, aprobada el 2026-10-03): ningún golpe de margen supera su velocidad máxima aunque el margen pedido lo permitiera — normal 9.5, slice 10, topspin 10 + 1.2·potencia (m/s de simulación, equivalente sin drag). Con error de timing, el techo baja hasta un 20 %. Sin esto, un golpe normal desde una bola alta sería un smash, y golpear pronto saldría más rápido que un PERFECT. 🟡 (valores)
- **Suelo del margen** 🟡: no se puede pedir menos margen que el de la velocidad máxima de un golpe (20 m/s de simulación); desde una bola alta el riesgo pasa a la profundidad.

---

# 8. Bloqueo (Space) ✅ (disparo) / 🟡 (detalle)

Fusiona el "Parry", la "Defensa" y el "Perfect Block" de v1 en una sola mecánica, para no tener tres ventanas de timing compitiendo.

- **Click = swing activo.** Tú pones la energía y el efecto.
- **Space mantenido + click = bloqueo pasivo** ✅ (P20, aprobada el 2026-10-03). Mantener Space pone la raqueta al 50 %; **el click marca el instante**, con la misma medición de timing y posición que un golpe (§4.2). Devuelve la bola **usando la energía de la bola entrante**. Sin cruce ni tipo de golpe: Espacio + tecla de golpe sigue siendo bloqueo.
- Detalle 🟡 (P26):
  - ritmo = **0.85 / 0.95 / 1.0** × la velocidad horizontal de llegada (PERFECT / GOOD / débil): un PERFECT **reduce la velocidad recibida**;
  - bola recta y sin potencia propia;
  - un PERFECT devuelve el **50 % del spin invertido** (un topspin vuelve como backspin, trail cian) y genera Momentum (+5 %);
  - sin PERFECT, el **topspin entrante la levanta y la alarga** (puede salir larga) y el **backspin la hunde** (red): leer el spin del rival importa;
  - pronto = más corta (red); tarde = más alta y lenta.
- **Trade-offs**, para que no sea defensa automática:
  - mientras mantienes Space, la raqueta se mueve al **50 % de su velocidad máxima**;
  - el bloqueo nunca genera potencia propia, así que la devolución es predecible y atacable;
  - contra bolas lentas o altas, el bloqueo devuelve una bola fácil para que el rival haga smash.
- ❓ Lejos de la mesa, bloquear una bola normal devuelve un globo (40–80 cm sobre la cinta). Ver §24-13.

---

# 9. Saque

## 9.1 Saque normal 🟡
1. Empieza el estado de saque: la bola está en la mano del jugador que saca (15 cm sobre la mesa).
   - Quien saca debe estar **detrás de la línea de fondo** (1.45 m desde la red).
   - Quien saca debe estar **dentro del ancho de la mesa** (±0.70 m). Desde fuera, el primer bote caería fuera de su campo.
2. El jugador se posiciona con el mouse. La bola **se lanza automáticamente hacia arriba** al cabo de **1 s**, o con un primer click.
   - Lanzamiento a 2.4 m/s: sube ~29 cm.
   - Más rápido, la bola caía tan deprisa que un saque tardío se golpeaba a ras de mesa.
3. Mientras la bola **cae**, se golpea con **click** (el gesto lateral cruza el saque; en el saque normal no hay tipo de golpe ni teclas), con la misma medición de timing y posición que un golpe normal.
   - Sweet spot a **30 cm sobre la mesa**.
   - Solo cuenta la bola bajando: también pasa por esa altura al subir.
4. El saque debe **botar primero en tu lado** y luego en el del rival.
   - En el saque simplificado (V0.1) la trayectoria se calcula sola para que el primer bote caiga en tu campo.
   - Un saque tardío sale **alto y fácil**, no a la red.
5. **Si la bola cae sin golpearla**, punto para el receptor (reglamento).

Curva de timing del saque 🟡:

| Δt (ms) | −120 | −60 | −25 | 0 | +25 | +60 | +120 |
|---|---|---|---|---|---|---|---|
| Margen sobre la cinta (m) | −0.02 | 0.035 | 0.06 | 0.06 | 0.08 | 0.12 | 0.16 |
| Profundidad (fracción de media mesa) | 0.55 | 0.65 | 0.75 | 0.78 | 0.75 | 0.70 | 0.62 |

## 9.2 Saque especial ✅ (concepto) / 🟡 (coste)
- **Mantener Shift** durante el estado de saque abre el modo de saque especial: se ajustan **dirección, potencia y spin** con el mouse. ✅
- **Soltar Shift** ejecuta el saque. ✅
- Respeta la red: una carga excesiva produce red, bola demasiado alta o bola fuera. ✅
- **Coste:** requiere ≥ 50 % de Momentum y consume 50 %. Así compite con el especial de rally (100 %) y es una decisión real. Si fuera gratis, nadie usaría el saque normal. 🟡
- Cada personaje tiene su variante (sección 12).

## 9.3 Reglas de saque 🟡 (se sigue el reglamento real; implementadas en V0.1)
- **Let:** si el saque toca la red y entra, **se repite** sin penalización.
- Si el saque toca la red y no entra, o no bota en tu lado primero → **punto para el rival**.
- **Alternancia:** el saque cambia cada **2 puntos**; desde el **10-10**, cada punto.
- En cada game empieza sacando quien recibió primero en el game anterior.

---

# 10. Reglas del rally y del match

## 10.1 Rally 🟡 (implementadas en V0.1)
- La bola debe **botar una vez** en tu lado antes de que la golpees.
- **Volea** (golpearla antes de que bote en tu lado) → punto para el rival.
- **Doble bote** en tu lado → punto para el rival.
- Bola que no bota en el lado rival (fuera o red) → punto para el rival.
- Seguridad: si no pasa nada en 8 s, el punto se repite.

## 10.2 Match ✅
- **11 puntos** por game, con **diferencia de 2** (desde el 10-10 se sigue hasta que haya 2 de diferencia).
- **Mejor de 5 games**: gana quien llega primero a 3.
- **El marcador es la "vida"** del juego. No hay HP.

## 10.3 Modo rápido 🟡
Un match al mejor de 5 dura 15–25 min, mucho para un juego de navegador. Se añade un **modo rápido**: 1 game a 11 con diferencia de 2. Al crear la sala se elige entre:

- **Rápido:** 1 game (≈ 3–4 min)
- **Estándar:** mejor de 3 (≈ 8–12 min)
- **Completo:** mejor de 5 (≈ 15–20 min)

Duraciones estimadas con bots de nivel medio (un game ≈ 3.5 min); con humanos suele ser algo menos.

## 10.4 Momentos de tensión ✅
En un deuce, sobre todo en el último game, la presentación se intensifica (música, efectos, cámara, UI), pero las reglas siguen siendo las mismas.

---

# 11. Momentum

## 11.1 Fuente única ✅ (concepto) / 🟡 (valores)
El especial se carga **solo con Momentum**, sin cooldown. Se elige solo Momentum porque recompensa la habilidad.

| Fuente | Momentum |
|---|---|
| Golpe GOOD | +3 % |
| Racha PERFECT (×1 / ×2 / ×3 / ×4+) | +8 / +10 / +12 / +15 % |
| Bloqueo PERFECT | +5 % |
| Devolver un smash o una bola con mucho spin (tipo SMASH, o \|spin relativo\| ≥ 250 rad/s 🟡) | +5 % |
| Rally largo: cada golpe propio desde el 6.º del rally | +2 % |
| Smash que gana el punto | +5 % |
| **Perder un punto** (contra la bola de nieve) | +3 % |

## 11.2 Usos 🟡
- **Especial de rally (R):** requiere 100 % y lo consume entero.
- **Saque especial:** requiere ≥ 50 % y consume 50 %.

## 11.3 Persistencia 🟡
- Se conserva entre puntos.
- **Se reduce a la mitad al cambiar de game.**
- Se reinicia a 0 al terminar el match.

---

# 12. Personajes y especiales

## 12.1 Alcance inicial ✅
**Se empieza con 2 personajes**, no 5. El resto queda en backlog hasta validar en playtest que las diferencias cambian la estrategia.

## 12.2 Principios ✅
- Las estadísticas se mantienen contenidas. **La identidad viene de las mecánicas.**
- Las habilidades **modifican el gameplay, no se saltan la física.**
- Cada personaje tiene: **1 rasgo pasivo** 🟡, **1 saque especial** y **1 especial de rally**.

## 12.3 Personajes iniciales: POWER y DEFENDER 🟡
Se eligen por ser los más opuestos (agresivo frente a consistente). Así sirven para comprobar si la diferencia entre personajes cambia la estrategia.

| | **POWER** (agresivo) | **DEFENDER** (consistente) |
|---|---|---|
| **Rasgo pasivo** | +10 % de velocidad máxima de golpe; ventana PERFECT de timing **−20 %** | Ventana PERFECT de timing **+20 %**; −10 % de velocidad máxima de golpe |

La "velocidad de golpe" se aplica a los **techos de ritmo y al ritmo del smash** (§7.5), no multiplicando la velocidad después del solver: eso movería el bote. 🟡 (P33)
| **Saque especial** | **Cannon Serve:** muy rápido y plano, con poco margen sobre la red. Ejecutarlo mal se castiga con red. | **Precision Serve:** coloca la bola en la zona elegida con margen amplio y dispersión mínima. |
| **Especial (R)** | **Overdrive:** durante los **3 golpes siguientes**, la raqueta se mueve +30 % más rápido y los golpes tienen +15 % de velocidad. | **Wall:** durante los **3 golpes siguientes**, cualquier **bloqueo** con timing al menos GOOD cuenta como PERFECT y genera el doble de Momentum. |

> En v2 los pasivos eran ±5 ms. Con el jitter de entrada y de pantalla medido (unos ±10 ms incluso con entrada sintética) no se notaría. ±20 % de la ventana (±5 ms sobre 25 ms) expresa lo mismo de forma escalable. Alternativa: aplicar el pasivo a la ventana de **posición**. Validar en V0.6.

## 12.4 Backlog de personajes 🟡
| Personaje | Saque especial | Especial | Nota |
|---|---|---|---|
| **TRICKSTER** | **Ghost Serve:** misma animación para un saque sin spin y uno con backspin pesado; la rotación del logo se oculta unos frames. Es un truco real del ping pong. | **Spin Break:** el siguiente golpe aplica un spin muy fuerte. | Requiere que el spin sea muy legible. |
| **SPEED** | ❓ *(renombrar: chocaba con "Dash")* | **Dash:** desplazamiento instantáneo corto de la raqueta. | Solo tiene sentido gracias a la raqueta con inercia (3.2). |
| **CONTROL** | **Curve Serve:** mucho efecto lateral. | **Precision:** amplía temporalmente la ventana de Perfect Hit. | Se solapa con el pasivo de Defender; revisar. |

---

# 13. Lectura del rival ✅

La animación de la raqueta da pistas sobre dirección, tipo de golpe, potencia y posible smash. El rival debe poder leer el golpe, **pero no con certeza absoluta**.

Esto crea habilidad mecánica + mind games. Los mensajes de racha visibles para el rival (5.2) y el Ghost Serve (12.4) refuerzan esta capa. La regla de "colocado" (§4.5, §4.6) añade una lectura: un rival que llega corriendo no puede cruzar y golpea con la mitad de potencia.

- **El rival no ve tus teclas antes del golpe** ✅: el contorno de la raqueta (§5.3) solo lo ve el jugador local, y en red las teclas solo viajan dentro del evento de golpe (§17.2). El golpe del rival se lee en la bola: trail, giro, sonido y ritmo. La etiqueta del tipo solo aparece en tus golpes.

---

# 14. Flujo de sala

## 14.1 Flujo ✅ (con añadidos 🟡)
```text
LOBBY
  ↓
CREAR SALA (código privado + modo de match) / UNIRSE CON CÓDIGO   🟡
  ↓
SELECCIÓN DE SALA / ESPERA: calibración de latencia disponible    ✅ (§3.7)
  ↓
SELECCIÓN DE PERSONAJE
  ↓
WARM-UP
  ↓
AMBOS LISTOS (mantener Shift / botón Listo en táctil)
  ↓
3 → 2 → 1 → GO
  ↓
GAMES (según el modo)
  ↓
MATCH END (pantalla de resultado + estadísticas: % PERFECT, racha máxima, errores en red)   🟡
  ↓
RESET → WARM-UP
```

## 14.2 Warm-up ✅
- Se puede bolear libremente.
- **No hay poderes** ni Momentum.
- La bola se reinicia si alguien falla.
- Los mensajes de feedback (sección 5) sí aparecen, como práctica.

## 14.3 Reset tras el match ✅
```text
score = 0-0
game = 1
ready = false
momentum = 0
special = reset
serve state = reset
```
La sala vuelve al warm-up.

## 14.4 Desconexión 🟡
- Si un jugador se desconecta, la partida **se pausa hasta 30 s** para que reconecte.
- Si no reconecta, pierde por **abandono**.
- **Timeout en el warm-up:** ❓ (ver preguntas abiertas).

---

# 15. HUD

| Elemento | Detalle |
|---|---|
| Marcador | Tarjetas abatibles con los puntos, game actual y games ganados por cada jugador. Indicador de quién saca. |
| Momentum | Barra por jugador. Aviso **"ESPECIAL LISTO"** al 100 %. Marca visible al 50 % (umbral del saque especial). |
| **Ping de la sala** ✅ | Ver 15.1. |
| Dispositivo | Icono 🖱️/⌨️/📱 junto al nombre de cada jugador. |
| Feedback de golpe | Sección 5. |
| "¿Por qué fallé?" | Sección 2.2. |
| Barra de teclas (Tab) ✅ | §5.3. |
| Panel de precisión (tecla D) 🟡 | Último golpe (Δt, posición, puntería, tipo y potencia, teclas en el click, gesto lateral, spin de salida, último golpe del rival) y medias de los últimos 20: Δt medio con su tendencia, pronto/tarde, causa de no PERFECT (timing o posición), posición media, desfase calibrado. Herramienta de playtest y de práctica. |

## 15.1 Ping de la sala ✅ (mostrarlo) / 🟡 (detalle)
- El cliente envía un ping al servidor **cada 2 s**. Se muestra la **media de las últimas 5 mediciones** para que el número no salte.
- Se muestra **el ping de los dos jugadores**, junto a su nombre, en el HUD y en la sala de espera antes de dar a Listo.
- Color según el valor:

| Ping | Color |
|---|---|
| < 60 ms | 🟢 |
| 60–120 ms | 🟡 |
| > 120 ms | 🔴 + aviso "Conexión inestable, el timing puede verse afectado" |

- **No hay servidores por región por ahora.** ✅

---

# 16. Audio 🟡

El sonido del bote es clave para el timing en el ping pong real. Es prioridad alta y tiene un coste bajo. Mientras no haya archivos, todos los sonidos se **sintetizan con WebAudio**; basta con dejar el archivo con el nombre correcto para sustituirlo (§18).

| Sonido | Uso |
|---|---|
| `bounce_table` | Bote en la mesa. Varía levemente según la velocidad. |
| `hit_normal`, `hit_good`, `hit_perfect` | Golpe según la calidad. |
| `hit_topspin`, `hit_slice`, `hit_smash`, `hit_block` | Golpe según el tipo (también el del rival: se oye qué viene). 🟡 (P28) |
| `streak_1` … `streak_4` | Notas de la racha (Do, Mi, Sol, Do agudo). |
| `net` | Choque con la red. |
| `whiff` | Fallo al aire. |
| `edge` | Bola de canto. |
| `point_win`, `point_lose` | Fin de punto. |
| `countdown`, `go` | Cuenta atrás. |
| `special_ready`, `special_activate` | Especial. |

---

# 17. Arquitectura técnica 🟡

## 17.1 Stack
| Capa | Tecnología |
|---|---|
| Cliente | TypeScript + Three.js, con Vite |
| Lógica y física | Propia, en el paquete compartido `shared/`: sin DOM, TypeScript solo con sintaxis borrable, ejecutable en Node ≥ 22.18 sin compilar |
| Servidor | Node.js + WebSocket propio (librería `ws`) desde V0.3: el modelo «cada uno golpea en su tiempo» (§17.2) necesita controlar cada mensaje. Colyseus se reconsidera para las salas de V0.4 (su estado sincronizado manda lo mismo a todos a la vez, lo contrario de §17.2). 🟡 |
| Estructura | Monorepo (npm workspaces): `client/`, `server/` (V0.3), `shared/` |
| Configuración | Un único archivo de valores ajustables: `shared/src/config.ts`. Cliente y servidor deben usar exactamente la misma config. |

## 17.2 Netcode: eventos de golpe y «cada uno golpea en su tiempo» ✅ (modelo, decisión del autor del 2026-10-03) / 🟡 (detalle)
Una bola cruza la mesa en menos de 1 s y la ventana PERFECT dura ±25 ms. Con física 100 % en el servidor y solo el render en el cliente (esquema de v1), cualquier ping normal vuelve el timing injusto. Pero entre golpe y golpe la bola es **balística y determinista**, así que:

1. Ambos clientes y el servidor usan la **misma física compartida** (`shared/`).
2. Lo único que viaja por la red es el **evento de golpe** (más la posición de la raqueta y el ping, abajo). La calidad no se envía: se recalcula.
3. **El servidor es la autoridad**: valida cada golpe, fija el estado de salida oficial de cada vuelo y decide puntos, reglas, Momentum, habilidades y estado del match.

**Cada uno golpea en su tiempo** ✅. Con latencia, el golpe del rival llega tarde a tu pantalla y alguien tiene que pagar ese retraso. Se elige que **ningún jugador pierda tiempo de reacción ni precisión**:
- **Vuelo:** cada bola entre dos golpes es un vuelo, definido por su estado de salida (posición, velocidad y spin en el contacto) y la física. Cada jugador mide el vuelo con **su propio reloj de vuelo**, que empieza cuando el vuelo empieza para él.
- **Tu golpe:** tu vuelo nuevo empieza al instante en tu pantalla (predicción local). El feedback no espera a la red.
- **El golpe del rival:** su vuelo empieza para ti **cuando recibes su golpe**, desde su raqueta y a velocidad real. Tienes todo tu tiempo de reacción y **tu click se mide en el reloj de ese vuelo, igual que en local**.
- **La bola que se aleja** se **frena poco a poco** en tu pantalla (normal cerca de ti, más lenta hacia el rival) para llegar a su zona de golpe cuando se espera su golpe: tu ping + el suyo. El freno tiene un límite. Si su golpe llega antes, la bola se adelanta suavemente (~80 ms); si no llega (falló), sigue su trayectoria real.
- **Coste aceptado** ✅: los rallies duran algo más que en local; con 100 ms de ping la bola que se aleja va ~25 % más lenta en ese tramo, con 150 ms ~40 %.
- **La raqueta del rival** se dibuja con su posición (30 veces por segundo, interpolada) **en ese mismo tiempo frenado**: en tu pantalla, su raqueta golpea la bola cuando la bola llega a ella, y la lectura de §13 sigue funcionando.

**Qué viaja** 🟡:
- **Evento de golpe:** `{ vuelo al que responde, t_click en el reloj de ese vuelo (ya corregido con el desfase de §3.7), posición fija de la raqueta (§4.2), swing.vx, teclas de golpe, block }`, más las muestras de raqueta que necesita la regla de «colocado» (270–150 ms antes del click).
- **Las teclas de golpe solo viajan dentro del evento**: el rival nunca recibe qué tecla mantienes antes del golpe ✅.
- **Posición de la raqueta:** 30 Hz con interpolación (no 120).
- **Ping** cada 2 s (§15.1); se usa también para calcular cuánto frenar la bola que se aleja.

**El servidor** 🟡: recalcula el golpe con el mismo código, comprueba que es plausible (§17.3) y difunde a los dos el **estado de salida oficial** del vuelo nuevo. Si discrepa de la predicción del que golpeó (raro), esa bola se corrige suavemente **sin borrar el mensaje** que ya vio el jugador. No simula a 120 Hz todo el rato: calcula cada vuelo al recibir el golpe (~0.1 ms) y usa temporizadores para detectar que nadie devolvió la bola.

Detalles que siguen valiendo:
- **Contacto diferido** (§4.2): en un click pronto el contacto ocurre hasta 120 ms después, en el reloj del vuelo de quien golpea.
- **Desfase de latencia (§3.7):** se aplica al click antes de enviarlo; el servidor aplica el mismo límite [−50, +100] ms.
- **Historial:** la evaluación usa el historial del vuelo y las muestras de raqueta (regla de «colocado»), con el reloj del vuelo de quien golpea.

> En v3 el modelo era un **reloj común**: `t_click` en tiempo de servidor y rebobinado de hasta 150 ms. Funciona, pero el receptor pierde su ping de tiempo de reacción en cada bola (un smash pasaría de 0.45 a 0.35 s con 100 ms) y la bola del rival "salta" al salir de su raqueta. El autor eligió que nadie pague el retraso en su timing.

## 17.3 Validación en servidor 🟡
Solo comprobaciones de plausibilidad, que vienen incluidas con el netcode:
- la raqueta pudo llegar a esa posición con su velocidad y aceleración máximas (se reutiliza la misma función de movimiento de `shared/`), según su posición enviada;
- el click está dentro de la ventana del vuelo al que responde;
- el desfase de latencia declarado está dentro del límite;
- el jugador tenía el Momentum necesario (V0.5).

## 17.4 Anti-cheat ✅
**Fuera de alcance por ahora.** No hay detección de patrones (por ejemplo, scripts de click en el frame perfecto). Se acepta como limitación conocida.

## 17.5 Bot 🟡
Hace falta **desde V0.1**: sin bot no se puede probar el feel hasta tener multijugador, y muchos jugadores no tendrán rival disponible. Además, los partidos bot contra bot sin navegador sirven para ajustar valores y encontraron varios fallos de diseño en V0.1.
- Predice el punto de intercepción con la misma física compartida y produce `InputIntent` como un humano. La calidad real la decide el mismo evaluador: si no llega a tiempo con su raqueta con inercia, falla.
- Simula humanidad con **retardo de reacción**, **error de posición** y una **distribución de calidades de golpe**. Deja pasar las bolas que van fuera.

| Dificultad | Reacción | PERFECT / GOOD / débil / whiff | Puntería |
|---|---|---|---|
| Fácil | 360 ms | 10 / 45 / 35 / 10 % | 40 % del recorrido |
| Normal | 240 ms | 30 / 50 / 15 / 5 % | 75 % |
| Difícil | 150 ms | 45 / 42 / 10 / 3 % | 100 % |

- Pide sus golpes con las **mismas teclas que un humano** (`modifiers`) y su potencia sale de la calidad que saca. 🟡
- Mezcla de golpes 🟡 (probabilidades cuando la situación lo permite): topspin / slice — Fácil 10 / 5 %, Normal 22 / 10 %, Difícil 35 / 18 %; smash con bola alta 35 / 60 / 85 %; smash con bola baja (error) 3 / 0.5 / 0 %; bloqueo contra bolas rápidas o con mucho spin 15 / 30 / 35 %. Bloquea en el punto más alto y espera la bola alta para el smash.
- En red (V0.3) es un **cliente más** que se conecta al servidor con su propia latencia: sirve para jugar solo online y para los tests de red sin navegador. 🟡

## 17.6 Determinismo 🟡
- En la física, el solver y las reglas solo se usan `+ − × ÷` y `Math.sqrt`, que es exacta según IEEE-754. **Prohibido** `Math.sin/cos/exp/pow` en la simulación: pueden variar entre motores de JavaScript.
- Azar solo con PRNG con semilla (mulberry32).
- Número fijo de iteraciones en los solvers.
- Config idéntica en cliente y servidor: se envía un hash de la config al entrar en la sala.
- Tests de determinismo bit a bit: misma semilla → mismo partido; en red, el mismo vuelo da la misma trayectoria en cliente y servidor.

---

# 18. Arte y placeholders ✅

- **El autor hace el arte final.** El prototipo usa **placeholders** que el autor sustituirá. Los de V0.1 se generan localmente con `npm run placeholders -w client`, sin licencias de terceros.
- Placeholders: círculos de color con la inicial, o imágenes de servicios libres. Se evitan imágenes con licencia dudosa.
- Todos los assets se cargan desde **un único manifiesto** (`client/src/assets/manifest.ts`) con **rutas fijas**, relativas a `client/src/assets/`. Para sustituir un asset basta con reemplazar el archivo con el mismo nombre; no se toca código. El manifiesto descubre los archivos al compilar, así que nunca se piden archivos inexistentes.

## 18.1 Lista de assets esperados 🟡
| Ruta | Formato | Tamaño sugerido |
|---|---|---|
| `characters/<id>/portrait.png` | PNG con transparencia | 512 × 512 |
| `characters/<id>/select.png` | PNG con transparencia | 1024 × 1536 |
| `characters/<id>/paddle.png` | PNG (textura de la cara de la raqueta) | 512 × 512 |
| `characters/<id>/color` | Color de acento en el manifiesto (hex) | — |
| `ui/logo.png` | PNG con transparencia | 1024 × 512 |
| `arena/background.jpg` | JPG | 1920 × 1080 |
| `sfx/<nombre>.ogg` | OGG (o MP3) con los nombres de §16; si falta, se sintetiza | — |

`<id>` ∈ { `power`, `defender` } en la fase inicial.

---

# 19. Accesibilidad 🟡
- Los colores de calidad (débil/GOOD/PERFECT) y de tipo de golpe siempre van acompañados de **texto o forma**, no solo color (daltonismo): la barra de teclas lleva letra y nombre; el mensaje del golpe dice el tipo.
- **Calibración de latencia** (§3.7).
- Sensibilidad del ratón y del gesto lateral (cruce) configurables.
- El **tipo de golpe por teclas** (§3.3) separa elegir el golpe de ejecutarlo.
- Opción para reducir el temblor de cámara y los destellos: sin ráfagas de chispas (`?reduce=1` hasta que haya menú de opciones) y, por defecto, según la preferencia «reducir movimiento» del sistema.
- Respetar "reducir movimiento" del sistema en las animaciones del HUD.

---

# 20. Ideas a futuro (fuera del alcance actual)
- Modo entrenamiento con **robot lanzapelotas** y ejercicios (topspin, smash, bloqueo).
- Ranking ELO y matchmaking público.
- Modo espectador y repeticiones compartibles.
- Cosméticos: raquetas, trails de la bola.
- Servidores por región.
- Los 3 personajes del backlog.

---

# 21. Roadmap 🟡

El bot y el netcode van pronto: son los dos puntos donde un fallo obliga a rehacer el trabajo anterior. Los criterios de aceptación son medibles cuando es posible.

| Fase | Contenido | Pregunta que responde / criterio de aceptación |
|---|---|---|
| **V0.1 — Feel local** ✅ **cerrada el 2026-10-01** (`v0.1.0`) | Monorepo, física básica, raqueta con inercia, cámara, sombra, input → `InputIntent`, golpe por click con timing y posición, whiff, feedback TTYD, bot de 3 dificultades, un game a 11 con saque simplificado, manifiesto de assets. Adelantado: reglas de rally y saque (let, volea, doble bote, rotación), marcador de bote, "¿por qué fallé?" mínimo, puntería "solo colocado" con riesgo de ángulo, calibración de latencia, panel de precisión. | Aprobada por el autor en dos playtests: control con el ratón bien tras ajustes; distingue PERFECT de GOOD; la red al golpear pronto, "lo justo". |
| **V0.2 — Golpe completo** ✅ **cerrada el 2026-10-03** (`v0.2.0`) | Tipos de golpe (normal, topspin, slice, smash) **elegidos con teclas** (V0.2b, tras el playtest: el gesto no era factible) con potencia por calidad; spin con Magnus y bote con spin; solver con spin; techo de ritmo; spin visible; bloqueo (Space + click); «¿por qué fallé?» completo; bot con los golpes nuevos. Barra de teclas, contorno de la raqueta y ráfaga por calidad. | Aceptada por el autor el 2026-10-03. Medido: con entrada humana y ±30 ms de error, 30/30 golpes del tipo pedido; 100 % de los puntos perdidos con causa nombrada; sin golpe dominante. **Pendiente para el primer playtest PvP (V0.4):** el jugador nombra el tipo de golpe del rival en ≥ 80 % de los casos. |
| **V0.3 — Netcode** | `server/` (Node + WebSocket) con la simulación compartida como autoridad. Modelo **«cada uno golpea en su tiempo»** (§17.2): reloj de vuelo, bola que se aleja frenada, raqueta del rival en tiempo frenado, validación y estado de salida oficial, corrección suave. **El jugador (lado de abajo) contra un bot remoto** conectado por la red. **Latencia simulada de 50/100/150 ms** con variación. Ping de los dos en el HUD (§15.1). | ¿Es jugable online? **Δt medio con 100 ms ≤ ±10 ms del de 0 ms** (E2E con ratón y teclado reales y ±30 ms de error); 0 discrepancias entre clientes y servidor en partidos de bots por la red; golpes por punto ±10 % de los de local; servidor < 1 ms por golpe, < 2 KB/s por jugador, cliente a 60 fps. |
| **V0.4 — Partido PvP** | Salas con código, lobby de sala con calibración, warm-up, Listo, cuenta atrás. **Dos personas** (cliente del lado 1 con mundo espejado). Jugar por internet (servidor publicado). Bola de canto. Modos de match. Desconexión y reconexión. | Se juega un partido completo PvP sin incidencias. El jugador nombra el golpe del rival en ≥ 80 % de los casos (criterio heredado de V0.2). |
| **V0.5 — Momentum + POWER** | Barra de Momentum y fuentes (sección 11). Saque especial (Shift) y especial (R). POWER completo. | ¿Los especiales suman sin romper el ping pong? |
| **V0.6 — DEFENDER + playtest** | DEFENDER completo. Sesiones de playtest y ajuste de ventanas y valores. | ¿Las diferencias entre personajes cambian la estrategia? |
| **V0.7 — Inputs adicionales** | Trackpad (sensibilidad del cruce) y táctil (arrastrar, levantar para golpear y botones de golpe). | ¿Es jugable fuera del mouse? |
| **V0.8+** | Arte final del autor, audio final, backlog de personajes, ideas a futuro. | Contenido. |

---

# 22. Fuera de alcance (por decisión) ✅
- Anti-cheat por detección de patrones.
- Servidores por región (solo se muestra el ping).
- Más de 2 personajes hasta superar V0.6.
- Arte final (lo hace el autor; el prototipo usa placeholders).

---

# 23. Visión final ✅

**Ping pong real** + **arcade competitivo** + **fighting game ligero** + **mind games**. Todo dentro de una sola mesa.

```text
MOVER (raqueta con inercia)
  ↓
POSICIONARSE (colocado = puedes cruzar y pegar con toda la potencia)
  ↓
LEER (animación del rival, spin visible, sombra)
  ↓
TECLA (Q/W/E) + CLICK (timing + posición → calidad → potencia)
  ↓
SPIN / POTENCIA / ÁNGULO
  ↓
¿SUPERA LA RED?
  ├── NO → ERROR → PUNTO (+ "¿por qué fallé?")
  │
  └── SÍ
       ↓
    ¿DÓNDE CAE? (¿te pasaste de ángulo?)
       ↓
    RIVAL REACCIONA
       ↓
      RALLY (+ racha: ¡Perfecto! → ¡Genial! → ¡Increíble! → ¡EXCELENTE!)
```

> **¡Nos vemos en la mesa! 🏓**

---

# 24. Preguntas abiertas

| # | Pregunta | Propuesta actual |
|---|---|---|
| 1 | ¿El jugador puede elegir la **profundidad** (bola corta o larga) además de la dirección? | Sin control explícito: la profundidad sale del timing, la potencia (+6 % de media mesa a tope) y el tipo de golpe (smash más profundo, bloqueo más corto). V0.2 lo confirma; falta que el autor lo decida. |
| 2 | ¿Hay **timeout en el warm-up** si alguien nunca da a Listo? | 3 min y luego expulsión de la sala. Pendiente de decidir (V0.4). |
| 3 | ¿Los personajes iniciales son **POWER + DEFENDER**? | Recomendado; no confirmado por el autor. Pasivos en % de la ventana (§12.3). |
| 4 | ¿El **coste del saque especial** (50 % de Momentum) es el correcto, o se prefiere un uso gratuito por game? | 50 %. Validar en V0.5. |
| 5 | **Nombre del saque especial de SPEED**, que chocaba con "Dash". | Pendiente. |
| 6 | ¿Solapamiento entre el especial *Precision* de CONTROL y el pasivo de DEFENDER? | Revisar al recuperar CONTROL del backlog. |
| 7 | ¿El modo por defecto al crear sala es Rápido, Estándar o Completo? | Estándar (mejor de 3, ≈ 8–12 min); Rápido para el matchmaking público. Pendiente (V0.4). |
| 12 | ¿La calibración de latencia es **obligatoria** la primera vez? | Sugerida, no obligatoria: se ofrece en el lobby y el panel D enseña la tendencia a pronto o tarde. |
| 13 | ¿El **bloqueo debería acercar la raqueta a la mesa** (profundidad máxima ~1.2 m mientras se mantiene Space)? | Lejos de la mesa, bloquear una bola normal devuelve un globo de 40–80 cm sobre la cinta: coherente con «bola fácil» (§8), pero no con cómo se bloquea en el ping pong real. Decidir tras un playtest (P26b). |
| 14 | ¿El **spin entrante** debería afectar a los golpes activos (p. ej. el backspin del rival baja el margen de tu golpe normal)? | Hoy solo afecta al bloqueo: leer el spin sirve para colocarse y para decidir si bloquear. Decidir tras un playtest (P36). |

**Resueltas:**

| # | Pregunta | Respuesta |
|---|---|---|
| 8 | ¿Cuál es el valor final de `gameSpeed`? | **0.75** ✅ (autor, playtest 2 de V0.1). |
| 9 | P5: ¿EARLY sale además más corto, para que ningún error de timing dé más velocidad que un PERFECT? | **Sí** ✅ (autor, 2026-10-03). |
| 10 | P6: ¿modelo "objetivos + solver + física"? | **Sí** ✅ (autor, 2026-10-03), con objetivos de ritmo y techo de ritmo (P24, aprobado). |
| 11 | ¿La regla de "colocado" se extiende a todos los golpes? | **Ya no decide el tipo**: los golpes van con teclas; persiguiendo, la potencia a la mitad ✅ (autor, V0.2b). |
| — | ¿Cómo se apunta la bola? | El gesto lateral apunta solo estando colocado ✅; el riesgo está en el ángulo ✅ (§4.5). |
| — | ¿Hace falta calibrar la latencia y dónde? | Sí, en el lobby de selección de sala ✅ (§3.7). |
| — | ¿Cómo se elige el tipo de golpe? | Teclas Q/W/E mantenidas en el click ✅ (V0.2b). |
| — | En red, ¿quién paga la latencia? | Nadie en su timing: **cada uno golpea en su tiempo** ✅ (§17.2, 2026-10-03). |

---

# 25. Registro de cambios v3 → v4

El registro v2 → v3 está en la v3 (`docs/archive/ping_pong_pvp_gameplay_design_v3.md`, §25); el v1 → v2, en la v2.

| Área | v3 | v4 | Motivo | Origen |
|---|---|---|---|---|
| ⚠️ pendientes | P5 y P6 | **Ninguna**: P5, P6, P20 y P24 aprobadas | Aprobación del autor | Autor, 2026-10-03 |
| `InputIntent` (§3.1) | `modifiers: { forceTopspin, forceSlice }` | `modifiers: { topspin, slice, smash }`, leídas en el evento del click; del `swing` solo cuenta `vx` | Tipo de golpe por teclas | V0.2b (P38) |
| Controles (§3.3) | Tipo por gesto; Especial en Q; bloqueo «Space (mantener)» | **Q slice · W topspin · E smash** ✅; **Especial en R** ✅; bloqueo = **Space + click** ✅; Tab (barra de teclas) | El autor no conseguía los golpes con gestos; Q pasó al slice | Playtest V0.2, V0.2b, P20, P37, P48 |
| Trackpad y táctil (§3.4–§3.5) | Modificadores W/S; tipo por deslizamiento | Las mismas teclas / botones de golpe; el gesto solo cruza | Coherencia con §3.3 | P45 |
| Medición de la posición (§4.2) | Raqueta de antes del gesto en cualquier dirección | Solo con gesto **lateral** | El gesto vertical ya no elige golpe | V0.2b |
| Efectos de la calidad (§4.3) | PERFECT «potencia máxima disponible»; ⚠️ P5 | PERFECT completo, GOOD reducido, débil flojo; **P5 ✅** | Se premia el PERFECT | V0.2b, autor |
| **Tipo de golpe** (§4.6) | Por gesto, con «colocado» para todos | **Por tecla** ✅; colocado ya no decide el tipo, persiguiendo = mitad de potencia ✅; curva del slice ✅; slice a la banda; sin golpe dominante ✅ | Playtest de V0.2 | V0.2b, decisiones 1, 4, 6, 7 |
| **Potencia** (§4.7) | Velocidad del gesto | **Calidad del golpe** ✅ (1 / 0.5 / 0.15); el riesgo es del tipo, no de la potencia | Premiar el PERFECT; un golpe mal dado nunca es el más fuerte | V0.2b, decisión 2 |
| Feedback (§5.3, nueva) | — | Texto del resultado y por qué; barra de teclas (Tab); **contorno** transparente con la tecla mantenida; ráfaga por calidad ✅ | Saber qué golpe tienes preparado y qué salió | V0.2b, decisión 8; autor 2026-10-03 |
| Bote (§7.1) | «el topspin acelera tras el bote» | El bote elimina parte del deslizamiento: el topspin frena menos (acelera solo si gira muy rápido) | Física implementada | P25 |
| Resolución del golpe (§7.5) | ⚠️ P6 | **P6 ✅**; objetivos de ritmo (smash, bloqueo); **techo de ritmo ✅** (P24); suelo del margen | Sin techo, un normal desde una bola alta era un smash y pronto salía más rápido | V0.2, autor |
| Bloqueo (§8) | Space (mantener), sin detalle | **Space + click** ✅; ritmo 0.85/0.95/1.0; PERFECT invierte el 50 % del spin; el spin no absorbido alarga o hunde | Definir «la energía de la bola entrante» con riesgo legible | P20, P26 |
| Momentum (§11.1) | «mucho spin» sin definir | \|spin relativo\| ≥ 250 rad/s o tipo SMASH | Fuentes calculables | P32 |
| Pasivos (§12.3) | «velocidad de golpe» sin mecanismo | Se aplica a techos de ritmo y ritmo del smash | Multiplicar la velocidad movería el bote | P33 |
| Lectura del rival (§13) | — | El rival no ve tus teclas; el tipo solo se etiqueta en tus golpes | No regalar la lectura | V0.2, V0.2b |
| Audio (§16) | Sonidos por calidad | + sonidos por tipo de golpe | Distinguir los golpes de oído | P28 |
| **Netcode** (§17.1–§17.3) | Reloj común con rebobinado (≤ 150 ms); Colyseus candidato | **«Cada uno golpea en su tiempo»** ✅: reloj de vuelo, bola que se aleja frenada, raqueta del rival en tiempo frenado; teclas solo en el evento; servidor por eventos con `ws` | Nadie pierde tiempo de reacción ni precisión por el ping | Autor, 2026-10-03; P31, P43 |
| Bot (§17.5) | Calidades por dificultad | + mezcla de golpes por dificultad; pide golpes con teclas; cliente remoto en V0.3 | V0.2, V0.2b | P30 |
| Accesibilidad (§19) | Modificadores W/S | Teclas para todos; reducir destellos = sin ráfagas, según el sistema | V0.2b | P44 |
| Roadmap (§21) | V0.2 abierta; V0.3 «2 navegadores»; criterio de lectura en V0.2 | **V0.2 cerrada** (`v0.2.0`); V0.3 = jugador contra bot remoto con criterios de rendimiento; dos personas y lectura del rival ≥ 80 % pasan a V0.4 | Decisiones del autor del 2026-10-03 | Autor |
| Preguntas abiertas (§24) | 1–12 | 9, 10 y 11 resueltas; nuevas 13 (bloqueo cerca de la mesa) y 14 (spin entrante en golpes activos) | — | P26b, P36 |
