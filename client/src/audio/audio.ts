/**
 * Audio [§16]. Carga los archivos del manifiesto si existen; si no, sintetiza cada sonido con
 * WebAudio (incluidas las notas de racha Do–Mi–Sol–Do agudo de §5.1).
 */
import { DEFAULT_CONFIG } from '@ppp/shared';
import { type SfxName, SFX_NAMES, sfxUrl } from '../assets/manifest.ts';

export interface PlayOptions {
  /** 0..1 */
  volume?: number;
  /** Panorama estéreo −1..1. */
  pan?: number;
}

type Synth = (ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer) => void;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private noise: AudioBuffer | null = null;

  /** Debe llamarse desde un gesto del usuario (política de autoplay). */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
      void this.loadFiles();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private async loadFiles(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      SFX_NAMES.map(async (name) => {
        const url = sfxUrl(name);
        if (!url) return;
        try {
          const res = await fetch(url);
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // Archivo dañado o formato no soportado: se queda el sintetizado.
        }
      }),
    );
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    let out: AudioNode = gain;
    if (opts.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(p);
      out = p;
    }
    out.connect(master);
    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start();
      return;
    }
    SYNTHS[name](ctx, gain, ctx.currentTime, this.noise!);
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    return buf;
  }
}

// ——— Sintetizadores ———

function env(ctx: AudioContext, out: AudioNode, t: number, attack: number, decay: number, peak = 1): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function tone(ctx: AudioContext, out: AudioNode, t: number, freq: number, type: OscillatorType, attack: number, decay: number, peak = 0.5, detune = 0): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  o.connect(env(ctx, out, t, attack, decay, peak));
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function noiseBurst(ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer, filter: BiquadFilterType, freq: number, q: number, attack: number, decay: number, peak = 0.6): BiquadFilterNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  f.Q.value = q;
  src.connect(f);
  f.connect(env(ctx, out, t, attack, decay, peak));
  src.start(t);
  src.stop(t + attack + decay + 0.05);
  return f;
}

/** Golpe de raqueta: chasquido de goma + cuerpo de madera; más brillante cuanto mejor. */
function hit(brightness: number): Synth {
  return (ctx, out, t, noise) => {
    noiseBurst(ctx, out, t, noise, 'bandpass', 1800 + brightness * 2600, 1.2, 0.001, 0.05, 0.7);
    tone(ctx, out, t, 420 + brightness * 260, 'triangle', 0.001, 0.07, 0.35);
  };
}

/** Nota de racha con un segundo oscilador desafinado para dar brillo. */
function note(freq: number, sparkle = false): Synth {
  return (ctx, out, t) => {
    tone(ctx, out, t, freq, 'triangle', 0.005, 0.32, 0.32);
    tone(ctx, out, t, freq * 2, 'sine', 0.005, 0.22, 0.08, 6);
    if (sparkle) {
      [1.5, 2, 3].forEach((m, i) => tone(ctx, out, t + 0.06 * (i + 1), freq * m, 'sine', 0.004, 0.18, 0.07));
    }
  };
}

const NOTES = DEFAULT_CONFIG.feedback.streakNotesHz;

const SYNTHS: Record<SfxName, Synth> = {
  bounce_table: (ctx, out, t, noise) => {
    tone(ctx, out, t, 1450, 'sine', 0.001, 0.045, 0.45);
    noiseBurst(ctx, out, t, noise, 'highpass', 3000, 0.7, 0.001, 0.02, 0.25);
  },
  hit_normal: hit(0),
  hit_good: hit(0.5),
  hit_perfect: hit(1),
  // Topspin: roce que sube (la goma "cepilla" la bola).
  hit_topspin: (ctx, out, t, noise) => {
    const f = noiseBurst(ctx, out, t, noise, 'bandpass', 900, 3, 0.004, 0.11, 0.45);
    f.frequency.exponentialRampToValueAtTime(3800, t + 0.11);
  },
  // Slice: corte seco que baja.
  hit_slice: (ctx, out, t, noise) => {
    const f = noiseBurst(ctx, out, t, noise, 'highpass', 4200, 1.5, 0.002, 0.09, 0.4);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.09);
  },
  // Smash: chasquido fuerte con cuerpo grave.
  hit_smash: (ctx, out, t, noise) => {
    noiseBurst(ctx, out, t, noise, 'lowpass', 6000, 0.7, 0.001, 0.09, 0.9);
    tone(ctx, out, t, 160, 'sine', 0.002, 0.12, 0.5);
  },
  // Bloqueo: golpe sordo y corto.
  hit_block: (ctx, out, t, noise) => {
    noiseBurst(ctx, out, t, noise, 'lowpass', 900, 1, 0.001, 0.05, 0.6);
    tone(ctx, out, t, 300, 'triangle', 0.001, 0.05, 0.3);
  },
  streak_1: note(NOTES[0]),
  streak_2: note(NOTES[1]),
  streak_3: note(NOTES[2]),
  streak_4: note(NOTES[3], true),
  net: (ctx, out, t, noise) => {
    noiseBurst(ctx, out, t, noise, 'lowpass', 500, 0.8, 0.003, 0.16, 0.8);
    tone(ctx, out, t, 140, 'sine', 0.003, 0.12, 0.3);
  },
  whiff: (ctx, out, t, noise) => {
    const f = noiseBurst(ctx, out, t, noise, 'bandpass', 600, 2.5, 0.06, 0.12, 0.35);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
  },
  edge: (ctx, out, t) => tone(ctx, out, t, 2600, 'square', 0.001, 0.03, 0.15),
  point_win: (ctx, out, t) => {
    tone(ctx, out, t, 783.99, 'triangle', 0.005, 0.14, 0.3);
    tone(ctx, out, t + 0.1, 1046.5, 'triangle', 0.005, 0.25, 0.3);
  },
  point_lose: (ctx, out, t) => {
    tone(ctx, out, t, 329.63, 'triangle', 0.005, 0.14, 0.3);
    tone(ctx, out, t + 0.12, 261.63, 'triangle', 0.005, 0.28, 0.3);
  },
  countdown: (ctx, out, t) => tone(ctx, out, t, 660, 'square', 0.002, 0.1, 0.15),
  go: (ctx, out, t) => tone(ctx, out, t, 990, 'square', 0.002, 0.25, 0.18),
  special_ready: note(NOTES[2], true),
  special_activate: (ctx, out, t, noise) => {
    noiseBurst(ctx, out, t, noise, 'bandpass', 900, 1, 0.02, 0.3, 0.4);
    tone(ctx, out, t, 220, 'sawtooth', 0.01, 0.3, 0.15);
  },
};
