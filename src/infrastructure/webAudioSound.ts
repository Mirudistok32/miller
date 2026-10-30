import type { Cue, Sound } from '@/application/ports/sound';

interface Note {
  /** Частота в начале и в конце, Гц; у шума — частота полосового фильтра. */
  f0: number;
  f1: number;
  /** Задержка от начала звука и длительность, с. */
  at: number;
  len: number;
  wave: OscillatorType | 'noise';
  gain: number;
}

const n = (
  f0: number,
  f1: number,
  at: number,
  len: number,
  wave: Note['wave'],
  gain: number,
): Note => ({ f0, f1, at, len, wave, gain });

/** Звуки синтезируются на лету: ни одного файла, работает и с диска. */
const CUES: Record<Cue, Note[]> = {
  // деревянный стук жёлоба
  turn: [n(240, 150, 0, 0.06, 'triangle', 0.13), n(1400, 900, 0, 0.018, 'square', 0.025)],
  // тот же стук, но тон идёт вверх: на слух понятно, что жёлоб пошёл обратно
  turnBack: [n(150, 240, 0, 0.06, 'triangle', 0.13), n(900, 1400, 0, 0.018, 'square', 0.025)],
  blocked: [n(130, 90, 0, 0.09, 'sine', 0.09)],
  // вода побежала дальше
  trickle: [n(1800, 900, 0.04, 0.16, 'noise', 0.05), n(520, 940, 0.05, 0.07, 'sine', 0.045)],
  // колесо пошло: плеск, скрип и мелодия
  wheel: [
    n(900, 400, 0, 0.5, 'noise', 0.06),
    n(98, 82, 0, 0.4, 'sawtooth', 0.02),
    n(392, 392, 0.05, 0.12, 'square', 0.035),
    n(523, 523, 0.17, 0.12, 'square', 0.035),
    n(659, 659, 0.29, 0.12, 'square', 0.035),
    n(784, 784, 0.41, 0.3, 'square', 0.035),
  ],
  unlock: [n(880, 880, 0, 0.1, 'triangle', 0.07), n(1319, 1319, 0.09, 0.22, 'triangle', 0.07)],
};

export function createWebAudioSound(): Sound {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let enabled = true;

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
    return ctx;
  };

  /** Полсекунды белого шума — основа для плеска воды. */
  const noiseBuffer = (ac: AudioContext): AudioBuffer => {
    if (noise) return noise;
    const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    noise = buffer;
    return buffer;
  };

  return {
    setEnabled(on) {
      enabled = on;
    },
    play(cue) {
      if (!enabled) return;
      const ac = context();
      if (!ac) return;
      if (ac.state === 'suspended') void ac.resume();
      const t0 = ac.currentTime;
      for (const note of CUES[cue]) {
        const start = t0 + note.at;
        const amp = ac.createGain();
        amp.gain.setValueAtTime(note.gain, start);
        amp.gain.exponentialRampToValueAtTime(0.0001, start + note.len);
        if (note.wave === 'noise') {
          const src = ac.createBufferSource();
          const band = ac.createBiquadFilter();
          src.buffer = noiseBuffer(ac);
          band.type = 'bandpass';
          band.Q.value = 2.5;
          band.frequency.setValueAtTime(note.f0, start);
          band.frequency.exponentialRampToValueAtTime(note.f1, start + note.len);
          src.connect(band).connect(amp).connect(ac.destination);
          src.start(start);
          src.stop(start + note.len + 0.02);
        } else {
          const osc = ac.createOscillator();
          osc.type = note.wave;
          osc.frequency.setValueAtTime(note.f0, start);
          osc.frequency.exponentialRampToValueAtTime(note.f1, start + note.len);
          osc.connect(amp).connect(ac.destination);
          osc.start(start);
          osc.stop(start + note.len + 0.02);
        }
      }
    },
  };
}
