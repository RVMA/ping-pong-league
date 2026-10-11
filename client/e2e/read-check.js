// Prueba E2E de aceptación de V0.4: la prueba de lectura (§13.1; docs/prompts/fase_v0.4.md, Verificación 3).
//  1. En local, http://localhost:5173/?read=1&bot=hard&offset=0: «Empezar» con un click real; el piloto lector
//     devuelve las bolas y, con cada pregunta abierta (debugState().read.open), se pulsa con el teclado REAL de
//     Playwright la tecla correcta (1 Normal · 2 Topspin · 3 Slice · 4 Smash · 5 Bloqueo) en 24 preguntas y una
//     incorrecta en 6 (cada quinta). La incorrecta es otro tipo de 1–4 (nunca depende de que el bot no bloquee).
//     Cada respuesta llega 60–160 ms (con semilla) después de abrirse la pregunta. El panel debe decir 80 %, con la
//     tabla de confusiones que toca. Capturas: read-test.png (leyenda a mitad de prueba) y read-result.png.
//  2. En una sala (A en esta página, B en una ventana aparte, los dos con ?autoplay=medium): A pulsa «Prueba de
//     lectura» en el warm-up y B ve el aviso (captura read-banner.png); A no puede dar a Listo; «Dejar la prueba» lo
//     quita.
// Uso: con `npm run dev` arrancado, ejecutar con browser_run_code de Playwright MCP (filename).
async (page) => {
  const base = 'http://localhost:5173/';
  const SHOT_DIR = 'docs/screenshots/v0.4';
  const VIEW = { width: 1280, height: 720 };
  const KEYS = { NORMAL: 'Digit1', TOPSPIN: 'Digit2', SLICE: 'Digit3', SMASH: 'Digit4', BLOCK: 'Digit5' };
  // Respuesta incorrecta: otro tipo de 1–4.
  const WRONG = { NORMAL: 'TOPSPIN', TOPSPIN: 'SLICE', SLICE: 'SMASH', SMASH: 'NORMAL', BLOCK: 'NORMAL' };
  let seed = 20261013;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const browser = page.context().browser();
  const consoleBy = {};
  const unlisten = [];
  const listen = (p, name) => {
    const c = (consoleBy[name] ??= { errors: [], warnings: [], pageErrors: [] });
    const onC = (m) => {
      if (m.type() === 'error') c.errors.push(m.text());
      else if (m.type() === 'warning') c.warnings.push(m.text());
    };
    const onE = (e) => c.pageErrors.push(String(e));
    p.on('console', onC);
    p.on('pageerror', onE);
    unlisten.push(() => {
      p.off('console', onC);
      p.off('pageerror', onE);
    });
  };
  const read = (p) => p.evaluate(() => window.__ppp.debugState().read);
  const room = (p) => p.evaluate(() => window.__ppp.debugState().room);
  const waitFor = async (fn, ms, label) => {
    const end = Date.now() + ms;
    let v = null;
    while (Date.now() < end) {
      v = await fn();
      if (v) return v;
      await page.waitForTimeout(40);
    }
    throw new Error(`tiempo agotado: ${label}`);
  };

  const out = { startedAt: new Date().toISOString() };
  listen(page, 'A');
  let ctxB = null;
  try {
    // ——— 1. Local contra el bot Difícil ———
    await page.setViewportSize(VIEW);
    await page.goto(`${base}?read=1&bot=hard&offset=0`);
    await page.waitForFunction(() => !!window.__ppp);
    await page.locator('button[data-action="read-start"]').click();
    await waitFor(async () => (await read(page)).active, 5000, 'prueba activa');
    const plan = []; // { q, shot, key, correct, delayMs, given }
    const handled = new Set();
    let legendShot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const r = await read(page);
      if (r.resultShown) break;
      if (r.open && r.given === null && !handled.has(r.asked)) {
        const q = r.asked;
        handled.add(q);
        const correct = q % 5 !== 0;
        const answer = correct ? r.open : WRONG[r.open];
        const delayMs = Math.round(60 + rand() * 100);
        await page.waitForTimeout(delayMs);
        const again = await read(page);
        const stillOpen = again.open !== null && again.asked === q && again.given === null;
        await page.keyboard.press(KEYS[answer]);
        await page.waitForTimeout(30);
        const after = await read(page);
        plan.push({ q, shot: r.open, answer, correct, delayMs, stillOpen, given: after.asked === q ? after.given : '(cerrada)' });
        if (q === 12 && !legendShot) {
          legendShot = true;
          await page.screenshot({ path: `${SHOT_DIR}/read-test.png` });
        }
        continue;
      }
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(400);
    const r = await read(page);
    out.local = {
      seconds: Math.round((Date.now() - t0) / 1000),
      debug: r,
      answersPlanned: { correct: plan.filter((p) => p.correct).length, wrong: plan.filter((p) => !p.correct).length, closedBeforeKey: plan.filter((p) => !p.stillOpen).length },
      shotsSeen: plan.reduce((m, p) => ((m[p.shot] = (m[p.shot] ?? 0) + 1), m), {}),
      panel: await page.evaluate(() => {
        const t = document.querySelector('.read-table');
        return {
          pct: document.querySelector('.read-pct')?.textContent ?? null,
          text: [...document.querySelectorAll('.read-panel p')].map((e) => e.textContent).filter((s) => s && s.trim()),
          table: t ? [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent)) : null,
          buttons: [...document.querySelectorAll('.read-panel button')].filter((b) => b.offsetParent !== null).map((b) => b.dataset.action),
        };
      }),
      plan,
    };
    await page.screenshot({ path: `${SHOT_DIR}/read-result.png` });

    // ——— 2. En una sala: A empieza la prueba en el warm-up y B ve el aviso ———
    await page.goto(`${base}?create=quick&name=Ana&offset=0&autoplay=medium`);
    await page.waitForFunction(() => !!window.__ppp);
    const code = (await waitFor(async () => {
      const v = await room(page);
      return v.code && v.phase === 'waiting' ? v : null;
    }, 10000, 'sala de A')).code;
    ctxB = await browser.newContext({ viewport: VIEW });
    const pageB = await ctxB.newPage();
    listen(pageB, 'B');
    await pageB.goto(`${base}?room=${code}&name=Beto&offset=0&autoplay=medium`);
    await waitFor(async () => (await room(page)).phase === 'warmup' && (await room(pageB)).phase === 'warmup', 15000, 'warm-up');
    await page.waitForTimeout(1500);
    const btn = page.locator('button[data-action="read-test"]');
    out.room = { code, buttonBefore: { text: await btn.textContent(), enabled: await btn.isEnabled() } };
    await btn.click();
    const note = pageB.locator('.strip-read');
    await note.waitFor({ state: 'visible', timeout: 5000 });
    await pageB.waitForTimeout(300);
    await pageB.screenshot({ path: `${SHOT_DIR}/read-banner.png` });
    out.room.started = {
      noticeOnB: await note.textContent(),
      rtA: (await room(page)).rt,
      rtB: (await room(pageB)).rt,
      readA: await read(page),
      buttonA: { text: await btn.textContent(), enabled: await btn.isEnabled() },
      readyEnabledA: await page.locator('button[data-action="ready"]').isEnabled(),
      pilotA: await page.evaluate(() => window.__ppp.debugState().pilot),
    };
    // Shift mantenido 800 ms en A no da el Listo mientras dura la prueba.
    await page.keyboard.down('Shift');
    await page.waitForTimeout(800);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);
    out.room.shiftWhileReading = (await room(page)).ready;
    await page.waitForTimeout(4000);
    out.room.afterFewSeconds = { asked: (await read(page)).asked, phase: (await room(page)).phase };
    await btn.click();
    await page.waitForTimeout(600);
    out.room.stopped = {
      buttonA: await btn.textContent(),
      rtB: (await room(pageB)).rt,
      noticeVisibleOnB: await note.isVisible(),
      readA: await read(page),
      pilotA: await page.evaluate(() => window.__ppp.debugState().pilot),
    };
    await pageB.locator('button[data-action="leave"]:visible').first().click().catch(() => {});
    await page.locator('button[data-action="leave"]:visible').first().click().catch(() => {});
    await page.waitForTimeout(300);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  } finally {
    out.console = consoleBy;
    for (const f of unlisten) f();
    if (ctxB) await ctxB.close().catch(() => {});
    out.finishedAt = new Date().toISOString();
  }
  return out;
}
