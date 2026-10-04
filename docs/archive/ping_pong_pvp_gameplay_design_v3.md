# 🏓 Ping Pong PvP — Diseño de Gameplay (v3)

> **Versión:** 3.0 — 2026-10-01. Integra lo aprendido al implementar V0.1 y los dos playtests del autor.
> **Versión anterior:** [`docs/archive/ping_pong_pvp_gameplay_design_v2.md`](docs/archive/ping_pong_pvp_gameplay_design_v2.md) (v1 en [`docs/archive/ping_pong_pvp_gameplay_design_v1.md`](docs/archive/ping_pong_pvp_gameplay_design_v1.md)).
> **Cambios respecto a v2:** ver sección [25. Registro de cambios](#25-registro-de-cambios-v2--v3).
> **Base de las decisiones:** [`docs/analisis_v0.1.md`](docs/analisis_v0.1.md) (§6 propuestas, §8–§9 playtests, §10 cierre).

### Leyenda de estado

Cada decisión indica de dónde viene, para saber qué se puede cambiar libremente y qué no.

| Marca | Significado |
|---|---|
| ✅ | **Decidido por el autor.** No cambiar sin consultarlo. |
| 🟡 | **Propuesta base.** Se implementa así y se valida en playtest; puede cambiar con justificación. |
| ❓ | **Abierto.** Falta decidir; ver [24. Preguntas abiertas](#24-preguntas-abiertas). |
| ⚠️ | **Propuesta que modifica una decisión ✅.** Ya está implementada en el prototipo, pero **falta la aprobación del autor**. Ver §24. |

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
| **Spin visible** | Logo o costura en la bola que rota según el spin real, más un trail de color por tipo de efecto (topspin, backspin, lateral). | Siempre | V0.2 |
| **Marcador de bote** | Punto donde va a botar la bola. | Solo en práctica y contra el bot | V0.1 |
| **"¿Por qué fallé?"** | Al perder un punto por error propio, una etiqueta breve con la causa: `Red. Golpeaste pronto: la bola sale más baja.`, `Fuera. Cruzaste golpeando pronto: te pasaste de ángulo.`, `GOLPE CON EL BORDE`… | Siempre (desactivable) | Base en V0.1, completo en V0.2 |

---

# 3. Input y controles

## 3.1 Modelo común: el "intento de golpe" ✅ (concepto) / 🟡 (detalle)

El juego no lee "el mouse" ni "el dedo". Cada dispositivo se traduce a un **intento** común. La física, el netcode, el servidor y el bot solo ven intentos. Añadir un dispositivo es escribir un traductor nuevo, sin tocar el juego.

```ts
interface InputIntent {
  target: { x: number; z: number }; // objetivo de la raqueta en coordenadas del jugador (m):
                                    //   x lateral (+ = su derecha), z profundidad desde la red (+ = hacia él)
  swing:  { vx: number; vy: number }; // velocidad del gesto en los últimos ~150 ms,
                                      //   en ALTURAS DE PANTALLA POR SEGUNDO (vx + = derecha, vy + = hacia la red)
  fire?:  number;                     // instante del disparo en MS DEL RELOJ DE PARTIDA,
                                      //   ya corregido con el desfase de latencia del jugador (§3.7)
  block:  boolean;                    // bloqueo mantenido
  special?: number;                   // instante de activación del especial (mismo reloj)
  specialServe: boolean;              // saque especial mantenido
  modifiers?: { forceTopspin?: boolean; forceSlice?: boolean };
}
```

- Las coordenadas de jugador permiten que el mismo intento sirva para ambos lados y para el mundo espejado.
- `fire` usa el timestamp **del propio evento de entrada**, no el del frame en que se procesa.
- En V0.3 el reloj de partida se sincroniza con el servidor (§17.2).

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

## 3.3 Mouse (principal) ✅
| Acción | Control |
|---|---|
| Mover raqueta | Mover el mouse (objetivo en el plano) |
| Cruzar la bola | Con la raqueta colocada, gesto lateral seco al hacer click (§4.5) ✅ |
| Tipo de golpe | Gesto del mouse antes del click (§4.6) |
| Golpear | Click izquierdo (el disparo) |
| Especial | Q |
| Bloqueo | Space (mantener) |
| Saque especial | Shift (mantener durante el saque) |
| Listo (warm-up) | Shift (mantener) |
| Calibrar latencia | Botón en el lobby de selección de sala (§3.7) ✅ |

Shift tiene dos usos según el contexto: en el warm-up significa "listo" y en el saque, "saque especial". No se solapan, porque en el warm-up no hay saques reales. 🟡

## 3.4 Trackpad 🟡
Es el mismo modelo que el mouse, con dos ajustes:
- **"Sensibilidad de swing"** en opciones: baja los umbrales de gesto. En un trackpad los gestos son cortos y lentos.
- **Modificadores opcionales:** mantener **W** fuerza topspin y mantener **S** fuerza slice. El trackpad solo se encarga de posicionarse y de hacer click. También sirve como opción de accesibilidad.

## 3.5 Táctil (móvil/tablet, horizontal) 🟡
- **Arrastrar el dedo** mueve la raqueta en modo **relativo**, como un trackpad. La raqueta se dibuja desplazada por encima del dedo para que no quede tapada.
- **Deslizar rápido y levantar el dedo** es el golpe:
  - la dirección del deslizamiento da el tipo de golpe;
  - la velocidad da la potencia;
  - **levantar el dedo es el disparo**.
- Botones en pantalla en la zona del pulgar libre: **Especial**, **Bloqueo**, **Saque especial**, **Listo**.
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
- Si el jugador **estaba colocado** y el gesto es un swing seco, la posición se mide con la raqueta **de antes del gesto** (§4.5): el gesto no cuenta como recolocación.

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

La calidad elige los **objetivos** del tiro: margen sobre la red y profundidad del bote, según una **curva continua en Δt**. La física ejecuta el tiro (§7.5). Por eso no hay saltos bruscos entre niveles y cada error es proporcional.

| Calidad | Efecto en la trayectoria |
|---|---|
| **PERFECT** | Mínima dispersión, potencia máxima disponible, mejor control del spin, más Momentum. **No elimina el riesgo de red**: la física sigue mandando. ✅ |
| **GOOD** | Golpe estable, dispersión pequeña. |
| **EARLY** | Ángulo más cerrado, trayectoria **más baja** → más riesgo de red. ✅ ⚠️ *Además, la bola sale **más corta**, de modo que **ningún error de timing da más velocidad que un PERFECT** (P5).* |
| **LATE** | Trayectoria **más alta**, menos velocidad → bola fácil para que el rival ataque. ✅ |
| **Golpe con el borde** (posición > 50 %) | La bola sale desviada hacia el lado del impacto. Es **predecible, no aleatorio**: el desvío es proporcional a la distancia al centro (`0.12·min(p, 0.5) + 0.9·max(0, p − 0.5)` m). |
| **Bola cogida baja** (< 12 cm sobre la mesa) | Menos margen sobre la red ("posición desfavorable", §6.1): el umbral de red de EARLY se adelanta (de ~−110 a ~−85 ms). |

⚠️ **P5 — pendiente de aprobación.** Sin esta regla, menos margen con el mismo bote daba una trayectoria más plana y **más rápida**: hacer click pronto quedaba premiado (−90 ms a 6.5 m/s frente a PERFECT a 5.4 m/s). Ya está implementada y cubierta por un test.

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

Es la misma lógica que la altura: pronto es arriesgado, tarde es pasivo.

## 4.6 Tipo de golpe por gesto 🟡 (V0.2)
El gesto en los ~150 ms previos al disparo define el tipo de golpe:

| Gesto | Golpe | Características | Riesgo |
|---|---|---|---|
| Quieto o muy lento | **Normal** | Trayectoria estable. | Bajo riesgo, baja recompensa. |
| Hacia arriba (hacia la red) | **Topspin** | Golpear más fuerte manteniendo la bola baja: el Magnus la hace caer antes. | Demasiado topspin desde mala posición → **trayectoria demasiado baja → red**. |
| Lateral seco | **Cruce** (V0.1) → **Slice** por encima de un umbral (V0.2) | El cruce de §4.5; por encima del umbral añade efecto lateral (curva) y más ángulo. | Ángulo excesivo, poco margen sobre la red. |
| Hacia abajo, con la bola **más de ~15 cm por encima de la cinta** | **Smash** | Muy rápido. Es una recompensa, no un botón de "ganar". ✅ | Con la bola baja → trayectoria hacia la red. |
| — (Space mantenido) | **Bloqueo** | Ver sección 8. | — |

**Propuesta para V0.2** 🟡 (extensión natural de la decisión ✅ de §4.5):
- **Solo puedes elegir tipo de golpe si estás colocado.** Persiguiendo la bola, cualquier gesto da un golpe normal. Arriba/abajo en el ratón también mueve la profundidad de la raqueta, igual que el gesto lateral mueve la x, así que tiene el mismo problema de "apuntar sin querer".
- Estando colocado, el gesto seco es swing y no recolocación: la posición se mide con la raqueta de antes del gesto, en cualquier dirección.
- El umbral del smash es **relativo a la red** (con altura automática no hay otra referencia fiable).

## 4.7 Potencia 🟡
La potencia sale de la **velocidad del gesto**, sin botón de carga.

A mayor potencia hay mayor velocidad, menor margen de error, más sensibilidad al timing y más riesgo de red o de bola fuera ✅. Así el golpe más fuerte no es siempre la mejor opción. En V0.1 la potencia es fija (golpe normal); llega en V0.2 con los tipos de golpe.

> **Eliminado en v2:** el "Power Hit" de mantener el click para cargar. Chocaba con usar el click como disparo de timing.

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
- Bote en la mesa con restitución vertical y fricción tangencial que **intercambia spin por velocidad**: el topspin acelera tras el bote y el backspin frena. (V0.2; en V0.1, sin spin, la fricción quita un 8 % de velocidad horizontal.)

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

## 7.5 Del golpe a la trayectoria: objetivos + solver + física ⚠️ (P6)

1. La **calidad** y el **gesto** eligen **objetivos**: margen de la bola sobre la cinta y punto de bote en el campo rival (§4.3, §4.5).
2. Un **solver determinista** (Newton con diferencias finitas sobre trayectorias simuladas con la misma física, número fijo de iteraciones) calcula la velocidad inicial que cumple esos objetivos.
3. **La física ejecuta el tiro**: si el margen pedido es negativo, la bola choca de verdad con la malla o la cinta.

No hay azar: la "dispersión pequeña" de GOOD es un desvío proporcional al error. Así la red es predecible y explicable.

⚠️ **P6 — pendiente de aprobación.** Interpreta "la red es física real" (§6, ✅): la colisión es real, pero el tiro se diseña por objetivos en vez de salir de un ángulo de raqueta simulado.

**V0.2 (spin):** el solver pasa de 2 a 3 incógnitas (más el ángulo lateral) y debe resolver **con Magnus incluido**, para que "el topspin permite pegar más fuerte manteniendo la bola baja" sea cierto. Si se aplica Magnus después del solver, el topspin mandaría la bola a la red de forma arbitraria.

---

# 8. Bloqueo (Space) 🟡 (V0.2)

Fusiona el "Parry", la "Defensa" y el "Perfect Block" de v1 en una sola mecánica, para no tener tres ventanas de timing compitiendo.

- **Click = swing activo.** Tú pones la energía y el efecto.
- **Space = bloqueo pasivo.** La raqueta se queda quieta y devuelve la bola **usando la energía de la bola entrante**. Sin swing ni tipo de golpe.
- El bloqueo usa la misma medición de timing y posición (sección 4.2). Un bloqueo PERFECT:
  - reduce la velocidad recibida;
  - devuelve con parte del spin invertido;
  - genera Momentum (+5 %).
- **Trade-offs**, para que no sea defensa automática:
  - mientras mantienes Space, la raqueta se mueve al **50 % de su velocidad máxima**;
  - el bloqueo nunca genera potencia propia, así que la devolución es predecible y atacable;
  - contra bolas lentas o altas, el bloqueo devuelve una bola fácil para que el rival haga smash.

---

# 9. Saque

## 9.1 Saque normal 🟡
1. Empieza el estado de saque: la bola está en la mano del jugador que saca (15 cm sobre la mesa).
   - Quien saca debe estar **detrás de la línea de fondo** (1.45 m desde la red).
   - Quien saca debe estar **dentro del ancho de la mesa** (±0.70 m). Desde fuera, el primer bote caería fuera de su campo.
2. El jugador se posiciona con el mouse. La bola **se lanza automáticamente hacia arriba** al cabo de **1 s**, o con un primer click.
   - Lanzamiento a 2.4 m/s: sube ~29 cm.
   - Más rápido, la bola caía tan deprisa que un saque tardío se golpeaba a ras de mesa.
3. Mientras la bola **cae**, se golpea con **gesto + click**, con la misma medición de timing y posición que un golpe normal.
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
| Devolver un smash o una bola con mucho spin | +5 % |
| Rally largo: cada golpe propio desde el 6.º del rally | +2 % |
| Smash que gana el punto | +5 % |
| **Perder un punto** (contra la bola de nieve) | +3 % |

## 11.2 Usos 🟡
- **Especial de rally (Q):** requiere 100 % y lo consume entero.
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
| **Saque especial** | **Cannon Serve:** muy rápido y plano, con poco margen sobre la red. Ejecutarlo mal se castiga con red. | **Precision Serve:** coloca la bola en la zona elegida con margen amplio y dispersión mínima. |
| **Especial (Q)** | **Overdrive:** durante los **3 golpes siguientes**, la raqueta se mueve +30 % más rápido y los golpes tienen +15 % de velocidad. | **Wall:** durante los **3 golpes siguientes**, cualquier **bloqueo** con timing al menos GOOD cuenta como PERFECT y genera el doble de Momentum. |

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

Esto crea habilidad mecánica + mind games. Los mensajes de racha visibles para el rival (5.2) y el Ghost Serve (12.4) refuerzan esta capa. La regla de "colocado" (§4.5, §4.6) añade una lectura: un rival que llega corriendo no puede cruzar ni elegir golpe.

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
| Panel de precisión (tecla D) 🟡 | Último golpe (Δt, posición, puntería) y medias de los últimos 20: Δt medio con su tendencia, pronto/tarde, causa de no PERFECT (timing o posición), posición media, desfase calibrado. Herramienta de playtest y de práctica. |

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
| Servidor | Node.js + WebSocket. Colyseus como candidato: da salas, estado y reconexión hechos. |
| Estructura | Monorepo (npm workspaces): `client/`, `server/` (V0.3), `shared/` |
| Configuración | Un único archivo de valores ajustables: `shared/src/config.ts`. Cliente y servidor deben usar exactamente la misma config. |

## 17.2 Netcode: eventos de golpe
Una bola cruza la mesa en menos de 1 s y la ventana PERFECT dura ±25 ms. Con física 100 % en el servidor y solo el render en el cliente (esquema de v1), cualquier ping normal vuelve el timing injusto. Pero entre golpe y golpe la bola es **balística y determinista**, así que:

1. Ambos clientes simulan la **misma física compartida** localmente.
2. Lo único que viaja por la red es un **evento de golpe**: `{ t_click (reloj de servidor), posición de la raqueta fija, swing, block }`.
   - La calidad no se envía: se recalcula.
   - La posición fija es la que se mide según §4.2, incluida la de antes del gesto si estaba colocado.
3. El cliente que golpea **evalúa la calidad al instante**, para mostrar el feedback sin espera.
4. El **servidor valida** el evento con compensación de lag: rebobina hasta el timestamp del cliente, con un límite de ~150 ms. Después calcula la trayectoria resultante y la difunde.
5. Los clientes se **resincronizan en cada golpe**. Si el servidor discrepa (raro y por pocos ms), se corrige la trayectoria **sin borrar el mensaje** que ya vio el jugador.

Detalles que salen de V0.1:
- **Contacto diferido:** en un click pronto el contacto ocurre hasta 120 ms después (§4.2), así que el evento llega al rival antes de hacer falta. En un click tarde el contacto está en el pasado y hay que rebobinar.
- **Reloj común:** `t_click` debe ir en tiempo de servidor; el desfase de reloj se estima con el ping. Si no, la ventana de compensación se gasta en desfase.
- **Desfase de latencia (§3.7):** el servidor conoce el desfase declarado de cada jugador y aplica el mismo límite [−50, +100] ms.
- **Historial:** la evaluación usa historial más predicción de la bola. El historial (y el de velocidades de la raqueta, para la regla de "colocado") forma parte del estado que se rebobina.

El servidor sigue siendo la **autoridad** sobre: puntos, colisiones con la red y la mesa, reglas, Momentum, habilidades y estado del match.

## 17.3 Validación en servidor
Solo comprobaciones de plausibilidad, que vienen incluidas con el netcode:
- la raqueta pudo llegar a esa posición con su velocidad y aceleración máximas (se reutiliza la misma función de movimiento de `shared/`);
- el timestamp está dentro de la ventana de compensación;
- el desfase de latencia declarado está dentro del límite;
- el jugador tenía el Momentum necesario.

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

## 17.6 Determinismo 🟡
- En la física, el solver y las reglas solo se usan `+ − × ÷` y `Math.sqrt`, que es exacta según IEEE-754. **Prohibido** `Math.sin/cos/exp/pow` en la simulación: pueden variar entre motores de JavaScript.
- Azar solo con PRNG con semilla (mulberry32).
- Número fijo de iteraciones en los solvers.
- Config idéntica en cliente y servidor: se envía un hash de la config al entrar en la sala.
- Tests de determinismo bit a bit: misma semilla → mismo partido.

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
- Los colores de calidad (débil/GOOD/PERFECT) siempre van acompañados de **texto o forma**, no solo color (daltonismo).
- **Calibración de latencia** (§3.7).
- Sensibilidad del mouse y sensibilidad de swing configurables.
- Modificadores W/S para el tipo de golpe (3.4).
- Opción para reducir el temblor de cámara y los destellos.
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
| **V0.2 — Golpe completo** | Gesto → tipo de golpe (normal, topspin, slice, smash) con la regla de "colocado" (§4.6). Potencia por velocidad del gesto. Spin con Magnus y bote con spin; solver con spin (§7.5). **Spin visible**. Bloqueo (Space). "¿Por qué fallé?" completo. Bot que usa los nuevos golpes. | ¿Un golpe malo a la red se entiende? Los cuatro golpes se distinguen en juego. Medible: en playtest, el jugador nombra el tipo de golpe del rival en ≥ 80 % de los casos y la causa de su propio error en ≥ 80 %. |
| **V0.3 — Spike de netcode** | `server/` con WebSocket. 2 navegadores, eventos de golpe, compensación de lag, resincronización, reloj común, desfase de latencia validado. **Latencia simulada de 50/100/150 ms.** Ping de la sala en el HUD. | ¿Es jugable online? A 100 ms el timing se siente justo: el Δt medio con 100 ms simulados no se desvía más de ±10 ms del Δt sin latencia. |
| **V0.4 — Partido PvP** | Salas con código, lobby de sala con calibración, warm-up, Listo, cuenta atrás. Bola de canto. Modos de match. Desconexión y reconexión. Cliente del lado 1 con mundo espejado. | Se juega un partido completo PvP sin incidencias. |
| **V0.5 — Momentum + POWER** | Barra de Momentum y fuentes (sección 11). Saque especial (Shift) y especial (Q). POWER completo. | ¿Los especiales suman sin romper el ping pong? |
| **V0.6 — DEFENDER + playtest** | DEFENDER completo. Sesiones de playtest y ajuste de ventanas y valores. | ¿Las diferencias entre personajes cambian la estrategia? |
| **V0.7 — Inputs adicionales** | Trackpad (sensibilidad de swing + W/S) y táctil (arrastrar/deslizar + botones). | ¿Es jugable fuera del mouse? |
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
POSICIONARSE (colocado = puedes cruzar y elegir golpe)
  ↓
LEER (animación del rival, spin visible, sombra)
  ↓
GESTO + CLICK (timing + posición → calidad)
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
| 1 | ¿El jugador puede elegir la **profundidad** (bola corta o larga) además de la dirección? | Sin control explícito: la profundidad sale del timing (V0.1 lo confirma), la potencia y el spin. Validar en V0.2. |
| 2 | ¿Hay **timeout en el warm-up** si alguien nunca da a Listo? | 3 min y luego expulsión de la sala. Pendiente de decidir. |
| 3 | ¿Los personajes iniciales son **POWER + DEFENDER**? | Recomendado; no confirmado por el autor. Pasivos en % de la ventana (§12.3). |
| 4 | ¿El **coste del saque especial** (50 % de Momentum) es el correcto, o se prefiere un uso gratuito por game? | 50 %. Validar en V0.5. |
| 5 | **Nombre del saque especial de SPEED**, que chocaba con "Dash". | Pendiente. |
| 6 | ¿Solapamiento entre el especial *Precision* de CONTROL y el pasivo de DEFENDER? | Revisar al recuperar CONTROL del backlog. |
| 7 | ¿El modo por defecto al crear sala es Rápido, Estándar o Completo? | Estándar (mejor de 3, ≈ 8–12 min); Rápido para el matchmaking público. Pendiente. |
| 9 | ⚠️ **P5:** ¿se aprueba que EARLY salga además más corto, para que ningún error de timing dé más velocidad que un PERFECT? (§4.3) | Sí; ya implementado y cubierto por un test. |
| 10 | ⚠️ **P6:** ¿se aprueba el modelo "objetivos + solver + física" para resolver los golpes? (§7.5) | Sí; ya implementado. Con spin, el solver debe incluir Magnus. |
| 11 | ¿La regla de "colocado" se extiende a **todos** los tipos de golpe (topspin, smash), no solo a cruzar? (§4.6) | Sí: arriba/abajo también mueve la raqueta en profundidad y tendría el mismo problema de "apuntar sin querer". Validar en V0.2. |
| 12 | ¿La calibración de latencia es **obligatoria** la primera vez? | Sugerida, no obligatoria: se ofrece en el lobby y el panel D enseña la tendencia a pronto o tarde. |

**Resueltas en V0.1:**

| # | Pregunta | Respuesta |
|---|---|---|
| 8 | ¿Cuál es el valor final de `gameSpeed`? | **0.75** ✅ (autor, playtest 2). |
| — | ¿Cómo se apunta la bola? | El gesto lateral apunta solo estando colocado ✅ (autor, playtest 1); el riesgo está en el ángulo ✅ (§4.5). |
| — | ¿Hace falta calibrar la latencia y dónde? | Sí, en el lobby de selección de sala ✅ (autor, playtest 2). |

---

# 25. Registro de cambios v2 → v3

El registro v1 → v2 está en la v2 (`docs/archive/ping_pong_pvp_gameplay_design_v2.md`, §25).

| Área | v2 | v3 | Motivo | Origen |
|---|---|---|---|---|
| Leyenda | ✅ 🟡 ❓ | + ⚠️ (cambio sobre una decisión ✅ pendiente de aprobación) | Distinguir lo implementado sin aprobar | Análisis V0.1 |
| Pilares | Red | + **Precisión exigente y riesgo legible** ✅ | Preferencia del autor | Playtest 1 |
| Zona de golpe (§4.1) | ≈ 1.6 × radio, en distancia | \|Δt\| ≤ 120 ms y posición < 100 % del radio | Una zona en distancia anula EARLY/LATE y contradice medir en ms | P1 |
| Radio de la raqueta (§4.1, §7.2) | Cara ≈ 15 cm | Radio de **juego** 14 cm, distinto del de reglamento | PERFECT exigiría 1.5 cm de precisión | P2, validado en playtest 1 |
| Instante del contacto (§4.2) | No definido | Calidad en el click; contacto en `max(t_click, t_ideal)`; raqueta fija entre ambos | Golpe coherente y evento de red definido | P4 |
| Nivel "EARLY/LATE" (§4.2) | Fila que mezclaba timing y posición | Nivel **débil** con causas pronto, tarde y borde | Claridad del feedback | P12 |
| Efectos de la calidad (§4.3) | Cualitativos | Curva continua en Δt; bola baja reduce el margen; ⚠️ EARLY más corto (nunca más rápido que PERFECT) | Cada error proporcional y legible; pronto quedaba premiado | P5 (⚠️), análisis |
| Riesgo de red (§4.3) | Sin valor | El margen cruza cero hacia −85 ms | En el playtest 1 casi nunca había red; en el 2, "lo justo" | Playtests 1 y 2 |
| **Dirección** (§4.5, nueva) | No definida | Gesto lateral seco, **solo estando colocado** ✅; riesgo en el ángulo ✅ | Se apuntaba sin querer al perseguir la bola | Autor, playtests 1 y 2 |
| Tipo de golpe (§4.6) | Gesto antes del click | + regla de "colocado" para todos los golpes; slice = cruce por encima de un umbral; smash relativo a la red | Mismo problema que la puntería en el eje de profundidad | Propuesta para V0.2 |
| **Calibración de latencia** (§3.7, nueva) | No existía | Mediana de 12 bolas, límite [−50, +100] ms, por navegador, en el lobby de sala ✅ | La latencia de pantalla supera la ventana PERFECT | P7, aprobada en playtest 2 |
| `InputIntent` (§3.1) | Boceto sin unidades | Unidades fijadas; `fire` ya corregido con el desfase | Sin unidades, cada traductor interpretaría distinto | P8 |
| Raqueta (§3.2) | Sin valores | 6 m/s, 60 m/s²; profundidad mínima 0.75 m; tiempo real | Se sentía lenta; voleas accidentales | Playtest 1, P18 |
| `gameSpeed` (§7.3) | 0.6–0.75, abierto | **0.75** ✅; solo afecta a la bola | Elección del autor | Playtest 2, P10 |
| Resolución del golpe (§7.5, nueva) | Implícita | ⚠️ Objetivos + solver + física; con spin, solver con Magnus | Red predecible y explicable | P6 (⚠️) |
| Saque normal (§9.1) | Lanzamiento + click | Altura de contacto 30 cm, lanzamiento 2.4 m/s, solo bola bajando, dentro del ancho de la mesa, saque no golpeado = punto del receptor, saque tardío alto | Saques tardíos a la red y saques fuera desde el lateral | P9, regresiones de V0.1 |
| Legibilidad (§2.2) | Sombra, spin, bote, "¿por qué fallé?" | + raqueta propia translúcida con anillos; causas ampliadas (ángulo, bola baja) | La raqueta tapaba la bola | P11 |
| HUD (§15) | Sin herramientas | + panel de precisión (tecla D) | Medir el sesgo pronto/tarde y la causa de no PERFECT | Playtest 1 |
| Pasivos (§12.3) | ±5 ms | ±20 % de la ventana | 5 ms queda por debajo del jitter | P16 |
| Netcode (§17.2–17.3) | Eventos de golpe | + contacto diferido, reloj común, desfase validado, historial en el estado rebobinable | Requisitos descubiertos en V0.1 | P14 |
| Determinismo (§17.6, nueva) | Implícito | Operaciones permitidas, PRNG con semilla, iteraciones fijas, hash de config | Requisito para V0.3 | P15 |
| Bot (§17.5) | 3 dificultades, ejemplo 30/50 | Tabla de valores; también como banco de pruebas sin navegador | Medido en V0.1 | Análisis |
| Assets (§18) | Manifiesto con rutas fijas | Archivos en `client/src/assets/`, descubiertos al compilar; sonidos sintetizados si faltan | Implementación de V0.1 | — |
| Roadmap (§21) | V0.1–V0.8 | V0.1 cerrada; reglas de rally y saque adelantadas; criterios medibles; calibración en el lobby de V0.4 | Estado real | P13, P19 |
| Modos de match (§10.3) | Sin duraciones | Duraciones estimadas | Dato para ❓7 | Análisis |
| Preguntas abiertas (§24) | 1–8 | 8 resuelta; nuevas 9–12 | — | — |
