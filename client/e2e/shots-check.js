// Prueba E2E (V0.2, actualizada en V0.2b): los cuatro golpes (normal, topspin, slice, smash) y el bloqueo contra el
// bot, en un navegador real, y después errores provocados para ver "¿por qué fallé?".
//  - La raqueta se coloca con eventos de ratón REALES de Playwright (page.mouse.move) bastante antes del golpe.
//  - V0.2b: el golpe se elige con TECLAS reales mantenidas en el click (page.keyboard.down: W topspin, S slice,
//    E smash; Space bloqueo) y click real (page.mouse.down/up). Ya no hay gestos sintéticos dentro de la página:
//    en V0.2 el gesto seco se despachaba como PointerEvents porque Playwright no puede moverse a <10 ms.
//  - Solo LEE el estado (window.__ppp, window.__pppShared) para saber dónde y cuándo llega la bola, como un jugador
//    mirando la sombra. No inyecta InputIntent ni toca la simulación.
// Uso: con `npm run dev` arrancado, ejecutar con la herramienta browser_run_code de Playwright MCP.
async (page) => {
  const SHOT_DIR = 'docs/screenshots/v0.2b/shots-check';
  // true = solo la fase B (errores provocados).
  const ONLY_ERRORS = false;
  const base = page.url().split('?')[0];
  await page.goto(base + '?autostart=1&bot=medium&seed=23&debug=1&offset=0');
  await page.waitForTimeout(500);

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
      // Smash y bloqueo: en el punto más alto de la trayectoria (bloquear bajo una bola rápida = red).
      const at = (want === 'SMASH' || want === 'BLOCK' || want === 'BLOCK_TOPSPIN') && high ? high : best;
      return {
        kind: 'hit',
        key: `r-${st.score.join('-')}-${st.rally.hits}`,
        ...proj(at.x, at.z),
        clickPerf: epoch + at.t,
        above: at.above,
        maxAbove: high ? high.above : null,
        lowAbove: best.above,
        nowPerf,
        incoming: { vh: Math.hypot(st.ball.vel.x, st.ball.vel.z), spin: S.relativeSpin(st.ball.spin, st.ball.vel) },
        lowPoint: proj(best.x, best.z),
        lowClick: epoch + best.t,
      };
    }
    return { kind: 'wait', phase: st.phase };
  };

  const waitUntil = async (perf) => {
    const wait = perf - (await page.evaluate(() => performance.now()));
    if (wait > 0) await page.waitForTimeout(wait);
  };
  const lastHuman = () =>
    page.evaluate(() => {
      const log = window.__ppp.log;
      const ev = [...log].reverse().find(({ e }) => (e.type === 'hit' || e.type === 'whiff') && e.player === 0);
      if (!ev) return null;
      const e = ev.e;
      if (e.type === 'whiff') return { type: 'WHIFF', dtMs: e.evaluation ? Math.round(e.evaluation.dtMs) : null };
      const b = window.__ppp.sim.state.ball;
      return {
        type: e.targets.type,
        tier: e.tier,
        dtMs: Math.round(e.evaluation.dtMs),
        pos: Math.round(e.evaluation.posFrac * 100),
        power: Math.round(e.targets.power * 100),
        spin: { top: Math.round(e.targets.spinRel.top), side: Math.round(e.targets.spinRel.side) },
        clearance: +e.targets.clearance.toFixed(3),
        aboveTape: +e.targets.aboveTape.toFixed(3),
        speedReal: +(Math.hypot(b.vel.x, b.vel.z) * window.__ppp.cfg.sim.gameSpeed).toFixed(1),
        landing: { x: +e.targets.landing.x.toFixed(2), z: +e.targets.landing.z.toFixed(2) },
        aimFactor: +e.aimFactor.toFixed(2),
      };
    });
  const lastPointText = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');

  // ——— Fase A: los cuatro golpes y el bloqueo ———
  const wanted = ['TOPSPIN', 'SLICE', 'BLOCK', 'NORMAL', 'SMASH', 'BLOCK_TOPSPIN'];
  const typeOf = (w) => (w === 'BLOCK_TOPSPIN' ? 'BLOCK' : w);
  // Golpes que dependen de la bola que llega: smash (bola alta) y bloquear un topspin (spin invertido).
  const ready = (w, plan) => (w === 'SMASH' ? plan.maxAbove !== null && plan.maxAbove >= 0.17 : w === 'BLOCK_TOPSPIN' ? plan.incoming.spin.top > 150 : true);
  const results = [];
  const shots = new Map(); // tipo → nº de capturas
  const done = new Set();
  let turn = 0;
  const t0 = Date.now();
  // Fase B (errores): se provocan en este orden cuando la situación lo permite.
  const errors = ['SMASH_LOW', 'SLICE_EARLY', 'TOPSPIN_EARLY'];
  const errorResults = [];
  let phase = ONLY_ERRORS ? 'B' : 'A';

  while (Date.now() - t0 < 150000) {
    const missing = wanted.filter((w) => !results.some((r) => r.want === w && r.type === typeOf(w)));
    if (phase === 'A' && missing.length === 0 && results.length >= 7) phase = 'B';
    if (phase === 'A' && Date.now() - t0 > 110000) phase = 'B';
    if (phase === 'B' && errors.length === 0) break;
    const probe = await page.evaluate(planFn, 'NORMAL');
    let nextWant = phase === 'A' ? wanted[turn % wanted.length] : errors[0];
    if (phase === 'A' && probe.kind === 'hit') {
      // Prioridad a los golpes condicionales que aún faltan si la bola que llega lo permite.
      const cond = missing.find((w) => (w === 'SMASH' || w === 'BLOCK_TOPSPIN') && ready(w, probe));
      if (cond) nextWant = cond;
      else if (!ready(nextWant, probe)) nextWant = missing.find((w) => w !== 'SMASH' && w !== 'BLOCK_TOPSPIN') ?? 'NORMAL';
    }
    const plan = await page.evaluate(planFn, nextWant);
    if (plan.kind === 'idle') {
      // Fin del game: otro, con el botón de la pantalla final.
      await page.waitForTimeout(400);
      if (await page.$('button[data-difficulty="medium"]')) await page.click('button[data-difficulty="medium"]');
      await page.waitForTimeout(300);
      continue;
    }
    if (!['hit', 'toss', 'serve'].includes(plan.kind) || done.has(plan.key)) {
      await page.waitForTimeout(15);
      continue;
    }
    done.add(plan.key);
    if (plan.kind === 'toss') {
      await page.mouse.move(plan.x, plan.y, { steps: 3 });
      await page.waitForTimeout(350);
      await page.mouse.down();
      await page.mouse.up();
      continue;
    }
    if (plan.kind === 'serve') {
      await waitUntil(plan.clickPerf - 4);
      await page.mouse.down();
      await page.mouse.up();
      continue;
    }

    // Elección del golpe de este turno. El smash se decide con el plan definitivo (no con la consulta anterior):
    // si la bola ya no va a pasar alta, topspin (en V0.2 un «smash con bola alta» se dio a 2.6 cm de la cinta).
    let want = nextWant === 'SMASH' && !(plan.above >= 0.17) ? 'TOPSPIN' : nextWant;
    const timeLeft = plan.clickPerf - plan.nowPerf;
    if (timeLeft < 330) {
      // No da tiempo a colocarse: golpe normal (persiguiendo, el gesto no contaría).
      want = 'NORMAL';
    } else if (phase === 'A') {
      turn++;
    } else {
      if (want === 'SMASH_LOW' && plan.lowAbove > 0.08) want = 'NORMAL';
      else errors.shift();
    }

    const usePoint = want === 'SMASH_LOW' ? { x: plan.lowPoint.x, y: plan.lowPoint.y, click: plan.lowClick } : { x: plan.x, y: plan.y, click: plan.clickPerf };
    await page.mouse.move(usePoint.x, usePoint.y, { steps: 3 });
    let dtOffset = 0;
    // Slice algo pronto: se abre de ángulo y sale por la banda (muy pronto ya sería red).
    if (want === 'SLICE_EARLY') dtOffset = -58;
    if (want === 'TOPSPIN_EARLY') dtOffset = -95;
    const clickAt = usePoint.click + dtOffset;
    if (want === 'BLOCK' || want === 'BLOCK_TOPSPIN') {
      await waitUntil(clickAt - 250);
      await page.keyboard.down('Space');
      await waitUntil(clickAt - 4);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(80);
      await page.keyboard.up('Space');
    } else if (want === 'NORMAL') {
      await waitUntil(clickAt - 4);
      await page.mouse.down();
      await page.mouse.up();
    } else {
      // Tecla del golpe mantenida desde 250 ms antes del click hasta después (teclado y click reales).
      const key = { TOPSPIN: 'KeyW', TOPSPIN_EARLY: 'KeyW', SLICE: 'KeyS', SLICE_EARLY: 'KeyS', SMASH: 'KeyE', SMASH_LOW: 'KeyE' }[want];
      await waitUntil(clickAt - 250);
      await page.keyboard.down(key);
      await waitUntil(clickAt - 4);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(60);
      await page.keyboard.up(key);
    }
    // Captura con el trail en vuelo (~180 ms después del contacto).
    await page.waitForTimeout(180);
    const hit = await lastHuman();
    const n = (shots.get(want) ?? 0) + 1;
    shots.set(want, n);
    if (hit && hit.type !== 'WHIFF' && phase === 'A' && n <= 2) await page.screenshot({ path: `${SHOT_DIR}/shot-${want.toLowerCase()}-${n}.png` });
    if (phase === 'A') results.push({ want, plannedAbove: +plan.above.toFixed(3), ...hit, incoming: { vh: +plan.incoming.vh.toFixed(1), top: Math.round(plan.incoming.spin.top), side: Math.round(plan.incoming.spin.side) } });
    else {
      // Esperar al fin del punto para leer el "¿por qué fallé?".
      let text = '';
      for (let i = 0; i < 80 && !text; i++) {
        await page.waitForTimeout(60);
        const s = await page.evaluate(() => window.__ppp.sim.state.phase);
        if (s === 'pointOver') text = await lastPointText();
      }
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOT_DIR}/why-${want.toLowerCase()}.png` });
      errorResults.push({ want, ...hit, toast: text });
    }
  }
  return { results, errorResults };
}
