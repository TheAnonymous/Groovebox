import * as Tone from "tone";
import { createFactoryProject } from "../domain/defaults";
import { chordNotes, scaleDegreeMidi } from "../domain/music";
import type { DrumVoice, SoundPresetId, Step, TrackKind, TrackMacros } from "../domain/types";
import { TRACK_KINDS } from "../domain/types";
import { effectiveTrackGains } from "../store/store";
import { applyTrackMacros, createMasterGraph, createTrackGraph, type TrackGraph } from "./graph";
import { createVoiceBank, type VoiceBank } from "./voices";

export interface AudioMetrics {
  samplePeak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  crestDb: number;
  dcOffset: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  spectralCentroid: number;
  stereoCorrelation: number;
  tailSeconds: number;
}

export interface OfflineRender {
  buffer: AudioBuffer;
  metrics: AudioMetrics;
}

export type DrumAudition = DrumVoice | "full" | "kick+closedHat" | "snare+clap" | "tom+clap";

export const LAB_MACROS = {
  minimum: { warmth: 0, drive: 0, space: 0, motion: 0, density: 0 },
  nominal: { warmth: 0.5, drive: 0.5, space: 0.5, motion: 0.5, density: 0.5 },
  maximum: { warmth: 1, drive: 1, space: 1, motion: 1, density: 1 },
} as const satisfies Record<string, TrackMacros>;

const SAMPLE_RATE = 44_100;
const PRESET_DURATION = 10;

export async function renderPresetPhrase(
  track: TrackKind,
  preset: SoundPresetId,
  macros: TrackMacros = LAB_MACROS.nominal,
  drumAudition: DrumAudition = "full",
): Promise<OfflineRender> {
  let lastEventTime = 0;
  const rendered = await Tone.Offline(async ({ transport }) => {
    const master = createMasterGraph();
    master.fader.gain.value = 0.82;
    const graph = createTrackGraph(track, master.input);
    graph.channelFader.gain.value = 0.78;
    applyTrackMacros(graph, track, preset, macros, 0);
    const bank = createVoiceBank(track, preset, graph.input);
    await graph.ready;
    lastEventTime = schedulePresetPhrase(bank, track, drumAudition, (time, trigger) => {
      transport.schedule((renderTime) => trigger(renderTime), time);
    });
    transport.start(0);
  }, PRESET_DURATION, 2, SAMPLE_RATE);
  const buffer = rendered.get();
  if (!buffer) throw new Error("Offline-Rendering lieferte keinen Audiopuffer");
  return { buffer, metrics: analyzeAudioBuffer(buffer, lastEventTime) };
}

export async function renderFactoryMix(): Promise<OfflineRender> {
  const project = createFactoryProject();
  const stepSeconds = 60 / project.tempo / 4;
  const sceneSeconds = stepSeconds * 16;
  const duration = sceneSeconds * project.scenes.length + 5.5;
  const lastEventTime = sceneSeconds * project.scenes.length;
  const rendered = await Tone.Offline(async ({ transport }) => {
    const master = createMasterGraph();
    master.fader.gain.value = 1;
    const gains = effectiveTrackGains(project);
    const graphs = {} as Record<TrackKind, TrackGraph>;
    const banks = {} as Record<TrackKind, VoiceBank>;
    for (const track of TRACK_KINDS) {
      const graph = createTrackGraph(track, master.input);
      graph.channelFader.gain.value = gains[track];
      applyTrackMacros(graph, track, project.soundPresets[track], project.scenes[0]!.tracks.find((entry) => entry.instrument === track)!.macros, 0);
      graphs[track] = graph;
      banks[track] = createVoiceBank(track, project.soundPresets[track], graph.input);
    }
    await Promise.all(Object.values(graphs).map((graph) => graph.ready));
    project.scenes.forEach((scene, sceneIndex) => {
      const barIndex = sceneIndex % scene.chords.length;
      const chord = scene.chords[barIndex]!;
      for (const track of TRACK_KINDS) {
        const pattern = scene.tracks.find((entry) => entry.instrument === track)!;
        pattern.bars[barIndex]!.steps.forEach((step, stepIndex) => {
          if (!step.enabled) return;
          const time = sceneIndex * sceneSeconds + stepIndex * stepSeconds + 0.05;
          const velocity = step.dynamics === "accent" ? 0.92 : step.dynamics === "ghost" ? 0.38 : 0.66;
          transport.schedule((renderTime) => {
            triggerMusicalStep(banks[track], track, step, chord.degree, chordNotes(project.key, project.scale, chord, 3), renderTime, velocity);
          }, time);
        });
      }
    });
    transport.start(0);
  }, duration, 2, SAMPLE_RATE);
  const buffer = rendered.get();
  if (!buffer) throw new Error("Offline-Rendering lieferte keinen Audiopuffer");
  return { buffer, metrics: analyzeAudioBuffer(buffer, lastEventTime) };
}

function schedulePresetPhrase(
  bank: VoiceBank,
  track: TrackKind,
  drumAudition: DrumAudition,
  schedule: (time: number, trigger: (renderTime: number) => void) => void,
): number {
  const normal = auditionStep("normal", 0.35);
  const accent = auditionStep("normal", 0.72, "accent");
  const ghost = auditionStep("short", 0.9, "ghost");
  if (track === "drums") {
    const voices = drumVoices(drumAudition);
    const times = [0.15, 1.35, 2.55, 3.75, 4.95, 6.15];
    times.forEach((time, index) => {
      const step = structuredClone(index % 4 === 0 ? accent : index % 2 ? ghost : normal);
      step.drumVoices = voices === null ? defaultFullDrums(index) : [...voices];
      schedule(time, (renderTime) => bank.trigger([], step, renderTime, index % 4 === 0 ? 0.88 : 0.62));
    });
    return times[times.length - 1]!;
  }
  if (track === "bass") {
    [45, 45, 48, 43, 45, 52].forEach((note, index) => {
      const time = 0.15 + index * 0.58;
      schedule(time, (renderTime) => bank.trigger([note], index % 3 === 2 ? ghost : index % 2 ? normal : accent, renderTime, index % 3 === 2 ? 0.48 : 0.72));
    });
    return 3.05;
  }
  if (track === "chords") {
    [[57, 60, 64, 69], [53, 57, 60, 64], [55, 59, 62, 67]].forEach((notes, index) => {
      const time = 0.15 + index * 1.12;
      schedule(time, (renderTime) => bank.trigger(notes, index === 2 ? ghost : index === 0 ? accent : normal, renderTime, 0.68));
    });
    return 2.39;
  }
  if (track === "lead") {
    [69, 72, 76, 72, 67, 69].forEach((note, index) => {
      const time = 0.15 + [0, 0.38, 0.76, 1.65, 2.03, 2.41][index]!;
      schedule(time, (renderTime) => bank.trigger([note], index === 2 || index === 5 ? ghost : index === 0 ? accent : normal, renderTime, index === 2 || index === 5 ? 0.5 : 0.74));
    });
    return 2.56;
  }
  schedule(0.15, (renderTime) => bank.trigger([45, 52, 57, 60], { ...accent, length: "long", variation: 0.25 }, renderTime, 0.62));
  schedule(2.75, (renderTime) => bank.trigger([41, 48, 53, 57], { ...normal, length: "long", variation: 0.82 }, renderTime, 0.58));
  return 2.75;
}

function triggerMusicalStep(
  bank: VoiceBank,
  track: TrackKind,
  step: Step,
  chordDegree: number,
  chord: number[],
  time: number,
  velocity: number,
): void {
  if (track === "drums") bank.trigger([], step, time, velocity);
  else if (track === "bass") bank.trigger([scaleDegreeMidi("A", "minor", chordDegree, step.degreeOffset, 2)], step, time, velocity);
  else if (track === "lead") bank.trigger([scaleDegreeMidi("A", "minor", chordDegree, step.degreeOffset, 4)], step, time, velocity);
  else bank.trigger(chord.slice(0, 4), step, time, velocity);
}

function auditionStep(length: Step["length"], variation: number, dynamics: Step["dynamics"] = "normal"): Step {
  return { enabled: true, dynamics, variation, degreeOffset: 0, length, drumVoices: [] };
}

function drumVoices(audition: DrumAudition): DrumVoice[] | null {
  if (audition === "full") return null;
  if (audition === "kick+closedHat") return ["kick", "closedHat"];
  if (audition === "snare+clap") return ["snare", "clap"];
  if (audition === "tom+clap") return ["tom", "clap"];
  return [audition];
}

function defaultFullDrums(index: number): DrumVoice[] {
  return [
    ["kick", "closedHat"],
    ["closedHat"],
    ["snare", "clap"],
    ["openHat"],
    ["kick"],
    ["tom", "clap"],
  ][index] as DrumVoice[];
}

export function analyzeAudioBuffer(buffer: AudioBuffer, tailStartSeconds = 0): AudioMetrics {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const left = channels[0] ?? new Float32Array();
  const right = channels[1] ?? left;
  let peak = 0;
  let sumSquares = 0;
  let sum = 0;
  let stereoProduct = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  const sampleCount = Math.max(1, left.length * Math.max(1, channels.length));
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSquares += l * l + (channels.length > 1 ? r * r : 0);
    sum += l + (channels.length > 1 ? r : 0);
    stereoProduct += l * r;
    leftSquares += l * l;
    rightSquares += r * r;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  const spectrum = bandEnergies(left, buffer.sampleRate);
  const lastAudible = lastAudibleSecond(channels, buffer.sampleRate);
  return {
    samplePeak: peak,
    peakDb: linearToDb(peak),
    rms,
    rmsDb: linearToDb(rms),
    crestDb: 20 * Math.log10(Math.max(1, peak / Math.max(rms, 1e-9))),
    dcOffset: Math.abs(sum / sampleCount),
    lowEnergy: spectrum.low,
    midEnergy: spectrum.mid,
    highEnergy: spectrum.high,
    spectralCentroid: spectrum.centroid,
    stereoCorrelation: stereoProduct / Math.sqrt(Math.max(1e-12, leftSquares * rightSquares)),
    tailSeconds: Math.max(0, lastAudible - tailStartSeconds),
  };
}

function lastAudibleSecond(channels: Float32Array[], sampleRate: number): number {
  const block = 512;
  const threshold = 10 ** (-55 / 20);
  for (let end = channels[0]?.length ?? 0; end > 0; end -= block) {
    const start = Math.max(0, end - block);
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
      for (let index = start; index < end; index += 1) {
        const sample = channel[index] ?? 0;
        sum += sample * sample;
        count += 1;
      }
    }
    if (Math.sqrt(sum / Math.max(1, count)) >= threshold) return end / sampleRate;
  }
  return 0;
}

function bandEnergies(samples: Float32Array, sampleRate: number) {
  const size = 2_048;
  const windows = Math.min(24, Math.max(1, Math.floor(samples.length / size)));
  let low = 0;
  let mid = 0;
  let high = 0;
  let weighted = 0;
  let total = 0;
  for (let windowIndex = 0; windowIndex < windows; windowIndex += 1) {
    const start = Math.floor((samples.length - size) * (windowIndex / Math.max(1, windows - 1)));
    const power = fftPower(samples, Math.max(0, start), size);
    for (let bin = 1; bin < power.length; bin += 1) {
      const frequency = bin * sampleRate / size;
      const value = power[bin] ?? 0;
      if (frequency < 250) low += value;
      else if (frequency < 2_500) mid += value;
      else if (frequency < 16_000) high += value;
      if (frequency < 16_000) {
        weighted += frequency * value;
        total += value;
      }
    }
  }
  const bandTotal = Math.max(1e-12, low + mid + high);
  return { low: low / bandTotal, mid: mid / bandTotal, high: high / bandTotal, centroid: weighted / Math.max(1e-12, total) };
}

function fftPower(samples: Float32Array, start: number, size: number): Float64Array {
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
    real[index] = (samples[start + index] ?? 0) * hann;
  }
  for (let index = 1, target = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; target & bit; bit >>= 1) target ^= bit;
    target ^= bit;
    if (index < target) {
      [real[index], real[target]] = [real[target] ?? 0, real[index] ?? 0];
      [imaginary[index], imaginary[target]] = [imaginary[target] ?? 0, imaginary[index] ?? 0];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal = (real[odd] ?? 0) * rotationReal - (imaginary[odd] ?? 0) * rotationImaginary;
        const oddImaginary = (real[odd] ?? 0) * rotationImaginary + (imaginary[odd] ?? 0) * rotationReal;
        const evenReal = real[even] ?? 0;
        const evenImaginary = imaginary[even] ?? 0;
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = rotationReal * stepReal - rotationImaginary * stepImaginary;
        rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
        rotationReal = nextReal;
      }
    }
  }
  const power = new Float64Array(size / 2);
  for (let index = 0; index < power.length; index += 1) power[index] = (real[index] ?? 0) ** 2 + (imaginary[index] ?? 0) ** 2;
  return power;
}

function linearToDb(value: number): number {
  return value <= 0 ? -Infinity : 20 * Math.log10(value);
}
