import { dbToGain, gainToDb, type Param } from "klangwerk";
import { connect, Gain, Noise, param, SoundNode, swapSound, toSeconds, useContext } from "klangwerk/tone";

/*
 * Groovebox's own lean effects. Tone's wrappers drive every parameter through
 * a running ConstantSourceNode and wrap effects in cross-fades, splitters and
 * helper gains; the Groovebox graph once had about 1,650 native nodes, and
 * Chromium spends roughly 1 ms of audio-thread time per node and second, so
 * live playback underran. These rebuild the same topology and parameter
 * mapping from plain native nodes (filter, EQ, chorus and sleeping outputs
 * come from klangwerk/tone).
 */

type Seconds = number;

export interface LeanFeedbackDelayOptions {
  /** Seconds or a note value ("8n"), at the current tempo. */
  delayTime: number | string;
  feedback: number;
  maxDelay?: Seconds;
}

/** Same as Tone.FeedbackDelay with wet 1: send → delay → return, return → feedback gain → delay. */
export class LeanFeedbackDelay extends SoundNode {
  readonly name = "LeanFeedbackDelay";
  readonly input: GainNode;
  readonly output: GainNode;
  readonly delayTime: Param;
  readonly feedback: Param;
  private readonly nodes: AudioNode[];

  constructor(options: LeanFeedbackDelayOptions) {
    super();
    const delaySeconds = toSeconds(options.delayTime);
    this.input = this.context.createGain();
    const delay = this.context.createDelay(Math.max(options.maxDelay ?? 1, delaySeconds));
    this.output = this.context.createGain();
    const feedbackGain = this.context.createGain();
    this.input.connect(delay);
    delay.connect(this.output);
    this.output.connect(feedbackGain);
    feedbackGain.connect(delay);
    this.delayTime = param(delay.delayTime, "time", delaySeconds);
    this.feedback = param(feedbackGain.gain, "normalRange", options.feedback);
    this.nodes = [this.input, delay, this.output, feedbackGain];
  }

  override dispose(): this {
    super.dispose();
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
export class LeanReverb extends SoundNode {
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

  override dispose(): this {
    super.dispose();
    this.input.disconnect();
    return this;
  }
}

async function generateImpulse(sampleRate: number, decay: Seconds, preDelay: Seconds): Promise<AudioBuffer> {
  // Tone.OfflineContext(2, seconds, rate) asks for seconds · rate frames, which the context truncates.
  const context = new OfflineAudioContext(2, (decay + preDelay) * sampleRate, sampleRate);
  const previous = useContext(context);
  try {
    const noiseL = new Noise();
    const noiseR = new Noise();
    const merge = context.createChannelMerger(2);
    connect(noiseL, merge, 0, 0);
    connect(noiseR, merge, 0, 1);
    const gainNode = new Gain(1);
    merge.connect(gainNode.input);
    gainNode.connect(context.destination);
    noiseL.start(0);
    noiseR.start(0);
    gainNode.gain.setValueAtTime(0, 0);
    gainNode.gain.setValueAtTime(1, preDelay);
    gainNode.gain.exponentialApproachValueAtTime(0, preDelay, decay);
  } finally {
    swapSound(previous);
  }
  return context.startRendering();
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
export class LeanMeter extends SoundNode {
  readonly name = "LeanMeter";
  readonly input: AnalyserNode;
  readonly output: AnalyserNode;
  private readonly buffer: Float32Array<ArrayBuffer>;
  private readonly normalRange: boolean;
  private readonly smoothing: number;
  private rms = 0;

  constructor(options: LeanMeterOptions = {}) {
    super();
    this.input = this.output = this.context.createAnalyser();
    this.input.fftSize = 256;
    this.input.channelCount = 1;
    this.input.channelCountMode = "explicit";
    this.input.channelInterpretation = "discrete";
    this.buffer = new Float32Array(new ArrayBuffer(256 * Float32Array.BYTES_PER_ELEMENT));
    this.normalRange = options.normalRange ?? false;
    this.smoothing = options.smoothing ?? 0.8;
  }

  getValue(): number {
    this.input.getFloatTimeDomainData(this.buffer);
    let total = 0;
    for (const sample of this.buffer) total += sample * sample;
    const rms = Math.sqrt(total / this.buffer.length);
    this.rms = rms < dbToGain(-100) ? 0 : Math.max(rms, this.rms * this.smoothing);
    return this.normalRange ? this.rms : gainToDb(this.rms);
  }

  override dispose(): this {
    super.dispose();
    this.input.disconnect();
    return this;
  }
}
