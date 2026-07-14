import * as Tone from "tone";
import { chordNotes, scaleDegreeMidi } from "../domain/music";
import type { ProjectV2, Step, TrackKind } from "../domain/types";
import { TRACK_KINDS } from "../domain/types";
import { effectiveTrackGains } from "../store/store";
import { applyTrackMacros, createMasterGraph, createTrackGraph, type MasterGraph, type TrackGraph } from "./graph";
import { BarQueuedTransport, type SequencerPosition } from "./transport";
import { createVoiceBank, MAX_VOICE_BANKS, type VoiceBank } from "./voices";

export { drumLayerGain, MAX_VOICE_BANKS, VOICE_LIMITS } from "./voices";

export type AudioStatus = "idle" | "starting" | "playing" | "suspended" | "error";

export interface AudioStatusEvent {
  status: AudioStatus;
  message: string;
}

export interface PlayheadEvent extends SequencerPosition {
  peak: number;
  trackPeaks: Record<TrackKind, number>;
}

export interface AudioEngine {
  initialize(): Promise<void>;
  start(scene: number): Promise<void>;
  stop(): void;
  panic(): void;
  queueScene(scene: number): number | null;
  syncProject(project: ProjectV2): void;
  onPlayhead(listener: (position: PlayheadEvent) => void): () => void;
  onStatus(listener: (status: AudioStatusEvent) => void): () => void;
  dispose(): void;
}

export class ToneAudioEngine implements AudioEngine {
  private project: ProjectV2;
  private initialized = false;
  private graphReady: Promise<void> | null = null;
  private strips: Record<TrackKind, TrackGraph> | null = null;
  private readonly voiceBanks = new Map<string, VoiceBank>();
  private master: MasterGraph | null = null;
  private scheduleId: number | null = null;
  private meterFrame: number | null = null;
  private measuredPeak = 0;
  private measuredTrackPeaks = zeroTrackPeaks();
  private readonly clock = new BarQueuedTransport();
  private readonly playheadListeners = new Set<(position: PlayheadEvent) => void>();
  private readonly statusListeners = new Set<(status: AudioStatusEvent) => void>();

  constructor(project: ProjectV2) {
    this.project = structuredClone(project);
  }

  async initialize(): Promise<void> {
    this.emitStatus("starting", "Audio wird vorbereitet …");
    await Tone.start();
    if (!this.initialized) {
      this.graphReady ??= this.createGraph().finally(() => { this.graphReady = null; });
      await this.graphReady;
    }
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
    this.resetMeters();
    this.emitStatus("idle", "Gestoppt");
  }

  panic(): void {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.scheduleId = null;
    this.clock.reset();
    this.destroyGraph();
    this.resetMeters();
    this.emitStatus("idle", "Panik – alle Stimmen und Effekte gestoppt");
  }

  queueScene(scene: number): number | null {
    return this.clock.queue(scene);
  }

  syncProject(project: ProjectV2): void {
    this.project = structuredClone(project);
    if (this.initialized) {
      this.prepareSelectedVoiceBanks();
      this.applyProject();
    }
  }

  onPlayhead(listener: (position: PlayheadEvent) => void): () => void {
    this.playheadListeners.add(listener);
    return () => this.playheadListeners.delete(listener);
  }

  onStatus(listener: (status: AudioStatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.scheduleId = null;
    this.clock.reset();
    this.destroyGraph();
    this.playheadListeners.clear();
    this.statusListeners.clear();
  }

  private async createGraph(): Promise<void> {
    const master = createMasterGraph();
    const strips = {} as Record<TrackKind, TrackGraph>;
    this.master = master;
    for (const track of TRACK_KINDS) strips[track] = createTrackGraph(track, master.input);
    this.strips = strips;
    await Promise.all(Object.values(strips).map((strip) => strip.ready));
    if (this.strips !== strips || this.master !== master) throw new Error("Audio-Vorbereitung wurde abgebrochen");
    this.prepareSelectedVoiceBanks();
    this.initialized = true;
    this.monitorMeters();
    this.applyProject();
  }

  private destroyGraph(): void {
    if (this.meterFrame !== null) cancelAnimationFrame(this.meterFrame);
    this.meterFrame = null;
    for (const bank of this.voiceBanks.values()) bank.dispose();
    this.voiceBanks.clear();
    Object.values(this.strips ?? {}).forEach((strip) => strip.dispose());
    this.master?.dispose();
    this.strips = null;
    this.master = null;
    this.initialized = false;
  }

  private applyProject(): void {
    const transport = Tone.getTransport();
    transport.bpm.rampTo(this.project.tempo, 0.08);
    transport.swing = this.project.swing;
    transport.swingSubdivision = "16n";
    this.master?.fader.gain.rampTo(this.project.masterVolume, 0.04);
    const gains = effectiveTrackGains(this.project);
    for (const track of TRACK_KINDS) {
      const strip = this.strips?.[track];
      if (!strip) continue;
      strip.channelFader.gain.rampTo(gains[track], 0.03);
      const macros = this.patternFor(this.clock.runningScene, track)?.macros;
      if (macros) applyTrackMacros(strip, track, this.project.soundPresets[track], macros);
    }
  }

  private tick(time: number): void {
    if (Tone.getContext().state !== "running") {
      this.emitStatus("suspended", "Audio wurde vom Browser pausiert – Start erneut anklicken");
      return;
    }
    const position = this.clock.next();
    if (position.switched) this.applyProject();
    for (const track of TRACK_KINDS) {
      try {
        this.triggerTrack(track, position, time);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Klang konnte nicht ausgelöst werden";
        this.emitStatus("error", `${track}: ${message}`);
      }
    }
    Tone.getDraw().schedule(() => {
      const event = { ...position, peak: this.measuredPeak, trackPeaks: { ...this.measuredTrackPeaks } };
      for (const listener of this.playheadListeners) listener(event);
    }, time);
  }

  private triggerTrack(track: TrackKind, position: SequencerPosition, time: number): void {
    const pattern = this.patternFor(position.scene, track);
    const step = pattern?.bars[position.bar]?.steps[position.step];
    const chord = this.project.scenes[position.scene]?.chords[position.bar];
    if (!pattern || !step?.enabled || !chord || effectiveTrackGains(this.project)[track] <= 0) return;
    const velocity = dynamicsVelocity(step) * densityBodyGain(track, pattern.macros.density);
    const bank = this.bankFor(track);
    if (track === "drums") {
      bank.trigger([], step, time, velocity);
    } else if (track === "bass") {
      bank.trigger([scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 2)], step, time, velocity);
    } else if (track === "lead") {
      bank.trigger([scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 4)], step, time, velocity);
    } else {
      bank.trigger(chordNotes(this.project.key, this.project.scale, chord, 3).slice(0, 4), step, time, velocity);
    }
  }

  private bankFor(track: TrackKind): VoiceBank {
    const preset = this.project.soundPresets[track];
    const key = `${track}:${preset}`;
    const existing = this.voiceBanks.get(key);
    if (existing) return existing;
    if (this.voiceBanks.size >= MAX_VOICE_BANKS) throw new Error("Maximale Zahl der Klangbänke erreicht");
    const strip = this.strips?.[track];
    if (!strip) throw new Error("Audio-Signalweg ist nicht initialisiert");
    const bank = createVoiceBank(track, preset, strip.input);
    this.voiceBanks.set(key, bank);
    return bank;
  }

  private prepareSelectedVoiceBanks(): void {
    for (const track of TRACK_KINDS) {
      const preset = this.project.soundPresets[track];
      for (const [key, bank] of this.voiceBanks) {
        if (bank.track === track && bank.preset !== preset) {
          bank.release();
          bank.dispose();
          this.voiceBanks.delete(key);
        }
      }
      this.bankFor(track);
    }
  }

  private patternFor(scene: number, track: TrackKind) {
    return this.project.scenes[scene]?.tracks.find((pattern) => pattern.instrument === track);
  }

  private releaseAll(): void {
    for (const bank of this.voiceBanks.values()) bank.release();
  }

  private monitorMeters(): void {
    if (!this.initialized) return;
    const peakDb = this.master?.meter.getValue();
    const masterPeak = typeof peakDb === "number" ? Math.pow(10, peakDb / 20) : 0;
    this.measuredPeak = clamp01(Math.max(masterPeak, this.measuredPeak * 0.86));
    for (const track of TRACK_KINDS) {
      const value = this.strips?.[track].meter.getValue();
      const peak = typeof value === "number" ? value : 0;
      this.measuredTrackPeaks[track] = clamp01(Math.max(peak, this.measuredTrackPeaks[track] * 0.84));
    }
    this.meterFrame = requestAnimationFrame(() => this.monitorMeters());
  }

  private resetMeters(): void {
    this.measuredPeak = 0;
    this.measuredTrackPeaks = zeroTrackPeaks();
  }

  private emitStatus(status: AudioStatus, message: string): void {
    for (const listener of this.statusListeners) listener({ status, message });
  }
}

export function densityBodyGain(track: TrackKind, density: number): number {
  const depth: Record<TrackKind, number> = { drums: 0.14, bass: 0.18, chords: 0.1, lead: 0.12, pad: 0.08 };
  return 0.82 + clamp01(density) * depth[track];
}

function dynamicsVelocity(step: Step): number {
  if (step.dynamics === "ghost") return 0.42;
  if (step.dynamics === "accent") return 1;
  return 0.72;
}

function zeroTrackPeaks(): Record<TrackKind, number> {
  return Object.fromEntries(TRACK_KINDS.map((track) => [track, 0])) as Record<TrackKind, number>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
