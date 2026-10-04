// Prueba E2E de aceptación de V0.3: el jugador online contra el bot remoto, con ping simulado de 0, 50, 100 y 150 ms.
//  - Ratón y teclado REALES de Playwright (page.mouse / page.keyboard): nada de gestos sintéticos dentro de la página.
//  - Cada click lleva un error de timing aleatorio de ±30 ms (PRNG con semilla, la MISMA secuencia en cada ping), además
//    de la latencia propia de Playwright: precisión humana, no perfecta.
//  - Solo LEE la vista del jugador (window.__ppp.sim, que en red es su ClientMatch) para saber dónde y cuándo llega la
//    bola, como un jugador mirando la sombra. No inyecta mensajes ni toca la red.
// Criterio de §21: el Δt medio con 100 ms se aleja ≤ 10 ms del de 0 ms. La evaluación es la del propio cliente, que es
// la del servidor si hay 0 correcciones (mismo código y mismo evento cuantizado).
// Capturas en docs/screenshots/v0.3/ (ping 100): HUD con el ping, bola que se aleja, raqueta del rival golpeando.
// Uso: con `npm run dev` arrancado (cliente + servidor), ejecutar con browser_run_code de Playwright MCP (filename).
async (page) => {
  const SHOT_DIR = 'docs/screenshots/v0.3';
  const JITTER_MS = 30;
  const PINGS = [0, 50, 100, 150];
  const HITS = 20;
  const base = 'http://localhost:5173/';
  let seed = 20261003;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const jitter = () => Math.round((rand() * 2 - 1) * JITTER_MS);
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // Igual que keys-check: dónde y cuándo pasa la bola por la zona de golpe (lee la vista, no la toca).
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
      return { kind: 'hit', key: `r-${st.score.join('-')}-${st.rally.hits}`, ...proj(at.x, at.z), clickPerf: epoch + at.t, maxAbove: high ? high.above : null, nowPerf };
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
  const lastHuman = (tMin) =>
    page.evaluate((tMin) => {
      const g = window.__ppp;
      const ev = [...g.log].reverse().find(({ t, e }) => t >= tMin && (e.type === 'hit' || e.type === 'whiff') && e.player === 0);
      const sw = [...g.log].reverse().find(({ t, e }) => t >= tMin && e.type === 'swing' && e.player === 0);
      if (!ev) return { type: 'NONE' };
      const e = ev.e;
      if (e.type === 'whiff') return { type: 'WHIFF', dtMs: e.evaluation ? Math.round(e.evaluation.dtMs) : null };
      return {
        type: e.targets.type,
        tier: e.tier,
        dtMs: +e.evaluation.dtMs.toFixed(1),
        pos: Math.round(e.evaluation.posFrac * 100),
        keys: sw ? Object.keys(sw.e.keys).join('+') || '-' : '?',
        // Retraso del mensaje del golpe propio respecto al click: el contacto, como en local (no espera a la red).
        feedbackMs: sw ? Math.round(ev.t - sw.t) : null,
        contactMs: sw ? Math.round(sw.e.contactMs - sw.t) : null,
      };
    }, tMin);
  const KEY = { TOPSPIN: 'KeyW', SLICE: 'KeyQ', SMASH: 'KeyE', BLOCK: 'Space' };
  const rotation = ['TOPSPIN', 'SLICE', 'NORMAL', 'SMASH', 'BLOCK'];

  await page.setViewportSize({ width: 1280, height: 720 });
  const runs = {};
  for (const ping of PINGS) {
    seed = 20261003; // misma secuencia de errores en cada ping
    await page.goto(`${base}?online=1&ping=${ping}&bot=medium&seed=11&offset=0&autostart=1`);
    for (let i = 0; i < 60; i++) {
      const s = await page.evaluate(() => window.__ppp.debugState().net?.status);
      if (s === 'playing') break;
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => window.__ppp.resetMetrics());
    const results = [];
    const done = new Set();
    let turn = 0;
    let shots = { hud: false, outgoing: false, rival: false };
    const t0 = Date.now();
    while (results.length < HITS && Date.now() - t0 < 120000) {
      const probe = await page.evaluate(planFn, 'NORMAL');
      if (probe.kind === 'idle') {
        await page.waitForTimeout(300);
        if (await page.$('button[data-difficulty="medium"]')) await page.click('button[data-difficulty="medium"]');
        continue;
      }
      if (!['hit', 'toss', 'serve'].includes(probe.kind) || done.has(probe.key)) {
        await page.waitForTimeout(15);
        continue;
      }
      done.add(probe.key);
      if (probe.kind === 'toss') {
        await page.mouse.move(probe.x, probe.y, { steps: 3 });
        await page.waitForTimeout(350);
        await click();
        continue;
      }
      if (probe.kind === 'serve') {
        await waitUntil(probe.clickPerf - 3 + jitter());
        await click();
        continue;
      }
      let want = rotation[turn % rotation.length];
      turn++;
      const highBall = probe.maxAbove !== null && probe.maxAbove >= 0.17;
      if (want === 'SMASH' && !highBall) want = 'TOPSPIN';
      const plan = want === 'NORMAL' ? probe : await page.evaluate(planFn, want);
      if (plan.kind !== 'hit') continue;
      const timeLeft = plan.clickPerf - plan.nowPerf;
      if (timeLeft < 420) want = 'NORMAL';
      const err = jitter();
      const clickAt = plan.clickPerf + err;
      const key = KEY[want];
      await page.mouse.move(plan.x, plan.y, { steps: 3 });
      if (key) {
        await waitUntil(clickAt - 260);
        await page.keyboard.down(key);
      }
      await waitUntil(clickAt - 3);
      const tClick = await page.evaluate(() => window.__ppp.sim.now);
      await click();
      await page.waitForTimeout(70);
      if (key) await page.keyboard.up(key);
      const hit = await lastHuman(tClick);
      results.push({ want, jitterMs: err, ...hit });
      if (ping === 100 && hit.type !== 'WHIFF' && hit.type !== 'NONE') {
        if (!shots.hud && results.length >= 3) {
          await page.screenshot({ path: `${SHOT_DIR}/hud-ping.png` });
          shots.hud = true;
        } else if (!shots.outgoing && results.length >= 5) {
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${SHOT_DIR}/outgoing-ball.png` });
          shots.outgoing = true;
        } else if (!shots.rival && results.length >= 7) {
          // La raqueta del rival golpeando: el evento `swing` del rival llega con su golpe y da el instante estimado.
          for (let i = 0; i < 80; i++) {
            const c = await page.evaluate((tMin) => {
              const g = window.__ppp;
              const sw = [...g.log].reverse().find(({ t, e }) => t >= tMin && e.type === 'swing' && e.player === 1);
              return sw ? g.clock.epoch + sw.e.contactMs : null;
            }, tClick + 1);
            if (c) {
              await waitUntil(c - 25);
              await page.screenshot({ path: `${SHOT_DIR}/rival-hit.png` });
              shots.rival = true;
              break;
            }
            await page.waitForTimeout(15);
          }
        }
      }
    }
    const d = await page.evaluate(() => window.__ppp.debugState());
    const evaluated = results.filter((r) => typeof r.dtMs === 'number');
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const tiers = { PERFECT: 0, GOOD: 0, WEAK: 0, WHIFF: 0, NONE: 0 };
    for (const r of results) tiers[r.type === 'WHIFF' || r.type === 'NONE' ? r.type : r.tier]++;
    const asked = results.filter((r) => r.type !== 'WHIFF' && r.type !== 'NONE' && r.want !== 'BLOCK');
    runs[ping] = {
      n: results.length,
      meanDtMs: +mean(evaluated.map((r) => r.dtMs)).toFixed(1),
      meanAbsDtMs: +mean(evaluated.map((r) => Math.abs(r.dtMs))).toFixed(1),
      tiers,
      askedEqualsOut: `${asked.filter((r) => r.type === r.want).length}/${asked.length}`,
      blocks: results.filter((r) => r.want === 'BLOCK').map((r) => r.type).join(','),
      feedbackMs: results.filter((r) => r.feedbackMs !== null && r.feedbackMs !== undefined).map((r) => r.feedbackMs - r.contactMs),
      corrections: d.net.corrections,
      brakes: d.net.brakes,
      pings: d.net.pings.map((v) => (v === null ? null : Math.round(v))),
      maxRenderJumpM: +d.net.maxRenderJump.toFixed(4),
      maxBallStepPerFrameM: +d.maxBallStep.toFixed(3),
      fps: Math.round(d.fps),
      upBps: Math.round(d.net.bytesOut / d.net.seconds),
      downBps: Math.round(d.net.bytesIn / d.net.seconds),
      results,
    };
  }
  return {
    criterion: { meanDt0: runs[0].meanDtMs, meanDt100: runs[100].meanDtMs, diff: +(runs[100].meanDtMs - runs[0].meanDtMs).toFixed(1), ok: Math.abs(runs[100].meanDtMs - runs[0].meanDtMs) <= 10 },
    runs,
    consoleErrors: errors,
  };
}
