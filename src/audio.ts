export type PowerupSound = "shield" | "triple" | "missile" | "laser";

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

  powerup(type: PowerupSound, volume = 1): void {
    const notes = type === "shield"
      ? [440, 660, 880, 1320]
      : type === "triple"
        ? [330, 495, 740, 990]
        : type === "missile"
          ? [220, 330, 550, 880]
          : [620, 930, 1395, 1860];
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
    this.tone(1380, 240, 0.2, "square", 0.11 * volume);
    this.tone(920, 1840, 0.16, "sine", 0.1 * volume, 0.035);
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
}
