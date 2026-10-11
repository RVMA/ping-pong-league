// Prueba E2E de aceptación de V0.4: precisión del LADO 1 en una sala, con ping 0 y 100 (docs/prompts/fase_v0.4.md,
// Verificación 3; criterio de §21 también para el lado 1).
//  - A (lado 0) crea la sala y juega con el piloto automático Difícil: ?create=quick&autoplay=hard&name=Bot&offset=0,
//    en una ventana aparte (browser.newContext()): una pestaña de fondo dibuja a 30 fps o menos.
//  - B (lado 1) es la página de Playwright MCP: ?room=<código>&offset=0&ping=0 y luego &ping=100 (cada ping en una sala
//    nueva). Juega con ratón y teclado REALES de Playwright (page.mouse / page.keyboard), con ±30 ms de error de
//    timing con semilla (la misma secuencia que net-check.js en cada ping), además de la latencia propia de Playwright.
//  - Como net-check.js, solo LEE la vista de B (window.__ppp.sim) para saber dónde y cuándo llega la bola, pero con la
//    cámara del lado 1: espera a debugState().viewSide === 1 y proyecta puntos del MUNDO con world.project (la zona de
//    golpe del lado 1 está en z < 0; su bote es el de c.side === 1).
//  - 20 golpes por ping en el partido (no en el warm-up), rotando W / Q / E / sin tecla / Espacio (el smash solo con
//    bola alta; si no, topspin; sin tiempo para colocarse, sin tecla). Solo se apunta a puntos que se ven en la
//    ventana (1280×720), como haría una persona.
// Criterios: |Δt(100) − Δt(0)| ≤ 10 ms; |Δt(0) del lado 1 − Δt(0) del lado 0| ≤ 10 ms (el del lado 0 lo da
// net-check.js; aquí se pasa como SIDE0_DT0); golpe pedido = salido; 0 correcciones; fps ≥ 55.
// Uso: con `npm run dev` arrancado, ejecutar con browser_run_code de Playwright MCP (filename).
async (page) => {
  const base = 'http://localhost:5173/';
  const PINGS = [0, 100];
  const HITS = 20;
  const JITTER_MS = 30;
  // Δt medio del lado 0 con ping 0 (net-check.js, Step 5, mismo build): docs/evidence/v0.4/e2e-net-check.json.
  const SIDE0_DT0 = -0.4;
  const VIEW = { width: 1280, height: 720 };
  const ME = 1;
  let seed = 20261003;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const jitter = () => Math.round((rand() * 2 - 1) * JITTER_MS);
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

  // Dónde y cuándo pasa la bola por la zona de golpe de `side` (coordenadas del mundo, cámara de esta página).
  const planFn = ([side, want]) => {
    const g = window.__ppp;
    const S = window.__pppShared;
    const sim = g.sim;
    const st = sim.state;
    const cfg = sim.cfg;
    const epoch = g.clock.epoch;
    const d = g.debugState();
    if (!g.running || d.viewSide !== side || d.room.phase !== 'match' || d.room.playMode !== 'play' || sim.practice) return { kind: 'idle', phase: st.phase, room: d.room.phase, end: d.room.matchEnd };
    const sg = side === 0 ? 1 : -1;
    const other = 1 - side;
    const planeY = cfg.world.tableHeight + cfg.presentation.cursorPlaneHeight;
    const proj = (x, z) => g.world.project(x, planeY, z);
    const nowPerf = performance.now();
    if (st.phase === 'serveHold' && st.server === side) {
      return { kind: 'toss', key: `toss-${st.phaseStartMs}`, ...proj(st.paddles[side].pos.x, 1.6 * sg), nowPerf };
    }
    if (st.phase === 'serveToss' && st.server === side) {
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
      const pad = st.paddles[side].pos;
      return { kind: 'serve', key: `serve-${st.phaseStartMs}`, ...proj(pad.x, pad.z), clickPerf: epoch + tIdeal, nowPerf };
    }
    if (st.phase === 'rally' && st.rally.lastHitter === other) {
      const b = S.cloneBall(st.ball);
      const contacts = [];
      let t = sim.now;
      let serverBounce = st.rally.isServe && st.rally.bounces.length === 0;
      let bounced = st.rally.bounces.length > 0 && st.rally.bounces[st.rally.bounces.length - 1] === side;
      let best = null;
      let high = null;
      const netTop = cfg.world.tableHeight + cfg.world.netHeight;
      for (let i = 0; i < 500; i++) {
        contacts.length = 0;
        S.stepBall(b, sim.dt, sim.env, contacts);
        t += sim.tickMs;
        let stop = false;
        for (const c of contacts) {
          if (c.kind === 'table' && serverBounce && c.side === other) serverBounce = false;
          else if (c.kind === 'table' && !bounced && c.side === side) bounced = true;
          else if (c.kind === 'table' || c.kind === 'floor') stop = true;
        }
        if (stop) break;
        if (!bounced) continue;
        const h = b.pos.y - cfg.world.tableHeight;
        const zp = b.pos.z * sg;
        if (zp < 1.2 || zp > 2.5 || h < 0.08 || h > 0.8) continue;
        // Solo puntos que se ven en la ventana: con 720 px de alto el plano del cursor llega a ~2.3 m de fondo y el
        // rival Difícil juega bolas profundas cuyo punto más alto cae fuera (un click ahí no llega a la página).
        const sp = proj(b.pos.x, b.pos.z);
        if (sp.x < 8 || sp.x > innerWidth - 8 || sp.y < 8 || sp.y > innerHeight - 8) continue;
        const above = b.pos.y - cfg.ball.radius - netTop;
        const p = { t, x: b.pos.x, z: b.pos.z, above, score: Math.abs(zp - 1.6) };
        if (!best || p.score < best.score) best = p;
        if (!high || above > high.above) high = p;
      }
      const key = `r-${st.phaseStartMs}-${st.rally.hits}`;
      if (!best) return { kind: 'letgo', key };
      const at = (want === 'SMASH' || want === 'BLOCK') && high ? high : best;
      return { kind: 'hit', key, ...proj(at.x, at.z), clickPerf: epoch + at.t, maxAbove: high ? high.above : null, nowPerf };
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
  const lastHuman = ([tMin, me]) =>
    page.evaluate(
      ([tMin, me]) => {
        const g = window.__ppp;
        const ev = [...g.log].reverse().find(({ t, e }) => t >= tMin && (e.type === 'hit' || e.type === 'whiff') && e.player === me);
        const sw = [...g.log].reverse().find(({ t, e }) => t >= tMin && e.type === 'swing' && e.player === me);
        if (!ev) return { type: 'NONE' };
        const e = ev.e;
        if (e.type === 'whiff') return { type: 'WHIFF', dtMs: e.evaluation ? Math.round(e.evaluation.dtMs) : null };
        return {
          type: e.targets.type,
          tier: e.tier,
          dtMs: +e.evaluation.dtMs.toFixed(1),
          pos: Math.round(e.evaluation.posFrac * 100),
          keys: sw ? Object.keys(sw.e.keys).join('+') || '-' : '?',
          feedbackMs: sw ? Math.round(ev.t - sw.t) : null,
          contactMs: sw ? Math.round(sw.e.contactMs - sw.t) : null,
        };
      },
      [tMin, me],
    );
  const st = (p) =>
    p.evaluate(() => {
      const d = window.__ppp.debugState();
      return { now: performance.now(), room: d.room, net: d.net ? { status: d.net.status, side: d.net.side, corrections: d.net.corrections, pings: d.net.pings } : null, fps: d.fps, viewSide: d.viewSide, frames: window.__frames ? window.__frames.n : null };
    });
  const waitFor = async (p, pred, ms, label) => {
    const end = Date.now() + ms;
    let s = null;
    while (Date.now() < end) {
      s = await st(p);
      if (pred(s)) return s;
      await p.waitForTimeout(50);
    }
    throw new Error(`tiempo agotado: ${label} (último estado: ${JSON.stringify(s && { room: s.room, net: s.net })})`);
  };
  const countFrames = (p) =>
    p.evaluate(() => {
      if (window.__frames) return;
      window.__frames = { n: 0 };
      const f = () => {
        window.__frames.n++;
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  const holdShift = async (p) => {
    await p.keyboard.down('Shift');
    await p.waitForTimeout(700);
    await p.keyboard.up('Shift');
  };
  const startMatch = async (pageA) => {
    await Promise.all([holdShift(pageA), holdShift(page)]);
    await waitFor(page, (s) => s.room.phase === 'countdown', 5000, 'cuenta atrás');
    await waitFor(page, (s) => s.room.phase === 'match' && s.room.playMode === 'play', 6000, 'partido');
  };
  const KEY = { TOPSPIN: 'KeyW', SLICE: 'KeyQ', SMASH: 'KeyE', BLOCK: 'Space' };
  const rotation = ['TOPSPIN', 'SLICE', 'SMASH', 'NORMAL', 'BLOCK'];

  await page.setViewportSize(VIEW);
  const ctxA = await browser.newContext({ viewport: VIEW });
  const out = { startedAt: new Date().toISOString(), side0Dt0: SIDE0_DT0, runs: {} };
  listen(page, 'B');
  try {
    for (const ping of PINGS) {
      seed = 20261003; // misma secuencia de errores en cada ping (y que net-check.js)
      const pageA = await ctxA.newPage();
      listen(pageA, `A-${ping}`);
      await pageA.goto(`${base}?create=quick&autoplay=hard&name=Bot&offset=0`);
      const a0 = await waitFor(pageA, (s) => s.room.code && s.room.phase === 'waiting', 10000, 'sala de A');
      const code = a0.room.code;
      await page.goto(`${base}?room=${code}&offset=0&ping=${ping}`);
      await page.waitForFunction(() => !!window.__ppp);
      if ((await st(page)).room.stage === 'name') {
        // Enlace sin nombre guardado: la pantalla corta del nombre (teclado real).
        await page.locator('.name-prompt .name-field').click();
        await page.keyboard.type('Beto');
        await page.keyboard.press('Enter');
      }
      await waitFor(page, (s) => s.room.phase === 'warmup' && s.viewSide === ME, 15000, 'warm-up de B con la vista del lado 1');
      await waitFor(pageA, (s) => s.room.phase === 'warmup', 5000, 'warm-up de A');
      await countFrames(page);
      await countFrames(pageA);
      await page.mouse.move(640, 560);
      await startMatch(pageA);
      const startB = await st(page);
      const startA = await st(pageA);
      const fpsGameB = [];
      const fpsGameA = [];
      const results = [];
      const done = new Set();
      let turn = 0;
      let matches = 1;
      const t0 = Date.now();
      while (results.length < HITS && Date.now() - t0 < 240000) {
        const probe = await page.evaluate(planFn, [ME, 'NORMAL']);
        if (probe.kind === 'idle') {
          if (probe.end) {
            // El partido acabó antes de los 20 golpes: «Seguir» en las dos, Listo y otro partido.
            await page.locator('button[data-action="continue"]:visible').click();
            await pageA.locator('button[data-action="continue"]:visible').click();
            await waitFor(page, (s) => s.room.phase === 'warmup' && !s.room.matchEnd, 8000, 'warm-up tras el partido');
            await waitFor(pageA, (s) => s.room.phase === 'warmup' && !s.room.matchEnd, 8000, 'warm-up de A tras el partido');
            await startMatch(pageA);
            matches++;
          } else await page.waitForTimeout(15);
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
        const plan = want === 'NORMAL' ? probe : await page.evaluate(planFn, [ME, want]);
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
        const hit = await lastHuman([tClick, ME]);
        results.push({ want, jitterMs: err, ...hit });
        const [sb, sa] = await Promise.all([st(page), st(pageA)]);
        fpsGameB.push(sb.fps);
        fpsGameA.push(sa.fps);
      }
      const endB = await st(page);
      const endA = await st(pageA);
      const dB = await page.evaluate(() => {
        const d = window.__ppp.debugState();
        return { brakes: d.net.brakes, maxRenderJump: d.net.maxRenderJump, maxBallStep: d.maxBallStep, up: d.net.bytesOut / d.net.seconds, down: d.net.bytesIn / d.net.seconds, side: d.side, viewSide: d.viewSide, camZ: window.__ppp.world.camera.position.z };
      });
      const evaluated = results.filter((r) => typeof r.dtMs === 'number');
      const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const tiers = { PERFECT: 0, GOOD: 0, WEAK: 0, WHIFF: 0, NONE: 0 };
      for (const r of results) tiers[r.type === 'WHIFF' || r.type === 'NONE' ? r.type : r.tier]++;
      const asked = results.filter((r) => r.type !== 'WHIFF' && r.type !== 'NONE' && r.want !== 'BLOCK');
      const blocks = results.filter((r) => r.want === 'BLOCK');
      const rafFps = (s0, s1) => Math.round((10000 * (s1.frames - s0.frames)) / (s1.now - s0.now)) / 10;
      out.runs[ping] = {
        code,
        matches,
        n: results.length,
        meanDtMs: +mean(evaluated.map((r) => r.dtMs)).toFixed(1),
        meanAbsDtMs: +mean(evaluated.map((r) => Math.abs(r.dtMs))).toFixed(1),
        tiers,
        askedEqualsOut: `${asked.filter((r) => r.type === r.want).length}/${asked.length}`,
        blocks: `${blocks.filter((r) => r.type === 'BLOCK').length}/${blocks.length}`,
        wants: results.map((r) => r.want).join(','),
        feedbackMs: results.filter((r) => r.feedbackMs !== null && r.feedbackMs !== undefined).map((r) => r.feedbackMs - r.contactMs),
        corrections: { B: endB.net.corrections, A: endA.net.corrections },
        pings: endB.net.pings.map((v) => (v === null ? null : Math.round(v))),
        side: { net: endB.net.side, view: dB.viewSide, cameraZ: +dB.camZ.toFixed(2) },
        fps: {
          B: { raf: rafFps(startB, endB), gameMin: Math.round(Math.min(...fpsGameB)), gameMean: Math.round(mean(fpsGameB)) },
          A: { raf: rafFps(startA, endA), gameMin: Math.round(Math.min(...fpsGameA)), gameMean: Math.round(mean(fpsGameA)) },
        },
        brakes: dB.brakes,
        maxRenderJumpM: +dB.maxRenderJump.toFixed(4),
        maxBallStepPerFrameM: +dB.maxBallStep.toFixed(3),
        upBps: Math.round(dB.up),
        downBps: Math.round(dB.down),
        seconds: Math.round((Date.now() - t0) / 1000),
        results,
      };
      await page.locator('button[data-action="leave"]:visible').first().click().catch(() => {});
      await pageA.close();
    }
    const r0 = out.runs[0];
    const r100 = out.runs[100];
    const fpsOk = [r0, r100].every((r) => r.fps.B.raf >= 55 && r.fps.B.gameMin >= 55);
    const outOk = [r0, r100].every((r) => r.askedEqualsOut.split('/')[0] === r.askedEqualsOut.split('/')[1] && r.blocks.split('/')[0] === r.blocks.split('/')[1] && r.tiers.WHIFF === 0 && r.tiers.NONE === 0);
    out.criteria = {
      pingDiffMs: +(r100.meanDtMs - r0.meanDtMs).toFixed(1),
      pingDiffOk: Math.abs(r100.meanDtMs - r0.meanDtMs) <= 10,
      sideDiffMs: +(r0.meanDtMs - SIDE0_DT0).toFixed(1),
      sideDiffOk: Math.abs(r0.meanDtMs - SIDE0_DT0) <= 10,
      askedEqualsOutOk: outOk,
      corrections0: [r0, r100].every((r) => r.corrections.A === 0 && r.corrections.B === 0),
      fps55: fpsOk,
    };
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  } finally {
    out.console = consoleBy;
    for (const f of unlisten) f();
    await ctxA.close().catch(() => {});
    out.finishedAt = new Date().toISOString();
  }
  return out;
}
