import * as Tone from "tone";
import { chordNotes, scaleDegreeMidi } from "../domain/music";
import type { ProjectV1, Step, TrackKind, TrackMacros } from "../domain/types";
import { TRACK_KINDS } from "../domain/types";
import { effectiveTrackGains } from "../store/store";
import { BarQueuedTransport, type SequencerPosition } from "./transport";

export type AudioStatus = "idle" | "starting" | "playing" | "suspended" | "error";

export interface AudioStatusEvent {
  status: AudioStatus;
  message: string;
}

export interface AudioEngine {
  initialize(): Promise<void>;
  start(scene: number): Promise<void>;
  stop(): void;
  panic(): void;
  queueScene(scene: number): number | null;
  syncProject(project: ProjectV1): void;
  onPlayhead(listener: (position: SequencerPosition & { peak: number }) => void): () => void;
  onStatus(listener: (status: AudioStatusEvent) => void): () => void;
  dispose(): void;
}

interface TrackStrip {
  gain: Tone.Gain;
  filter: Tone.Filter;
  distortion: Tone.Distortion;
  delay: Tone.FeedbackDelay;
  reverb: Tone.Reverb;
  meter: Tone.Meter;
}

interface Instruments {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.MetalSynth;
  bass: Tone.MonoSynth;
  chords: Tone.Synth[];
  lead: Tone.MonoSynth;
  pad: Tone.Synth[];
}

export class ToneAudioEngine implements AudioEngine {
  private project: ProjectV1;
  private initialized = false;
  private strips: Record<TrackKind, TrackStrip> | null = null;
  private instruments: Instruments | null = null;
  private masterNodes: Tone.ToneAudioNode[] = [];
  private masterMeter: Tone.Meter | null = null;
  private scheduleId: number | null = null;
  private meterFrame: number | null = null;
  private measuredPeak = 0;
  private readonly clock = new BarQueuedTransport();
  private readonly playheadListeners = new Set<(position: SequencerPosition & { peak: number }) => void>();
  private readonly statusListeners = new Set<(status: AudioStatusEvent) => void>();

  constructor(project: ProjectV1) {
    this.project = structuredClone(project);
  }

  async initialize(): Promise<void> {
    this.emitStatus("starting", "Audio wird vorbereitet …");
    await Tone.start();
    if (!this.initialized) this.createGraph();
    if (Tone.getContext().state !== "running") {
      this.emitStatus("suspended", "Audio ist pausiert – Start erneut anklicken");
      return;
    }
    this.emitStatus("idle", "Audio bereit");
  }

  async start(scene: number): Promise<void> {
    try {
      await this.initialize();
      if (Tone.getContext().state !== "running") return;
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      transport.position = 0;
      this.clock.start(scene);
      this.applyProject();
      this.scheduleId = transport.scheduleRepeat((time) => this.tick(time), "16n");
      transport.start("+0.05");
      this.emitStatus("playing", "Wiedergabe läuft");
    } catch (error) {
      this.emitStatus("error", error instanceof Error ? error.message : "Audio konnte nicht gestartet werden");
    }
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    if (this.scheduleId !== null) transport.clear(this.scheduleId);
    this.scheduleId = null;
    this.clock.reset();
    this.releaseAll();
    this.measuredPeak = 0;
    this.emitStatus("idle", "Gestoppt");
  }

  panic(): void {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.scheduleId = null;
    this.clock.reset();
    this.releaseAll();
    this.measuredPeak = 0;
    this.emitStatus("idle", "Panik – alle Stimmen gestoppt");
  }

  queueScene(scene: number): number | null {
    return this.clock.queue(scene);
  }

  syncProject(project: ProjectV1): void {
    this.project = structuredClone(project);
    if (this.initialized) this.applyProject();
  }

  onPlayhead(listener: (position: SequencerPosition & { peak: number }) => void): () => void {
    this.playheadListeners.add(listener);
    return () => this.playheadListeners.delete(listener);
  }

  onStatus(listener: (status: AudioStatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    this.panic();
    Object.values(this.strips ?? {}).forEach((strip) => Object.values(strip).forEach((node) => node.dispose()));
    Object.values(this.instruments ?? {}).forEach((instrument) => {
      if (Array.isArray(instrument)) instrument.forEach((voice) => voice.dispose());
      else instrument.dispose();
    });
    this.masterNodes.forEach((node) => node.dispose());
    if (this.meterFrame !== null) cancelAnimationFrame(this.meterFrame);
    this.meterFrame = null;
    this.strips = null;
    this.instruments = null;
    this.masterNodes = [];
    this.initialized = false;
  }

  private createGraph(): void {
    const highpass = new Tone.Filter({ type: "highpass", frequency: 28, rolloff: -24 });
    const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.012, release: 0.22 });
    const limiter = new Tone.Limiter(-1.2);
    const meter = new Tone.Meter({ normalRange: false, smoothing: 0.82 });
    highpass.chain(compressor, limiter, meter, Tone.getDestination());
    this.masterNodes = [highpass, compressor, limiter, meter];
    this.masterMeter = meter;

    const strips = {} as Record<TrackKind, TrackStrip>;
    for (const track of TRACK_KINDS) {
      const filter = new Tone.Filter({ type: "lowpass", frequency: 8000, rolloff: -12 });
      const distortion = new Tone.Distortion({ distortion: 0.08, oversample: "2x", wet: 0.18 });
      const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.18, wet: 0.1 });
      const reverb = new Tone.Reverb({ decay: track === "pad" ? 3.4 : 1.7, preDelay: 0.02, wet: 0.12 });
      const gain = new Tone.Gain(0.8);
      const trackMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
      filter.chain(distortion, delay, reverb, gain, highpass);
      trackMeter.connect(filter);
      strips[track] = { filter, distortion, delay, reverb, gain, meter: trackMeter };
    }
    this.strips = strips;

    const route = (instrument: Tone.ToneAudioNode, track: TrackKind) => instrument.connect(strips[track].meter);
    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.045,
      octaves: 7,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.28, sustain: 0.01, release: 0.12 },
    });
    const snare = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.08 },
    });
    const hat = new Tone.MetalSynth({
      harmonicity: 5.1,
      modulationIndex: 26,
      resonance: 3200,
      octaves: 1.5,
      envelope: { attack: 0.001, decay: 0.055, release: 0.025 },
    });
    hat.frequency.value = 220;
    const bass = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 2, rolloff: -24 },
      filterEnvelope: { attack: 0.005, decay: 0.18, sustain: 0.22, release: 0.16, baseFrequency: 90, octaves: 3.4 },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.45, release: 0.12 },
    });
    const chords = Array.from(
      { length: 4 },
      () => new Tone.Synth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.012, decay: 0.2, sustain: 0.38, release: 0.45 },
      }),
    );
    const lead = new Tone.MonoSynth({
      oscillator: { type: "square" },
      filter: { type: "lowpass", Q: 1.4, rolloff: -12 },
      filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.5, release: 0.16, baseFrequency: 350, octaves: 3 },
      envelope: { attack: 0.008, decay: 0.1, sustain: 0.35, release: 0.16 },
    });
    const pad = Array.from(
      { length: 4 },
      () => new Tone.Synth({
        oscillator: { type: "fatsawtooth", count: 2, spread: 18 },
        envelope: { attack: 0.18, decay: 0.4, sustain: 0.48, release: 1.3 },
      }),
    );
    route(kick, "drums");
    route(snare, "drums");
    route(hat, "drums");
    route(bass, "bass");
    chords.forEach((voice) => route(voice, "chords"));
    route(lead, "lead");
    pad.forEach((voice) => route(voice, "pad"));
    this.instruments = { kick, snare, hat, bass, chords, lead, pad };
    this.initialized = true;
    this.monitorMeters();
    this.applyProject();
  }

  private applyProject(): void {
    const transport = Tone.getTransport();
    transport.bpm.rampTo(this.project.tempo, 0.08);
    transport.swing = this.project.swing;
    transport.swingSubdivision = "16n";
    Tone.getDestination().volume.rampTo(gainToDb(this.project.masterVolume), 0.04);
    const gains = effectiveTrackGains(this.project);
    for (const track of TRACK_KINDS) {
      const strip = this.strips?.[track];
      if (!strip) continue;
      strip.gain.gain.rampTo(gains[track], 0.03);
      const macros = this.patternFor(this.clock.runningScene, track)?.macros;
      if (macros) this.applyMacros(strip, macros, track);
    }
  }

  private applyMacros(strip: TrackStrip, macros: TrackMacros, track: TrackKind): void {
    const baseCutoff = track === "bass" ? 500 : track === "pad" ? 3200 : 7600;
    strip.filter.frequency.rampTo(baseCutoff * (1.35 - macros.warmth * 0.72), 0.08);
    strip.distortion.distortion = 0.02 + macros.drive * (track === "drums" || track === "bass" ? 0.42 : 0.22);
    strip.distortion.wet.rampTo(0.08 + macros.drive * 0.34, 0.08);
    strip.delay.wet.rampTo(macros.space * 0.28, 0.08);
    strip.delay.feedback.rampTo(0.1 + macros.motion * 0.26, 0.08);
    strip.reverb.wet.rampTo(macros.space * (track === "pad" ? 0.52 : 0.34), 0.08);
  }

  private tick(time: number): void {
    if (Tone.getContext().state !== "running") {
      this.emitStatus("suspended", "Audio wurde vom Browser pausiert – Start erneut anklicken");
      return;
    }
    const position = this.clock.next();
    if (position.switched) this.applyProject();
    for (const track of TRACK_KINDS) this.triggerTrack(track, position, time);
    Tone.getDraw().schedule(() => {
      for (const listener of this.playheadListeners) listener({ ...position, peak: this.measuredPeak });
    }, time);
  }

  private triggerTrack(track: TrackKind, position: SequencerPosition, time: number): void {
    const pattern = this.patternFor(position.scene, track);
    const step = pattern?.bars[position.bar]?.steps[position.step];
    const chord = this.project.scenes[position.scene]?.chords[position.bar];
    if (!pattern || !step?.enabled || !chord || !this.instruments) return;
    const gain = effectiveTrackGains(this.project)[track];
    if (gain <= 0) return;
    const velocity = dynamicsVelocity(step) * (0.78 + pattern.macros.density * 0.2);
    const duration = stepDuration(step);

    if (track === "drums") {
      if (step.variation >= 0.72) this.instruments.hat.triggerAttackRelease("32n", time, velocity * 0.52);
      else if (step.variation >= 0.3) this.instruments.snare.triggerAttackRelease("16n", time, velocity * 0.58);
      else this.instruments.kick.triggerAttackRelease("C1", "16n", time, velocity * 0.88);
      return;
    }
    if (track === "bass") {
      const midi = scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 2);
      this.instruments.bass.triggerAttackRelease(toHz(midi), duration, time, velocity * 0.74);
      return;
    }
    if (track === "chords") {
      const notes = chordNotes(this.project.key, this.project.scale, chord, 3).slice(0, 4);
      this.instruments.chords.forEach((voice, index) => {
        voice.triggerRelease(time);
        const note = notes[index];
        if (note !== undefined) voice.triggerAttackRelease(toHz(note), duration, time, velocity * 0.32);
      });
      return;
    }
    if (track === "lead") {
      const midi = scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 4);
      this.instruments.lead.triggerAttackRelease(toHz(midi), duration, time, velocity * 0.4);
      return;
    }
    const notes = chordNotes(this.project.key, this.project.scale, chord, 3).slice(0, 4);
    this.instruments.pad.forEach((voice, index) => {
      voice.triggerRelease(time);
      const note = notes[index];
      if (note !== undefined) {
        voice.triggerAttackRelease(
          toHz(note),
          step.length === "short" ? "8n" : step.length === "long" ? "1m" : "2n",
          time,
          velocity * 0.2,
        );
      }
    });
  }

  private patternFor(scene: number, track: TrackKind) {
    return this.project.scenes[scene]?.tracks.find((pattern) => pattern.instrument === track);
  }

  private releaseAll(): void {
    this.instruments?.kick.triggerRelease();
    this.instruments?.snare.triggerRelease();
    this.instruments?.hat.triggerRelease();
    this.instruments?.bass.triggerRelease();
    this.instruments?.chords.forEach((voice) => voice.triggerRelease());
    this.instruments?.lead.triggerRelease();
    this.instruments?.pad.forEach((voice) => voice.triggerRelease());
  }

  private monitorMeters(): void {
    if (!this.initialized) return;
    const peakDb = this.masterMeter?.getValue();
    const masterPeak = typeof peakDb === "number" ? Math.pow(10, peakDb / 20) : 0;
    const stripPeak = Math.max(
      0,
      ...Object.values(this.strips ?? {}).map((strip) => {
        const value = strip.meter.getValue();
        return typeof value === "number" ? value : 0;
      }),
    );
    const current = Math.max(masterPeak, stripPeak * this.project.masterVolume);
    this.measuredPeak = Math.max(current, this.measuredPeak * 0.88);
    this.measuredPeak = Math.max(0, Math.min(1, this.measuredPeak));
    this.meterFrame = requestAnimationFrame(() => this.monitorMeters());
  }

  private emitStatus(status: AudioStatus, message: string): void {
    for (const listener of this.statusListeners) listener({ status, message });
  }
}

function dynamicsVelocity(step: Step): number {
  if (step.dynamics === "ghost") return 0.42;
  if (step.dynamics === "accent") return 1;
  return 0.72;
}

function stepDuration(step: Step): Tone.Unit.Time {
  if (step.length === "short") return "32n";
  if (step.length === "long") return "8n";
  return "16n";
}

function toHz(midi: number): number {
  return Tone.Frequency(midi, "midi").toFrequency();
}

function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}
