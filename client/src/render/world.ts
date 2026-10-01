/**
 * Escena 3D: pabellón, mesa, red, bola con sombra vertical, raquetas, marcador del cursor
 * y marcador de bote. Solo presentación: no decide nada del juego.
 */
import type { GameConfig, Side } from '@ppp/shared';
import { sideSign } from '@ppp/shared';
import * as THREE from 'three';
import { ARENA_ASSETS, assetUrl, CHARACTERS, type CharacterId } from '../assets/manifest.ts';

const COLORS = {
  table: 0x24508c,
  line: 0xf3f6fa,
  floor: 0x6e2b27,
  surround: 0x18233d,
  ink: 0x22252e,
  ball: 0xfff6e8,
  gold: 0xffd23f,
};

export interface PaddleFrame {
  x: number;
  y: number;
  z: number;
  /** 0..1 progreso del swing, o null si no hay swing. */
  swing: number | null;
  /** Desplazamiento visual hacia el punto de contacto (golpes tardíos). */
  reach: { x: number; y: number; z: number };
  flash: number;
}

export interface RenderFrame {
  ball: { x: number; y: number; z: number; visible: boolean };
  paddles: [PaddleFrame, PaddleFrame];
  target: { x: number; z: number } | null;
  bounceMarker: { x: number; z: number; alpha: number } | null;
  shake: { x: number; y: number };
}

class PaddleView {
  readonly group = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly faceMat: THREE.MeshStandardMaterial;
  private readonly side: Side;

  constructor(side: Side, character: CharacterId, radius: number, perfectFrac: number, goodFrac: number, translucent: boolean, loader: THREE.TextureLoader) {
    this.side = side;
    const ch = CHARACTERS[character];
    const accent = new THREE.Color(ch.color);
    const url = assetUrl(ch.paddle);
    const tex = url ? loader.load(url) : null;
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      // La tapa del cilindro se ve desde fuera tras girarlo: se espeja la textura para leerla bien.
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;
    }
    const opacity = translucent ? 0.62 : 1;
    this.faceMat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : accent, roughness: 0.7, transparent: translucent, opacity, emissive: accent, emissiveIntensity: 0 });
    const backMat = new THREE.MeshStandardMaterial({ color: accent.clone().multiplyScalar(0.45), roughness: 0.8, transparent: translucent, opacity });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd9c7a3, roughness: 0.6, transparent: translucent, opacity });

    // Cilindro con el eje en z: la cara circular mira a la red / a la cámara.
    const face = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.012, 48), [rimMat, this.faceMat, backMat]);
    face.rotation.x = Math.PI / 2;
    // Para el lado 0 la cara texturizada (tapa superior) mira a la cámara (+z).
    if (side === 1) face.rotation.x = -Math.PI / 2;
    this.pivot.add(face);

    // Anillos de referencia del sweet spot (zona PERFECT y GOOD), en el lado que ve el jugador.
    const ringMat = (alpha: number) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide });
    const ringZ = sideSign(side) * 0.0075;
    const r1 = new THREE.Mesh(new THREE.RingGeometry(radius * perfectFrac - 0.004, radius * perfectFrac, 40), ringMat(0.75));
    const r2 = new THREE.Mesh(new THREE.RingGeometry(radius * goodFrac - 0.003, radius * goodFrac, 48), ringMat(0.35));
    r1.position.z = ringZ;
    r2.position.z = ringZ;
    this.pivot.add(r1, r2);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.12, 0.024), rimMat);
    handle.position.y = -radius - 0.055;
    this.pivot.add(handle);
    this.group.add(this.pivot);
  }

  update(f: PaddleFrame): void {
    this.group.position.set(f.x + f.reach.x, f.y + f.reach.y, f.z + f.reach.z);
    const sgn = sideSign(this.side);
    if (f.swing !== null) {
      // Barrido de derecha: gira sobre el eje vertical y avanza hacia la red.
      const s = f.swing;
      const arc = Math.sin(s * Math.PI);
      this.pivot.rotation.y = (-0.55 + 1.2 * s) * sgn;
      this.pivot.position.z = -sgn * 0.12 * arc;
      this.pivot.rotation.x = -0.25 * arc * sgn;
    } else {
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.position.set(0, 0, 0);
    }
    this.faceMat.emissiveIntensity = f.flash * 0.9;
  }
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 64);
  g.strokeStyle = 'rgba(20, 28, 48, 0.95)';
  g.lineWidth = 1.5;
  for (let x = 0; x <= 512; x += 8) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 64);
    g.stroke();
  }
  for (let y = 0; y <= 64; y += 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly cfg: GameConfig;
  private readonly ball: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly paddles: [PaddleView, PaddleView];
  private readonly target: THREE.Mesh;
  private readonly bounce: THREE.Mesh;
  private readonly bounceMat: THREE.MeshBasicMaterial;
  private readonly basePos: THREE.Vector3;
  private readonly lookAt: THREE.Vector3;

  constructor(canvas: HTMLCanvasElement, cfg: GameConfig, characters: [CharacterId, CharacterId]) {
    this.cfg = cfg;
    const { world: w, presentation: pres } = cfg;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(pres.camera.fov, 16 / 9, 0.05, 60);
    this.basePos = new THREE.Vector3(...pres.camera.pos);
    this.lookAt = new THREE.Vector3(...pres.camera.lookAt);
    this.camera.position.copy(this.basePos);
    this.camera.lookAt(this.lookAt);

    const loader = new THREE.TextureLoader();
    const bgUrl = assetUrl(ARENA_ASSETS.background);
    if (bgUrl) {
      const bg = loader.load(bgUrl);
      bg.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = bg;
    } else {
      this.scene.background = new THREE.Color(0x0e1a2e);
    }
    this.scene.fog = new THREE.Fog(0x141c30, 9, 22);

    this.scene.add(new THREE.HemisphereLight(0xc8d6ff, COLORS.floor, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.8, 6, 2.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.5);
    fill.position.set(-3, 3, -4);
    this.scene.add(fill);

    this.buildArena();
    this.buildTable();

    // Bola (escala solo visual) y su sombra vertical: la referencia principal de altura [§2.2].
    const ballR = cfg.ball.radius * pres.ballVisualScale;
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(ballR, 24, 16),
      new THREE.MeshStandardMaterial({ color: COLORS.ball, roughness: 0.35, emissive: 0x2a2620 }),
    );
    this.scene.add(this.ball);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(0,0,0,1)', 'rgba(0,0,0,0)'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    const pc = cfg.paddle;
    this.paddles = [
      new PaddleView(0, characters[0], pc.radius, cfg.hit.perfectPos, cfg.hit.goodPos, true, loader),
      new PaddleView(1, characters[1], pc.radius, cfg.hit.perfectPos, cfg.hit.goodPos, false, loader),
    ];
    this.scene.add(this.paddles[0].group, this.paddles[1].group);

    this.target = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.042, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.target.rotation.x = -Math.PI / 2;
    this.scene.add(this.target);

    this.bounceMat = new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.bounce = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 32), this.bounceMat);
    this.bounce.rotation.x = -Math.PI / 2;
    this.bounce.position.y = w.tableHeight + 0.002;
    this.scene.add(this.bounce);
  }

  private buildArena(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    // Vallas bajas del pabellón.
    const barrierMat = new THREE.MeshStandardMaterial({ color: COLORS.surround, roughness: 0.7 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x2f4f8a, roughness: 0.6 });
    const addBarrier = (x: number, z: number, len: number, alongX: boolean) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.04, 0.7, alongX ? 0.04 : len), barrierMat);
      b.position.set(x, 0.35, z);
      const s = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.045, 0.08, alongX ? 0.045 : len), stripeMat);
      s.position.set(x, 0.55, z);
      this.scene.add(b, s);
    };
    addBarrier(0, -6.5, 8, true);
    addBarrier(-4, -1.5, 10, false);
    addBarrier(4, -1.5, 10, false);
  }

  private buildTable(): void {
    const { tableLength: L, tableWidth: W, tableHeight: H, netHeight, netOverhang } = this.cfg.world;
    const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, L), new THREE.MeshStandardMaterial({ color: COLORS.table, roughness: 0.55 }));
    top.position.y = H - 0.015;
    this.scene.add(top);
    const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.line });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, H + 0.0006, z);
      this.scene.add(m);
    };
    line(0.02, L, W / 2 - 0.01, 0);
    line(0.02, L, -W / 2 + 0.01, 0);
    line(W, 0.02, 0, L / 2 - 0.01);
    line(W, 0.02, 0, -L / 2 + 0.01);
    line(0.003, L, 0, 0);

    const legMat = new THREE.MeshStandardMaterial({ color: COLORS.ink, roughness: 0.6 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.03, 0.05), legMat);
        leg.position.set(sx * (W / 2 - 0.12), (H - 0.03) / 2, sz * (L / 2 - 0.3));
        this.scene.add(leg);
      }

    const netW = W + 2 * netOverhang;
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(netW, netHeight),
      new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    net.position.set(0, H + netHeight / 2, 0);
    this.scene.add(net);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(netW, 0.015, 0.006), new THREE.MeshStandardMaterial({ color: COLORS.line, roughness: 0.5 }));
    tape.position.set(0, H + netHeight - 0.0075, 0);
    this.scene.add(tape);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, netHeight + 0.03, 12), legMat);
      post.position.set(sx * (netW / 2), H + (netHeight + 0.03) / 2 - 0.03, 0);
      this.scene.add(post);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // En pantallas estrechas se abre el campo de visión para que la mesa siga entera.
    const base = this.cfg.presentation.camera.fov;
    this.camera.fov = this.camera.aspect < 1.4 ? Math.min(75, base * (1.4 / this.camera.aspect) ** 0.7) : base;
    this.camera.updateProjectionMatrix();
  }

  /** Proyecta un punto del mundo a píxeles CSS del canvas. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const el = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
  }

  render(f: RenderFrame): void {
    const { tableHeight: H, tableWidth: W, tableLength: L } = this.cfg.world;
    this.ball.visible = f.ball.visible;
    this.ball.position.set(f.ball.x, f.ball.y, f.ball.z);

    // Sombra proyectada en vertical sobre la mesa o el suelo.
    const overTable = Math.abs(f.ball.x) <= W / 2 && Math.abs(f.ball.z) <= L / 2 && f.ball.y >= H;
    const groundY = overTable ? H : 0;
    const height = Math.max(0, f.ball.y - groundY);
    const r = this.cfg.ball.radius * this.cfg.presentation.ballVisualScale;
    this.shadow.visible = f.ball.visible;
    this.shadow.position.set(f.ball.x, groundY + 0.0015, f.ball.z);
    this.shadow.scale.setScalar(r * (1.6 + height * 1.4));
    this.shadowMat.opacity = Math.max(0.45, 0.95 - height * 0.7);

    this.paddles[0].update(f.paddles[0]);
    this.paddles[1].update(f.paddles[1]);

    this.target.visible = f.target !== null;
    if (f.target) this.target.position.set(f.target.x, H + 0.003, f.target.z);

    this.bounce.visible = f.bounceMarker !== null;
    if (f.bounceMarker) {
      this.bounce.position.x = f.bounceMarker.x;
      this.bounce.position.z = f.bounceMarker.z;
      this.bounceMat.opacity = 0.85 * f.bounceMarker.alpha;
    }

    this.camera.position.set(this.basePos.x + f.shake.x, this.basePos.y + f.shake.y, this.basePos.z);
    this.camera.lookAt(this.lookAt);
    this.renderer.render(this.scene, this.camera);
  }
}
