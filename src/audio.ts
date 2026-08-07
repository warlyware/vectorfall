export type PowerupSound =
  | "shield"
  | "triple"
  | "missile"
  | "laser"
  | "phase"
  | "afterburner"
  | "gravity"
  | "reflector"
  | "fuel"
  | "overcharge";

export class ArcadeAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastRicochet = 0;
  private lastImpact = 0;

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.2;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  fire(triple = false, volume = 1): void {
    this.tone(760, 210, 0.085, "square", 0.22 * volume);
    this.tone(1180, 480, 0.045, "sawtooth", 0.07 * volume, 0.012);
    if (triple) this.tone(920, 260, 0.1, "square", 0.11 * volume, 0.025);
  }

  missileFire(volume = 1): void {
    this.tone(210, 95, 0.16, "sawtooth", 0.16 * volume);
    this.noise(0.11, 0.07 * volume, 160, 900);
  }

  laserFire(volume = 1): void {
    this.tone(1680, 520, 0.075, "square", 0.17 * volume);
    this.tone(2300, 980, 0.045, "sine", 0.08 * volume, 0.008);
  }

  ricochet(volume = 1): void {
    const now = performance.now();
    if (now - this.lastRicochet < 45) return;
    this.lastRicochet = now;
    this.tone(1250, 620, 0.055, "square", 0.1 * volume);
    this.tone(1760, 980, 0.035, "sine", 0.06 * volume, 0.01);
  }

  impact(speed: number): void {
    const now = performance.now();
    if (now - this.lastImpact < 110) return;
    this.lastImpact = now;
    const strength = Math.min(1, Math.max(0.2, speed / 280));
    this.noise(0.075, 0.12 * strength, 180, 850);
    this.tone(150, 75, 0.09, "square", 0.1 * strength);
  }

  shieldHit(volume = 1): void {
    this.tone(980, 1480, 0.09, "sine", 0.12 * volume);
    this.tone(1520, 920, 0.13, "triangle", 0.06 * volume, 0.018);
  }

  hullHit(volume = 1): void {
    this.noise(0.09, 0.13 * volume, 120, 1100);
    this.tone(130, 58, 0.12, "sawtooth", 0.1 * volume);
  }

  explosion(volume = 1): void {
    this.noise(0.42, 0.34 * volume, 55, 1500);
    this.tone(125, 34, 0.4, "sawtooth", 0.24 * volume);
    this.tone(70, 42, 0.3, "square", 0.1 * volume, 0.035);
  }

  reflect(volume = 1): void {
    this.tone(720, 1760, 0.11, "triangle", 0.13 * volume);
    this.tone(1420, 540, 0.09, "square", 0.07 * volume, 0.025);
  }

  mineExplosion(volume = 1): void {
    this.tone(260, 42, 0.48, "sawtooth", 0.2 * volume);
    this.noise(0.35, 0.22 * volume, 65, 950, 0.04);
  }

  powerup(type: PowerupSound, volume = 1): void {
    const noteSets: Record<PowerupSound, number[]> = {
      shield: [440, 660, 880, 1320],
      triple: [330, 495, 740, 990],
      missile: [220, 330, 550, 880],
      laser: [620, 930, 1395, 1860],
      phase: [280, 560, 1120, 1680],
      afterburner: [180, 360, 720, 1080],
      gravity: [520, 390, 260, 130],
      reflector: [480, 960, 720, 1440],
      fuel: [260, 390, 520, 780],
      overcharge: [420, 840, 1260, 2100],
    };
    const notes = noteSets[type];
    notes.forEach((frequency, index) => {
      this.tone(
        frequency,
        frequency * 1.04,
        0.12,
        index % 2 === 0 ? "square" : "triangle",
        0.09 * volume,
        index * 0.055,
      );
    });
  }

  wormholeEnter(volume = 1): void {
    this.tone(95, 720, 0.72, "sawtooth", 0.1 * volume);
    this.tone(180, 1380, 0.82, "sine", 0.08 * volume, 0.08);
    this.noise(0.6, 0.08 * volume, 280, 2400, 0.08);
  }

  wormholeExit(volume = 1): void {
    this.whoosh(0.48, 0.16 * volume);
    this.tone(210, 92, 0.32, "sine", 0.045 * volume, 0.035);
  }

  win(volume = 1): void {
    [523, 659, 784, 1047, 1319].forEach((frequency, index) => {
      this.tone(frequency, frequency * 1.015, 0.24, index % 2 ? "triangle" : "square", 0.1 * volume, index * 0.11);
    });
    this.noise(0.32, 0.055 * volume, 900, 4200, 0.34);
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
  ): void {
    if (!this.context || !this.master) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(
    duration: number,
    volume: number,
    lowFrequency: number,
    highFrequency: number,
    delay = 0,
  ): void {
    if (!this.context || !this.master) return;
    const frameCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const envelope = 1 - index / frameCount;
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const start = this.context.currentTime + delay;
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(highFrequency, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, lowFrequency), start + duration);
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start);
  }

  private whoosh(duration: number, volume: number): void {
    if (!this.context || !this.master) return;
    const frameCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let smoothedNoise = 0;
    for (let index = 0; index < frameCount; index += 1) {
      smoothedNoise = smoothedNoise * 0.35 + (Math.random() * 2 - 1) * 0.65;
      samples[index] = smoothedNoise;
    }

    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    const start = this.context.currentTime;
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.Q.value = 0.55;
    filter.frequency.setValueAtTime(320, start);
    filter.frequency.exponentialRampToValueAtTime(2800, start + duration * 0.42);
    filter.frequency.exponentialRampToValueAtTime(620, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + duration * 0.14);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    panner.pan.setValueAtTime(-0.45, start);
    panner.pan.linearRampToValueAtTime(0.45, start + duration);
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    source.start(start);
  }
}
