import type { Param } from "klangwerk";
import { param, SoundNode } from "klangwerk/tone";

/**
 * The master's live filter: a DJ-style lowpass/highpass on one bipolar value
 * and a separate rising highpass for build-ups. At rest the lowpass sits at
 * Nyquist and the highpasses at 0 Hz, where a biquad passes the signal
 * through (measured: within float rounding, below −130 dB), so renders and
 * exports sound exactly as without it.
 */
export class PerformanceFilter extends SoundNode {
  readonly name = "PerformanceFilter";
  readonly input: GainNode;
  readonly output: BiquadFilterNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly highpass: BiquadFilterNode;
  private readonly rise: BiquadFilterNode;
  private readonly riseFrequency: Param;
  private snapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.input = this.context.createGain();
    this.lowpass = this.biquad("lowpass", this.context.sampleRate / 2, 1.1);
    this.highpass = this.biquad("highpass", 0, 1.1);
    this.rise = this.biquad("highpass", 0, 1.35);
    this.input.connect(this.lowpass);
    this.lowpass.connect(this.highpass);
    this.highpass.connect(this.rise);
    this.output = this.rise;
    this.riseFrequency = param(this.rise.frequency, "frequency");
    this.riseFrequency.setValueAtTime(0, 0);
  }

  /** −1 closes the lowpass down to 110 Hz, +1 opens the highpass up to 2.8 kHz, 0 is neutral. */
  setFilter(value: number): void {
    const amount = Math.max(-1, Math.min(1, value));
    const time = this.now();
    const lowpass = amount < -0.005 ? 18_000 * (110 / 18_000) ** -amount : this.context.sampleRate / 2;
    const highpass = amount > 0.005 ? 25 * (2_800 / 25) ** amount : 0;
    this.lowpass.frequency.cancelScheduledValues(time);
    this.highpass.frequency.cancelScheduledValues(time);
    this.lowpass.frequency.setTargetAtTime(lowpass, time, 0.025);
    this.highpass.frequency.setTargetAtTime(highpass, time, 0.025);
    if (this.snapTimer !== null) clearTimeout(this.snapTimer);
    this.snapTimer = null;
    if (Math.abs(amount) > 0.005) return;
    // An exponential approach never lands exactly on Nyquist or 0 Hz; snap there once settled.
    this.snapTimer = setTimeout(() => {
      this.snapTimer = null;
      const now = this.now();
      this.lowpass.frequency.cancelScheduledValues(now);
      this.highpass.frequency.cancelScheduledValues(now);
      this.lowpass.frequency.setValueAtTime(this.context.sampleRate / 2, now);
      this.highpass.frequency.setValueAtTime(0, now);
    }, 300);
  }

  /** Sweeps the build-up highpass from 30 Hz to 1.1 kHz over `seconds`. */
  startRise(time: number, seconds: number): void {
    this.riseFrequency.cancelAndHoldAtTime(time);
    this.riseFrequency.setValueAtTime(30, time);
    this.riseFrequency.exponentialRampToValueAtTime(1_100, time + seconds);
  }

  /** The drop: the build-up highpass opens fully at `time`. */
  endRise(time: number): void {
    this.riseFrequency.cancelAndHoldAtTime(time);
    this.riseFrequency.setValueAtTime(0, time);
  }

  override dispose(): this {
    super.dispose();
    if (this.snapTimer !== null) clearTimeout(this.snapTimer);
    this.input.disconnect();
    this.lowpass.disconnect();
    this.highpass.disconnect();
    this.rise.disconnect();
    return this;
  }

  private biquad(type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }
}
