# V0.2b — Golpes con teclas y PERFECT premiado

## Contexto
- Lee antes de empezar:
  - `ping_pong_pvp_gameplay_design_v3.md`: §3.1, §3.3, §4.5–§4.7 y §8.
  - `docs/analisis_v0.2.md`: §3, §5.3 y §6.
  - `README.md`.
- V0.2 está en `master` (último commit `59bbc35`), sin etiqueta `v0.2.0`.
- **Problema del playtest del autor (2026-10-02):** no consiguió ningún topspin, slice ni smash con gestos del ratón. Hoy el gesto debe cumplir tres cosas a la vez, además de acertar el timing:
  - hacerse **antes** del click, en los 150 ms previos (el movimiento posterior no cuenta);
  - ser rápido (≥ 1.2 alturas de pantalla/s; el slice, ≥ 2.5);
  - llegar con la raqueta quieta entre 270 y 150 ms antes del click.
- El E2E de V0.2 pasó porque despachaba gestos sintéticos perfectos. Eso prueba el código, no que una persona pueda hacerlo.

## Decisiones del autor
Cambian §3.3 ✅ y §4.6–§4.7: regístralas como decisión del autor.
1. **El tipo de golpe se elige con teclas mantenidas en el momento del click:**
   - **W** = topspin, **S** = slice, **E** = smash;
   - click sin tecla = golpe normal;
   - **Espacio** = bloqueo (sin cambios);
   - el ratón solo mueve la raqueta y hace click.
2. **Se premia el PERFECT:** la potencia y el spin salen de la **calidad del golpe**, no de la velocidad del gesto.
   - PERFECT = golpe completo;
   - GOOD = reducido;
   - débil = flojo y más arriesgado.
   - Propón y justifica los valores (🟡). Mantén que ningún error de timing dé más velocidad que un PERFECT.
3. **Se mantienen los riesgos legibles:**
   - smash con la bola baja → red;
   - topspin desde una bola muy baja → red;
   - slice pronto → fuera por la banda;
   - golpe fuerte y tarde → larga.
4. **Regla de «colocado»** (por defecto, editable): ya no decide el tipo, porque las teclas son deliberadas. Llegar persiguiendo la bola reduce la potencia a la mitad.
5. **Cruce** (por defecto, editable): se mantiene el gesto lateral de V0.1, que el autor aprobó. **Pregúntame al empezar si también me cuesta.** La alternativa son A/D mantenidas, pero entonces el panel de precisión tendría que pasar de `D` a otra tecla.
6. **Dirección de la curva del slice:** hacia el lado al que cruzas; sin cruce, hacia fuera desde el lado donde golpeas.
7. **Sin golpe dominante:** comprueba con el partido entre bots que un bot que siempre da topspin no gana con claridad a uno que mezcla golpes. Si gana, reequilibra y explícalo.
8. **Teclas siempre visibles y feedback del golpe** (solo para el jugador local):
   - Una barra pequeña con las teclas (W Topspin · S Slice · E Smash · Espacio Bloqueo), siempre visible, en una esquina inferior. Sin tapar la mesa ni la bola (§5.2: nunca en el centro).
   - Mientras mantienes una tecla, se ilumina en la barra **y** tu raqueta toma el color del golpe (los mismos del trail: naranja topspin, magenta slice, blanco smash, cian bloqueo). Al golpear se mira la raqueta, no la esquina.
   - Tras el golpe, el mensaje junto a la raqueta dice qué salió y con qué fuerza (por ejemplo, «¡Perfecto! · TOPSPIN completo» o «Bien · TOPSPIN reducido»). Si salió algo distinto de lo que pediste, dice por qué: bola baja para el smash, persiguiendo, o la tecla no estaba pulsada al hacer click.
   - El rival no debe ver estas señales antes del golpe (§13 ✅: el golpe se lee, pero no con certeza). Anótalo como requisito para el multijugador (V0.3–V0.4).
   - Accesibilidad (§19): el color va siempre con texto o icono.

## Requisitos técnicos
- **Arquitectura:**
  - Usa `InputIntent.modifiers`, que ya existe (§3.1), ampliado a `{ topspin, slice, smash }`.
  - La lógica va en `shared/` (sin DOM, determinista, 120 Hz); el cliente solo traduce teclas.
  - Los valores nuevos van en `shared/src/config.ts`.
- **Tests:**
  - Los 164 de `shared/` deben seguir en verde. Si cambias uno a propósito, explica por qué.
  - Añade tests de:
    - teclas → tipo de golpe;
    - potencia por calidad (PERFECT > GOOD > débil) y que ningún error de timing salga más rápido que PERFECT;
    - «persiguiendo» reduce la potencia;
    - smash bajo → red;
    - determinismo.
- **Bot:** mismo modelo, con modificadores en lugar de gestos.
- **Ajuste:** con `node shared/scripts/shot-stats.ts medium medium 30 7`.
  - Normal contra Normal: ≥ 6 golpes por punto.
  - Puntos perdidos con causa nombrada: ≥ 95 %.
  - Reparto razonable entre red, fuera y no devuelta.
- **Verificación con entrada humana:**
  - Playwright con **teclado real** (`page.keyboard.down/up`) y **clicks reales** (`page.mouse`).
  - **Sin** gestos sintéticos dentro de la página.
  - Con un error de timing aleatorio de ±30 ms, para comprobar que los golpes salen con precisión humana.
  - Los E2E de V0.1 y `client/e2e/shots-check.js` deben seguir pasando o actualizarse.
  - Capturas en `docs/screenshots/v0.2b/`.
- **Cuidado:**
  - No borres nada que contenga enlaces a `node_modules`: los workspaces enlazan `client/` y `shared/`.
  - Al terminar, cierra los procesos `node vite.js` que queden escuchando.
- **Commits:** pequeños por hito en `master`. No etiquetes.

## Entrega
- Añade a `docs/analisis_v0.2.md` una sección «V0.2b» con:
  - qué cambió y por qué;
  - los valores elegidos;
  - las decisiones del autor;
  - las propuestas de cambio al documento de diseño, **sin modificarlo**.
- Actualiza el README (controles) y las instrucciones del menú.
- Dame:
  - cómo arrancar;
  - una checklist de playtest de 5–8 puntos con la URL completa, qué hacer y qué mirar exactamente.
