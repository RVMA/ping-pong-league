/**
 * Genera los placeholders de arte con las rutas fijas de §18.1 (client/src/assets/...).
 * Todo se dibuja localmente (sin descargas ni licencias dudosas): círculos de color con la
 * inicial, texto con una fuente de mapa de bits 5×7 y degradados.
 *
 *   npm run placeholders -w client
 *
 * El autor sustituirá estos archivos por el arte final con el mismo nombre; no hay que tocar código.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets');

const CHARACTERS = {
  power: { name: 'POWER', color: [0xe4, 0x57, 0x2e] },
  defender: { name: 'DEFENDER', color: [0x2f, 0x9c, 0x95] },
};

// Fuente 5×7 (solo los glifos necesarios). Cada fila es una cadena de 5 bits.
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

class Canvas {
  constructor(w, h, bg = [0, 0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) this.data.set(bg, i * 4);
  }
  blend(x, y, [r, g, b], a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    const da = d[i + 3] / 255;
    const oa = a + da * (1 - a);
    d[i] = (r * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  /** Disco con antialiasing (cobertura por distancia al borde). */
  disc(cx, cy, r, color, alpha = 1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        this.blend(x, y, color, Math.max(0, Math.min(1, r - d + 0.5)) * alpha);
      }
    }
  }
  ring(cx, cy, r, width, color, alpha = 1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - (r - width / 2));
        this.blend(x, y, color, Math.max(0, Math.min(1, width / 2 - d + 0.5)) * alpha);
      }
    }
  }
  roundRect(x0, y0, w, h, rad, colorTop, colorBottom) {
    for (let y = y0; y < y0 + h; y++) {
      const t = (y - y0) / h;
      const c = colorTop.map((v, k) => v + (colorBottom[k] - v) * t);
      for (let x = x0; x < x0 + w; x++) {
        const dx = Math.max(x0 + rad - x, 0, x - (x0 + w - rad));
        const dy = Math.max(y0 + rad - y, 0, y - (y0 + h - rad));
        const d = Math.hypot(dx, dy);
        this.blend(x, y, c, Math.max(0, Math.min(1, rad - d + 0.5)));
      }
    }
  }
  text(str, cx, cy, scale, color, alpha = 1) {
    const w = str.length * 6 * scale - scale;
    let x = Math.round(cx - w / 2);
    const y0 = Math.round(cy - 3.5 * scale);
    for (const ch of str) {
      const g = FONT[ch];
      if (!g) throw new Error(`Glifo sin definir: ${ch}`);
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 5; c++)
          if (g[r][c] === '1')
            for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) this.blend(x + c * scale + xx, y0 + r * scale + yy, color, alpha);
      x += 6 * scale;
    }
  }
  savePng(rel) {
    const png = new PNG({ width: this.w, height: this.h });
    png.data = Buffer.from(this.data.buffer);
    write(rel, PNG.sync.write(png));
  }
  saveJpg(rel) {
    write(rel, jpeg.encode({ data: Buffer.from(this.data.buffer), width: this.w, height: this.h }, 88).data);
  }
}

function write(rel, buf) {
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  console.log(`  ${rel} (${(buf.length / 1024).toFixed(0)} KB)`);
}

const darken = (c, f) => c.map((v) => Math.round(v * f));
const lighten = (c, f) => c.map((v) => Math.round(v + (255 - v) * f));
const WHITE = [255, 255, 255];
const INK = [0x22, 0x25, 0x2e];

console.log('Generando placeholders en', ROOT);
for (const [id, { name, color }] of Object.entries(CHARACTERS)) {
  // portrait.png 512×512: círculo de color con la inicial.
  const p = new Canvas(512, 512);
  p.disc(256, 256, 240, darken(color, 0.55));
  p.disc(256, 256, 222, color);
  p.text(name[0], 256, 250, 34, WHITE);
  p.text('PLACEHOLDER', 256, 430, 3, WHITE, 0.6);
  p.savePng(`characters/${id}/portrait.png`);

  // select.png 1024×1536: carta vertical con nombre.
  const s = new Canvas(1024, 1536);
  s.roundRect(32, 32, 960, 1472, 64, lighten(color, 0.15), darken(color, 0.45));
  s.disc(512, 620, 330, darken(color, 0.35), 0.6);
  s.text(name[0], 512, 620, 70, WHITE);
  s.text(name, 512, 1180, 18, WHITE);
  s.text('PLACEHOLDER', 512, 1380, 6, WHITE, 0.6);
  s.savePng(`characters/${id}/select.png`);

  // paddle.png 512×512: textura de la cara de la raqueta.
  const r = new Canvas(512, 512, [...color, 255]);
  r.ring(256, 256, 256, 26, darken(color, 0.6));
  r.ring(256, 256, 200, 6, lighten(color, 0.35), 0.8);
  r.text(name[0], 256, 256, 22, lighten(color, 0.55), 0.9);
  r.savePng(`characters/${id}/paddle.png`);
}

// ui/logo.png 1024×512.
const logo = new Canvas(1024, 512);
logo.disc(150, 256, 100, [0xf3, 0xf6, 0xfa]);
logo.disc(150, 256, 84, [0xff, 0xd2, 0x3f]);
logo.text('PING PONG', 640, 205, 12, [0xf3, 0xf6, 0xfa]);
logo.text('PVP', 640, 320, 12, [0xff, 0xd2, 0x3f]);
logo.savePng('ui/logo.png');

// arena/background.jpg 1920×1080: pabellón en penumbra.
const bg = new Canvas(1920, 1080, [0, 0, 0, 255]);
for (let y = 0; y < 1080; y++) {
  const t = y / 1080;
  const top = [0x0e, 0x1a, 0x2e];
  const bottom = [0x2a, 0x16, 0x1a];
  const c = top.map((v, k) => Math.round(v + (bottom[k] - v) * t));
  for (let x = 0; x < 1920; x++) {
    const i = (y * 1920 + x) * 4;
    // Focos del techo: manchas de luz suaves.
    let glow = 0;
    for (const fx of [320, 960, 1600]) glow += Math.exp(-(((x - fx) / 260) ** 2) - (((y - 120) / 160) ** 2)) * 38;
    bg.data[i] = Math.min(255, c[0] + glow);
    bg.data[i + 1] = Math.min(255, c[1] + glow);
    bg.data[i + 2] = Math.min(255, c[2] + glow * 1.1);
    bg.data[i + 3] = 255;
  }
}
bg.text('PLACEHOLDER', 960, 1040, 3, INK.map(() => 90), 0.8);
bg.saveJpg('arena/background.jpg');
console.log('Listo.');
