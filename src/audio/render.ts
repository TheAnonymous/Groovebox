import * as Tone from "tone";
import type { ProjectV2 } from "../domain/types";
import { TRACK_KINDS } from "../domain/types";
import { ToneAudioEngine, type RenderPlan } from "./engine";

export const RENDER_SAMPLE_RATE = 44_100;
/** Room for pads, echoes and reverb to ring out after the last step. */
export const RENDER_TAIL_SECONDS = 5;
const STEPS_PER_PASS = 64;

export interface RenderOptions {
  /** Each track on its own channel pair, before the master bus (for mixing elsewhere). */
  stems?: boolean;
}

/** Channel pairs of a stems render, in track order. */
export const STEM_CHANNELS = TRACK_KINDS.length * 2;

export type ExportMode = { kind: "arc" } | { kind: "scene"; scene: number };

/** The whole arc plays every scene `sceneRepeats` times in order; a scene export loops one scene as often. */
export function renderPlan(project: ProjectV2, mode: ExportMode): RenderPlan {
  const repeats = project.sceneRepeats;
  return mode.kind === "arc"
    ? { startScene: 0, chainRepeats: repeats, steps: project.scenes.length * repeats * STEPS_PER_PASS }
    : { startScene: mode.scene, chainRepeats: null, steps: repeats * STEPS_PER_PASS };
}

export function planSeconds(project: ProjectV2, plan: RenderPlan): number {
  return (plan.steps * 60) / project.tempo / 4;
}

/** Seconds of music the clock schedules ahead of the renderer, as live playback's lookahead does. */
const RENDER_CHUNK_SECONDS = 2;

/**
 * Renders through the same engine, signal path and swing as live playback,
 * faster than real time. Live playback must be stopped first: while the graph
 * is prepared, Tone's global context points at the offline one.
 *
 * Tone's own offline render runs the whole clock before rendering, so every
 * note of the piece exists (pending) from the first sample on and the render
 * cost grows with the square of the length. Here the renderer suspends every
 * two seconds and the clock only schedules the next stretch, like live play.
 */
export async function renderProject(project: ProjectV2, mode: ExportMode, onProgress?: (fraction: number) => void, options: RenderOptions = {}): Promise<AudioBuffer> {
  const plan = renderPlan(project, mode);
  const duration = planSeconds(project, plan) + RENDER_TAIL_SECONDS;
  const channels = options.stems ? STEM_CHANNELS : 2;
  // Firefox cannot suspend an offline render; it renders in one go, as Tone.Offline does.
  if (typeof OfflineAudioContext.prototype.suspend !== "function") return renderAtOnce(project, plan, duration, channels, options, onProgress);
  const native = new OfflineAudioContext(channels, Math.ceil(duration * RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE);
  const context = new Tone.OfflineContext(native as never);
  const original = Tone.getContext();
  Tone.setContext(context);
  try {
    const engine = new ToneAudioEngine(project, { offline: true, stems: options.stems === true });
    await engine.scheduleOffline(plan);
    Tone.getTransport().start(0);
  } finally {
    Tone.setContext(original);
  }
  const clock = context as unknown as { _currentTime: number; emit(event: "tick"): void };
  const quantum = 128 / RENDER_SAMPLE_RATE;
  // The same loop as Tone's OfflineContext clock, stopped at `end`.
  const advanceClock = (end: number) => {
    Tone.setContext(context);
    try {
      while (clock._currentTime < Math.min(end, duration)) {
        clock.emit("tick");
        clock._currentTime += quantum;
      }
    } finally {
      Tone.setContext(original);
    }
  };
  advanceClock(2 * RENDER_CHUNK_SECONDS);
  const failures: unknown[] = [];
  for (let time = RENDER_CHUNK_SECONDS; time < duration; time += RENDER_CHUNK_SECONDS) {
    void native.suspend(time).then(() => {
      try {
        advanceClock(time + 2 * RENDER_CHUNK_SECONDS);
        onProgress?.(time / duration);
      } catch (error) {
        failures.push(error);
      }
      return native.resume();
    });
  }
  const buffer = await native.startRendering();
  if (failures.length > 0) throw failures[0] instanceof Error ? failures[0] : new Error("Das Rendern ist fehlgeschlagen.");
  onProgress?.(1);
  return buffer;
}

async function renderAtOnce(project: ProjectV2, plan: RenderPlan, duration: number, channels: number, options: RenderOptions, onProgress?: (fraction: number) => void): Promise<AudioBuffer> {
  const original = Tone.getContext();
  const context = new Tone.OfflineContext(channels, duration, RENDER_SAMPLE_RATE);
  Tone.setContext(context);
  try {
    const engine = new ToneAudioEngine(project, { offline: true, stems: options.stems === true });
    await engine.scheduleOffline(plan);
    Tone.getTransport().start(0);
  } catch (error) {
    Tone.setContext(original);
    throw error;
  }
  const rendering = context.render(false);
  Tone.setContext(original);
  const buffer = (await rendering).get();
  if (!buffer) throw new Error("Das Rendern lieferte kein Audio.");
  onProgress?.(1);
  return buffer;
}
