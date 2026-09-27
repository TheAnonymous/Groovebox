import * as Tone from "tone";

/*
 * Lean replacements for Tone.js effect components.
 *
 * Tone's wrappers drive every parameter through a running ConstantSourceNode
 * and wrap effects in cross-fades, splitters and helper gains. The Groovebox
 * graph ended up with about 1,650 native nodes, and Chromium spends roughly
 * 1 ms of audio-thread time per node and second, so live playback underran.
 * The classes below rebuild the same signal topology and the same parameter
 * mapping from plain native nodes; automation goes through Tone.Param, which
 * wraps an AudioParam without creating nodes.
 */

type Seconds = number;

interface AutomatableParam {
  value: unknown;
  setValueAtTime(value: number, time: Tone.Unit.Time): unknown;
  linearRampToValueAtTime(value: number, time: Tone.Unit.Time): unknown;
  exponentialRampToValueAtTime(value: number, time: Tone.Unit.Time): unknown;
  setTargetAtTime(value: number, startTime: Tone.Unit.Time, timeConstant: number): unknown;
  rampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): unknown;
  linearRampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): unknown;
  exponentialRampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): unknown;
  cancelScheduledValues(time: Tone.Unit.Time): unknown;
  cancelAndHoldAtTime(time: Tone.Unit.Time): unknown;
  dispose(): unknown;
}

/** Applies every automation call to several params that must move together (cascaded biquads, stereo LFOs). */
export class ParamGroup implements AutomatableParam {
  constructor(private readonly params: readonly AutomatableParam[]) {}

  get value(): number {
    return Number(this.params[0]!.value);
  }

  set value(value: number) {
    for (const param of this.params) param.value = value;
  }

  setValueAtTime(value: number, time: Tone.Unit.Time): this {
    for (const param of this.params) param.setValueAtTime(value, time);
    return this;
  }

  linearRampToValueAtTime(value: number, time: Tone.Unit.Time): this {
    for (const param of this.params) param.linearRampToValueAtTime(value, time);
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: Tone.Unit.Time): this {
    for (const param of this.params) param.exponentialRampToValueAtTime(value, time);
    return this;
  }

  setTargetAtTime(value: number, startTime: Tone.Unit.Time, timeConstant: number): this {
    for (const param of this.params) param.setTargetAtTime(value, startTime, timeConstant);
    return this;
  }

  rampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): this {
    for (const param of this.params) param.rampTo(value, rampTime, startTime);
    return this;
  }

  linearRampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): this {
    for (const param of this.params) param.linearRampTo(value, rampTime, startTime);
    return this;
  }

  exponentialRampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): this {
    for (const param of this.params) param.exponentialRampTo(value, rampTime, startTime);
    return this;
  }

  cancelScheduledValues(time: Tone.Unit.Time): this {
    for (const param of this.params) param.cancelScheduledValues(time);
    return this;
  }

  cancelAndHoldAtTime(time: Tone.Unit.Time): this {
    for (const param of this.params) param.cancelAndHoldAtTime(time);
    return this;
  }

  dispose(): this {
    for (const param of this.params) param.dispose();
    return this;
  }
}

function param<TUnit extends Tone.Unit.UnitName>(
  context: Tone.BaseContext,
  native: AudioParam,
  units: TUnit,
  value?: number,
  convert = true,
): Tone.Param<TUnit> {
  const wrapped = new Tone.Param<TUnit>({ context, param: native, units, convert } as never);
  if (value !== undefined) wrapped.value = value as never;
  return wrapped;
}

export interface LeanFilterOptions {
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
  gain?: number;
  rolloff?: -12 | -24 | -48 | -96;
}

/** Same as Tone.Filter: `rolloff / -12` cascaded biquads sharing frequency, Q and gain. */
export class LeanFilter extends Tone.ToneAudioNode {
  readonly name = "LeanFilter";
  readonly input: BiquadFilterNode;
  readonly output: BiquadFilterNode;
  readonly frequency: ParamGroup;
  readonly Q: ParamGroup;
  readonly gain: ParamGroup;
  private readonly biquads: BiquadFilterNode[];

  constructor(options: LeanFilterOptions) {
    super();
    const count = [-12, -24, -48, -96].indexOf(options.rolloff ?? -12) + 1;
    this.biquads = Array.from({ length: count }, () => {
      const biquad = this.context.createBiquadFilter();
      biquad.type = options.type;
      return biquad;
    });
    this.biquads.forEach((biquad, index) => {
      const next = this.biquads[index + 1];
      if (next) biquad.connect(next);
    });
    this.input = this.biquads[0]!;
    this.output = this.biquads[this.biquads.length - 1]!;
    this.frequency = new ParamGroup(this.biquads.map((biquad) => param(this.context, biquad.frequency, "frequency", options.frequency)));
    this.Q = new ParamGroup(this.biquads.map((biquad) => param(this.context, biquad.Q, "positive", options.Q ?? 1)));
    // BiquadFilterNode.gain is already in decibels, so no conversion (as Tone.Filter's gain signal).
    this.gain = new ParamGroup(this.biquads.map((biquad) => param(this.context, biquad.gain, "decibels", options.gain ?? 0, false)));
  }

  dispose(): this {
    super.dispose();
    this.frequency.dispose();
    this.Q.dispose();
    this.gain.dispose();
    this.biquads.forEach((biquad) => biquad.disconnect());
    return this;
  }
}

export interface LeanEq3Options {
  low?: number;
  mid?: number;
  high?: number;
  lowFrequency?: number;
  highFrequency?: number;
}

/**
 * Same as Tone.EQ3: Tone.MultibandSplit (12 dB/oct crossovers, Q 1) with a
 * decibel gain per band, summed into one output.
 */
export class LeanEq3 extends Tone.ToneAudioNode {
  readonly name = "LeanEq3";
  readonly input: GainNode;
  readonly output: GainNode;
  readonly low: Tone.Param<"decibels">;
  readonly mid: Tone.Param<"decibels">;
  readonly high: Tone.Param<"decibels">;
  private readonly nodes: AudioNode[];

  constructor(options: LeanEq3Options = {}) {
    super();
    const lowFrequency = options.lowFrequency ?? 400;
    const highFrequency = options.highFrequency ?? 2_500;
    const biquad = (type: BiquadFilterType, frequency: number) => {
      const node = this.context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = 1;
      return node;
    };
    this.input = this.context.createGain();
    this.output = this.context.createGain();
    const lowBand = biquad("lowpass", lowFrequency);
    const lowMid = biquad("highpass", lowFrequency);
    const midBand = biquad("lowpass", highFrequency);
    const highBand = biquad("highpass", highFrequency);
    const lowGain = this.context.createGain();
    const midGain = this.context.createGain();
    const highGain = this.context.createGain();
    this.input.connect(lowBand);
    this.input.connect(highBand);
    this.input.connect(lowMid);
    lowMid.connect(midBand);
    lowBand.connect(lowGain);
    midBand.connect(midGain);
    highBand.connect(highGain);
    lowGain.connect(this.output);
    midGain.connect(this.output);
    highGain.connect(this.output);
    this.low = param(this.context, lowGain.gain, "decibels", options.low ?? 0);
    this.mid = param(this.context, midGain.gain, "decibels", options.mid ?? 0);
    this.high = param(this.context, highGain.gain, "decibels", options.high ?? 0);
    this.nodes = [this.input, lowBand, lowMid, midBand, highBand, lowGain, midGain, highGain, this.output];
  }

  dispose(): this {
    super.dispose();
    this.low.dispose();
    this.mid.dispose();
    this.high.dispose();
    this.nodes.forEach((node) => node.disconnect());
    return this;
  }
}

export interface LeanChorusOptions {
  frequency: number;
  /** Centre delay in milliseconds, as in Tone.Chorus. */
  delayTime: number;
  depth: number;
  spread: number;
}

/**
 * Same as Tone.Chorus with feedback 0 and wet 1: the stereo input is split,
 * each side runs through a delay whose time a sine LFO sweeps between
 * `delay·(1 − depth)` and `delay·(1 + depth)`, with the two LFO phases
 * `spread` degrees apart.
 */
export class LeanChorus extends Tone.ToneAudioNode {
  readonly name = "LeanChorus";
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly frequency: ParamGroup;
  private readonly nodes: AudioNode[];
  private readonly oscillators: OscillatorNode[];

  constructor(options: LeanChorusOptions) {
    super();
    const centre = options.delayTime / 1_000;
    const deviation = centre * options.depth;
    const min = Math.max(centre - deviation, 0);
    const max = centre + deviation;
    this.input = this.context.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = "explicit";
    const split = this.context.createChannelSplitter(2);
    this.output = this.context.createChannelMerger(2);
    this.input.connect(split);
    const phases = [90 - options.spread / 2, 90 + options.spread / 2];
    this.oscillators = [];
    const sides = phases.map((phaseDegrees, channel) => {
      const delay = this.context.createDelay(1);
      delay.delayTime.value = (min + max) / 2;
      const depth = this.context.createGain();
      depth.gain.value = (max - min) / 2;
      const oscillator = this.context.createOscillator();
      oscillator.setPeriodicWave(sineWithPhase(this.context, phaseDegrees));
      oscillator.frequency.value = options.frequency;
      oscillator.connect(depth);
      depth.connect(delay.delayTime);
      split.connect(delay, channel, 0);
      delay.connect(this.output, 0, channel);
      this.oscillators.push(oscillator);
      return [delay, depth, oscillator] as AudioNode[];
    });
    const startAt = this.context.currentTime;
    this.oscillators.forEach((oscillator) => oscillator.start(startAt));
    this.frequency = new ParamGroup(this.oscillators.map((oscillator) => param(this.context, oscillator.frequency, "frequency")));
    this.nodes = [this.input, split, this.output, ...sides.flat()];
  }

  dispose(): this {
    super.dispose();
    this.frequency.dispose();
    this.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // already stopped
      }
    });
    this.nodes.forEach((node) => node.disconnect());
    return this;
  }
}

/** Tone.Oscillator's phase-shifted sine: real[1] = −sin φ, imag[1] = cos φ. */
function sineWithPhase(context: Tone.BaseContext, degrees: number): PeriodicWave {
  const phase = (degrees * Math.PI) / 180;
  const real = new Float32Array([0, -Math.sin(phase)]);
  const imag = new Float32Array([0, Math.cos(phase)]);
  return context.createPeriodicWave(real, imag);
}

export interface LeanFeedbackDelayOptions {
  delayTime: Tone.Unit.Time;
  feedback: number;
  maxDelay?: Seconds;
}

/** Same as Tone.FeedbackDelay with wet 1: send → delay → return, return → feedback gain → delay. */
export class LeanFeedbackDelay extends Tone.ToneAudioNode {
  readonly name = "LeanFeedbackDelay";
  readonly input: GainNode;
  readonly output: GainNode;
  readonly delayTime: Tone.Param<"time">;
  readonly feedback: Tone.Param<"normalRange">;
  private readonly nodes: AudioNode[];

  constructor(options: LeanFeedbackDelayOptions) {
    super();
    const delaySeconds = this.toSeconds(options.delayTime);
    this.input = this.context.createGain();
    const delay = this.context.createDelay(Math.max(options.maxDelay ?? 1, delaySeconds));
    this.output = this.context.createGain();
    const feedbackGain = this.context.createGain();
    this.input.connect(delay);
    delay.connect(this.output);
    this.output.connect(feedbackGain);
    feedbackGain.connect(delay);
    this.delayTime = param(this.context, delay.delayTime, "time", delaySeconds);
    this.feedback = param(this.context, feedbackGain.gain, "normalRange", options.feedback);
    this.nodes = [this.input, delay, this.output, feedbackGain];
  }

  dispose(): this {
    super.dispose();
    this.delayTime.dispose();
    this.feedback.dispose();
    this.nodes.forEach((node) => node.disconnect());
    return this;
  }
}

export interface LeanReverbOptions {
  decay: Seconds;
  preDelay: Seconds;
}

/**
 * Same as Tone.Reverb with wet 1: a convolver whose impulse response is
 * generated exactly like Tone.Reverb.generate() (stereo noise, silent
 * pre-delay, exponential decay).
 */
export class LeanReverb extends Tone.ToneAudioNode {
  readonly name = "LeanReverb";
  readonly input: ConvolverNode;
  readonly output: ConvolverNode;
  readonly ready: Promise<void>;

  constructor(options: LeanReverbOptions) {
    super();
    this.input = this.output = this.context.createConvolver();
    this.ready = generateImpulse(this.context.sampleRate, options.decay, options.preDelay).then((buffer) => {
      this.input.buffer = buffer;
    });
  }

  dispose(): this {
    super.dispose();
    this.input.disconnect();
    return this;
  }
}

async function generateImpulse(sampleRate: number, decay: Seconds, preDelay: Seconds): Promise<AudioBuffer> {
  const context = new Tone.OfflineContext(2, decay + preDelay, sampleRate);
  const noiseL = new Tone.Noise({ context });
  const noiseR = new Tone.Noise({ context });
  const merge = new Tone.Merge({ context });
  noiseL.connect(merge, 0, 0);
  noiseR.connect(merge, 0, 1);
  const gainNode = new Tone.Gain({ context }).toDestination();
  merge.connect(gainNode);
  noiseL.start(0);
  noiseR.start(0);
  gainNode.gain.setValueAtTime(0, 0);
  gainNode.gain.setValueAtTime(1, preDelay);
  gainNode.gain.exponentialApproachValueAtTime(0, preDelay, decay);
  const rendered = (await context.render()).get();
  if (!rendered) throw new Error("Hall-Impulsantwort konnte nicht erzeugt werden");
  return rendered;
}

export interface LeanMeterOptions {
  normalRange?: boolean;
  smoothing?: number;
}

/**
 * Same readings as a one-channel Tone.Meter: RMS over the last 256 samples of
 * the left channel, falling at most by `smoothing` per read. It is a tap, not
 * an inline node: connect the source to it and to its real destination.
 */
export class LeanMeter extends Tone.ToneAudioNode {
  readonly name = "LeanMeter";
  readonly input: AnalyserNode;
  readonly output = undefined;
  private readonly analyser: AnalyserNode;
  private readonly buffer: Float32Array<ArrayBuffer>;
  private readonly normalRange: boolean;
  private readonly smoothing: number;
  private rms = 0;

  constructor(options: LeanMeterOptions = {}) {
    super();
    this.analyser = this.input = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.channelCount = 1;
    this.analyser.channelCountMode = "explicit";
    this.analyser.channelInterpretation = "discrete";
    this.buffer = new Float32Array(new ArrayBuffer(256 * Float32Array.BYTES_PER_ELEMENT));
    this.normalRange = options.normalRange ?? false;
    this.smoothing = options.smoothing ?? 0.8;
  }

  getValue(): number {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let total = 0;
    for (const sample of this.buffer) total += sample * sample;
    const rms = Math.sqrt(total / this.buffer.length);
    this.rms = rms < Tone.dbToGain(-100) ? 0 : Math.max(rms, this.rms * this.smoothing);
    return this.normalRange ? this.rms : Tone.gainToDb(this.rms);
  }

  dispose(): this {
    super.dispose();
    this.analyser.disconnect();
    return this;
  }
}

/**
 * Keeps a sound source connected to its destination only while it can be
 * audible. Chromium only processes nodes reachable from the destination, so a
 * sleeping bank costs nothing. Offline renders stay connected throughout.
 */
export class SleepyOutput {
  private connected = false;
  private silentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly source: Tone.ToneAudioNode,
    private readonly destination: Tone.ToneAudioNode | AudioNode,
    private readonly alwaysAwake: boolean,
  ) {
    if (alwaysAwake) this.wake(0, Number.POSITIVE_INFINITY);
  }

  /** Connects now (the note is scheduled ahead) and stays awake until `until` (context time). */
  wake(_time: Seconds, until: Seconds): void {
    this.silentAt = Math.max(this.silentAt, until);
    if (!this.connected) {
      this.source.connect(this.destination);
      this.connected = true;
    }
    if (this.alwaysAwake || !Number.isFinite(this.silentAt)) return;
    this.schedule();
  }

  sleepNow(): void {
    if (this.alwaysAwake) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.silentAt = 0;
    if (this.connected) {
      this.source.disconnect(this.destination);
      this.connected = false;
    }
  }

  get awake(): boolean {
    return this.connected;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const delay = Math.max(0, (this.silentAt - this.source.context.currentTime) * 1_000) + 50;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.source.context.currentTime < this.silentAt) {
        this.schedule();
        return;
      }
      if (this.connected) {
        this.source.disconnect(this.destination);
        this.connected = false;
      }
    }, delay);
  }
}
