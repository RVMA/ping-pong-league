/**
 * Configuración única del juego (V0.3).
 *
 * TODOS los valores ajustables viven aquí: ventanas de timing, gameSpeed, radios,
 * velocidades de la raqueta, curvas de tiro, spin, tipos de golpe, bloqueo, bot, feedback,
 * red (V0.3), Momentum (preparado) y presentación. El cliente puede sobrescribir valores para playtest (parámetros de URL),
 * pero cliente y servidor deben compartir exactamente la misma config en partida.
 *
 * Unidades:
 *  - Distancias en metros, ángulos no se usan.
 *  - "ms" = milisegundos de tiempo REAL (lo que percibe el jugador).
 *  - Velocidades de la bola en m/s de tiempo de SIMULACIÓN (afectadas por gameSpeed).
 *  - Velocidades de la raqueta en m/s de tiempo REAL (no las ralentiza gameSpeed).
 *
 * Referencias al documento de diseño v4 (ping_pong_pvp_gameplay_design_v4.md) entre corchetes: [§7.3].
 */

/** Punto de una curva de tiro indexada por el error de timing (ms). */
export interface ShotCurvePoint {
  /** Δt = t_click − t_ideal en ms (negativo = pronto). */
  dt: number;
  /** Margen deseado de la parte inferior de la bola sobre el borde superior de la red (m). Negativo = red. */
  clearance: number;
  /** Profundidad del bote en campo rival como fracción de media mesa (0 = red, 1 = línea de fondo). */
  depth: number;
}

/** Punto de una curva de golpe "de ritmo" (smash, bloqueo): el margen sale de la velocidad y la geometría. */
export interface PaceCurvePoint {
  dt: number;
  /** Margen extra sobre el que da la geometría (m). Negativo = más bajo. */
  clearance: number;
  /** Profundidad del bote (fracción de media mesa). */
  depth: number;
  /** Factor sobre la velocidad horizontal pedida (≤ 1). */
  pace: number;
}

export interface BotDifficultyConfig {
  label: string;
  /** Retardo desde el golpe del rival hasta que el bot empieza a moverse hacia la intercepción. */
  reactionMs: number;
  /** Distribución de calidades objetivo (suma 1). [§17.5] */
  quality: { perfect: number; good: number; weak: number; whiff: number };
  /** Fracción del recorrido máximo de puntería lateral que usa el bot (0 = siempre al centro). */
  aimSpread: number;
  /** Profundidad preferida (m desde la red) a la que intenta golpear. */
  preferredDepth: number;
  /**
   * Mezcla de golpes (V0.2) [§17.5]. Probabilidades cuando la situación lo permite: smash solo si la bola va a
   * pasar alta (salvo `badSmash`: probabilidad, en cada devolución sin bola alta, de intentarlo igualmente →
   * red); bloqueo contra bolas rápidas o con mucho spin; si no, topspin / slice / normal. V0.2b: el golpe se pide
   * con teclas, como un humano, y la potencia sale de la calidad que saca (`quality`), no de un rango propio.
   */
  shots: { topspin: number; slice: number; smash: number; badSmash: number; block: number };
}

export const DEFAULT_CONFIG = {
  sim: {
    /** Paso fijo de la simulación [§7.4]. */
    tickHz: 120,
    /** Escala de tiempo global de la bola [§7.3] 🟡 0.6–0.75. §24-8: el autor eligió 0.75 en el playtest 2 (2026-10-01). */
    gameSpeed: 0.75,
  },

  /** Medidas de reglamento [§7.2]. Origen: centro de la mesa a nivel del suelo; y arriba; la red en z = 0. */
  world: {
    tableLength: 2.74,
    tableWidth: 1.525,
    tableHeight: 0.76,
    netHeight: 0.1525,
    /** La red sobresale 15.25 cm por cada lateral de la mesa. */
    netOverhang: 0.1525,
  },

  ball: {
    radius: 0.02,
    gravity: 9.81,
    /** Drag cuadrático: a = −k·|v|·v (1/m). Teórico para 40 mm / 2.7 g ≈ 0.14. */
    dragK: 0.12,
    /** Restitución vertical en la mesa [§7.2]. */
    tableRestitution: 0.89,
    /**
     * Agarre de la mesa en el bote [§7.1, V0.2]: fracción del deslizamiento del punto de contacto que el bote
     * elimina (0 = mesa sin fricción, 1 = la bola sale rodando). El impulso de fricción cambia velocidad y spin
     * a la vez (esfera hueca, I = ⅔·m·R²): de cada unidad de deslizamiento eliminado, 2/5 son velocidad.
     * Con 0.2, una bola SIN spin pierde el 8 % de su velocidad horizontal, como en V0.1; con topspin pierde
     * menos o acelera, y con backspin frena más.
     */
    tableGrip: 0.2,
    floorRestitution: 0.55,
    floorFriction: 0.25,
    /** Choque contra la malla de la red: la bola pierde casi toda la velocidad. */
    netFaceRestitution: 0.12,
    netFaceDamping: 0.5,
    /** Choque contra la cinta superior (net cord). */
    netCordRestitution: 0.35,
    netCordFriction: 0.35,
  },

  /**
   * Spin [§7.1, V0.2]. El spin se guarda en el mundo (rad/s de tiempo de SIMULACIÓN, como la velocidad).
   * Convención relativa a la dirección de vuelo: topspin > 0 = la parte de arriba de la bola avanza (cae
   * antes); topspin < 0 = backspin (sostiene); lateral > 0 = curva hacia la derecha de quien golpea.
   */
  spin: {
    /**
     * Efecto Magnus: a = magnusK · (ω × v). Con 400 rad/s de topspin a 7 m/s empuja hacia abajo ≈ 10 m/s²,
     * como una gravedad doble: el topspin permite pegar más fuerte manteniendo la bola baja.
     * Orden de magnitud real para 40 mm y 2.7 g: C·ρ·A·r/(2m) ≈ 0.003–0.004.
     */
    magnusK: 0.0035,
    /** Pérdida de spin en el aire: fracción por segundo de simulación. */
    airDecay: 0.1,
    /** Choque con la malla: fracción del spin que se conserva. */
    netSpinKeep: 0.5,
    /** Choque con el suelo: fracción del spin que se conserva. */
    floorSpinKeep: 0.5,
  },

  paddle: {
    /**
     * Radio de JUEGO de la cara de la raqueta (m). El documento indica ≈ 15 cm de ancho (r = 7.5 cm);
     * se amplía para que la medición de posición (% del radio) sea alcanzable con mouse y cámara trasera.
     */
    radius: 0.14,
    /** Persecución del objetivo con inercia [§3.2]. m/s y m/s² de tiempo real. */
    /** Playtest 1 (2026-10-01): 4.2 m/s y 30 m/s² se sentían lentos. */
    maxSpeed: 6.0,
    maxAccel: 60,
    /** Límites del plano de movimiento (coordenadas del jugador: x lateral, z profundidad desde la red). */
    maxLateral: 1.3,
    minDepth: 0.75,
    maxDepth: 2.7,
    /** Durante el saque, quien saca debe estar detrás de la línea de fondo. */
    serveMinDepth: 1.45,
    /** Saque simplificado: quien saca no se sale del ancho de la mesa (si no, el primer bote caería fuera). */
    serveMaxLateral: 0.7,
    /** Alcance vertical automático, relativo a la superficie de la mesa (m) [§3.2]. */
    minReachHeight: 0.0,
    maxReachHeight: 0.85,
    /** Altura de reposo visual cuando no viene bola. */
    restHeight: 0.18,
  },

  /** Medición de precisión [§4.2] 🟡. */
  hit: {
    perfectMs: 25,
    goodMs: 60,
    weakMs: 120,
    /** Fracción del radio de la raqueta. */
    perfectPos: 0.2,
    goodPos: 0.5,
    weakPos: 1.0,
    /** Ventana (± ms) en la que se busca el paso más cercano de la bola alrededor del click. */
    searchWindowMs: 400,
    /** Recuperación tras un whiff [§4.4]. */
    whiffLockoutMs: 300,
    /** Duración de la animación de swing (solo presentación, pero compartida con el bot). */
    swingMs: 160,
  },

  /** Del resultado del golpe a la trayectoria [§4.3]. */
  shot: {
    /**
     * Curva Δt → (margen sobre la red, profundidad). Interpolación lineal.
     * EARLY: trayectoria más baja y corta → riesgo de red. LATE: más alta y lenta → bola fácil.
     * La profundidad de EARLY baja deprisa para que pronto NO sea más rápido que PERFECT
     * (con el mismo bote, menos margen = trayectoria más plana = más velocidad).
     * Playtest 1: casi nunca había red al golpear pronto. Ahora el margen cruza cero hacia −85 ms:
     * de −60 a −80 ms la bola pasa baja y desde ~−85 ms va a la cinta o a la red.
     */
    timingCurve: [
      { dt: -120, clearance: -0.07, depth: 0.3 },
      { dt: -90, clearance: -0.01, depth: 0.42 },
      { dt: -60, clearance: 0.05, depth: 0.58 },
      { dt: -25, clearance: 0.115, depth: 0.82 },
      { dt: 0, clearance: 0.11, depth: 0.88 },
      { dt: 25, clearance: 0.14, depth: 0.82 },
      { dt: 60, clearance: 0.3, depth: 0.74 },
      { dt: 120, clearance: 0.55, depth: 0.68 },
    ] as ShotCurvePoint[],
    /** Golpear la bola muy baja reduce el margen sobre la red ("posición desfavorable" §6.1). */
    lowContactRefHeight: 0.12,
    lowContactPenaltyPerM: 0.6,
    /** Puntería lateral: fracción de la x de contacto que se conserva (0 = siempre al centro). */
    aimBaseFromContact: 0.45,
    /**
     * Metros de desplazamiento lateral del objetivo por unidad de velocidad de gesto (alturas de pantalla/s).
     * Con la inercia de la raqueta, un gesto seco y rápido (≈ 30 px en 25 ms) apunta mucho y apenas mueve
     * la raqueta (≈ 2 cm); un movimiento lento recoloca sin apuntar (por debajo de la zona muerta).
     */
    aimSwingGain: 0.5,
    aimSwingDeadZone: 0.5,
    /**
     * Puntería solo si estás colocado (decisión del autor, 2026-10-01): se mira la velocidad máxima
     * de la raqueta en [click − aimSettleFromMs, click − aimSettleToMs], antes de la ventana del gesto.
     * ≤ aimSettledSpeed → puntería completa; ≥ aimChasingSpeed → la bola sale recta; en medio, proporcional.
     */
    aimSettleFromMs: 270,
    aimSettleToMs: 150,
    aimSettledSpeed: 0.6,
    aimChasingSpeed: 1.6,
    /**
     * El riesgo de cruzar está en el ÁNGULO, no en la posición (playtest 2): si estabas colocado, el gesto no
     * te mueve la raqueta para medir la posición. A cambio, con la parte del objetivo que viene del gesto:
     *  - pronto → te pasas de ángulo: × (1 + aimEarlyWiden · e), e = 0..1 entre la ventana PERFECT y la de WEAK;
     *  - tarde  → no llegas a cruzar:  × (1 − aimLateNarrow · l);
     *  - un cruce a tope deja aimClearancePenalty m menos de margen sobre la red (§4.5 slice: «poco margen»).
     */
    aimEarlyWiden: 0.6,
    aimLateNarrow: 0.7,
    aimClearancePenalty: 0.02,
    /** Margen interior respecto a la banda lateral para la puntería "limpia". */
    aimEdgeMargin: 0.1,
    /**
     * Golpe con el borde [§4.3]: desvío lateral determinista hacia el lado del impacto.
     * desvío = small·min(pos, 0.5) + edge·max(0, pos − 0.5)   (pos en fracción del radio)
     */
    edgeDeviationSmall: 0.12,
    edgeDeviationEdge: 0.9,
  },

  /**
   * Tipos de golpe [§4.6, §4.7] — V0.2b (decisión del autor, 2026-10-02): el tipo se elige con TECLAS mantenidas en
   * el instante del click (Q slice, W topspin, E smash; sin tecla, normal; Space, bloqueo) y la potencia sale de la
   * CALIDAD del golpe, no de la velocidad de un gesto (se premia el PERFECT). El ratón solo mueve, hace click y cruza
   * la bola (gesto lateral de V0.1, §4.5 ✅). Lógica en stroke.ts y shot.ts.
   *
   * Potencia (0..1) = powerByTier[calidad] × (chasingPower + (1 − chasingPower) · factor de «colocado»):
   *  - PERFECT = golpe completo (1); GOOD = reducido (0.5); débil = flojo (0.15). Así el PERFECT es la única manera
   *    de sacar todo el golpe y ningún error de timing da más velocidad que un PERFECT (P5).
   *  - Llegar persiguiendo la bola ya no anula el tipo (las teclas son deliberadas): reduce la potencia a la mitad.
   * Qué hace la potencia [§4.7 ✅]: más spin, más velocidad (techo de ritmo del topspin, ritmo del smash), el bote algo
   * más al fondo (+powerDepth) y más bajo sobre la red (−powerClearance).
   * Riesgo de los golpes de ataque (topspin, slice, smash), que NO depende de la potencia: las desviaciones de la
   * curva de timing crecen ×(1 + timingGain) de cada tipo (en pronto también la profundidad y el ángulo). Un golpe
   * de ataque débil sale flojo y además más arriesgado que un golpe normal con el mismo error.
   */
  shotTypes: {
    powerByTier: { PERFECT: 1, GOOD: 0.5, WEAK: 0.15 } as Record<'PERFECT' | 'GOOD' | 'WEAK', number>,
    chasingPower: 0.5,
    /** Etiqueta del golpe junto a la raqueta: «completo» desde full, «reducido» desde reduced, si no «flojo». */
    powerLevels: { full: 0.95, reduced: 0.3 },
    powerDepth: 0.06,
    powerClearance: 0.03,
    /**
     * Topspin: spin de spinMin (potencia 0) a spinMax (completo), rad/s de simulación. Con el Magnus el solver lo
     * convierte en un golpe más rápido con el mismo margen. Riesgos [§4.6]: apunta algo más bajo (−clearanceDrop·p),
     * desde una bola baja la penalización de "posición desfavorable" se multiplica (×(1 + lowContactGain)) y
     * «golpe fuerte y tarde → larga»: tarde, el bote se alarga lateLong·l (l = 0..1 entre la ventana PERFECT y la
     * débil): un topspin GOOD algo tarde todavía entra; uno claramente tarde (≳ +75 ms) se va largo.
     */
    topspin: { timingGain: 0.8, spinMin: 100, spinMax: 340, clearanceDrop: 0.02, lowContactGain: 1.5, paceCap: 10, paceCapPower: 1.2, lateLong: 0.5 },
    /**
     * Slice: corte con efecto lateral (curva) y algo de backspin, con MÁS ÁNGULO: va siempre a la banda, a `target` m
     * del centro (14 cm dentro de la línea) hacia el lado de la curva, desde donde golpees. Dirección de la curva
     * (decisión del autor): hacia el lado al que cruzas; sin cruce, hacia fuera desde el lado donde golpeas. Es un
     * golpe de corte, no de potencia: su margen sobre la red es tan sensible al timing como el de un golpe normal
     * (timingGain 0), pero su riesgo es el ÁNGULO: pronto, el ángulo se abre ×(1 + earlyWiden·e) (más que un cruce,
     * shot.aimEarlyWiden) y sale por la banda: desde el centro hacia −50 ms, cruzado hacia −45, desde un lado hacia
     * fuera hacia −60; la red solo llega antes, hacia −72 ms. Además pasa con poco margen (−clearancePenalty·p y el
     * del cruce a tope).
     */
    slice: { timingGain: 0, earlyWiden: 0.9, sideMin: 100, sideMax: 350, backspin: 80, target: 0.62, clearancePenalty: 0.02, paceCap: 10 },
    /**
     * Techo de ritmo de los golpes de margen (normal, topspin, slice): velocidad horizontal equivalente sin drag
     * (m/s de simulación) que el golpe no supera aunque el margen pedido lo permitiera. Desde una bola baja no
     * se nota (el margen manda: el normal PERFECT sale a ~7.6); desde una bola alta evita que un golpe normal
     * sea un smash ("bajo riesgo, baja recompensa"). Con error de timing el techo baja hasta un
     * paceCapTimingLoss (×sensibilidad del golpe de ataque): ningún error da más velocidad que un PERFECT.
     */
    normalPaceCap: 9.5,
    paceCapTimingLoss: 0.2,
    /**
     * Smash [§4.6]: muy rápido. El objetivo es de RITMO: velocidad horizontal pace (de paceMin a paceMax con la
     * potencia; equivalente sin drag, m/s de simulación: débil ~11.2, GOOD ~12.8, PERFECT 15 = ~2 veces el normal)
     * y bote; el margen sobre la
     * red sale de la geometría (cuerda contacto → bote + flecha de la parábola a esa velocidad).
     * Umbral relativo a la red: con la parte inferior de la bola a menos de minAboveTape sobre la cinta, la
     * bola baja más empinada: el bote se acorta lowDepthPerM (fracción de media mesa) por metro que falte y
     * la recta pasa por la red (~3 cm por debajo del umbral ya no entra, desde cualquier profundidad).
     * Curva de timing: margen extra (m, solo ≥ 0: más alto y lento), profundidad y factor de ritmo (≤ 1).
     * Pronto = más corto y empinado (red); tarde = más alto y lento. Ningún error da más velocidad que PERFECT.
     */
    smash: {
      /** Sensibilidad al timing del golpe de ataque (pronto: más corto y empinado → red). */
      timingGain: 0.6,
      minAboveTape: 0.15,
      lowDepthPerM: 10,
      paceMin: 10.5,
      paceMax: 15,
      topspin: 50,
      timingCurve: [
        { dt: -120, clearance: 0, depth: 0.3, pace: 0.8 },
        { dt: -60, clearance: 0, depth: 0.68, pace: 0.92 },
        { dt: -25, clearance: 0, depth: 0.88, pace: 1 },
        { dt: 0, clearance: 0, depth: 0.9, pace: 1 },
        { dt: 25, clearance: 0.01, depth: 0.86, pace: 0.97 },
        { dt: 60, clearance: 0.06, depth: 0.8, pace: 0.85 },
        { dt: 120, clearance: 0.14, depth: 0.72, pace: 0.7 },
      ] as PaceCurvePoint[],
    },
    /**
     * Velocidad horizontal más alta que puede tener un golpe (m/s de simulación). Fija el margen mínimo que se
     * puede pedir desde una bola alta (la trayectoria con gravedad nunca baja de la cuerda): sin este suelo el
     * solver no tendría solución.
     */
    maxPace: 20,
  },

  /**
   * Bloqueo [§8] 🟡: click con Space mantenido (el click da el instante, como en cualquier golpe: misma medición
   * de timing y posición, §4.2; el evento de red de §17.2 ya lleva `block`). Sin gesto ni tipo de golpe: la
   * bola sale recta y sin potencia propia.
   *  - Mientras se mantiene Space, la raqueta va al paddleSpeedFactor de su velocidad máxima.
   *  - Devuelve con la energía de la bola entrante: objetivo de RITMO = paceByTier × velocidad horizontal de
   *    llegada (un PERFECT "reduce la velocidad recibida"); el margen sale de la geometría, como en el smash.
   *    Contra una bola lenta devuelve una bola alta y fácil; contra un smash, una bola rápida y baja.
   *  - Spin: un PERFECT devuelve invertido spinInvert del spin entrante (el topspin vuelve como backspin).
   *    GOOD y débil no lo absorben: el topspin entrante levanta la bola (spinLift m de margen y spinLong de
   *    profundidad por rad/s → larga) y el backspin la hunde (→ red).
   *  - Curva de timing: margen extra (≥ 0), profundidad y factor de ritmo: pronto = más corta (red), tarde =
   *    más alta y lenta.
   * Momentum del bloqueo PERFECT (+5 %): solo como valor en momentum.perfectBlock (V0.5).
   */
  block: {
    paddleSpeedFactor: 0.5,
    paceByTier: { PERFECT: 0.85, GOOD: 0.95, WEAK: 1.0 } as Record<'PERFECT' | 'GOOD' | 'WEAK', number>,
    /** Ritmo mínimo de la devolución (m/s de simulación), para bolas casi paradas. */
    minPace: 3,
    spinInvert: 0.5,
    spinLiftByTier: { PERFECT: 0, GOOD: 0.00012, WEAK: 0.00025 } as Record<'PERFECT' | 'GOOD' | 'WEAK', number>,
    spinLongByTier: { PERFECT: 0, GOOD: 0.0003, WEAK: 0.0007 } as Record<'PERFECT' | 'GOOD' | 'WEAK', number>,
    timingCurve: [
      { dt: -120, clearance: 0, depth: 0.3, pace: 1 },
      { dt: -60, clearance: 0, depth: 0.55, pace: 1 },
      { dt: -25, clearance: 0, depth: 0.7, pace: 1 },
      { dt: 0, clearance: 0, depth: 0.72, pace: 1 },
      { dt: 25, clearance: 0, depth: 0.7, pace: 0.97 },
      { dt: 60, clearance: 0.03, depth: 0.66, pace: 0.85 },
      { dt: 120, clearance: 0.08, depth: 0.6, pace: 0.7 },
    ] as PaceCurvePoint[],
  },

  /** Saque normal simplificado [§9.1] 🟡. */
  serve: {
    /** La bola se lanza sola al cabo de ~1 s o con el primer click. */
    autoTossMs: 1000,
    holdHeight: 0.15,
    /** Playtest 2: a 3.0 m/s la bola caía tan rápido que un saque tardío se golpeaba a ras de mesa. */
    tossSpeed: 2.4,
    /** Altura ideal de contacto (sweet spot) durante la caída, relativa a la mesa. */
    idealContactHeight: 0.3,
    /** Profundidad del primer bote (en tu campo) como fracción de la distancia hasta la red. */
    firstBounceFraction: 0.45,
    timingCurve: [
      { dt: -120, clearance: -0.02, depth: 0.55 },
      { dt: -60, clearance: 0.035, depth: 0.65 },
      { dt: -25, clearance: 0.06, depth: 0.75 },
      { dt: 0, clearance: 0.06, depth: 0.78 },
      { dt: 25, clearance: 0.08, depth: 0.75 },
      { dt: 60, clearance: 0.12, depth: 0.7 },
      { dt: 120, clearance: 0.16, depth: 0.62 },
    ] as ShotCurvePoint[],
  },

  /** Reglas de un game [§10]. */
  rules: {
    pointsToWin: 11,
    winBy: 2,
    /** El saque cambia cada N puntos; desde 10-10, cada punto [§9.3]. */
    serveEvery: 2,
    /** Pausa tras un punto antes del siguiente saque. */
    pointDelayMs: 1600,
    /** Seguridad: si no pasa nada en este tiempo, se repite el punto. */
    rallyTimeoutMs: 8000,
  },

  /** Bot [§17.5] 🟡. */
  bot: {
    difficulties: {
      easy: {
        label: 'Fácil',
        reactionMs: 360,
        quality: { perfect: 0.1, good: 0.45, weak: 0.35, whiff: 0.1 },
        aimSpread: 0.4,
        preferredDepth: 1.65,
        shots: { topspin: 0.1, slice: 0.05, smash: 0.35, badSmash: 0.03, block: 0.15 },
      },
      medium: {
        label: 'Normal',
        reactionMs: 240,
        quality: { perfect: 0.3, good: 0.5, weak: 0.15, whiff: 0.05 },
        aimSpread: 0.75,
        preferredDepth: 1.6,
        shots: { topspin: 0.22, slice: 0.1, smash: 0.6, badSmash: 0.005, block: 0.3 },
      },
      hard: {
        label: 'Difícil',
        reactionMs: 150,
        quality: { perfect: 0.45, good: 0.42, weak: 0.1, whiff: 0.03 },
        aimSpread: 1.0,
        preferredDepth: 1.55,
        shots: { topspin: 0.35, slice: 0.18, smash: 0.85, badSmash: 0, block: 0.35 },
      },
    } as Record<'easy' | 'medium' | 'hard', BotDifficultyConfig>,
    /** Bandas que usa el bot para fabricar su error, por calidad elegida. */
    bands: {
      perfect: { dtMs: [0, 18], pos: [0, 0.12] },
      good: { dtMs: [30, 55], pos: [0.22, 0.45] },
      weak: { dtMs: [65, 110], pos: [0.1, 0.6] },
      whiff: { dtMs: [140, 220], pos: [0.2, 0.8] },
    },
    /** Posición de espera tras golpear (coordenadas del bot). */
    readyDepth: 1.7,
    /** Bloquea si la bola llega a más de esta velocidad horizontal (m/s de simulación) o con este topspin (rad/s). */
    blockMinSpeed: 8.5,
    blockMinSpin: 250,
    /** Mantiene Space desde este tiempo antes del click (la raqueta va más lenta mientras tanto). */
    blockHoldMs: 220,
    /** Margen extra sobre el umbral del smash para intentarlo (m). */
    smashMargin: 0.03,
  },

  /** Feedback estilo TTYD [§5] ✅ concepto / 🟡 detalle. */
  feedback: {
    messageMs: 400,
    goodText: 'Bien',
    streakTexts: ['¡Perfecto!', '¡Genial!', '¡Increíble!', '¡EXCELENTE!'],
    earlyText: 'pronto',
    lateText: 'tarde',
    edgeText: 'borde',
    whiffText: 'fallo',
    /** Do, Mi, Sol, Do agudo. */
    streakNotesHz: [523.25, 659.25, 783.99, 1046.5],
    /** Escala del mensaje del rival respecto al propio. */
    opponentScale: 0.7,
  },

  /**
   * Calibración de latencia (P7, aprobada por el autor en el playtest 2). Desfase en ms que el traductor de
   * entrada resta al instante de cada click: compensa el retardo de pantalla y de entrada de cada jugador.
   * Se limita para que un desfase inflado no regale tiempo de reacción en PvP.
   */
  input: {
    latencyOffsetMs: 0,
    latencyOffsetMin: -50,
    latencyOffsetMax: 100,
    calibrationTrials: 12,
    /** Clicks a más de esto de la llegada de la bola no cuentan (despistes). */
    calibrationRejectMs: 250,
    /** Velocidad de la bola de calibración (m/s reales) ≈ la de llegada en partida con gameSpeed 0.75. */
    calibrationBallSpeed: 3.4,
  },

  /**
   * Red (V0.3) [§15.1, §17.2, §17.3] 🟡. Modelo «cada uno golpea en su tiempo» ✅: cada bola entre dos golpes es un
   * vuelo que cada jugador mide con su propio reloj; la bola que se aleja se frena en tu pantalla para llegar a la
   * raqueta rival cuando se espera su golpe (tu ping + el suyo). Lógica en shared/src/net/.
   */
  net: {
    /** Posición de la raqueta que se envía al rival: 30 veces por segundo, interpolada al dibujarla [§17.2]. */
    paddleHz: 30,
    /**
     * Ping [§15.1]: cada `everyMs`, media de las últimas `average` medidas. Al conectar se hacen `warmup` medidas
     * seguidas (cada `warmupEveryMs`) para frenar bien desde la primera bola. Colores: < goodBelowMs verde,
     * hasta warnAboveMs amarillo, por encima rojo con aviso.
     */
    ping: { everyMs: 2000, average: 5, warmup: 3, warmupEveryMs: 250, goodBelowMs: 60, warnAboveMs: 120 },
    /**
     * Bola que se aleja (reloj de visualización, brake.ts): velocidad real hasta `startFrac` del contacto esperado
     * («normal cerca de ti») y después frenada lineal para llegar a ese contacto con tu ping + el del rival de
     * retraso, sin bajar nunca de `minSpeed` (el límite del freno). Si el golpe rival llega antes, la bola se
     * adelanta en al menos `catchUpMs`; si el rival no la devuelve, vuelve a velocidad real en `rampBackMs`.
     * `defaultDepth`: profundidad (m desde la red) del contacto esperado si aún no se conoce la raqueta rival.
     */
    brake: { startFrac: 0.25, minSpeed: 0.25, catchUpMs: 80, rampBackMs: 150, defaultDepth: 1.6 },
    /** Una corrección o un cambio de vuelo con desfase se funde en pantalla en este tiempo (sin saltos). */
    blendMs: 80,
    /**
     * Validación del servidor [§17.3]: tolerancias del alcance de la raqueta (desde su última posición enviada, a su
     * velocidad máxima), de sus límites y de un click «en el futuro» (más tarde de lo que el jugador pudo verlo).
     */
    validation: { reachToleranceM: 0.03, boundsToleranceM: 0.02, futureToleranceMs: 60 },
    /** Respaldo: si el jugador que debe golpear calla este tiempo tras el fin del vuelo, el punto se cierra solo. */
    timers: { fallbackMs: 3000 },
    /** Latencia simulada (parámetros ping, botping y jitter de la URL): límites aceptados y variación por defecto. */
    latency: { defaultJitter: 0.1, maxPingMs: 500, maxJitter: 0.5 },
    /**
     * Cuantización del evento de golpe (mm, ms, mm/s, alturas de pantalla/s): quien golpea predice su vuelo con el
     * evento ya cuantizado, así su predicción y la del servidor coinciden bit a bit.
     */
    quantize: { mmDecimals: 3, msDecimals: 3, speedDecimals: 1, swingDecimals: 4 },
  },

  /** Momentum [§11] — NO se usa en V0.1; los valores viven aquí para que el config sea único. */
  momentum: {
    good: 0.03,
    perfectStreak: [0.08, 0.1, 0.12, 0.15],
    perfectBlock: 0.05,
    returnHard: 0.05,
    longRallyFromHit: 6,
    longRallyPerHit: 0.02,
    smashWinner: 0.05,
    losePoint: 0.03,
    specialCost: 1.0,
    specialServeCost: 0.5,
    halveOnGameChange: true,
  },

  /** Presentación (solo cliente). */
  presentation: {
    camera: { fov: 46, pos: [0, 1.78, 3.45] as [number, number, number], lookAt: [0, 0.72, -0.35] as [number, number, number] },
    /** La bola real (40 mm) es casi invisible desde la cámara trasera: escala SOLO visual. */
    ballVisualScale: 1.5,
    shakeOnPerfect: 0.012,
    shakeMs: 140,
    reduceShakeAndFlash: false,
    /** Marcador de bote: solo en práctica y contra el bot [§2.2]. */
    bounceMarker: true,
    /** Altura del plano sobre el que se proyecta el cursor (relativa a la mesa). */
    cursorPlaneHeight: 0.1,
    /**
     * Spin visible [§2.2]: el logo y la costura giran con el spin REAL de la bola (eje y sentido) escalado por
     * este factor. Sin escalar, 380 rad/s de simulación (~45 rev/s reales) se verían estroboscópicos a 60 fps;
     * con 0.05 el topspin máximo gira a ~2 rev/s y el que deja un bote, despacio.
     */
    spinVisualScale: 0.05,
    /** Trail por tipo de efecto [§2.2]: frames que dura y spin relativo mínimo (rad/s) para colorearlo. */
    trailFrames: 12,
    trailMinSpin: 60,
    /**
     * Colores del trail: topspin (naranja), backspin (cian), lateral (magenta) y sin efecto (blanco, solo si la
     * bola va rápida: el smash). Elegidos para destacar sobre la mesa azul; el giro del logo (eje) y la etiqueta
     * del golpe propio dan la misma información sin color (§19).
     */
    trailColors: { top: '#ff7a1a', back: '#6ad8ff', side: '#ff4fd8', none: '#ffffff' },
    /**
     * Señales del golpe (V0.2b), con los colores del trail: naranja topspin, magenta slice, blanco smash, cian bloqueo
     * (el golpe normal, dorado). Solo presentación; el color siempre va acompañado de texto (barra de teclas,
     * mensaje junto a la raqueta) [§19].
     *  - Tecla mantenida (solo el jugador local; el rival nunca la ve, §13): se ilumina solo el CONTORNO de tu
     *    raqueta con el color del golpe: una franja transparente de `haloWidth` m pegada al borde, por fuera
     *    (opacidad `haloOpacity`). Decisiones del autor (2026-10-03): sin partículas alrededor; solo el contorno, no
     *    toda la raqueta; una sola franja, la transparente (sin aro sólido).
     *  - Al golpear: ráfaga de chispas que sale de la raqueta y se abre hacia fuera durante `burstMs`; más chispas
     *    cuanto mejor el golpe (`burst`), las del débil en gris, el fallo sin chispas. La ve también el rival (es tras
     *    el golpe, como sus mensajes, §5.2). Con reduceShakeAndFlash no hay ráfaga.
     */
    sparks: {
      haloWidth: 0.025,
      haloOpacity: 0.35,
      burst: { PERFECT: 22, GOOD: 10, WEAK: 4 } as Record<'PERFECT' | 'GOOD' | 'WEAK', number>,
      burstMs: 300,
      normalColor: '#ffd23f',
      weakColor: '#9aa3ae',
    },
    /** "¿Por qué fallé?" al perder un punto por error propio [§2.2] (desactivable en el menú). */
    explainErrors: true,
  },
};

export type GameConfig = typeof DEFAULT_CONFIG;
export type BotDifficulty = keyof GameConfig['bot']['difficulties'];

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type ConfigOverrides = DeepPartial<GameConfig>;

/** Copia profunda de la config por defecto con sobrescrituras (no muta DEFAULT_CONFIG). */
export function makeConfig(overrides: ConfigOverrides = {}): GameConfig {
  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), overrides) as GameConfig;
}

function deepMerge(target: Record<string, unknown>, src: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(src)) {
    const value = src[key];
    if (value === undefined) continue;
    const current = target[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
      deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/** Duración de un tick en ms de tiempo real. */
export function tickMs(cfg: GameConfig): number {
  return 1000 / cfg.sim.tickHz;
}

/** Paso de integración de la bola en segundos de simulación. */
export function simDt(cfg: GameConfig): number {
  return cfg.sim.gameSpeed / cfg.sim.tickHz;
}
