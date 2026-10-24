// Звуки и музыка синтезируются на лету через Web Audio: файлы не нужны, игра остаётся лёгкой.

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.8;
    this.musicVol = 0.4;
    this.last = {};
    this.listener = { x: 0, z: 0 };
    this.musicOn = false;
  }

  // Браузер разрешает звук только после нажатия, поэтому вызываем из обработчика кнопки
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    this.music = c.createGain();
    this.music.connect(this.master);
    this.setVolumes(this.sfxVol, this.musicVol);
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx;
    this.musicVol = music;
    if (!this.ctx) return;
    this.sfx.gain.value = sfx;
    this.music.gain.value = music * 0.5;
  }

  suspend() { this.ctx?.suspend?.(); }
  resume() { this.ctx?.resume?.(); }

  tone(type, f1, f2, dur, vol, when = 0, out = this.sfx) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hiss(freq, q, dur, vol, sweepTo = freq, when = 0, out = this.sfx) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo !== freq) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  // name — какой звук, pos — где (тише вдали от игрока)
  play(name, pos = null) {
    if (!this.ctx || this.ctx.state !== 'running' || this.sfxVol <= 0) return;
    let k = 1;
    if (pos) {
      const d = Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z);
      if (d > 32) return;
      k = 1 - d / 36;
    }
    const now = this.ctx.currentTime;
    if (now - (this.last[name] ?? 0) < 0.045) return;
    this.last[name] = now;
    const v = (x) => x * k;
    switch (name) {
      case 'hit': this.hiss(1400, 1.2, 0.07, v(0.25)); break;
      case 'crit': this.hiss(2200, 1, 0.12, v(0.35)); this.tone('square', 900, 500, 0.08, v(0.08)); break;
      case 'shoot': this.tone('triangle', 720, 380, 0.09, v(0.12)); break;
      case 'arrow': this.hiss(3000, 3, 0.1, v(0.18), 1500); break;
      case 'tower': this.tone('sawtooth', 900, 160, 0.18, v(0.09)); break;
      case 'fireball': this.hiss(500, 0.8, 0.35, v(0.3), 1600); break;
      case 'frost': this.hiss(4000, 2, 0.4, v(0.18), 1800); this.tone('sine', 1400, 1900, 0.3, v(0.05)); break;
      case 'shield': this.tone('sine', 300, 900, 0.3, v(0.12)); break;
      case 'dash': this.hiss(900, 0.7, 0.2, v(0.3), 300); break;
      case 'boom': this.hiss(220, 0.6, 0.55, v(0.6), 60); this.tone('sine', 110, 40, 0.4, v(0.4)); break;
      case 'smallboom': this.hiss(400, 0.7, 0.25, v(0.35), 120); this.tone('sine', 160, 60, 0.2, v(0.2)); break;
      case 'stun': this.tone('triangle', 1500, 1500, 0.08, v(0.08)); this.tone('triangle', 1900, 1900, 0.08, v(0.08), 0.08); break;
      case 'buff': this.tone('sine', 500, 1000, 0.25, v(0.15)); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.14, i * 0.07)); break;
      case 'coin': this.tone('triangle', 1318, 1318, 0.07, 0.1); this.tone('triangle', 1760, 1760, 0.12, 0.1, 0.06); break;
      case 'death': this.tone('sawtooth', 380, 70, 0.7, v(0.15)); break;
      case 'kill': [392, 523, 659].forEach((f) => this.tone('square', f, f, 0.35, 0.05)); break;
      case 'bad': [330, 262, 196].forEach((f, i) => this.tone('square', f, f, 0.22, 0.05, i * 0.12)); break;
      case 'structure': this.hiss(150, 0.5, 1.2, v(0.6), 40); this.tone('sine', 70, 30, 1, v(0.5)); break;
      case 'click': this.tone('square', 1200, 1200, 0.03, 0.05); break;
      case 'roar': this.hiss(260, 1, 0.9, v(0.4), 120); this.tone('sawtooth', 120, 70, 0.8, v(0.12)); break;
      default: break;
    }
  }

  // Фоновая музыка: аккорды, бас и тихий ритм, генерируются по ходу
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const beat = 60 / 88;
    let step = 0;
    let next = this.ctx.currentTime + 0.1;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const schedule = () => {
      if (!this.musicOn || !this.ctx) return;
      while (next < this.ctx.currentTime + 0.6) {
        const when = next - this.ctx.currentTime;
        const bar = Math.floor(step / 8) % 4;
        const chord = chords[bar];
        if (step % 8 === 0) {
          for (const n of chord) this.tone('sawtooth', midi(n), midi(n), beat * 4, 0.025, when, this.music);
          this.tone('sine', midi(chord[0] - 24), midi(chord[0] - 24), beat * 3.5, 0.12, when, this.music);
        }
        if (step % 2 === 0) this.tone('sine', 120, 45, 0.18, step % 4 === 0 ? 0.16 : 0.06, when, this.music);
        this.hiss(7000, 2, 0.04, 0.03, 7000, when, this.music);
        if (step % 8 === 6) this.tone('triangle', midi(chord[2] + 12), midi(chord[2] + 12), beat * 0.9, 0.025, when, this.music);
        step++;
        next += beat / 2;
      }
      this.musicTimer = setTimeout(schedule, 200);
    };
    schedule();
  }

  stopMusic() {
    this.musicOn = false;
    clearTimeout(this.musicTimer);
  }
}
