// Prueba E2E (V0.2b): golpes elegidos con TECLAS y potencia por calidad, con entrada humana en un navegador real.
//  - Teclado real (page.keyboard.down/up: Q, W, E, Space, Tab) y clicks reales (page.mouse.move/down/up).
//  - SIN gestos sintéticos dentro de la página: nada de PointerEvents despachados con page.evaluate.
//  - Cada click lleva un error de timing aleatorio de ±30 ms (PRNG con semilla, reproducible) además de la latencia
//    propia de Playwright: así se comprueba que los golpes salen con precisión humana, no con la perfecta.
//  - Solo LEE el estado (window.__ppp, window.__pppShared) para saber dónde y cuándo llega la bola, como un jugador
//    mirando la sombra. No inyecta InputIntent ni toca la simulación.
// Fases: A) los cuatro golpes y el bloqueo pedidos con su tecla; B) casos que deben explicarse: tecla pulsada después
// del click, tecla soltada antes, persiguiendo, smash con la bola baja; C) barra de teclas con Tab (foco y
// preferencia guardada); D) ?reduce=1 sin ráfagas. Capturas en docs/screenshots/v0.2b/.
// Uso: con `npm run dev` arrancado, ejecutar con la herramienta browser_run_code de Playwright MCP (filename).
async (page) => {
  const SHOT_DIR = 'docs/screenshots/v0.2b';
  const JITTER_MS = 30;
  const base = 'http://localhost:5173/';
  let seed = 20261002;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const jitter = () => Math.round((rand() * 2 - 1) * JITTER_MS);

  const planFn = (want) => {
    const g = window.__ppp;
    const S = window.__pppShared;
    const sim = g.sim;
    const st = sim.state;
    const cfg = sim.cfg;
    const epoch = g.clock.epoch;
    if (!g.running) return { kind: 'idle', phase: st.phase, score: st.score };
    const planeY = cfg.world.tableHeight + cfg.presentation.cursorPlaneHeight;
    const proj = (x, z) => g.world.project(x, planeY, z);
    const nowPerf = performance.now();
    if (st.phase === 'serveHold' && st.server === 0) {
      return { kind: 'toss', key: `toss-${st.score.join('-')}-${st.phaseStartMs}`, ...proj(st.paddles[0].pos.x, 1.6), nowPerf };
    }
    if (st.phase === 'serveToss' && st.server === 0) {
      const yIdeal = cfg.world.tableHeight + cfg.serve.idealContactHeight;
      const b = S.cloneBall(st.ball);
      let t = sim.now;
      let tIdeal = null;
      for (let i = 0; i < 400; i++) {
        const py = b.pos.y;
        S.stepBall(b, sim.dt, sim.env);
        t += sim.tickMs;
        if (b.vel.y < 0 && py >= yIdeal && b.pos.y < yIdeal) {
          tIdeal = t - sim.tickMs + (sim.tickMs * (py - yIdeal)) / (py - b.pos.y);
          break;
        }
      }
      const pad = st.paddles[0].pos;
      return { kind: 'serve', key: `serve-${st.phaseStartMs}`, ...proj(pad.x, pad.z), clickPerf: epoch + tIdeal, nowPerf };
    }
    if (st.phase === 'rally' && st.rally.lastHitter === 1) {
      const b = S.cloneBall(st.ball);
      const contacts = [];
      let t = sim.now;
      let serverBounce = st.rally.isServe && st.rally.bounces.length === 0;
      let bounced = st.rally.bounces.length > 0 && st.rally.bounces[st.rally.bounces.length - 1] === 0;
      let best = null;
      let high = null;
      const netTop = cfg.world.tableHeight + cfg.world.netHeight;
      for (let i = 0; i < 500; i++) {
        contacts.length = 0;
        S.stepBall(b, sim.dt, sim.env, contacts);
        t += sim.tickMs;
        let stop = false;
        for (const c of contacts) {
          if (c.kind === 'table' && serverBounce && c.side === 1) serverBounce = false;
          else if (c.kind === 'table' && !bounced && c.side === 0) bounced = true;
          else if (c.kind === 'table' || c.kind === 'floor') stop = true;
        }
        if (stop) break;
        if (!bounced) continue;
        const h = b.pos.y - cfg.world.tableHeight;
        if (b.pos.z < 1.2 || b.pos.z > 2.5 || h < 0.08 || h > 0.8) continue;
        const above = b.pos.y - cfg.ball.radius - netTop;
        const p = { t, x: b.pos.x, z: b.pos.z, above, score: Math.abs(b.pos.z - 1.6) };
        if (!best || p.score < best.score) best = p;
        if (!high || above > high.above) high = p;
      }
      if (!best) return { kind: 'letgo', key: `r-${st.score.join('-')}-${st.rally.hits}` };
      const at = (want === 'SMASH' || want === 'BLOCK') && high ? high : best;
      return {
        kind: 'hit',
        key: `r-${st.score.join('-')}-${st.rally.hits}`,
        ...proj(at.x, at.z),
        clickPerf: epoch + at.t,
        above: at.above,
        maxAbove: high ? high.above : null,
        lowAbove: best.above,
        lowPoint: proj(best.x, best.z),
        lowClick: epoch + best.t,
        nowPerf,
      };
    }
    return { kind: 'wait', phase: st.phase };
  };

  const now = () => page.evaluate(() => performance.now());
  const waitUntil = async (perf) => {
    const wait = perf - (await now());
    if (wait > 0) await page.waitForTimeout(wait);
  };
  const click = async () => {
    await page.mouse.down();
    await page.mouse.up();
  };
  // Último golpe o fallo del humano POSTERIOR a `tMin` (ms de juego): si el click no produjo nada (p. ej. el punto ya
  // había terminado), devuelve { type: 'NONE' } en lugar del golpe anterior.
  const lastHuman = (tMin = 0) =>
    page.evaluate((tMin) => {
      const g = window.__ppp;
      const ev = [...g.log].reverse().find(({ t, e }) => t >= tMin && (e.type === 'hit' || e.type === 'whiff') && e.player === 0);
      const sw = [...g.log].reverse().find(({ t, e }) => t >= tMin && e.type === 'swing' && e.player === 0);
      const d = g.debugState();
      if (!ev) return { type: 'NONE' };
      const e = ev.e;
      if (e.type === 'whiff') return { type: 'WHIFF', dtMs: e.evaluation ? Math.round(e.evaluation.dtMs) : null };
      const b = g.sim.state.ball;
      return {
        type: e.targets.type,
        tier: e.tier,
        dtMs: Math.round(e.evaluation.dtMs),
        pos: Math.round(e.evaluation.posFrac * 100),
        power: Math.round(e.targets.power * 100),
        keys: sw ? Object.keys(sw.e.keys).join('+') || '-' : '?',
        aimFactor: +e.aimFactor.toFixed(2),
        aboveTape: +e.targets.aboveTape.toFixed(3),
        speedReal: +(Math.hypot(b.vel.x, b.vel.z) * g.cfg.sim.gameSpeed).toFixed(1),
        text: d.lastStrokeText,
        sparks: d.sparks.alive,
      };
    }, tMin);
  const pointText = async () => {
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(60);
      if ((await page.evaluate(() => window.__ppp.sim.state.phase)) === 'pointOver') break;
    }
    await page.waitForTimeout(100);
    return page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  };
  const KEY = { TOPSPIN: 'KeyW', SLICE: 'KeyQ', SMASH: 'KeyE', BLOCK: 'Space' };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(base + '?debug=1');
  await page.evaluate(() => localStorage.removeItem('ppp.keyBar'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT_DIR}/01-menu.png` });

  await page.goto(base + '?autostart=1&bot=medium&seed=23&offset=0');
  await page.waitForTimeout(600);

  // ——— Tecla mantenida: barra iluminada y raqueta iluminada con el color del golpe (antes de golpear) ———
  const held = [];
  await page.mouse.move(640, 560);
  await page.waitForTimeout(300);
  for (const [name, code] of Object.entries(KEY)) {
    await page.keyboard.down(code);
    await page.waitForTimeout(220);
    const s = await page.evaluate(() => ({ kb: window.__ppp.debugState().keyBar.active, sparks: window.__ppp.debugState().sparks.glow }));
    held.push({ key: code, bar: s.kb, glow: s.sparks });
    await page.screenshot({ path: `${SHOT_DIR}/held-${name.toLowerCase()}.png` });
    await page.keyboard.up(code);
  }
  await page.waitForTimeout(150);
  const heldOff = await page.evaluate(() => ({ kb: window.__ppp.debugState().keyBar.active, sparks: window.__ppp.debugState().sparks.glow }));

  // ——— Fase A: golpes pedidos con tecla; fase B: casos explicados ———
  const rotation = ['TOPSPIN', 'SLICE', 'NORMAL', 'SMASH', 'BLOCK'];
  // Casos que deben explicarse; LATE_TOPSPIN y EARLY_SLICE llevan un error de timing deliberado (sin jitter): golpe
  // débil (chispas grises) con su riesgo legible (topspin tarde → larga; slice pronto → fuera por la banda).
  const scenarios = ['LATE_KEY', 'EARLY_RELEASE', 'CHASE', 'SMASH_LOW', 'LATE_TOPSPIN', 'EARLY_SLICE'];
  // Slice: sale por la banda desde cualquier sitio entre ~−61 y ~−72 ms medidos (antes, red). Playwright llega unos
  // 4–6 ms tarde, así que se pide −68 para medir ~−63.
  const caseOffset = { LATE_TOPSPIN: 85, EARLY_SLICE: -68 };
  const results = [];
  const special = [];
  const shots = new Map();
  const done = new Set();
  let turn = 0;
  let phase = 'A';
  const t0 = Date.now();
  while (Date.now() - t0 < 230000) {
    if (phase === 'A' && (results.length >= 30 || Date.now() - t0 > 140000)) phase = 'B';
    if (phase === 'B' && scenarios.length === 0) break;
    const probe = await page.evaluate(planFn, 'NORMAL');
    if (probe.kind === 'idle') {
      await page.waitForTimeout(400);
      if (await page.$('button[data-difficulty="medium"]')) await page.click('button[data-difficulty="medium"]');
      await page.waitForTimeout(300);
      continue;
    }
    if (!['hit', 'toss', 'serve'].includes(probe.kind) || done.has(probe.key)) {
      await page.waitForTimeout(15);
      continue;
    }
    if (probe.kind === 'toss') {
      done.add(probe.key);
      await page.mouse.move(probe.x, probe.y, { steps: 3 });
      await page.waitForTimeout(350);
      await click();
      continue;
    }
    if (probe.kind === 'serve') {
      done.add(probe.key);
      await waitUntil(probe.clickPerf - 3 + jitter());
      await click();
      continue;
    }

    // Golpe de este turno.
    let want = phase === 'A' ? rotation[turn % rotation.length] : scenarios[0];
    const highBall = probe.maxAbove !== null && probe.maxAbove >= 0.17;
    // El smash pide una bola alta, que el bot Normal da poco: se aprovecha cuando llega.
    if (phase === 'A' && highBall && (shots.get('SMASH') ?? 0) < 3) want = 'SMASH';
    if (want === 'SMASH' && !highBall) want = 'TOPSPIN';
    if (want === 'SMASH_LOW' && probe.lowAbove > 0.08) want = 'NORMAL';
    const plan = await page.evaluate(planFn, want);
    if (plan.kind !== 'hit') continue;
    done.add(plan.key);
    const timeLeft = plan.clickPerf - plan.nowPerf;
    if (timeLeft < 420 && want !== 'CHASE') want = 'NORMAL'; // no da tiempo a colocarse con calma
    if (phase === 'A') turn++;
    const isCase = phase === 'B' && want === scenarios[0];
    if (isCase) scenarios.shift();

    const useLow = want === 'SMASH_LOW';
    const point = useLow ? { x: plan.lowPoint.x, y: plan.lowPoint.y, click: plan.lowClick } : { x: plan.x, y: plan.y, click: plan.clickPerf };
    const err = caseOffset[want] ?? jitter();
    const clickAt = point.click + err;
    const key = {
      TOPSPIN: 'KeyW',
      SLICE: 'KeyQ',
      SMASH: 'KeyE',
      SMASH_LOW: 'KeyE',
      BLOCK: 'Space',
      CHASE: 'KeyW',
      LATE_KEY: 'KeyW',
      EARLY_RELEASE: 'KeyW',
      LATE_TOPSPIN: 'KeyW',
      EARLY_SLICE: 'KeyQ',
    }[want];

    if (want === 'CHASE') {
      // Lejos al otro lado y arrancar tarde: la raqueta sigue corriendo hasta el click (llega «persiguiendo»).
      await page.mouse.move(point.x - 320, point.y, { steps: 2 });
      await waitUntil(clickAt - 300);
      await page.keyboard.down(key);
      await waitUntil(clickAt - 260);
      await page.mouse.move(point.x, point.y, { steps: 6 });
    } else {
      await page.mouse.move(point.x, point.y, { steps: 3 });
      if (key && want !== 'LATE_KEY') {
        await waitUntil(clickAt - 260);
        await page.keyboard.down(key);
      }
      if (want === 'EARLY_RELEASE') {
        await waitUntil(clickAt - 90);
        await page.keyboard.up(key);
      }
    }
    await waitUntil(clickAt - 3);
    const tClick = await page.evaluate(() => window.__ppp.sim.now);
    await click();
    if (want === 'LATE_KEY') {
      await page.waitForTimeout(60);
      await page.keyboard.down(key);
    }
    await page.waitForTimeout(70);
    if (key) await page.keyboard.up(key);
    // Captura con la ráfaga de chispas aún viva (dura ~0.3 s desde el contacto).
    await page.waitForTimeout(40);
    const hit = await lastHuman(tClick);
    const n = (shots.get(want) ?? 0) + 1;
    shots.set(want, n);
    if (hit && hit.type !== 'WHIFF' && hit.type !== 'NONE' && n <= 2) await page.screenshot({ path: `${SHOT_DIR}/${phase === 'A' ? 'shot' : 'case'}-${want.toLowerCase()}-${n}.png` });
    const row = { want, jitterMs: err, timeLeft: Math.round(timeLeft), ...hit };
    if (phase === 'A') results.push(row);
    else if (isCase) {
      row.toast = await pointText();
      special.push(row);
    }
  }

  // ——— Fase C: Tab muestra u oculta la barra sin mover el foco; la preferencia se guarda ———
  const tab = [];
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(120);
    tab.push(
      await page.evaluate(() => ({
        focus: document.activeElement?.tagName,
        visible: window.__ppp.debugState().keyBar.visible,
        stored: localStorage.getItem('ppp.keyBar'),
      })),
    );
    if (i === 0) await page.screenshot({ path: `${SHOT_DIR}/keybar-hidden.png` });
  }
  await page.keyboard.press('Tab');
  await page.goto(base + '?autostart=1&bot=medium&seed=23&offset=0');
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => window.__ppp.debugState().keyBar);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);

  // ——— Fase D: ?reduce=1 → sin ráfagas de chispas ———
  await page.goto(base + '?autostart=1&bot=easy&seed=4&offset=0&reduce=1');
  await page.waitForTimeout(500);
  const reduce = [];
  const done2 = new Set();
  const t1 = Date.now();
  while (Date.now() - t1 < 25000 && reduce.length < 3) {
    const plan = await page.evaluate(planFn, 'TOPSPIN');
    if (!['hit', 'toss', 'serve'].includes(plan.kind) || done2.has(plan.key)) {
      await page.waitForTimeout(15);
      continue;
    }
    done2.add(plan.key);
    if (plan.kind === 'toss') {
      await page.mouse.move(plan.x, plan.y, { steps: 3 });
      await page.waitForTimeout(350);
      await click();
      continue;
    }
    if (plan.kind === 'serve') {
      await waitUntil(plan.clickPerf - 3);
      await click();
      continue;
    }
    await page.mouse.move(plan.x, plan.y, { steps: 3 });
    await waitUntil(plan.clickPerf - 260);
    await page.keyboard.down('KeyW');
    await waitUntil(plan.clickPerf - 3);
    await click();
    await page.waitForTimeout(60);
    await page.keyboard.up('KeyW');
    const h = await lastHuman();
    if (h) reduce.push({ type: h.type, tier: h.tier, sparks: h.sparks });
  }

  // ——— Resumen ———
  const summary = {};
  for (const r of results) {
    const s = (summary[r.want] ??= { n: 0, asked: 0, PERFECT: 0, GOOD: 0, WEAK: 0, WHIFF: 0, NONE: 0, texts: {} });
    s.n++;
    if (r.type === r.want) s.asked++;
    s[r.type === 'WHIFF' || r.type === 'NONE' ? r.type : r.tier]++;
    if (r.text) s.texts[r.text] = (s.texts[r.text] ?? 0) + 1;
  }
  const absDt = results.filter((r) => r.dtMs !== undefined && r.dtMs !== null).map((r) => Math.abs(r.dtMs));
  return {
    held,
    heldOff,
    summary,
    meanAbsDtMs: absDt.length ? +(absDt.reduce((a, b) => a + b, 0) / absDt.length).toFixed(1) : null,
    results,
    special,
    tab,
    afterReload,
    reduce,
  };
}
