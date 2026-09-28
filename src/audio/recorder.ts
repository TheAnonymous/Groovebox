import * as Tone from "tone";
import processorUrl from "./recorder-processor.js?url&no-inline";

/** Longest live recording: 15 minutes of 16-bit stereo stays around 170 MB in memory. */
export const MAX_RECORDING_SECONDS = 15 * 60;

const PROCESSOR = "musik-master-recorder";

const loadedContexts = new WeakSet<object>();

export interface Recording {
  sampleRate: number;
  left: Int16Array;
  right: Int16Array;
}

/**
 * Records what leaves the master, as the speakers get it, into 16-bit PCM.
 * An AudioWorklet copies the samples off the audio thread in blocks, so the
 * recording is lossless and cannot glitch the music.
 */
export class MasterRecorder {
  private node: AudioWorkletNode | null = null;
  private silent: GainNode | null = null;
  private chunks: { left: Int16Array; right: Int16Array }[] = [];
  private frames = 0;
  private stopping: ((recording: Recording) => void) | null = null;
  private sampleRate = 44_100;

  constructor(private readonly onLimit: () => void) {}

  get active(): boolean {
    return this.node !== null;
  }

  get seconds(): number {
    return this.frames / this.sampleRate;
  }

  async start(source: Tone.ToneAudioNode): Promise<void> {
    if (this.node) return;
    const context = Tone.getContext();
    if (!loadedContexts.has(context)) {
      await context.addAudioWorkletModule(processorUrl);
      loadedContexts.add(context);
    }
    this.sampleRate = context.sampleRate;
    this.chunks = [];
    this.frames = 0;
    const node = context.createAudioWorkletNode(PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    node.port.onmessage = (event: MessageEvent<{ left?: Float32Array; right?: Float32Array; done?: boolean }>) => this.receive(event.data);
    // A worklet only runs while something pulls it; a muted path to the output does.
    const silent = context.createGain();
    silent.gain.value = 0;
    Tone.connect(source, node);
    node.connect(silent);
    silent.connect(context.rawContext.destination as unknown as AudioNode);
    this.node = node;
    this.silent = silent;
  }

  stop(): Promise<Recording> {
    const node = this.node;
    if (!node) return Promise.resolve(this.collect());
    return new Promise((resolve) => {
      this.stopping = resolve;
      node.port.postMessage("stop");
    });
  }

  private receive(data: { left?: Float32Array; right?: Float32Array; done?: boolean }): void {
    if (data.left && data.right) {
      this.chunks.push({ left: toPcm(data.left), right: toPcm(data.right) });
      this.frames += data.left.length;
      if (this.seconds >= MAX_RECORDING_SECONDS && !this.stopping) this.onLimit();
    }
    if (!data.done) return;
    this.node?.disconnect();
    this.silent?.disconnect();
    this.node = null;
    this.silent = null;
    const resolve = this.stopping;
    this.stopping = null;
    resolve?.(this.collect());
  }

  private collect(): Recording {
    const left = new Int16Array(this.frames);
    const right = new Int16Array(this.frames);
    let offset = 0;
    for (const chunk of this.chunks) {
      left.set(chunk.left, offset);
      right.set(chunk.right, offset);
      offset += chunk.left.length;
    }
    this.chunks = [];
    this.frames = 0;
    return { sampleRate: this.sampleRate, left, right };
  }
}

function toPcm(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    pcm[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return pcm;
}
