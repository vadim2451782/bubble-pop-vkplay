/**
 * Procedural Web Audio: no external sound files, so the game stays fully
 * offline after the first visit. Music is a gentle synth loop, SFX are short
 * oscillator/noise gestures created on demand.
 */
export class AudioEngine {
  constructor(settings = { sound: true, music: true }) {
    this.settings = { sound: true, music: true, ...settings };
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.nextNoteTime = 0;
    this.noiseBuffer = null;
    this.unlocked = false;
  }

  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.settings.music ? 0.55 : 0;
      this.musicBus.connect(this.master);
      this.noiseBuffer = this.makeNoise(1.2);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (error) {
        return false;
      }
    }
    this.unlocked = true;
    this.startMusic();
    return true;
  }

  setSettings(next = {}) {
    Object.assign(this.settings, next);
    if (this.master) {
      this.master.gain.setTargetAtTime(this.settings.sound || this.settings.music ? 0.55 : 0, this.ctx.currentTime, 0.05);
    }
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(this.settings.music ? 0.5 : 0, this.ctx.currentTime, 0.1);
    }
    if (this.settings.music) this.startMusic();
    else this.stopMusic();
  }

  makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  tone({
    freq = 440,
    endFreq = freq,
    dur = 0.15,
    type = 'sine',
    gain = 0.08,
    when = 0,
    attack = 0.005,
    bus = null,
  } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    }
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(bus || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.18, gain = 0.1, freq = 900, q = 1.2, when = 0, sweep = null } = {}) {
    if (!this.ctx || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + when;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t0 + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    source.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    source.start(t0);
    source.stop(t0 + dur + 0.02);
  }

  play(name, options = {}) {
    if (!this.ctx || !this.settings.sound) return;
    const now = 0;
    switch (name) {
      case 'shoot':
        this.tone({ freq: 620, endFreq: 240, dur: 0.14, type: 'triangle', gain: 0.07 });
        this.noise({ dur: 0.09, gain: 0.03, freq: 1500, sweep: 500 });
        break;
      case 'bounce':
        this.tone({ freq: 880, endFreq: 700, dur: 0.06, type: 'sine', gain: 0.035 });
        break;
      case 'place':
        this.tone({ freq: 300, endFreq: 240, dur: 0.1, type: 'sine', gain: 0.06 });
        break;
      case 'pop': {
        const combo = Math.min(8, options.combo || 1);
        const base = 460 + combo * 55;
        this.tone({ freq: base, endFreq: base * 1.6, dur: 0.12, type: 'sine', gain: 0.09 });
        this.tone({ freq: base * 1.5, endFreq: base * 2.1, dur: 0.1, type: 'triangle', gain: 0.045, when: 0.015 });
        this.noise({ dur: 0.1, gain: 0.025, freq: 2600, sweep: 1200 });
        break;
      }
      case 'fall':
        this.tone({ freq: 420, endFreq: 120, dur: 0.35, type: 'sine', gain: 0.05, when: 0.02 });
        break;
      case 'swap':
        this.tone({ freq: 500, endFreq: 760, dur: 0.09, type: 'sine', gain: 0.05 });
        break;
      case 'click':
        this.tone({ freq: 1200, endFreq: 900, dur: 0.045, type: 'sine', gain: 0.04 });
        break;
      case 'buy':
        this.tone({ freq: 660, dur: 0.08, type: 'triangle', gain: 0.07 });
        this.tone({ freq: 990, dur: 0.12, type: 'triangle', gain: 0.06, when: 0.08 });
        break;
      case 'bonus':
        [660, 880, 1320].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.06, when: i * 0.07 }));
        break;
      case 'bomb':
        this.noise({ dur: 0.5, gain: 0.14, freq: 320, q: 0.6, sweep: 70 });
        this.tone({ freq: 130, endFreq: 42, dur: 0.5, type: 'sine', gain: 0.14 });
        break;
      case 'lightning':
        this.noise({ dur: 0.32, gain: 0.09, freq: 3200, sweep: 600 });
        this.tone({ freq: 1400, endFreq: 300, dur: 0.25, type: 'sawtooth', gain: 0.035 });
        break;
      case 'rocket':
        this.noise({ dur: 0.4, gain: 0.09, freq: 700, sweep: 2400 });
        this.tone({ freq: 160, endFreq: 520, dur: 0.35, type: 'sawtooth', gain: 0.04 });
        break;
      case 'rainbow':
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.2, type: 'sine', gain: 0.05, when: i * 0.06 }));
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.075, when: i * 0.1 }));
        this.tone({ freq: 1046, dur: 0.55, type: 'sine', gain: 0.05, when: 0.55 });
        break;
      case 'lose':
        [392, 349, 294, 233].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.06, when: i * 0.12 }));
        break;
      case 'star':
        this.tone({ freq: 1046, endFreq: 1568, dur: 0.2, type: 'triangle', gain: 0.055, when: now });
        break;
      default:
        break;
    }
  }

  /** Silence everything while an ad is on screen or the tab is in the background. */
  pauseAll() {
    this.stopMusic();
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  /** Bring sound back afterwards, honouring the player's settings. */
  resumeAll() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this.settings.music) this.startMusic();
  }

  startMusic() {
    if (!this.ctx || !this.settings.music) return;
    if (this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.2;
    this.musicStep = 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 220);
    this.scheduleMusic();
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  scheduleMusic() {
    if (!this.ctx || !this.settings.music) return;
    if (this.ctx.state === 'suspended') return;
    const chords = [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [48, 52, 55, 60],
      [55, 59, 62, 67],
    ];
    const stepDuration = 0.32;
    while (this.nextNoteTime < this.ctx.currentTime + 0.7) {
      const step = this.musicStep;
      const bar = Math.floor(step / 8) % chords.length;
      const chord = chords[bar];
      const note = chord[step % 4];
      const midi = note + 12;
      const freq = 440 * 2 ** ((midi - 69) / 12);
      if (step % 2 === 0) {
        this.tone({
          freq,
          dur: stepDuration * 1.8,
          type: 'triangle',
          gain: 0.028,
          bus: this.musicBus,
          attack: 0.02,
        });
      }
      if (step % 8 === 0) {
        const bass = 440 * 2 ** ((chord[0] - 12 - 69) / 12);
        this.tone({
          freq: bass,
          dur: 1.4,
          type: 'sine',
          gain: 0.032,
          bus: this.musicBus,
          attack: 0.02,
        });
      }
      if (step % 4 === 2) {
        this.tone({
          freq: freq * 2,
          dur: 0.18,
          type: 'sine',
          gain: 0.012,
          bus: this.musicBus,
        });
      }
      this.nextNoteTime += stepDuration;
      this.musicStep += 1;
    }
  }
}
