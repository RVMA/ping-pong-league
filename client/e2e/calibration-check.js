// Prueba E2E (calibración de latencia, P7): simula a un jugador que SIEMPRE hace click LATE_MS tarde
// respecto a lo que ve, con eventos de ratón reales de Playwright.
//  1) Calibra (12 bolas): el desfase medido debería ser ≈ LATE_MS (+ la latencia propia de Playwright).
//  2) Guarda y juega ~25 s con el mismo retraso: con el desfase aplicado, el Δt medio debería quedar ≈ 0.
async (page) => {
  const LATE_MS = 40;
  await page.goto(page.url().split('?')[0] + '?debug=1&seed=5');
  await page.evaluate(() => localStorage.removeItem('ppp.latencyOffsetMs'));
  await page.reload();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/07-menu-latency.png' });
  await page.click('button[data-action="calibrate"]');
  await page.waitForTimeout(100);
  const sweetPx = await page.evaluate(() => {
    const g = window.__ppp;
    const c = g.calibration;
    return g.world.project(c.sweet.x, c.sweet.y, c.sweet.z);
  });
  await page.mouse.move(sweetPx.x, sweetPx.y);
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const st = await page.evaluate(() => {
      const c = window.__ppp.calibration;
      if (!c) return { done: true };
      const tr = c.trial;
      return { done: false, arrive: tr ? tr.arrive : null, id: tr ? tr.t0 : null };
    });
    if (st.done) break;
    if (st.arrive && !seen.has(st.id)) {
      seen.add(st.id);
      const now = await page.evaluate(() => performance.now());
      const wait = st.arrive + LATE_MS - now - 4;
      if (wait > 0) await page.waitForTimeout(wait);
      await page.mouse.down();
      await page.mouse.up();
      if (seen.size === 4) {
        await page.waitForTimeout(80);
        await page.screenshot({ path: 'docs/screenshots/08-calibrating.png' });
      }
      continue;
    }
    await page.waitForTimeout(15);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/screenshots/09-calibration-result.png' });
  const result = await page.textContent('.overlay h1');
  await page.click('button[data-action="save"]');
  await page.waitForTimeout(250);
  const menuText = await page.textContent('.latency-text');
  const offset = await page.evaluate(() => window.__ppp.input.latencyOffsetMs);
  const stored = await page.evaluate(() => localStorage.getItem('ppp.latencyOffsetMs'));

  // Fase 2: jugar contra el bot haciendo click siempre LATE_MS tarde.
  await page.click('button[data-difficulty="medium"]');
  await page.waitForTimeout(250);
  const planFn = () => {
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
      return { kind: 'hit', key: `serve-${st.phaseStartMs}`, ...proj(pad.x, pad.z), clickPerf: epoch + tIdeal, nowPerf };
    }
    if (st.phase === 'rally' && st.rally.lastHitter === 1) {
      const b = S.cloneBall(st.ball);
      const contacts = [];
      let t = sim.now;
      let serverBounce = st.rally.isServe && st.rally.bounces.length === 0;
      let bounced = st.rally.bounces.length > 0 && st.rally.bounces[st.rally.bounces.length - 1] === 0;
      let best = null;
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
        if (b.pos.z < 1.25 || b.pos.z > 2.2 || h < 0.06 || h > 0.8) continue;
        const score = Math.abs(b.pos.z - 1.6);
        if (!best || score < best.score) best = { t, x: b.pos.x, z: b.pos.z, score };
      }
      if (!best) return { kind: 'letgo', key: `r-${st.score.join("-")}-${st.rally.hits}` };
      return { kind: 'hit', key: `r-${st.score.join("-")}-${st.rally.hits}`, ...proj(best.x, best.z), clickPerf: epoch + best.t, nowPerf };
    }
    return { kind: 'wait', phase: st.phase };
  };

  const done = new Set();
  const t1 = Date.now();
  while (Date.now() - t1 < 25000) {
    const plan = await page.evaluate(planFn);
    if (plan.kind === 'idle') break;
    if ((plan.kind === 'hit' || plan.kind === 'toss') && !done.has(plan.key)) {
      done.add(plan.key);
      await page.mouse.move(plan.x, plan.y, { steps: 3 });
      if (plan.kind === 'toss') {
        await page.waitForTimeout(350);
        await page.mouse.down();
        await page.mouse.up();
        continue;
      }
      const now = await page.evaluate(() => performance.now());
      const wait = plan.clickPerf + LATE_MS - now - 4;
      if (wait > 0) await page.waitForTimeout(wait);
      await page.mouse.down();
      await page.mouse.up();
      continue;
    }
    await page.waitForTimeout(15);
  }
  await page.screenshot({ path: 'docs/screenshots/10-debug-after-calibration.png' });
  const precision = await page.evaluate(() => window.__ppp.precision.rows());
  return { result, menuText, offset, stored, precision };
}
