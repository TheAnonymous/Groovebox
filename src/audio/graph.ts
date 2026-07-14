import * as Tone from "tone";
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
  input: Tone.Gain;
  highpass: Tone.Filter;
  filter: Tone.Filter;
  eq: Tone.EQ3;
  saturation: Tone.WaveShaper;
  compressor: Tone.Compressor;
  panner: Tone.Panner;
  postInsert: Tone.Gain;
  dry: Tone.Gain;
  chorusSend: Tone.Gain;
  chorus: Tone.Chorus;
  delaySend: Tone.Gain;
  delay: Tone.FeedbackDelay;
  reverbSend: Tone.Gain;
  reverb: Tone.Reverb;
  channelFader: Tone.Gain;
  meter: Tone.Meter;
  readonly ready: Promise<void>;
  dispose(): void;
}

export interface MasterGraph {
  input: Tone.Gain;
  highpass: Tone.Filter;
  eq: Tone.EQ3;
  compressor: Tone.Compressor;
  limiter: Tone.Limiter;
  fader: Tone.Gain;
  meter: Tone.Meter;
  dispose(): void;
}

export function createTrackGraph(track: TrackKind, destination: Tone.ToneAudioNode): TrackGraph {
  const input = new Tone.Gain(1);
  const highpass = new Tone.Filter({ type: "highpass", frequency: track === "drums" || track === "bass" ? 24 : 90, rolloff: -24 });
  const filter = new Tone.Filter({ type: "lowpass", frequency: 8_000, Q: 0.8, rolloff: -12 });
  const eq = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 220, highFrequency: 3_200 });
  const saturation = new Tone.WaveShaper(softSaturationCurve(0.08), 4096);
  saturation.oversample = "2x";
  const compressor = new Tone.Compressor({ threshold: -8, ratio: 1.3, attack: 0.018, release: 0.16, knee: 8 });
  const panner = new Tone.Panner(0);
  const postInsert = new Tone.Gain(1);
  const dry = new Tone.Gain(1);
  const chorusSend = new Tone.Gain(0.04);
  const chorus = new Tone.Chorus({ frequency: track === "pad" ? 0.28 : 0.62, delayTime: 3.2, depth: 0.42, spread: 90, wet: 1 }).start();
  const delaySend = new Tone.Gain(0.02);
  const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.14, wet: 1 });
  const reverbSend = new Tone.Gain(0.03);
  const reverb = new Tone.Reverb({ decay: track === "pad" ? 2.3 : 1.35, preDelay: 0.018, wet: 1 });
  const channelFader = new Tone.Gain(0.8);
  const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });

  input.chain(highpass, filter, eq, saturation, compressor, panner, postInsert);
  postInsert.connect(dry);
  dry.connect(channelFader);
  postInsert.connect(chorusSend);
  chorusSend.chain(chorus, channelFader);
  postInsert.connect(delaySend);
  delaySend.chain(delay, channelFader);
  postInsert.connect(reverbSend);
  reverbSend.chain(reverb, channelFader);
  channelFader.chain(meter, destination);

  const nodes: Tone.ToneAudioNode[] = [
    input,
    highpass,
    filter,
    eq,
    saturation,
    compressor,
    panner,
    postInsert,
    dry,
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
    input,
    highpass,
    filter,
    eq,
    saturation,
    compressor,
    panner,
    postInsert,
    dry,
    chorusSend,
    chorus,
    delaySend,
    delay,
    reverbSend,
    reverb,
    channelFader,
    meter,
    ready: reverb.ready,
    dispose: () => {
      chorus.stop();
      nodes.forEach((node) => node.dispose());
    },
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
  graph.delay.delayTime.rampTo(parameters.delaySubdivision, rampSeconds);
  graph.delay.feedback.rampTo(parameters.feedback, rampSeconds);
  graph.reverbSend.gain.rampTo(parameters.reverbSend, rampSeconds);
}

export function createMasterGraph(destination: Tone.ToneAudioNode = Tone.getDestination()): MasterGraph {
  const input = new Tone.Gain(1);
  const highpass = new Tone.Filter({ type: "highpass", frequency: 25, rolloff: -24 });
  const eq = new Tone.EQ3({ low: -0.25, mid: 0.35, high: -0.2, lowFrequency: 180, highFrequency: 4_800 });
  const compressor = new Tone.Compressor({ threshold: -14, ratio: 1.6, attack: 0.03, release: 0.28, knee: 10 });
  const limiter = new Tone.Limiter(-1.2);
  const ceilingLevel = 10 ** (-1.21 / 20);
  const ceiling = new Tone.WaveShaper((sample) => Math.max(-ceilingLevel, Math.min(ceilingLevel, sample)), 4096);
  const fader = new Tone.Gain(0.78);
  const meter = new Tone.Meter({ normalRange: false, smoothing: 0.82 });
  input.chain(highpass, eq, compressor, limiter, ceiling, fader, meter, destination);
  const nodes: Tone.ToneAudioNode[] = [input, highpass, eq, compressor, limiter, ceiling, fader, meter];
  return {
    input,
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
