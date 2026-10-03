import { Compressor, Gain, LeanChorus, LeanEq3, LeanFilter, Limiter, Panner, soundContext, SoundNode, toSeconds, WaveShaper } from "klangwerk/tone";
import { LeanFeedbackDelay, LeanMeter, LeanReverb } from "./lean";
import { PerformanceFilter } from "./performance";
import { safeEffectParameters } from "../domain/sound-presets";
import type { SoundPresetId, TrackKind, TrackMacros } from "../domain/types";

export const TRACK_SIGNAL_FLOW = [
  "highpass",
  "filter",
  "eq3",
  "saturation-2x",
  "compressor",
  "pan",
  "parallel-sends",
  "channel-fader",
  "meter",
] as const;

export const MASTER_SIGNAL_FLOW = [
  "highpass-25hz",
  "correction-eq",
  "glue-1.6",
  "limiter--1.2dbfs",
  "master-fader",
  "final-meter",
] as const;

export const PARALLEL_SEND_CONTRACT = {
  chorusWet: 1,
  delayWet: 1,
  reverbWet: 1,
  channelFaderAfterReturns: true,
} as const;

export interface TrackGraph {
  /** Where the voices enter: the highpass sums them itself (a unity input gain cost a node). */
  input: LeanFilter;
  highpass: LeanFilter;
  filter: LeanFilter;
  eq: LeanEq3;
  saturation: WaveShaper;
  compressor: Compressor;
  panner: Panner;
  chorusSend: Gain;
  chorus: LeanChorus;
  delaySend: Gain;
  delay: LeanFeedbackDelay;
  reverbSend: Gain;
  reverb: LeanReverb;
  channelFader: Gain;
  meter: LeanMeter;
  readonly ready: Promise<void>;
  dispose(): void;
}

export interface MasterGraph {
  input: SoundNode;
  performance: PerformanceFilter;
  highpass: LeanFilter;
  eq: LeanEq3;
  compressor: Compressor;
  limiter: Limiter;
  fader: Gain;
  meter: LeanMeter;
  dispose(): void;
}

export function createTrackGraph(track: TrackKind, destination: SoundNode | AudioNode): TrackGraph {
  const highpass = new LeanFilter({ type: "highpass", frequency: track === "drums" || track === "bass" ? 24 : 90, rolloff: -24 });
  const filter = new LeanFilter({ type: "lowpass", frequency: 8_000, Q: 0.8, rolloff: -12 });
  const eq = new LeanEq3({ low: 0, mid: 0, high: 0, lowFrequency: 220, highFrequency: 3_200 });
  const saturation = new WaveShaper(softSaturationCurve(0.08), 4096);
  saturation.oversample = "2x";
  const compressor = new Compressor({ threshold: -8, ratio: 1.3, attack: 0.018, release: 0.16, knee: 8 });
  const panner = new Panner(0);
  const chorusSend = new Gain(0.04);
  const chorus = new LeanChorus({ frequency: track === "pad" ? 0.28 : 0.62, delayTime: 3.2, depth: 0.42, spread: 90 });
  const delaySend = new Gain(0.02);
  const delay = new LeanFeedbackDelay({ delayTime: "8n", feedback: 0.14 });
  const reverbSend = new Gain(0.03);
  const reverb = new LeanReverb({ decay: track === "pad" ? 2.3 : 1.35, preDelay: 0.018 });
  const channelFader = new Gain(0.8);
  const meter = new LeanMeter({ normalRange: true, smoothing: 0.8 });

  // The panner feeds the fader (dry) and the sends itself, and the fader sums them (unity gains cost nodes).
  highpass.chain(filter, eq, saturation, compressor, panner);
  panner.connect(channelFader);
  panner.connect(chorusSend);
  chorusSend.chain(chorus, channelFader);
  panner.connect(delaySend);
  delaySend.chain(delay, channelFader);
  panner.connect(reverbSend);
  reverbSend.chain(reverb, channelFader);
  channelFader.connect(destination);
  channelFader.connect(meter);

  const nodes: SoundNode[] = [
    highpass,
    filter,
    eq,
    saturation,
    compressor,
    panner,
    chorusSend,
    chorus,
    delaySend,
    delay,
    reverbSend,
    reverb,
    channelFader,
    meter,
  ];

  return {
    input: highpass,
    highpass,
    filter,
    eq,
    saturation,
    compressor,
    panner,
    chorusSend,
    chorus,
    delaySend,
    delay,
    reverbSend,
    reverb,
    channelFader,
    meter,
    ready: reverb.ready,
    dispose: () => nodes.forEach((node) => node.dispose()),
  };
}

export function applyTrackMacros(
  graph: TrackGraph,
  track: TrackKind,
  preset: SoundPresetId,
  macros: TrackMacros,
  rampSeconds = 0.08,
): void {
  const parameters = safeEffectParameters(track, preset, macros);
  graph.highpass.frequency.rampTo(parameters.highpass, rampSeconds);
  graph.filter.frequency.rampTo(parameters.cutoff, rampSeconds);
  graph.filter.Q.rampTo(parameters.filterQ, rampSeconds);
  graph.eq.low.rampTo(parameters.eqLow, rampSeconds);
  graph.eq.mid.rampTo(parameters.eqMid, rampSeconds);
  graph.eq.high.rampTo(parameters.eqHigh, rampSeconds);
  graph.saturation.setMap(softSaturationCurve(parameters.distortion), 4096);
  graph.compressor.threshold.rampTo(parameters.compressorThreshold, rampSeconds);
  graph.compressor.ratio.rampTo(parameters.compressorRatio, rampSeconds);
  graph.panner.pan.rampTo(parameters.pan, rampSeconds);
  graph.chorusSend.gain.rampTo(parameters.chorusSend, rampSeconds);
  graph.chorus.frequency.rampTo(parameters.chorusRate, rampSeconds);
  graph.delaySend.gain.rampTo(parameters.delaySend, rampSeconds);
  // A note value at the tempo of this moment, as Tone's time param converted it.
  graph.delay.delayTime.rampTo(toSeconds(parameters.delaySubdivision), rampSeconds);
  graph.delay.feedback.rampTo(parameters.feedback, rampSeconds);
  graph.reverbSend.gain.rampTo(parameters.reverbSend, rampSeconds);
}

export function createMasterGraph(destination: SoundNode | AudioNode = soundContext().destination): MasterGraph {
  const performance = new PerformanceFilter();
  const highpass = new LeanFilter({ type: "highpass", frequency: 25, rolloff: -24 });
  const eq = new LeanEq3({ low: -0.25, mid: 0.35, high: -0.2, lowFrequency: 180, highFrequency: 4_800 });
  const compressor = new Compressor({ threshold: -14, ratio: 1.6, attack: 0.03, release: 0.28, knee: 10 });
  const limiter = new Limiter(-1.2);
  const ceilingLevel = 10 ** (-1.21 / 20);
  const ceiling = new WaveShaper((sample) => Math.max(-ceilingLevel, Math.min(ceilingLevel, sample)), 4096);
  const fader = new Gain(0.78);
  const meter = new LeanMeter({ normalRange: false, smoothing: 0.82 });
  performance.chain(highpass, eq, compressor, limiter, ceiling, fader, destination);
  fader.connect(meter);
  const nodes: SoundNode[] = [performance, highpass, eq, compressor, limiter, ceiling, fader, meter];
  return {
    input: performance,
    performance,
    highpass,
    eq,
    compressor,
    limiter,
    fader,
    meter,
    dispose: () => nodes.forEach((node) => node.dispose()),
  };
}

function softSaturationCurve(amount: number): (sample: number) => number {
  const drive = 1 + Math.max(0, Math.min(1, amount)) * 3;
  const normalization = Math.tanh(drive);
  return (sample) => Math.tanh(sample * drive) / normalization;
}
