// Prueba E2E: juega contra el bot en un navegador real con eventos de ratón REALES de Playwright
// (page.mouse.move / down / up → pointermove / pointerdown con su timestamp del navegador).
// Solo LEE el estado del juego (window.__ppp, window.__pppShared) para saber dónde y cuándo
// hacer click, como haría un jugador mirando la sombra. No inyecta InputIntent ni toca la simulación.
//
// Uso: con el servidor de desarrollo arrancado, ejecutar este archivo con la herramienta
// `browser_run_code` de Playwright MCP (es una función async (page) => {...}).
// Errores de timing deliberados (ms) por golpe para ver los distintos mensajes de feedback.
async (page) => {
  const DURATION_MS = 45000;
  const OFFSETS = [0, 5, -35, 0, 45, 0, -10, 0, 30, -50, 0, 10, 0, 85, 0, -20];
  const SHOT_DIR = 'docs/screenshots';
  const SCREENSHOT_AT = new Set([2, 4, 6, 9, 13]);
  const log = [];

  // Sin desfase de latencia guardado: los Δt medidos deben ser los provocados.
  await page.goto(page.url().split('?')[0] + '?offset=0');
  await page.waitForTimeout(300);
  if (await page.$('button[data-difficulty="medium"]')) await page.click('button[data-difficulty="medium"]');
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
  let shot = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < DURATION_MS) {
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
      const offset = OFFSETS[shot % OFFSETS.length];
      shot++;
      if (shot === 1) await page.screenshot({ path: `${SHOT_DIR}/02-incoming.png` });
      const nowPerf = await page.evaluate(() => performance.now());
      const wait = plan.clickPerf + offset - nowPerf - 4;
      if (wait > 0) await page.waitForTimeout(wait);
      await page.mouse.down();
      await page.mouse.up();
      if (SCREENSHOT_AT.has(shot)) {
        await page.waitForTimeout(90);
        await page.screenshot({ path: `${SHOT_DIR}/rally-shot-${String(shot).padStart(2, '0')}.png` });
      }
      log.push({ shot, intendedOffsetMs: offset });
      continue;
    }
    await page.waitForTimeout(15);
  }

  // Resumen a partir del registro de eventos del juego.
  return await page.evaluate(() => {
    const g = window.__ppp;
    const rallies = [];
    let cur = [];
    const hits = [];
    for (const { e } of g.log) {
      if (e.type === 'hit') {
        cur.push(e.player === 0 ? `TÚ:${e.tier}` : `BOT:${e.tier}`);
        if (e.player === 0) hits.push({ tier: e.tier, dtMs: Math.round(e.evaluation.dtMs), pos: Math.round(e.evaluation.posFrac * 100), causes: e.evaluation.causes.join('+'), streak: e.streak });
      }
      if (e.type === 'whiff' && e.player === 0) hits.push({ tier: 'WHIFF', dtMs: e.evaluation ? Math.round(e.evaluation.dtMs) : null });
      if (e.type === 'point' || e.type === 'let') {
        rallies.push({ golpes: cur.length, fin: e.type === 'let' ? 'let' : `${e.winner === 0 ? 'TÚ' : 'BOT'} gana (${e.reason})`, secuencia: cur.join(' ') });
        cur = [];
      }
    }
    return { estado: g.debugState(), rallies, golpesHumano: hits.slice(-40) };
  });
}
