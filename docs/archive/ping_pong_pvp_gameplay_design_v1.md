# 🏓 Ping Pong PvP — Diseño de Gameplay

## 1. Visión

Juego PvP de ping pong para navegador que combina:

- Ping pong real como base.
- Acción rápida en tiempo real.
- Precisión mecánica.
- Lectura del rival.
- Habilidades especiales ligeras.
- Sistema de Momentum.
- Personajes con estilos diferentes.

> **La habilidad importa, pero también leer al rival.**

Las habilidades deben modificar la forma de jugar el rally sin convertir el juego en un fighting game con una mesa.

---

# 2. Perspectiva y controles

El jugador está en el lado inferior de la mesa mirando hacia el rival.

### Controles

| Acción | Control |
|---|---|
| Mover raqueta | Mouse |
| Golpear | Click izquierdo |
| Especial | Q |
| Defensa / Parry | Space |
| Listo / Saque especial | Shift |

La posición y movimiento de la raqueta son importantes. El click no debe ser simplemente "disparar la bola".

El juego debe capturar el estado de la raqueta en el momento del impacto:

- Posición X/Y.
- Dirección de movimiento.
- Velocidad de movimiento.
- Momento exacto del click.

---

# 3. La red: factor determinante del punto

## Principio

La red debe ser una parte real de la física y una de las principales consecuencias de golpear mal.

Un jugador puede perder un punto porque:

- Golpeó demasiado pronto.
- Golpeó demasiado tarde.
- Aplicó demasiado ángulo.
- Generó demasiado efecto.
- Intentó demasiada potencia.
- Golpeó desde una posición desfavorable.
- Intentó un smash cuando la bola no estaba en una posición adecuada.

La red no debe sentirse aleatoria.

> **Si la bola choca con la red, el jugador debe poder entender por qué ocurrió.**

---

# 4. Modelo conceptual del golpe

Cada golpe genera una trayectoria que depende de:

```text
posición de impacto
       +
velocidad de la raqueta
       +
dirección de la raqueta
       +
tipo de golpe
       +
spin
       +
potencia
       ↓
TRAYECTORIA
       ↓
¿Pasa sobre la red?
       ↓
Sí → continúa el rally
No → red → punto para el rival
```

---

# 5. Ventana de golpe

El timing del click modifica el resultado.

### EARLY

Golpeas demasiado pronto.

Posibles consecuencias:

- Ángulo demasiado cerrado.
- Trayectoria demasiado baja.
- Mayor probabilidad de red.

### GOOD

Golpe normal y estable.

### PERFECT

Golpeas en la ventana ideal.

Beneficios:

- Mejor control.
- Mayor velocidad potencial.
- Mayor precisión.
- Más Momentum.

### LATE

Golpeas demasiado tarde.

Posibles consecuencias:

- Bola más elevada.
- Menor velocidad.
- Mayor facilidad para que el rival ataque.

---

# 6. Altura de la trayectoria y clearance sobre la red

La trayectoria no debería comprobar únicamente si la bola "cruza" la red.

Debe existir un margen de seguridad:

```text
             ●
            /
           /
----------/----------------  ← trayectoria
         /|
        / | clearance
-------/--|----------------  ← RED
```

Podemos pensar en tres zonas:

### 🔴 Danger Zone

La trayectoria pasa demasiado cerca de la red.

```text
             ●
            /
           /
----------●----------------
         RED
```

Pequeñas variaciones de spin, timing o posición pueden provocar un choque.

### 🟡 Safe Zone

La bola pasa por encima de la red con margen razonable.

### 🟢 Ideal

Trayectoria suficientemente segura y con buena profundidad.

Esto crea una decisión:

> ¿Intento un golpe muy agresivo cerca de la red o juego seguro?

---

# 7. Golpes y riesgo de red

## Golpe normal

El golpe básico busca una trayectoria relativamente estable.

- Bajo riesgo.
- Buena consistencia.
- Menor recompensa.

---

## Topspin

El movimiento de la raqueta hacia adelante/arriba genera topspin.

Conceptualmente:

```text
        ●
       /
      /
     /
    ╰────
       RED
```

El topspin permite:

- Golpear más fuerte.
- Mantener la bola relativamente baja.
- Hacer que la bola caiga antes.

Pero requiere suficiente velocidad y buen timing.

### Riesgo

Si se intenta generar demasiado topspin desde una posición mala:

**la trayectoria puede quedar demasiado baja → red.**

---

# 8. Slice

El slice modifica principalmente el comportamiento lateral y la velocidad de la bola.

Puede ser útil para:

- Cambiar el ritmo.
- Buscar ángulos.
- Sacar al rival de posición.

Pero un slice demasiado agresivo puede producir:

- Ángulo lateral excesivo.
- Trayectoria con poco margen.
- Mayor riesgo de tocar la red si el impacto es malo.

---

# 9. Smash

El smash debe ser una recompensa, no un botón de "ganar".

Solo debería ser realmente efectivo cuando la bola está en una posición favorable.

Ejemplo:

```text
                 ●
                 ↓
              buena altura

                 🏓
```

Si el jugador intenta smash cuando la bola viene demasiado baja:

```text
        ●
        ↓
        🏓
        ↓
-------RED----------------
```

El golpe puede resultar en una trayectoria demasiado baja y:

**RED → punto para el rival.**

Esto crea una decisión importante:

> "¿Tengo una oportunidad real de hacer smash o estoy forzando el golpe?"

---

# 10. Potencia vs seguridad

El jugador puede arriesgar más potencia.

Conceptualmente:

```text
POTENCIA

Seguro
●───────────────

Agresivo
●──────────────────────

Máximo
●──────────────────────────── ⚠
```

A mayor potencia:

- Mayor velocidad.
- Menor margen de error.
- Mayor sensibilidad al timing.
- Mayor riesgo de red o salida de mesa.

Esto evita que el golpe más fuerte sea siempre la mejor opción.

---

# 11. Error de altura

El juego debería diferenciar entre:

### Golpe demasiado bajo

→ red.

### Golpe demasiado alto

→ puede ser devuelto fácilmente o, si supera los límites de la mesa, convertirse en un error.

### Golpe bien ajustado

→ trayectoria óptima.

Esto hace que el jugador aprenda intuitivamente a controlar la altura.

---

# 12. La red también puede interactuar con el saque

El saque especial debe respetar la red.

Un saque demasiado agresivo puede:

- Chocar con la red.
- Ser demasiado alto.
- Salirse de la mesa.

Esto permite que los saques tengan riesgo real.

Ejemplo:

```text
POWER ████████████░

        ●
       /
      /
-----/----------------
    RED
```

Una carga excesiva puede resultar en:

**NET SERVE / FAULT**

---

# 13. Saque especial

El saque especial usa Shift.

El jugador puede ajustar:

- Potencia.
- Dirección.
- Spin.

Y soltar Shift para ejecutar.

Cada personaje puede tener una variante.

### Power — Cannon Serve

Saque extremadamente rápido.

Riesgo:

- Mayor dificultad para controlar altura.
- Mayor posibilidad de red si se ejecuta mal.

### Trickster — Ghost Serve

Saque con comportamiento engañoso después del bote.

### Defender — Precision Serve

Mayor control y margen de error.

### Speed — Dash Serve

Saque rápido con aceleración.

### Control — Curve Serve

Mayor efecto lateral.

---

# 14. Perfect Hit

Existe una pequeña ventana temporal alrededor del impacto.

```text
EARLY     GOOD       PERFECT       LATE
  🔵        🟢          🟢🟢          🔴
   |---------|-----------|------------|
```

Perfect Hit:

- Mejor control.
- Mayor potencial de velocidad.
- Menor dispersión.
- Más Momentum.

Un Perfect Hit no debe eliminar completamente el riesgo de la red.

La física sigue mandando.

---

# 15. Momentum

El jugador obtiene Momentum por jugar bien.

Ejemplos:

- Perfect Hit.
- Devoluciones difíciles.
- Rally largo.
- Smash correctamente ejecutado.
- Devolver un golpe con mucho spin.

```text
MOMENTUM
████████████░░░ 80%
```

Al llegar al máximo:

**SPECIAL READY**

Esto recompensa habilidad en lugar de depender exclusivamente de cooldowns.

---

# 16. Especiales

Cada personaje tiene:

- 1 saque especial.
- 1 habilidad especial durante el rally.

Las habilidades deben modificar el gameplay, no saltarse la física.

Ejemplos:

### Overdrive

Durante unos segundos:

- Raqueta más rápida.
- Mayor velocidad de golpe.

### Spin Break

El siguiente golpe aplica un efecto fuerte.

### Precision

Aumenta temporalmente la ventana de Perfect Hit.

### Wall

Mejora la capacidad defensiva.

### Dash

Permite un pequeño desplazamiento instantáneo de la raqueta.

---

# 17. Parry / defensa

Space puede utilizarse para una defensa de precisión.

Si la bola viene muy rápido:

```text
      ●
      ↓
    ✨🏓✨
      ↑
```

Si el timing es correcto:

**PERFECT BLOCK**

La devolución puede:

- Reducir la velocidad recibida.
- Devolver con spin.
- Generar Momentum.

Si se usa mal:

- El jugador puede quedar mal posicionado.
- No debería ser un botón de defensa automática.

---

# 18. Lectura del rival

La animación de la raqueta puede dar pequeñas pistas sobre:

- Dirección.
- Tipo de golpe.
- Potencia.
- Posible smash.

El rival debe poder leer el golpe, pero no con certeza absoluta.

Esto crea:

> habilidad mecánica + mind games.

---

# 19. Warm-up

Cuando ambos jugadores entran a la sala:

```text
PLAYER 1                 PLAYER 2

     🏓                     🏓

              WARM UP

        [ HOLD SHIFT ]
```

Durante warm-up:

- Pueden bolear.
- No existen poderes.
- Pueden probar el movimiento.
- La bola puede reiniciarse si alguien falla.

El objetivo es que puedan practicar antes de comenzar.

---

# 20. Ready

Ambos mantienen Shift.

```text
PLAYER 1 ✓             PLAYER 2 ✓

              3
              2
              1
             GO!
```

Entonces comienza el partido.

---

# 21. Reglas

Se conservan las reglas básicas del ping pong.

- 11 puntos por game.
- Se necesita diferencia de 2.
- 10-10 continúa hasta que exista diferencia de 2.
- Match al mejor de 5 games.
- El primero en ganar 3 games gana el match.

El marcador es la "vida" del juego.

No hace falta HP.

---

# 22. Momentos de tensión

Ejemplo:

```text
             GAME 5

PLAYER 1       10
PLAYER 2       10

             DEUCE
```

La presentación puede intensificarse:

- Música.
- Efectos.
- Cámara.
- UI.

Pero las reglas siguen siendo las mismas.

---

# 23. Personajes

Los personajes deben diferenciarse por cómo juegan.

### POWER

- Golpes fuertes.
- Cannon Serve.
- Overdrive.

### TRICKSTER

- Efectos.
- Ghost Serve.
- Spin Break.

### DEFENDER

- Control.
- Precision Serve.
- Wall.

### SPEED

- Movilidad.
- Dash Serve.
- Dash.

### CONTROL

- Consistencia.
- Curve Serve.
- Precision.

Las estadísticas deben mantenerse relativamente contenidas. La identidad debe venir principalmente de las mecánicas.

---

# 24. Flujo completo

```text
LOBBY
  ↓
SELECCIÓN DE PERSONAJE
  ↓
ENTRAR A SALA
  ↓
WARM-UP
  ↓
AMBOS READY
  ↓
3 → 2 → 1 → GO
  ↓
GAME 1
  ↓
GAME 2
  ↓
GAME 3
  ↓
GAME 4 / GAME 5
  ↓
MATCH END
  ↓
RESET
  ↓
WARM-UP
```

Después del match:

```text
score = 0-0
game = 1
ready = false
momentum = reset
special = reset
serve state = reset
```

La sala vuelve al estado inicial.

---

# 25. Arquitectura PvP

La física importante debe ser autoritativa del servidor.

```text
CLIENTE
   │
   │ input
   ▼
SERVIDOR
   │
   ├── Physics
   ├── Collision
   ├── Net Collision
   ├── Score
   ├── Abilities
   ├── Match State
   └── Anti-cheat
   │
   ▼
CLIENTE
   │
   └── Render
```

El cliente comunica intención/input.

El servidor determina el resultado real.

Esto es especialmente importante para:

- Posición de la bola.
- Colisiones.
- Puntos.
- Golpes.
- Habilidades.
- Choques con la red.

---

# 26. MVP recomendado

No implementar todo de golpe.

## V0.1 — Ping Pong puro

- Mesa.
- Red.
- Bola.
- Raquetas.
- Mouse.
- Click.
- Rebotes.
- Colisiones.
- Puntos.

**Objetivo:** que un rally sea divertido.

## V0.2 — Física del golpe

Agregar:

- Ángulo.
- Potencia.
- Spin.
- Altura.
- Velocidad de raqueta.
- Colisión real con la red.

**Objetivo:** que un golpe malo pueda provocar una red de manera predecible.

## V0.3 — Timing

Agregar:

- Early.
- Good.
- Perfect.
- Late.

## V0.4 — Momentum

Agregar:

- Barra de Momentum.
- Perfect Hit genera carga.
- Especial listo.

## V0.5 — Primer personaje

Agregar:

- 1 saque especial.
- 1 especial.

## V0.6 — Multiplayer

- 2 jugadores.
- Sala.
- Warm-up.
- Ready.
- Match state.

## V0.7 — Segundo personaje

Probar si las diferencias realmente cambian la estrategia.

---

# 27. Principio de diseño

La regla más importante:

> **Los poderes nunca deben sustituir al ping pong.**

El jugador debe ganar porque:

1. Se posicionó mejor.
2. Leyó al rival.
3. Golpeó correctamente.
4. Gestionó el riesgo.
5. Usó su especial en el momento adecuado.

No simplemente porque presionó un botón.

---

# 28. Visión final

El objetivo es crear una mezcla de:

**Ping pong real**
+
**arcade competitivo**
+
**fighting game ligero**
+
**mind games**

Todo dentro de una sola mesa.

La interacción fundamental:

```text
MOVER
  ↓
POSICIONARSE
  ↓
LEER
  ↓
GOLPEAR
  ↓
SPIN / POTENCIA / ÁNGULO
  ↓
¿SUPERA LA RED?
  ├── NO → ERROR → PUNTO
  │
  └── SÍ
       ↓
    ¿DÓNDE CAE?
       ↓
    RIVAL REACCIONA
       ↓
      RALLY
```

La red es una parte fundamental del sistema: **cada golpe debe tener que resolver el problema de pasar por encima de ella con suficiente margen**, haciendo que los golpes agresivos sean decisiones de riesgo/recompensa.

> **¡Nos vemos en la mesa! 🏓**
