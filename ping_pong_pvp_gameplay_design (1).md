# 🏓 Ping Pong PvP — Diseño de Gameplay (v2)

> **Versión:** 2.0 — 2026-09-30
> **Versión anterior:** [`docs/archive/ping_pong_pvp_gameplay_design_v1.md`](docs/archive/ping_pong_pvp_gameplay_design_v1.md)
> **Cambios respecto a v1:** ver sección [25. Registro de cambios](#25-registro-de-cambios-v1--v2).

### Leyenda de estado

Cada decisión indica de dónde viene, para saber qué se puede cambiar libremente y qué no.

| Marca | Significado |
|---|---|
| ✅ | **Decidido por el autor.** No cambiar sin consultarlo. |
| 🟡 | **Propuesta base.** Se implementa así para el prototipo, pero se valida en playtest y puede cambiar. |
| ❓ | **Abierto.** Falta decidir; ver [24. Preguntas abiertas](#24-preguntas-abiertas). |

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

---

# 2. Cámara y legibilidad

## 2.1 Perspectiva ✅
Cada jugador se ve a sí mismo en el lado inferior de la mesa, mirando hacia el rival. Cada cliente espeja el mundo, así que los dos jugadores ven la misma perspectiva. 🟡

Cámara en tercera persona, detrás y por encima del jugador, fija (sin seguir a la bola). 🟡

## 2.2 Ayudas de lectura 🟡
Todo el diseño depende de juzgar la **altura** de la bola, y desde una cámara trasera eso es muy difícil. Son obligatorias:

| Ayuda | Descripción | Disponible |
|---|---|---|
| **Sombra de la bola** | Proyectada verticalmente sobre la mesa y el suelo. Es la referencia principal de altura. | Siempre |
| **Spin visible** | Logo o costura en la bola que rota según el spin real, más un trail de color por tipo de efecto (topspin, backspin, lateral). | Siempre |
| **Marcador de bote** | Punto donde va a botar la bola. | Solo en práctica y contra el bot |
| **"¿Por qué fallé?"** | Al perder un punto por error propio, una etiqueta breve con la causa, por ejemplo `TARDE + TOPSPIN EXCESIVO` o `GOLPE CON EL BORDE`. | Siempre (desactivable) |

---

# 3. Input y controles

## 3.1 Modelo común: el "intento de golpe" ✅ (concepto) / 🟡 (detalle)

El juego no lee "el mouse" ni "el dedo". Cada dispositivo se traduce a un **intento** común. La física, el netcode y el servidor solo ven intentos. Añadir un dispositivo es escribir un traductor nuevo, sin tocar el juego.

```ts
// Boceto orientativo
interface InputIntent {
  target: { x: number; z: number }; // dónde quiere estar la raqueta (lateral, profundidad)
  swing:  { vx: number; vy: number }; // velocidad/dirección del gesto en los últimos ~150 ms
  fire?:  number;                     // timestamp del disparo (click / soltar el dedo)
  block:  boolean;                    // bloqueo mantenido
  special?: number;                   // timestamp de activación del especial
  specialServe: boolean;              // saque especial mantenido
  modifiers?: { forceTopspin?: boolean; forceSlice?: boolean };
}
```

## 3.2 Movimiento de la raqueta 🟡
- La raqueta **persigue** al objetivo con **velocidad y aceleración máximas**. No sigue al cursor 1:1.
  - Así el posicionamiento cuesta tiempo y es una habilidad real.
  - Da sentido a "quedar mal posicionado".
  - Permite que la movilidad sea un rasgo de personaje.
- La raqueta se mueve en un **plano horizontal**: lateral (X) y profundidad (Z).
- **La altura de la raqueta es automática**: se ajusta a la altura de la bola dentro de la zona de golpe.

## 3.3 Mouse (principal, V0.1) ✅
| Acción | Control |
|---|---|
| Mover raqueta | Mover el mouse (objetivo en el plano) |
| Tipo de golpe | Gesto del mouse antes del click (ver 4.5) |
| Golpear | Click izquierdo (el disparo) |
| Especial | Q |
| Bloqueo | Space (mantener) |
| Saque especial | Shift (mantener durante el saque) |
| Listo (warm-up) | Shift (mantener) |

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

---

# 4. Modelo del golpe

## 4.1 Disparo por click ✅
**El golpe ocurre al hacer click con la bola cerca de la raqueta.** No se golpea por colisión automática: si no haces click, la bola pasa de largo.

Hay una **zona de golpe** alrededor del sweet spot (centro de la raqueta), de radio ≈ 1.6 × el radio de la raqueta. 🟡

## 4.2 Medición de precisión ✅ (concepto) / 🟡 (valores)
**Se recompensa a quien da exactamente en el punto.** En el instante del click se mide dónde está la bola respecto al sweet spot y esa distancia se separa en dos componentes:

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

- **Timing (ms):** `Δt = t_click − t_ideal`, donde `t_ideal` es el instante en que la bola pasa más cerca del sweet spot. Se calcula exacto porque la trayectoria es determinista. Se mide en **milisegundos**, no en distancia, para que sea igual de justo con bolas lentas y rápidas.
- **Posición (% del radio de la raqueta):** distancia perpendicular entre la bola y el sweet spot en `t_ideal`.
- **Calidad final = la peor de las dos.** Para un PERFECT hay que estar bien colocado **y** hacer click a tiempo.

### Ventanas iniciales 🟡 (para ajustar en playtest)

| Calidad | Timing | Posición |
|---|---|---|
| **PERFECT** | ±25 ms | < 20 % del radio |
| **GOOD** | ±60 ms | < 50 % |
| **EARLY / LATE** | ±120 ms | < 100 % |
| **WHIFF** (fallo) | fuera de lo anterior | fuera de la raqueta |

La escala de timing es simétrica: `EARLY – GOOD – PERFECT – GOOD – LATE`. En v1 aparecía como `EARLY – GOOD – PERFECT – LATE`.

## 4.3 Efecto de cada calidad 🟡

| Calidad | Efecto en la trayectoria |
|---|---|
| **PERFECT** | Mínima dispersión, potencia máxima disponible, mejor control del spin, más Momentum. **No elimina el riesgo de red**: la física sigue mandando. ✅ |
| **GOOD** | Golpe estable, dispersión pequeña. |
| **EARLY** | Ángulo más cerrado, trayectoria **más baja** → más riesgo de red. ✅ |
| **LATE** | Trayectoria **más alta**, menos velocidad → bola fácil para que el rival ataque. ✅ |
| **Golpe con el borde** (posición > 50 %) | La bola sale desviada hacia el lado del impacto. Es **predecible, no aleatorio**: el desvío es proporcional a la distancia al centro. |

## 4.4 Whiff y recuperación 🟡
Hacer click con la bola fuera de la zona de golpe produce un **whiff**: la raqueta hace la animación del swing y queda **~300 ms sin poder golpear**. Sin esto, el mejor truco sería hacer click sin parar.

## 4.5 Tipo de golpe por gesto 🟡
El gesto en los ~150 ms previos al disparo define el tipo de golpe:

| Gesto | Golpe | Características | Riesgo |
|---|---|---|---|
| Quieto o muy lento | **Normal** | Trayectoria estable. | Bajo riesgo, baja recompensa. |
| Hacia arriba (hacia la red) | **Topspin** | Golpear más fuerte manteniendo la bola baja: el Magnus la hace caer antes. | Demasiado topspin desde mala posición → **trayectoria demasiado baja → red**. |
| Lateral | **Slice** | Efecto lateral, cambio de ritmo, busca ángulos. | Ángulo excesivo, poco margen sobre la red. |
| Hacia abajo, con la bola por encima de un umbral de altura | **Smash** | Muy rápido. Es una recompensa, no un botón de "ganar". ✅ | Con la bola baja → trayectoria hacia la red. |
| — (Space mantenido) | **Bloqueo** | Ver sección 8. | — |

## 4.6 Potencia 🟡
La potencia sale de la **velocidad del gesto**, sin botón de carga.

A mayor potencia hay mayor velocidad, menor margen de error, más sensibilidad al timing y más riesgo de red o de bola fuera ✅. Así el golpe más fuerte no es siempre la mejor opción.

> **Eliminado:** el "Power Hit" de mantener el click para cargar (infografía v1, §8). Chocaba con usar el click como disparo de timing.

---

# 5. Feedback de golpe (estilo Paper Mario TTYD) ✅ (concepto) / 🟡 (detalle)

Cada golpe bueno muestra un mensaje pequeño y sutil con un sonido. Las rachas suben de nivel como las acciones encadenadas de *Paper Mario: The Thousand-Year Door*.

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

- La racha **se rompe** con cualquier golpe que no sea PERFECT o al terminar el punto.
- EARLY/LATE no muestra mensaje celebratorio, solo una **etiqueta gris pequeña** ("pronto"/"tarde"). Ayuda a entender los errores sin hacer ruido.

## 5.2 Reglas de sutileza
- El texto aparece **pequeño junto a la raqueta**, sube y se desvanece en ~400 ms. **Nunca en el centro de la pantalla**, porque la bola ya viene de vuelta.
- **Nada de hit-stop real** (congelar la simulación). En PvP desincronizaría a los jugadores. El impacto se transmite solo con efectos: destello, un pequeño temblor de cámara y el sonido.
- **El rival también ve tus mensajes**, más pequeños y en su lado de la mesa. Genera presión y suma a los mind games.

---

# 6. La red y la trayectoria ✅

## 6.1 La red es física real
La red es un colisionador real y una de las principales consecuencias de golpear mal. Un jugador puede perder un punto porque:

- golpeó demasiado pronto o demasiado tarde;
- aplicó demasiado ángulo, efecto o potencia;
- golpeó desde una posición desfavorable o con el borde;
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
- **Net cord en el rally:** si la bola toca la red y pasa al lado del rival, **es válida**. Aporta drama.
- **Toque de red en el saque:** ver 9.3 (let).
- **Bola de canto (edge ball):** si toca el borde superior de la mesa, es válida.

---

# 7. Física 🟡

Física **propia y simple**, sin motor genérico. Un motor genérico no aporta nada aquí y complica el determinismo.

## 7.1 Fuerzas
- Gravedad.
- Resistencia del aire (drag cuadrático).
- **Efecto Magnus** (spin → curva): el topspin hace caer antes la bola, el backspin la sostiene y el lateral la curva.
- Bote en la mesa con restitución vertical y fricción tangencial que **intercambia spin por velocidad**: el topspin acelera tras el bote y el backspin frena.

## 7.2 Medidas de referencia (reglamento real)
| Elemento | Valor |
|---|---|
| Mesa | 2.74 m × 1.525 m, superficie a 0.76 m del suelo |
| Red | 15.25 cm de alto |
| Bola | 40 mm de diámetro, 2.7 g |
| Restitución vertical mesa | ≈ 0.89 |
| Raqueta (cara) | ≈ 15 cm de ancho |

## 7.3 Velocidad del juego
En el ping pong real la bola cruza la mesa en 0.2–0.3 s, demasiado rápido para un mouse. Hay una **escala de tiempo global** (`gameSpeed`, inicial ≈ 0.6–0.75) que ralentiza la simulación sin alterar la forma de las trayectorias. Es un parámetro de tuning clave.

## 7.4 Simulación
- Paso fijo (*fixed timestep*) de **120 Hz**.
- Mismo código de física en cliente y servidor (paquete compartido).
- Entre golpe y golpe la bola es **balística y determinista**: su trayectoria depende solo del estado tras el último golpe.

---

# 8. Bloqueo (Space) 🟡

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
Faltaba en v1.

1. Empieza el estado de saque: el servidor coloca la bola en la mano del jugador que saca.
2. El jugador se posiciona con el mouse. La bola **se lanza automáticamente hacia arriba** al cabo de ~1 s, o al hacer un primer click.
3. Mientras la bola cae, se golpea con **gesto + click**, con la misma medición de timing y posición que un golpe normal.
4. El saque debe **botar primero en tu lado** y luego en el del rival.

## 9.2 Saque especial ✅ (concepto) / 🟡 (coste)
- **Mantener Shift** durante el estado de saque abre el modo de saque especial: se ajustan **dirección, potencia y spin** con el mouse. ✅
- **Soltar Shift** ejecuta el saque. ✅
- Respeta la red: una carga excesiva produce red, bola demasiado alta o bola fuera. ✅
- **Coste:** requiere ≥ 50 % de Momentum y consume 50 %. Así compite con el especial de rally (100 %) y es una decisión real. Si fuera gratis, nadie usaría el saque normal. 🟡
- Cada personaje tiene su variante (sección 12).

## 9.3 Reglas de saque 🟡 (se sigue el reglamento real)
- **Let:** si el saque toca la red y entra, **se repite** sin penalización. En v1 se llamaba "NET SERVE / FAULT"; ahora sigue el reglamento real.
- Si el saque toca la red y no entra, o no bota en tu lado primero → **punto para el rival**.
- **Alternancia:** el saque cambia cada **2 puntos**; desde el **10-10**, cada punto.
- En cada game empieza sacando quien recibió primero en el game anterior.

---

# 10. Reglas del rally y del match

## 10.1 Rally 🟡
- La bola debe **botar una vez** en tu lado antes de que la golpees.
- **Volea** (golpearla antes de que bote en tu lado) → punto para el rival.
- **Doble bote** en tu lado → punto para el rival.
- Bola que no bota en el lado rival (fuera o red) → punto para el rival.

## 10.2 Match ✅
- **11 puntos** por game, con **diferencia de 2** (desde el 10-10 se sigue hasta que haya 2 de diferencia).
- **Mejor de 5 games**: gana quien llega primero a 3.
- **El marcador es la "vida"** del juego. No hay HP.

## 10.3 Modo rápido 🟡
Un match al mejor de 5 dura 15–25 min, mucho para un juego de navegador. Se añade un **modo rápido**: 1 game a 11 con diferencia de 2. Al crear la sala se elige entre:

- **Rápido:** 1 game
- **Estándar:** mejor de 3
- **Completo:** mejor de 5

## 10.4 Momentos de tensión ✅
En un deuce, sobre todo en el último game, la presentación se intensifica (música, efectos, cámara, UI), pero las reglas siguen siendo las mismas.

---

# 11. Momentum

## 11.1 Fuente única ✅ (concepto) / 🟡 (valores)
El especial se carga **solo con Momentum**, sin cooldown. La infografía de v1 decía "Momentum o cooldown"; se elige solo Momentum porque recompensa la habilidad.

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
| **Rasgo pasivo** | +10 % de velocidad máxima de golpe; ventana PERFECT de timing −5 ms | Ventana PERFECT de timing +5 ms; −10 % de velocidad máxima de golpe |
| **Saque especial** | **Cannon Serve:** muy rápido y plano, con poco margen sobre la red. Ejecutarlo mal se castiga con red. | **Precision Serve:** coloca la bola en la zona elegida con margen amplio y dispersión mínima. |
| **Especial (Q)** | **Overdrive:** durante los **3 golpes siguientes**, la raqueta se mueve +30 % más rápido y los golpes tienen +15 % de velocidad. | **Wall:** durante los **3 golpes siguientes**, cualquier **bloqueo** con timing al menos GOOD cuenta como PERFECT y genera el doble de Momentum. |

## 12.4 Backlog de personajes 🟡
| Personaje | Saque especial | Especial | Nota |
|---|---|---|---|
| **TRICKSTER** | **Ghost Serve:** misma animación para un saque sin spin y uno con backspin pesado; la rotación del logo se oculta unos frames. Es un truco real del ping pong. | **Spin Break:** el siguiente golpe aplica un spin muy fuerte. | En v1 "la bola cambia de trayectoria", lo que contradecía "no saltarse la física". Requiere que el spin sea muy legible. |
| **SPEED** | ❓ *(renombrar: chocaba con "Dash")* | **Dash:** desplazamiento instantáneo corto de la raqueta. | Solo tiene sentido gracias a la raqueta con inercia (3.2). |
| **CONTROL** | **Curve Serve:** mucho efecto lateral. | **Precision:** amplía temporalmente la ventana de Perfect Hit. | Se solapa con el pasivo de Defender; revisar. |

---

# 13. Lectura del rival ✅

La animación de la raqueta da pistas sobre dirección, tipo de golpe, potencia y posible smash. El rival debe poder leer el golpe, **pero no con certeza absoluta**.

Esto crea habilidad mecánica + mind games. Los mensajes de racha visibles para el rival (5.2) y el Ghost Serve (12.4) refuerzan esta capa.

---

# 14. Flujo de sala

## 14.1 Flujo ✅ (con añadidos 🟡)
```text
LOBBY
  ↓
CREAR SALA (código privado + modo de match) / UNIRSE CON CÓDIGO   🟡
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
| Marcador | Puntos, game actual, games ganados por cada jugador. Indicador de quién saca. |
| Momentum | Barra por jugador. Aviso **"ESPECIAL LISTO"** al 100 %. Marca visible al 50 % (umbral del saque especial). |
| **Ping de la sala** ✅ | Ver 15.1. |
| Dispositivo | Icono 🖱️/⌨️/📱 junto al nombre de cada jugador. |
| Feedback de golpe | Sección 5. |
| "¿Por qué fallé?" | Sección 2.2. |

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

El sonido del bote es clave para el timing en el ping pong real. Es prioridad alta y tiene un coste bajo.

| Sonido | Uso |
|---|---|
| `bounce_table` | Bote en la mesa. Varía levemente según la velocidad. |
| `hit_normal`, `hit_good`, `hit_perfect` | Golpe según la calidad. |
| `streak_1` … `streak_4` | Notas de la racha (Do, Mi, Sol, Do agudo). Se pueden sintetizar con WebAudio. |
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
| Física | Propia, en el paquete compartido `shared/` |
| Servidor | Node.js + WebSocket. Colyseus como candidato: da salas, estado y reconexión hechos. |
| Estructura | Monorepo: `client/`, `server/`, `shared/` |

## 17.2 Netcode: eventos de golpe
Una bola cruza la mesa en menos de 1 s y la ventana PERFECT dura ±25 ms. Con física 100 % en el servidor y solo el render en el cliente (esquema de v1), cualquier ping normal vuelve el timing injusto. Pero entre golpe y golpe la bola es **balística y determinista**, así que:

1. Ambos clientes simulan la **misma física compartida** localmente.
2. Lo único que viaja por la red es un **evento de golpe**: `{ timestamp, posición de raqueta, swing, tipo }`.
3. El cliente que golpea **evalúa la calidad al instante**, para mostrar el feedback sin espera.
4. El **servidor valida** el evento con compensación de lag: rebobina hasta el timestamp del cliente, con un límite de ~150 ms. Después calcula la trayectoria resultante y la difunde.
5. Los clientes se **resincronizan en cada golpe**. Si el servidor discrepa (raro y por pocos ms), se corrige la trayectoria **sin borrar el mensaje** que ya vio el jugador.

El servidor sigue siendo la **autoridad** sobre: puntos, colisiones con la red y la mesa, reglas, Momentum, habilidades y estado del match.

## 17.3 Validación en servidor
Solo comprobaciones de plausibilidad, que vienen incluidas con el netcode:
- la raqueta pudo llegar a esa posición con su velocidad máxima;
- el timestamp está dentro de la ventana de compensación;
- el jugador tenía el Momentum necesario.

## 17.4 Anti-cheat ✅
**Fuera de alcance por ahora.** No hay detección de patrones (por ejemplo, scripts de click en el frame perfecto). Se acepta como limitación conocida.

## 17.5 Bot 🟡
Hace falta **desde V0.1**: sin bot no se puede probar el feel hasta tener multijugador, y muchos jugadores no tendrán rival disponible.
- Predice el punto de intercepción con la misma física compartida.
- Simula humanidad con **retardo de reacción**, **error de posición** y una **distribución de calidades de golpe** (por ejemplo, 30 % PERFECT y 50 % GOOD en dificultad media).
- Tres dificultades configurables.

---

# 18. Arte y placeholders ✅

- **El autor hace el arte final.** El prototipo usa **placeholders** que el autor sustituirá.
- Placeholders: imágenes de servicios libres (por ejemplo, avatares generados con DiceBear) o círculos de color con la inicial. Se evitan imágenes con licencia dudosa.
- Todos los assets se cargan desde **un único manifiesto** (`client/src/assets/manifest.ts`) con **rutas fijas**. Para sustituir un asset basta con reemplazar el archivo con el mismo nombre; no se toca código.

## 18.1 Lista de assets esperados 🟡
| Ruta | Formato | Tamaño sugerido |
|---|---|---|
| `characters/<id>/portrait.png` | PNG con transparencia | 512 × 512 |
| `characters/<id>/select.png` | PNG con transparencia | 1024 × 1536 |
| `characters/<id>/paddle.png` | PNG (textura de la cara de la raqueta) | 512 × 512 |
| `characters/<id>/color` | Color de acento en el manifiesto (hex) | — |
| `ui/logo.png` | PNG con transparencia | 1024 × 512 |
| `arena/background.jpg` | JPG | 1920 × 1080 |
| `sfx/*.ogg` | OGG (+ fallback MP3) | Ver sección 16 |

`<id>` ∈ { `power`, `defender` } en la fase inicial.

---

# 19. Accesibilidad 🟡
- Los colores de calidad (EARLY/GOOD/PERFECT/LATE) siempre van acompañados de **texto o forma**, no solo color (daltonismo).
- Sensibilidad del mouse y sensibilidad de swing configurables.
- Modificadores W/S para el tipo de golpe (3.4).
- Opción para reducir el temblor de cámara y los destellos.

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

Cambio principal frente a v1: **el bot y el netcode se adelantan**. Son los dos puntos donde un fallo obliga a rehacer el trabajo anterior.

| Fase | Contenido | Pregunta que responde / criterio de aceptación |
|---|---|---|
| **V0.1 — Feel local** | Estructura monorepo (`client/`, `shared/`). Mesa, red, bola y física básica (gravedad, drag, bote, red). Raqueta con inercia, cámara, **sombra de la bola**. Input mouse → `InputIntent`. **Modelo de golpe por click** con medición de timing y posición (4.1–4.4) y whiff. **Feedback TTYD** con mensajes y sonidos (sección 5). **Bot simple.** Marcador de un game a 11 con saque normal simplificado. Manifiesto de assets con placeholders. | ¿Se siente bien controlar con el mouse? Un rally de 6+ golpes contra el bot es controlable, el jugador distingue PERFECT de GOOD sin mirar números y entiende por qué la bola fue a la red. |
| **V0.2 — Golpe completo** | Gesto → tipo de golpe (normal, topspin, slice, smash). Spin con Magnus y bote con spin, **spin visible**. Clearance real sobre la red. Bloqueo (Space). Etiquetas "¿Por qué fallé?". Ajuste de `gameSpeed`. | ¿Un golpe malo a la red se entiende? Los cuatro golpes se distinguen en juego. |
| **V0.3 — Spike de netcode** | `server/` con WebSocket. 2 navegadores, eventos de golpe, compensación de lag, resincronización. **Latencia simulada de 50/100/150 ms.** Ping de la sala en el HUD. | ¿Es jugable online? A 100 ms el timing se siente justo. |
| **V0.4 — Partido PvP** | Salas con código, warm-up, Listo, cuenta atrás. Reglas completas (let, alternancia de saque, volea, doble bote, net cord, canto). Modos de match. Desconexión y reconexión. | Se juega un partido completo PvP sin incidencias. |
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
POSICIONARSE
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
    ¿DÓNDE CAE?
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
| 1 | ¿El jugador puede elegir la **profundidad** (bola corta o larga) además de la dirección? | Que salga de la potencia y el spin, sin control explícito. Validar en V0.2. |
| 2 | ¿Hay **timeout en el warm-up** si alguien nunca da a Listo? | 3 min y luego expulsión de la sala. Pendiente de decidir. |
| 3 | ¿Los personajes iniciales son **POWER + DEFENDER**? | Recomendado; no confirmado por el autor. |
| 4 | ¿El **coste del saque especial** (50 % de Momentum) es el correcto, o se prefiere un uso gratuito por game? | 50 %. Validar en V0.5. |
| 5 | **Nombre del saque especial de SPEED**, que chocaba con "Dash". | Pendiente. |
| 6 | ¿Solapamiento entre el especial *Precision* de CONTROL y el pasivo de DEFENDER? | Revisar al recuperar CONTROL del backlog. |
| 7 | ¿El modo por defecto al crear sala es Rápido, Estándar o Completo? | Estándar (mejor de 3). Pendiente. |
| 8 | ¿Cuál es el valor final de `gameSpeed`? | 0.6–0.75. Se fija en playtest de V0.1–V0.2. |

---

# 25. Registro de cambios v1 → v2

| Área | v1 | v2 | Motivo |
|---|---|---|---|
| Mapeo del mouse | Sin definir (2D → 3D ambiguo; "adelante/arriba" en topspin) | Plano horizontal + altura automática; el gesto define el tipo de golpe | Era la principal ambigüedad del control |
| Movimiento de la raqueta | Implícitamente 1:1 con el cursor | Persecución con inercia y velocidad máxima | Si es 1:1, el posicionamiento y SPEED no tienen sentido |
| Disparo del golpe | Ambiguo (¿click o colisión?) | **Click cerca de la bola** ✅ | Decisión del autor; el mismo modelo sirve en todos los dispositivos |
| Precisión | Solo timing (EARLY/GOOD/PERFECT/LATE) | Timing (ms) + posición en la raqueta; calidad = la peor de las dos | Recompensar dar exactamente en el punto ✅ |
| Escala de timing | EARLY–GOOD–PERFECT–LATE | EARLY–GOOD–PERFECT–GOOD–LATE | La escala no era simétrica |
| Feedback | No definido | Mensajes y sonidos escalonados estilo TTYD con racha ✅ | Decisión del autor |
| Whiff | No definido | Recuperación de ~300 ms | Evitar hacer click sin parar |
| Power Hit (infografía §8) | Mantener el click para cargar | **Eliminado**; la potencia sale de la velocidad del gesto | Chocaba con el click como disparo |
| Parry / Defensa / Perfect Block | Tres conceptos con su propio timing | Un único **Bloqueo** (Space) con trade-offs | Demasiadas ventanas de timing compitiendo |
| Saque normal | No existía | Definido (lanzamiento automático + gesto + click) | Faltaba |
| Coste del saque especial | No definido | 50 % de Momentum | Si era gratis, nadie usaría el saque normal |
| Red en el saque | "NET SERVE / FAULT" | **Let** (se repite), como en el reglamento | Reglamento real |
| Reglas del rally | Solo puntuación | Bote obligatorio, volea, doble bote, net cord, canto, alternancia de saque | Faltaban |
| Carga del especial | "Momentum o cooldown" (infografía) | Solo Momentum, con fuentes y valores | Inconsistencia entre la infografía y el `.md` |
| Bola de nieve del Momentum | No tratada | +3 % al perder un punto; se reduce a la mitad al cambiar de game | Evitar que gane siempre quien ya va ganando |
| Personajes | 5 | **2 iniciales** ✅ (POWER + DEFENDER 🟡) y 3 en backlog | Decisión del autor; el balance de 5 es inviable al principio |
| Wall | "Mejora la defensa" (vago) | Definido sobre el Bloqueo | No se podía implementar |
| Ghost Serve | "La bola cambia de trayectoria" | Engaño con física real (spin oculto) | Contradecía "no saltarse la física" |
| Rasgos de personaje | Stats | Rasgo pasivo mecánico | "La identidad viene de las mecánicas" |
| Duración del match | Solo mejor de 5 | Modos Rápido / Estándar / Completo | 15–25 min es mucho para navegador |
| Input | Solo mouse | Capa `InputIntent`: mouse, trackpad y táctil | Propuesta solicitada por el autor |
| Ping | No tratado | Ping de la sala en el HUD ✅; sin regiones | Decisión del autor |
| Legibilidad | No tratada | Sombra, spin visible, marcador de bote, "¿por qué fallé?" | Sin estas ayudas, la red parecería aleatoria |
| Netcode | Servidor autoritativo con física 100 % en servidor | Eventos de golpe + física compartida + compensación de lag | La latencia rompía el timing |
| Anti-cheat | En la arquitectura | **Fuera de alcance** ✅ | Decisión del autor |
| Arte | Personajes anime | Placeholders con manifiesto y rutas fijas ✅ | El autor hace el arte final |
| Roadmap | Multijugador en V0.6, sin bot | Bot en V0.1, netcode en V0.3 | Riesgo de tener que reescribir el juego |
| Reglas del match (infografía §12) | "Mejor de 9" en un texto | Mejor de 5 (más modos opcionales) | Errata de la infografía |
