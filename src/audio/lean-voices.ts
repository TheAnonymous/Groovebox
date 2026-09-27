import * as Tone from "tone";

/*
 * Lean voices: the same oscillator, envelope and noise behaviour as the
 * Tone.js instruments the banks used before (Synth, MembraneSynth, NoiseSynth,
 * OmniOscillator with fat and FM types, AmplitudeEnvelope), built from native
 * nodes. Envelope and pitch automation run through Tone.Param, so the curves
 * are Tone's own; only the Signal/ConstantSource plumbing is gone.
 */

export type BasicWave = "sine" | "triangle" | "sawtooth" | "square";

export type ToneSpec =
  | { kind: "basic"; type: BasicWave }
  | { kind: "fat"; type: BasicWave; count: number; spread: number }
  | { kind: "fm"; type: BasicWave; modulationType: BasicWave; harmonicity: number; modulationIndex: number };

type Curve = "linear" | "exponential";

interface MappedTarget {
  param: Tone.Param<Tone.Unit.UnitName>;
  scale: number;
  offset: number;
}

/** Drives several params from one value: `value · scale + offset` each (FM ratios, fat detune spread). */
export class MappedParam {
  private current: number;

  constructor(private readonly targets: readonly MappedTarget[], initial: number) {
    this.current = initial;
    // An event at time 0, not at "now": offline renders trigger up to one block
    // after the note time, and an event at "now" would land after the note's
    // own automation (cutting a kick's pitch sweep). Time 0 precedes every real
    // event and still gives Tone's timeline the value ramps start from.
    for (const target of targets) target.param.setValueAtTime((initial * target.scale + target.offset) as never, 0);
  }

  get value(): number {
    return this.current;
  }

  set value(value: number) {
    this.current = value;
    for (const target of this.targets) target.param.value = (value * target.scale + target.offset) as never;
  }

  setValueAtTime(value: number, time: Tone.Unit.Time): this {
    for (const target of this.targets) target.param.setValueAtTime(this.map(target, value) as never, time);
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: Tone.Unit.Time): this {
    for (const target of this.targets) target.param.exponentialRampToValueAtTime(this.map(target, value) as never, time);
    return this;
  }

  exponentialRampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): this {
    for (const target of this.targets) target.param.exponentialRampTo(this.map(target, value) as never, rampTime, startTime);
    return this;
  }

  linearRampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): this {
    for (const target of this.targets) target.param.linearRampTo(this.map(target, value) as never, rampTime, startTime);
    return this;
  }

  cancelAndHoldAtTime(time: Tone.Unit.Time): this {
    for (const target of this.targets) target.param.cancelAndHoldAtTime(time);
    return this;
  }

  dispose(): void {
    for (const target of this.targets) target.param.dispose();
  }

  private map(target: MappedTarget, value: number): number {
    return value * target.scale + target.offset;
  }
}

function wrap<TUnit extends Tone.Unit.UnitName>(context: Tone.BaseContext, native: AudioParam, units: TUnit): Tone.Param<TUnit> {
  return new Tone.Param<TUnit>({ context, param: native, units, convert: true } as never);
}

const waveCache = new WeakMap<object, Map<string, PeriodicWave>>();

/** Tone.Oscillator's wave for a phase offset: 2048 partials, real[n] = −b·sin(φn), imag[n] = b·cos(φn). */
function phasedWave(context: Tone.BaseContext, type: BasicWave, phaseDegrees: number): PeriodicWave {
  const key = `${type}:${phaseDegrees}`;
  const cache = waveCache.get(context.rawContext) ?? new Map<string, PeriodicWave>();
  waveCache.set(context.rawContext, cache);
  const cached = cache.get(key);
  if (cached) return cached;
  const size = 2048;
  const phase = (phaseDegrees * Math.PI) / 180;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let n = 1; n < size; n += 1) {
    const piFactor = 2 / (n * Math.PI);
    let b = 0;
    if (type === "sine") b = n <= 1 ? 1 : 0;
    else if (type === "square") b = n & 1 ? 2 * piFactor : 0;
    else if (type === "sawtooth") b = piFactor * (n & 1 ? 1 : -1);
    else b = n & 1 ? 2 * piFactor * piFactor * (((n - 1) >> 1) & 1 ? -1 : 1) : 0;
    real[n] = b === 0 ? 0 : -b * Math.sin(phase * n);
    imag[n] = b === 0 ? 0 : b * Math.cos(phase * n);
  }
  const wave = context.createPeriodicWave(real, imag);
  cache.set(key, wave);
  return wave;
}

function oscillator(context: Tone.BaseContext, type: BasicWave, phaseDegrees = 0): OscillatorNode {
  const node = context.createOscillator();
  if (phaseDegrees % 360 === 0) node.type = type;
  else node.setPeriodicWave(phasedWave(context, type, phaseDegrees));
  return node;
}

/**
 * The oscillator part of Tone.OmniOscillator for the types the banks use:
 * basic waves, fat oscillators (`count` voices, −6 − 1.1·count dB each,
 * detuned across `spread` cents, phases spread over the cycle) and FM
 * (carrier plus modulator at `harmonicity`, depth `modulationIndex · f`).
 */
export class LeanTone {
  readonly output: GainNode;
  readonly frequency: MappedParam;
  readonly detune: MappedParam;
  private readonly sources: OscillatorNode[];
  private readonly extraNodes: AudioNode[];

  constructor(readonly context: Tone.BaseContext, spec: ToneSpec, frequency = 440, detune = 0) {
    this.output = context.createGain();
    this.extraNodes = [];
    if (spec.kind === "fat") {
      const count = Math.max(1, Math.round(spec.count));
      this.output.gain.value = Tone.dbToGain(-6 - count * 1.1);
      this.sources = Array.from({ length: count }, (_, index) => oscillator(context, spec.type, (index / count) * 360));
      this.sources.forEach((source) => source.connect(this.output));
      const start = -spec.spread / 2;
      const step = count > 1 ? spec.spread / (count - 1) : 0;
      this.frequency = new MappedParam(this.sources.map((source) => ({ param: wrap(context, source.frequency, "frequency"), scale: 1, offset: 0 })), frequency);
      this.detune = new MappedParam(this.sources.map((source, index) => ({ param: wrap(context, source.detune, "cents"), scale: 1, offset: count > 1 ? start + step * index : 0 })), detune);
    } else if (spec.kind === "fm") {
      const carrier = oscillator(context, spec.type);
      const modulator = oscillator(context, spec.modulationType);
      const depth = context.createGain();
      carrier.frequency.value = 0;
      depth.gain.value = 0;
      modulator.connect(depth);
      depth.connect(carrier.frequency);
      carrier.connect(this.output);
      this.sources = [carrier, modulator];
      this.extraNodes.push(depth);
      this.frequency = new MappedParam([
        { param: wrap(context, carrier.frequency, "frequency"), scale: 1, offset: 0 },
        { param: wrap(context, modulator.frequency, "frequency"), scale: spec.harmonicity, offset: 0 },
        { param: wrap(context, depth.gain, "frequency"), scale: spec.modulationIndex, offset: 0 },
      ], frequency);
      this.detune = new MappedParam([
        { param: wrap(context, carrier.detune, "cents"), scale: 1, offset: 0 },
        { param: wrap(context, modulator.detune, "cents"), scale: 1, offset: 0 },
      ], detune);
    } else {
      const source = oscillator(context, spec.type);
      source.connect(this.output);
      this.sources = [source];
      this.frequency = new MappedParam([{ param: wrap(context, source.frequency, "frequency"), scale: 1, offset: 0 }], frequency);
      this.detune = new MappedParam([{ param: wrap(context, source.detune, "cents"), scale: 1, offset: 0 }], detune);
    }
  }

  start(time: number): this {
    for (const source of this.sources) source.start(time);
    return this;
  }

  stop(time: number): this {
    for (const source of this.sources) {
      try {
        source.stop(time);
      } catch {
        // a native source can only be stopped once
      }
    }
    return this;
  }

  /** Releases the nodes once the sources have ended. */
  disposeWhenEnded(): void {
    this.sources[0]!.addEventListener("ended", () => this.dispose(), { once: true });
  }

  dispose(): void {
    this.frequency.dispose();
    this.detune.dispose();
    for (const node of [...this.sources, ...this.extraNodes, this.output]) node.disconnect();
  }
}

export interface EnvelopeOptions {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  attackCurve?: Curve;
  decayCurve?: Curve;
  releaseCurve?: Curve;
}

/** Tone.AmplitudeEnvelope: a gain whose level follows Tone.Envelope's attack, decay and release automation. */
export class LeanEnvelope extends Tone.ToneAudioNode {
  readonly name = "LeanEnvelope";
  readonly input: GainNode;
  readonly output: GainNode;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  private readonly attackCurve: Curve;
  private readonly decayCurve: Curve;
  private readonly releaseCurve: Curve;
  private readonly level: Tone.Param<"number">;

  constructor(options: EnvelopeOptions) {
    super();
    this.input = this.output = this.context.createGain();
    this.level = wrap(this.context, this.input.gain, "number");
    this.level.value = 0;
    this.attack = options.attack;
    this.decay = options.decay;
    this.sustain = options.sustain;
    this.release = options.release;
    this.attackCurve = options.attackCurve ?? "linear";
    this.decayCurve = options.decayCurve ?? "exponential";
    this.releaseCurve = options.releaseCurve ?? "exponential";
  }

  getValueAtTime(time: number): number {
    return Number(this.level.getValueAtTime(time));
  }

  triggerAttack(time: number, velocity = 1): this {
    let attack = this.attack;
    const currentValue = this.getValueAtTime(time);
    if (currentValue > 0) attack = (1 - currentValue) / (1 / attack);
    if (attack < this.sampleTime) {
      this.level.cancelScheduledValues(time);
      this.level.setValueAtTime(velocity, time);
    } else if (this.attackCurve === "linear") {
      this.level.linearRampTo(velocity, attack, time);
    } else {
      this.level.targetRampTo(velocity, attack, time);
    }
    if (this.decay && this.sustain < 1) {
      const decayValue = velocity * this.sustain;
      const decayStart = time + attack;
      if (this.decayCurve === "linear") this.level.linearRampToValueAtTime(decayValue, this.decay + decayStart);
      else this.level.exponentialApproachValueAtTime(decayValue, decayStart, this.decay);
    }
    return this;
  }

  triggerRelease(time: number = this.now()): this {
    const currentValue = this.getValueAtTime(time);
    if (currentValue > 0) {
      if (this.release < this.sampleTime) this.level.setValueAtTime(0, time);
      else if (this.releaseCurve === "linear") this.level.linearRampTo(0, this.release, time);
      else this.level.targetRampTo(0, this.release, time);
    }
    return this;
  }

  triggerAttackRelease(duration: number, time: number, velocity = 1): this {
    this.triggerAttack(time, velocity);
    this.triggerRelease(time + duration);
    return this;
  }

  dispose(): this {
    super.dispose();
    this.level.dispose();
    this.input.disconnect();
    return this;
  }
}

export interface OneShotVoiceOptions {
  envelope: EnvelopeOptions;
  volume?: number;
}

/**
 * Tone.Synth / MembraneSynth behaviour for percussive notes: every note gets
 * a fresh oscillator (as Tone restarts its source), which stops once the
 * envelope is silent. A retrigger cuts the previous source at the new note.
 */
export class OneShotTone extends Tone.ToneAudioNode {
  readonly name = "OneShotTone";
  readonly input = undefined;
  readonly output: Tone.ToneAudioNode;
  readonly envelope: LeanEnvelope;
  private current: { tone: LeanTone; stopAt: number } | null = null;

  constructor(private readonly spec: ToneSpec, options: OneShotVoiceOptions & { pitch?: { octaves: number; pitchDecay: number } }) {
    super();
    this.envelope = new LeanEnvelope(options.envelope);
    this.output = options.volume === undefined ? this.envelope : this.envelope.connect(new Tone.Gain(options.volume, "decibels"));
    this.pitch = options.pitch ?? null;
  }

  private readonly pitch: { octaves: number; pitchDecay: number } | null;

  triggerAttackRelease(frequency: number, duration: number, time: number, velocity = 1): this {
    const release = time + duration;
    const stopAt = this.envelope.sustain === 0
      ? time + this.envelope.attack + this.envelope.decay
      : release + this.envelope.release;
    if (this.current && this.current.stopAt > time) this.current.tone.stop(time);
    const tone = new LeanTone(this.context, this.spec, frequency);
    tone.output.connect(this.envelope.input);
    this.envelope.triggerAttack(time, velocity);
    if (this.pitch) {
      tone.frequency.setValueAtTime(frequency * 2 ** this.pitch.octaves, time);
      tone.frequency.exponentialRampToValueAtTime(frequency, time + this.pitch.pitchDecay);
    } else {
      tone.frequency.setValueAtTime(frequency, time);
    }
    tone.start(time).stop(stopAt);
    tone.disposeWhenEnded();
    this.envelope.triggerRelease(release);
    this.current = { tone, stopAt };
    return this;
  }

  triggerRelease(time: number = this.now()): this {
    this.envelope.triggerRelease(time);
    if (this.current && this.current.stopAt > time + this.envelope.release) {
      this.current.tone.stop(time + this.envelope.release);
      this.current.stopAt = time + this.envelope.release;
    }
    return this;
  }

  dispose(): this {
    super.dispose();
    this.current?.tone.stop(this.now());
    this.envelope.dispose();
    if (this.output !== this.envelope) this.output.dispose();
    return this;
  }
}

const noiseCache = new Map<"white" | "pink", AudioBuffer>();

/** Tone.Noise's 5-second stereo white and pink noise buffers. */
function noiseBuffer(context: Tone.BaseContext, type: "white" | "pink"): AudioBuffer {
  const cached = noiseCache.get(type);
  if (cached && cached.sampleRate === context.sampleRate) return cached;
  const length = 44_100 * 5;
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channelNumber = 0; channelNumber < 2; channelNumber += 1) {
    const channel = buffer.getChannelData(channelNumber);
    if (type === "white") {
      for (let index = 0; index < length; index += 1) channel[index] = Math.random() * 2 - 1;
      continue;
    }
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      channel[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  noiseCache.set(type, buffer);
  return buffer;
}

/**
 * Tone.NoiseSynth: looping noise from a random offset through an amplitude
 * envelope. With sustain 0 the noise stops after attack + decay, as in Tone.
 */
export class NoiseVoice extends Tone.ToneAudioNode {
  readonly name = "NoiseVoice";
  readonly input = undefined;
  readonly output: LeanEnvelope;
  private current: { source: AudioBufferSourceNode; stopAt: number } | null = null;

  constructor(private readonly type: "white" | "pink", envelope: EnvelopeOptions) {
    super();
    this.output = new LeanEnvelope(envelope);
  }

  triggerAttackRelease(duration: number, time: number, velocity = 1): this {
    const envelope = this.output;
    const release = time + duration;
    const stopAt = envelope.sustain === 0 ? time + envelope.attack + envelope.decay : release + envelope.release;
    if (this.current && this.current.stopAt > time) this.current.source.stop(time);
    const buffer = noiseBuffer(this.context, this.type);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(envelope.input);
    envelope.triggerAttack(time, velocity);
    source.start(time, Math.random() * (buffer.duration - 0.001));
    source.stop(stopAt);
    source.addEventListener("ended", () => source.disconnect(), { once: true });
    envelope.triggerRelease(release);
    this.current = { source, stopAt };
    return this;
  }

  triggerRelease(time: number = this.now()): this {
    this.output.triggerRelease(time);
    return this;
  }

  dispose(): this {
    super.dispose();
    this.output.dispose();
    return this;
  }
}
