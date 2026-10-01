// Prueba E2E (puntería): alterna golpes 'colocado + gesto lateral' y 'persiguiendo la bola hasta el click'
// con eventos de ratón reales (salvo el gesto rápido, ver abajo). Comprueba la regla del autor (2026-10-01): el gesto lateral solo apunta
// si la raqueta estaba colocada antes del gesto; persiguiendo, la bola sale recta.
async (page) => {
  await page.goto(page.url().split('?')[0] + '?autostart=1&bot=medium&seed=11&debug=1&offset=0');
  await page.waitForTimeout(400);
  const results = [];
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
  let shot = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && results.length < 8) {
    const plan = await page.evaluate(planFn);
    if (plan.kind === 'idle') break;
    if ((plan.kind === 'hit' || plan.kind === 'toss') && !done.has(plan.key)) {
      done.add(plan.key);
      if (plan.kind === 'toss') {
        await page.mouse.move(plan.x, plan.y, { steps: 3 });
        await page.waitForTimeout(350);
        await page.mouse.down();
        await page.mouse.up();
        continue;
      }
      const isServe = plan.key.startsWith('serve');
      const mode = isServe ? 'saque' : shot++ % 2 === 0 ? 'colocado' : 'persiguiendo';
      if (mode === 'persiguiendo') {
        // Lejos al otro lado y arrancar tarde: la raqueta sigue corriendo hasta el click.
        await page.mouse.move(plan.x - 320, plan.y, { steps: 2 });
        const wait = plan.clickPerf - 260 - (await page.evaluate(() => performance.now()));
        if (wait > 0) await page.waitForTimeout(wait);
        await page.mouse.move(plan.x, plan.y, { steps: 6 });
      } else {
        await page.mouse.move(plan.x, plan.y, { steps: 3 });
        if (mode === 'colocado') {
          // Gesto lateral seco (~30 px en 25 ms) y click. Playwright no puede enviar movimientos a menos de
          // ~10 ms de intervalo (cada uno es un viaje al navegador), así que este gesto se despacha dentro de
          // la página como PointerEvents con su temporización exacta; entran por el mismo traductor de ratón.
          await page.evaluate(({ x, y, clickPerf }) => new Promise((resolve) => {
            const canvas = document.getElementById('scene');
            const at = (t, fn) => setTimeout(fn, Math.max(0, t - performance.now()));
            for (let k = 1; k <= 5; k++) {
              at(clickPerf - 30 + 5 * k, () => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 6 * k, clientY: y, bubbles: true })));
            }
            at(clickPerf, () => {
              canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x + 30, clientY: y, button: 0, bubbles: true }));
              resolve();
            });
          }), plan);
        }
      }
      if (mode !== 'colocado') {
        const wait = plan.clickPerf - (await page.evaluate(() => performance.now())) - 4;
        if (wait > 0) await page.waitForTimeout(wait);
        await page.mouse.down();
        await page.mouse.up();
      }
      await page.waitForTimeout(250);
      const hit = await page.evaluate(() => {
        const ev = [...window.__ppp.log].reverse().find(({ e }) => (e.type === 'hit' || e.type === 'whiff') && e.player === 0);
        if (!ev) return null;
        const e = ev.e;
        return e.type === 'hit'
          ? { tier: e.tier, aimFactor: Math.round(e.aimFactor * 100) / 100, contactX: +e.pos.x.toFixed(2), landingX: +e.targets.landing.x.toFixed(2), dtMs: Math.round(e.evaluation.dtMs), pos: Math.round(e.evaluation.posFrac * 100) }
          : { tier: 'WHIFF' };
      });
      results.push({ mode, ...hit });
      if (results.length === 3) await page.screenshot({ path: 'docs/screenshots/06-debug-panel.png' });
      continue;
    }
    await page.waitForTimeout(15);
  }
  return results;
}
