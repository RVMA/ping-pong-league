// Prueba E2E de aceptación de V0.4: salas entre dos jugadores (docs/prompts/fase_v0.4.md, Verificación 3).
//  - A es la página de Playwright MCP; B, una pestaña de la misma ventana (page.context().newPage()) si su bucle de
//    dibujo va a ritmo completo; si no (pestaña oculta o frenada), una ventana aparte (browser.newContext()). La
//    evidencia dice cuál se usó y lo que midió la prueba.
//  - Los dos juegan con el piloto automático (?autoplay=medium): la prueba es del flujo de sala, no de la precisión
//    (eso es side1-check.js, con ratón y teclado reales).
//  - Teclas y clicks reales de Playwright para la interfaz: Shift mantenido 700 ms para el Listo, botones del lobby y
//    de la sala, recarga y cierre de la página de B.
//  - Lee window.__ppp (debugState) y registra, sin tocarlos, los mensajes de sala que llegan por el WebSocket
//    (window.__e2e: welcome, room, start, pt, mend, err, bye con su performance.now()) y los frames dibujados.
// Partes (por defecto todas; se eligen con #parts=main,reconnect,abandon en la URL de la página antes de lanzarla):
//  1. main: lobby → «Crear sala» Rápido → B entra por el enlace con un nombre hostil → warm-up → Listo con Shift en
//     las dos → cuenta atrás → partido → estadísticas en las dos → «Seguir» → warm-up. Mide correcciones, marcadores
//     (los del servidor a cada uno y los que enseñó cada vista), fps de cada página y consola.
//  2. reconnect: sala Estándar; en el game 1 con 3+ puntos, B recarga → A ve la pausa → B vuelve con el mismo
//     marcador → cuenta atrás → el partido sigue y acaba. Mide del `open` del socket nuevo de B a su `room` con
//     ph 'countdown' (< 1 s).
//  3. abandon: sala Rápido; B se cierra en el game 1 → a los 30 s A recibe `mend` con why 'abandon'.
// Base: el origen de la página al lanzarla (http://localhost:5173 con `npm run dev`; http://localhost:8787 con
// `npm run cf:dev`). Capturas en docs/screenshots/v0.4/ solo contra el servidor de desarrollo.
// Uso: con el servidor arrancado, navegar a la base y ejecutar con browser_run_code de Playwright MCP (filename).
async (page) => {
  const here = page.url();
  const isHttp = /^https?:\/\//.test(here);
  const origin = isHttp ? new URL(here).origin : 'http://localhost:5173';
  const base = `${origin}/`;
  const nodeDev = origin === 'http://localhost:5173';
  const parts = ((isHttp ? new URL(here).hash : '').match(/parts=([a-z,]+)/)?.[1] ?? 'main,reconnect,abandon').split(',');
  const SHOT_DIR = 'docs/screenshots/v0.4';
  const shots = nodeDev;
  const VIEW = { width: 1280, height: 720 };
  const HOSTILE = '<img src=x onerror=alert(1)>';
  const browser = page.context().browser();

  // ——— Registro dentro de la página (no cambia nada del juego) ———
  const RECORDER = () => {
    if (window.__e2e) return;
    const e2e = { ws: [], frames: 0, shown: [] };
    window.__e2e = e2e;
    const Orig = window.WebSocket;
    let n = 0;
    class W extends Orig {
      constructor(url, protocols) {
        super(url, protocols);
        if (!/\/ws\?/.test(String(url))) return; // el de Vite (HMR) no
        const id = ++n;
        const log = (o) => {
          o.t = performance.now();
          o.id = id;
          e2e.ws.push(o);
        };
        log({ d: 'new', url: String(url).replace(/^.*\/ws/, '/ws') });
        this.addEventListener('open', () => log({ d: 'open' }));
        this.addEventListener('close', (ev) => log({ d: 'close', code: ev.code }));
        this.addEventListener('message', (ev) => {
          const s = String(ev.data);
          if (s.charCodeAt(0) === 91) return; // raqueta: [n, r, x, z]
          let m;
          try {
            m = JSON.parse(s);
          } catch {
            return;
          }
          if (!['welcome', 'room', 'start', 'pt', 'mend', 'err', 'bye'].includes(m.k)) return;
          const o = { d: 'in', k: m.k };
          for (const f of ['ph', 'dk', 'why', 'w', 'r', 'sc', 'go', 'gw', 'g', 'wu', 'side', 'm', 'st', 'rj', 'fs', 'ns']) if (m[f] !== undefined) o[f] = m[f];
          if (m.pl) o.nm = m.pl.map((p) => (p ? p.nm : null));
          log(o);
        });
      }
    }
    window.WebSocket = W;
    const tick = () => {
      e2e.frames++;
      const v = window.__ppp && window.__ppp.sim;
      if (v && v.practice === false && v.game > 0 && v.state) {
        const sc = v.state.score;
        const last = e2e.shown[e2e.shown.length - 1];
        if (!last || last.g !== v.game || last.sc[0] !== sc[0] || last.sc[1] !== sc[1]) e2e.shown.push({ t: performance.now(), g: v.game, sc: [sc[0], sc[1]] });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ——— Consola y diálogos de cada página ———
  const consoleBy = {};
  const unlisten = [];
  const listen = (p, name) => {
    const c = (consoleBy[name] ??= { errors: [], warnings: [], pageErrors: [], dialogs: [] });
    const onC = (m) => {
      if (m.type() === 'error') c.errors.push(m.text());
      else if (m.type() === 'warning') c.warnings.push(m.text());
    };
    const onE = (e) => c.pageErrors.push(String(e));
    const onD = (d) => {
      c.dialogs.push(`${d.type()}: ${d.message()}`);
      d.dismiss().catch(() => {});
    };
    p.on('console', onC);
    p.on('pageerror', onE);
    p.on('dialog', onD);
    unlisten.push(() => {
      p.off('console', onC);
      p.off('pageerror', onE);
      p.off('dialog', onD);
    });
  };

  // ——— Ayudas ———
  const st = (p) =>
    p.evaluate(() => {
      const g = window.__ppp;
      const d = g.debugState();
      return {
        now: performance.now(),
        room: d.room,
        net: d.net ? { status: d.net.status, side: d.net.side, corrections: d.net.corrections, pings: d.net.pings } : null,
        fps: d.fps,
        score: d.score,
        game: g.sim.game,
        practice: g.sim.practice,
        viewSide: d.viewSide,
        frames: window.__e2e ? window.__e2e.frames : null,
      };
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
  const wsLog = (p) => p.evaluate(() => (window.__e2e ? window.__e2e.ws : []));
  const holdShift = async (p) => {
    await p.keyboard.down('Shift');
    await p.waitForTimeout(700);
    await p.keyboard.up('Shift');
  };
  const clickVisible = (p, action) => p.locator(`button[data-action="${action}"]:visible`).first().click();
  const gotoA = async (url) => {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__ppp);
    await page.evaluate(RECORDER);
  };
  const frameRate = (samples) => {
    const rates = [];
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i].now - samples[i - 1].now;
      if (dt > 500) rates.push((1000 * (samples[i].frames - samples[i - 1].frames)) / dt);
    }
    const ema = samples.map((s) => s.fps);
    const r1 = (v) => Math.round(v * 10) / 10;
    return rates.length
      ? { windows: rates.length, meanRaf: r1(rates.reduce((a, b) => a + b, 0) / rates.length), minRaf: r1(Math.min(...rates)), meanGame: r1(ema.reduce((a, b) => a + b, 0) / ema.length), minGame: r1(Math.min(...ema)) }
      : null;
  };
  // Puntos del partido según los mensajes del servidor (sin warm-up): [{ g, sc, w, r, go }].
  const matchPoints = (log) => {
    let wu = 1;
    let g = 0;
    const out = [];
    for (const e of log) {
      if (e.d !== 'in') continue;
      if (e.k === 'start') {
        wu = e.wu;
        g = e.g;
      } else if (e.k === 'pt' && wu === 0 && e.w !== -1) out.push({ g, sc: e.sc, w: e.w, r: e.r, go: e.go });
    }
    return out;
  };
  const lastPerGame = (rows) => {
    const m = {};
    for (const r of rows) m[r.g] = r.sc;
    return m;
  };
  const shownOf = (p) => p.evaluate(() => (window.__e2e ? window.__e2e.shown : []));
  const endPanel = (p) =>
    p.evaluate(() => {
      const t = document.querySelector('.match-stats');
      const panel = t ? t.closest('.panel') : null;
      return panel ? { title: panel.querySelector('h1')?.textContent ?? '', sub: panel.querySelector('.lead')?.textContent ?? '', rows: [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent)) } : null;
    });

  // B: una pestaña si su bucle va a ritmo completo con A; si no, una ventana aparte.
  let bMode = null;
  let bCtx = null;
  // Frames por segundo durante 4 s (cada segundo por separado): la pestaña de fondo puede ir a 30 fps o menos.
  const probe = (p) =>
    p.evaluate(
      () =>
        new Promise((res) => {
          const perSec = [];
          let n = 0;
          let last = performance.now();
          const f = (t) => {
            n++;
            if (t - last >= 1000) {
              perSec.push(n);
              n = 0;
              last = t;
            }
            if (perSec.length < 4) requestAnimationFrame(f);
            else res({ vis: document.visibilityState, fps: Math.min(...perSec), perSec });
          };
          requestAnimationFrame(f);
          setTimeout(() => res({ vis: document.visibilityState, fps: perSec.length ? Math.min(...perSec) : 0, perSec, stalled: true }), 6000);
        }),
    );
  const chooseB = async () => {
    await page.setViewportSize(VIEW);
    await page.goto(`${base}?offset=0`);
    const tab = await page.context().newPage();
    await tab.setViewportSize(VIEW);
    await tab.goto(`${base}?offset=0`);
    await tab.waitForTimeout(1000);
    const [a, b] = await Promise.all([probe(page), probe(tab)]);
    const tabOk = a.vis === 'visible' && b.vis === 'visible' && a.fps >= 55 && b.fps >= 55;
    await tab.close();
    if (tabOk) {
      bMode = 'tab';
      return { tab: { A: a, B: b }, used: 'tab' };
    }
    bMode = 'window';
    bCtx = await browser.newContext({ viewport: VIEW });
    const w = await bCtx.newPage();
    await w.goto(`${base}?offset=0`);
    await w.waitForTimeout(1000);
    const [a2, b2] = await Promise.all([probe(page), probe(w)]);
    await w.close();
    return { tab: { A: a, B: b }, window: { A: a2, B: b2 }, used: 'window' };
  };
  const newB = async (name) => {
    const p = bMode === 'tab' ? await page.context().newPage() : await bCtx.newPage();
    if (bMode === 'tab') await p.setViewportSize(VIEW);
    await p.addInitScript(RECORDER);
    listen(p, name);
    return p;
  };
  // A crea la sala desde el lobby (mode: quick | standard); devuelve el código.
  const createRoom = async (mode, shotLobby) => {
    await gotoA(`${base}?name=Ana&offset=0&autoplay=medium`);
    await waitFor(page, (s) => s.room.stage === 'lobby', 10000, 'lobby de A');
    await page.waitForTimeout(400);
    if (shotLobby && shots) await page.screenshot({ path: `${SHOT_DIR}/lobby.png` });
    await page.click(`button[data-mode="${mode}"]`);
    await page.click('button[data-action="create"]');
    const s = await waitFor(page, (s) => s.room.code && s.room.phase === 'waiting', 10000, 'sala de A');
    return s.room.code;
  };
  const joinB = async (pageB, code, name) => {
    await pageB.goto(`${base}?room=${code}&name=${encodeURIComponent(name)}&offset=0&autoplay=medium`);
    await waitFor(pageB, (s) => s.room.phase === 'warmup', 15000, 'warm-up de B');
    await waitFor(page, (s) => s.room.phase === 'warmup', 5000, 'warm-up de A');
  };
  const readyBoth = async (pageB) => {
    await Promise.all([holdShift(page), holdShift(pageB)]);
    return waitFor(page, (s) => s.room.phase === 'countdown', 5000, 'cuenta atrás');
  };
  // Juega hasta que las dos enseñan las estadísticas; muestras de fps cada segundo; `onTick` para capturas.
  const playToEnd = async (pageB, maxMs, onTick) => {
    const samples = { A: [], B: [] };
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const [a, b] = await Promise.all([st(page), st(pageB)]);
      samples.A.push(a);
      samples.B.push(b);
      if (a.room.matchEnd && b.room.matchEnd) return { samples, a, b, seconds: Math.round((Date.now() - t0) / 1000) };
      if (onTick) await onTick(a, b);
      await page.waitForTimeout(1000);
    }
    throw new Error('el partido no acabó a tiempo');
  };
  const continueBoth = async (pageB) => {
    await Promise.all([clickVisible(page, 'continue'), clickVisible(pageB, 'continue')]);
    const ok = (s) => s.room.phase === 'warmup' && !s.room.matchEnd && s.room.playMode === 'play';
    const [a, b] = await Promise.all([waitFor(page, ok, 8000, 'A de vuelta al warm-up'), waitFor(pageB, ok, 8000, 'B de vuelta al warm-up')]);
    return { A: a.room, B: b.room };
  };
  const leaveBoth = async (pageB) => {
    await clickVisible(pageB, 'leave').catch(() => {});
    await clickVisible(page, 'leave').catch(() => {});
    await page.waitForTimeout(300);
  };

  const result = { base, nodeDev, parts, startedAt: new Date().toISOString() };
  listen(page, 'A');
  try {
    result.second = await chooseB();

    // ——— 1. Partido completo ———
    if (parts.includes('main')) {
      const r = (result.main = {});
      const code = await createRoom('quick', true);
      r.code = code;
      r.urlAfterCreate = page.url().replace(origin, '');
      await page.waitForTimeout(300);
      if (shots) await page.screenshot({ path: `${SHOT_DIR}/room-waiting.png` });
      const pageB = await newB('B-main');
      await joinB(pageB, code, HOSTILE);
      await page.waitForTimeout(1500);
      // El nombre hostil se ve como texto: ni elemento <img> ni diálogo.
      const nameCheck = (p) =>
        p.evaluate(() => ({
          names: window.__ppp.debugState().room.names,
          chips: [...document.querySelectorAll('.ready-name')].map((e) => e.textContent),
          imgX: document.querySelectorAll('img[src="x"]').length,
          imgs: document.querySelectorAll('img').length,
          textHasTag: document.body.innerText.includes('<img src=x'),
        }));
      r.hostileName = { A: await nameCheck(page), B: await nameCheck(pageB) };
      if (shots) await page.screenshot({ path: `${SHOT_DIR}/warmup.png` });
      await readyBoth(pageB);
      await page.waitForTimeout(250);
      r.countdown = await page.evaluate(() => ({ big: document.querySelector('.center-big')?.textContent, sub: document.querySelector('.center-sub')?.textContent }));
      if (shots) await page.screenshot({ path: `${SHOT_DIR}/countdown.png` });
      await waitFor(page, (s) => s.room.phase === 'match', 6000, 'partido');
      const played = await playToEnd(pageB, 12 * 60000);
      r.matchSeconds = played.seconds;
      await page.waitForTimeout(500);
      if (shots) await page.screenshot({ path: `${SHOT_DIR}/match-end.png` });
      r.endPanel = { A: await endPanel(page), B: await endPanel(pageB) };
      const [wa, wb] = [await wsLog(page), await wsLog(pageB)];
      const pa = matchPoints(wa);
      const pb = matchPoints(wb);
      const ma = wa.filter((e) => e.k === 'mend');
      const mb = wb.filter((e) => e.k === 'mend');
      const [sa, sb] = [await shownOf(page), await shownOf(pageB)];
      r.score = {
        serverPointsA: pa.length,
        serverPointsB: pb.length,
        sameServerScores: JSON.stringify(pa) === JSON.stringify(pb),
        finalByGameA: lastPerGame(pa),
        finalByGameB: lastPerGame(pb),
        shownFinalA: lastPerGame(sa),
        shownFinalB: lastPerGame(sb),
        shownEqualsServer: JSON.stringify(lastPerGame(sa)) === JSON.stringify(lastPerGame(pa)) && JSON.stringify(lastPerGame(sb)) === JSON.stringify(lastPerGame(pb)),
        mendA: ma.map((m) => ({ w: m.w, why: m.why, gw: m.gw, st: m.st, rj: m.rj })),
        mendB: mb.map((m) => ({ w: m.w, why: m.why, gw: m.gw, st: m.st, rj: m.rj })),
        sameMend: JSON.stringify(ma.map((m) => [m.w, m.why, m.gw, m.st, m.rj])) === JSON.stringify(mb.map((m) => [m.w, m.why, m.gw, m.st, m.rj])),
      };
      r.corrections = { A: played.a.net.corrections, B: played.b.net.corrections };
      r.sides = { A: played.a.net.side, B: played.b.net.side, viewA: played.a.viewSide, viewB: played.b.viewSide };
      r.pings = { A: played.a.net.pings, B: played.b.net.pings };
      r.fps = { A: frameRate(played.samples.A), B: frameRate(played.samples.B) };
      r.afterContinue = await continueBoth(pageB);
      await page.waitForTimeout(1500);
      r.warmupAgain = { A: (await st(page)).room.phase, B: (await st(pageB)).room.phase };
      await leaveBoth(pageB);
      await pageB.close();
    }

    // ——— 2. Reconexión ———
    if (parts.includes('reconnect')) {
      const r = (result.reconnect = {});
      const code = await createRoom('standard', false);
      r.code = code;
      const pageB = await newB('B-reconnect');
      await joinB(pageB, code, 'Beto');
      await readyBoth(pageB);
      await waitFor(page, (s) => s.room.phase === 'match', 6000, 'partido');
      const before = await waitFor(page, (s) => s.room.phase === 'match' && s.practice === false && s.game === 1 && s.score[0] + s.score[1] >= 3, 8 * 60000, 'game 1 con 3 puntos');
      const beforeB = await st(pageB);
      r.before = { scoreA: before.score, scoreB: beforeB.score, game: before.game, correctionsB: beforeB.net.corrections, correctionsA: before.net.corrections };
      // A ve la pausa (captura en cuanto el texto de la pausa está en pantalla).
      let stop = false;
      const watcher = (async () => {
        while (!stop) {
          const s = await st(page);
          if (s.room.phase === 'paused') {
            const center = await page.evaluate(() => [document.querySelector('.center-big')?.textContent, document.querySelector('.center-sub')?.textContent]);
            if (!center[0] || !center[0].startsWith('Esperando')) {
              await page.waitForTimeout(10);
              continue;
            }
            if (shots) await page.screenshot({ path: `${SHOT_DIR}/pause.png` });
            const after = (await st(page)).room.phase;
            return { at: s.now, score: s.score, center, phaseAfterShot: after };
          }
          await page.waitForTimeout(10);
        }
        return null;
      })();
      // La recarga carga el programa como en una red real (el script principal llega 1.5 s después; con Vite en local
      // llegaba en ~0.15 s y la pausa de A duraba menos que una captura). El socket nuevo se mide desde su `open`.
      const mainScript = (url) => /\/src\/main\.ts$|\/assets\/index-[^/]*\.js$/.test(new URL(url).pathname);
      const slowMain = async (route) => {
        await new Promise((res) => setTimeout(res, 1500));
        await route.continue();
      };
      await pageB.route(mainScript, slowMain);
      const tA = (await st(page)).now;
      const t0 = Date.now();
      await pageB.reload();
      r.reloadLoadMs = Date.now() - t0;
      await pageB.unroute(mainScript, slowMain);
      const back = await waitFor(pageB, (s) => s.room.phase === 'match' && s.net && s.net.status === 'playing', 20000, 'B de vuelta en el partido');
      r.backInMatchMs = Date.now() - t0;
      const pause = await Promise.race([watcher, new Promise((res) => setTimeout(() => res('pending'), 3000))]);
      stop = true;
      r.pauseSeenByA = pause && pause !== 'pending' ? { afterReloadMs: Math.round(pause.at - tA), score: pause.score, center: pause.center, phaseAfterShot: pause.phaseAfterShot } : null;
      const wb = await wsLog(pageB);
      const open = wb.find((e) => e.d === 'open');
      const welcome = wb.find((e) => e.k === 'welcome');
      const cd = open ? wb.find((e) => e.k === 'room' && e.ph === 'countdown' && e.t >= open.t) : null;
      const startResume = wb.find((e) => e.k === 'start' && e.wu === 0);
      r.reconnectMs = open && cd ? Math.round((cd.t - open.t) * 10) / 10 : null;
      r.openToWelcomeMs = open && welcome ? Math.round((welcome.t - open.t) * 10) / 10 : null;
      r.firstRoomAfterOpen = wb.filter((e) => e.k === 'room').slice(0, 3).map((e) => ({ ph: e.ph, dk: e.dk, ms: Math.round(e.t - open.t) }));
      r.resumeStart = startResume ? { g: startResume.g, sc: startResume.sc, ms: Math.round(startResume.t - open.t) } : null;
      const wa = await wsLog(page);
      r.phasesSeenByA = wa.filter((e) => e.k === 'room' && e.t >= tA).map((e) => ({ ph: e.ph, dk: e.dk, ms: Math.round(e.t - tA) }));
      r.path = r.phasesSeenByA.some((e) => e.ph === 'paused') ? 'disconnect → rejoin (A vio la pausa)' : 'sin pausa en A (¿sustitución?)';
      r.backB = { side: back.net.side, viewSide: back.viewSide };
      // El partido sigue y acaba (captura del cambio de game en vivo).
      let betweenShot = false;
      const played = await playToEnd(pageB, 16 * 60000, async (a) => {
        if (!betweenShot && a.room.phase === 'between') {
          const vis = await page.evaluate(() => {
            const b = document.querySelector('.center-big');
            return b && b.offsetParent !== null && b.textContent ? [b.textContent, document.querySelector('.center-sub')?.textContent] : null;
          });
          if (vis) {
            betweenShot = true;
            r.betweenText = vis;
            if (shots) await page.screenshot({ path: `${SHOT_DIR}/between.png` });
          }
        }
      });
      r.matchSeconds = played.seconds;
      // Lo primero que enseñó la vista de B al volver (el registro guarda cada cambio de marcador del partido).
      const shownB = await shownOf(pageB);
      r.shownAfterReturnB = shownB.slice(0, 2).map((e) => ({ g: e.g, sc: e.sc, afterResumeStartMs: startResume ? Math.round(e.t - startResume.t) : null }));
      const same = (x, y) => !!(x && y && x[0] === y[0] && x[1] === y[1]);
      r.sameScoreOnReturn = !!(r.pauseSeenByA && r.resumeStart && same(r.resumeStart.sc, r.pauseSeenByA.score) && shownB.length && same(shownB[0].sc, r.pauseSeenByA.score));
      const wa2 = await wsLog(page);
      const wb2 = await wsLog(pageB);
      const pa = matchPoints(wa2);
      const pb = matchPoints(wb2);
      const ma = wa2.filter((e) => e.k === 'mend');
      const mb = wb2.filter((e) => e.k === 'mend');
      r.score = {
        finalByGameA: lastPerGame(pa),
        finalByGameB: lastPerGame(pb),
        // B solo tiene los puntos desde que volvió: se comparan los que tienen los dos.
        sameServerScoresAfterReturn: JSON.stringify(pa.slice(pa.length - pb.length)) === JSON.stringify(pb),
        shownFinalA: lastPerGame(await shownOf(page)),
        shownFinalB: lastPerGame(await shownOf(pageB)),
        mendA: ma.map((m) => ({ w: m.w, why: m.why, gw: m.gw, st: m.st, rj: m.rj })),
        sameMend: JSON.stringify(ma.map((m) => [m.w, m.why, m.gw, m.st, m.rj])) === JSON.stringify(mb.map((m) => [m.w, m.why, m.gw, m.st, m.rj])),
      };
      r.corrections = { A: played.a.net.corrections, BbeforeReload: r.before.correctionsB, BafterReload: played.b.net.corrections };
      r.fps = { A: frameRate(played.samples.A), B: frameRate(played.samples.B) };
      r.endPanel = { A: await endPanel(page), B: await endPanel(pageB) };
      r.afterContinue = await continueBoth(pageB);
      await leaveBoth(pageB);
      await pageB.close();
    }

    // ——— 3. Abandono ———
    if (parts.includes('abandon')) {
      const r = (result.abandon = {});
      const code = await createRoom('quick', false);
      r.code = code;
      const pageB = await newB('B-abandon');
      await joinB(pageB, code, 'Beto');
      await readyBoth(pageB);
      await waitFor(page, (s) => s.room.phase === 'match' && s.practice === false && s.game === 1, 8000, 'game 1');
      await page.waitForTimeout(3000);
      const tClose = (await st(page)).now;
      await pageB.close();
      r.closeAtGameScore = (await st(page)).score;
      const t0 = Date.now();
      let mend = null;
      while (Date.now() - t0 < 45000) {
        const w = await wsLog(page);
        mend = w.find((e) => e.k === 'mend' && e.t > tClose);
        if (mend) break;
        await page.waitForTimeout(100);
      }
      const wa = await wsLog(page);
      r.phasesSeenByA = wa.filter((e) => e.k === 'room' && e.t >= tClose).map((e) => ({ ph: e.ph, dk: e.dk, ms: Math.round(e.t - tClose) }));
      r.mend = mend ? { why: mend.why, w: mend.w, gw: mend.gw, afterCloseMs: Math.round(mend.t - tClose) } : null;
      if (mend) {
        await waitFor(page, (s) => s.room.matchEnd, 6000, 'estadísticas del abandono');
        r.endPanel = await endPanel(page);
        await clickVisible(page, 'continue');
        const s = await waitFor(page, (s) => s.room.phase === 'waiting' && !s.room.matchEnd, 6000, 'A esperando rival');
        r.afterContinue = { phase: s.room.phase, notice: s.room.notice, stage: s.room.stage };
        r.correctionsA = s.net.corrections;
      }
      await clickVisible(page, 'leave').catch(() => {});
    }
  } catch (e) {
    result.error = String(e && e.stack ? e.stack : e);
  } finally {
    result.console = consoleBy;
    for (const f of unlisten) f();
    if (bCtx) await bCtx.close().catch(() => {});
    result.finishedAt = new Date().toISOString();
  }
  return result;
}
