import { renderInChunks } from "klangwerk";
import { swapSound, useContext } from "klangwerk/tone";
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
 * is prepared, the current context is the offline one.
 *
 * Scheduling the whole piece before rendering would make every note exist
 * (pending) from the first sample on, and the render cost would grow with the
 * square of the length. Here the renderer suspends every two seconds and the
 * transport only schedules the next stretch, like live play (Firefox, which
 * cannot suspend an offline render, gets everything at once).
 */
export async function renderProject(project: ProjectV2, mode: ExportMode, onProgress?: (fraction: number) => void, options: RenderOptions = {}): Promise<AudioBuffer> {
  const plan = renderPlan(project, mode);
  const duration = planSeconds(project, plan) + RENDER_TAIL_SECONDS;
  const channels = options.stems ? STEM_CHANNELS : 2;
  const context = new OfflineAudioContext(channels, Math.ceil(duration * RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE);
  const previous = useContext(context);
  let engine: ToneAudioEngine;
  try {
    engine = new ToneAudioEngine(project, { offline: true, stems: options.stems === true });
    await engine.scheduleOffline(plan);
  } finally {
    swapSound(previous);
  }
  const failures: unknown[] = [];
  const buffer = await renderInChunks(context, (until) => {
    try {
      engine.renderUntil(until);
    } catch (error) {
      failures.push(error);
    }
  }, duration, RENDER_CHUNK_SECONDS, onProgress);
  if (failures.length > 0) throw failures[0] instanceof Error ? failures[0] : new Error("Das Rendern ist fehlgeschlagen.");
  onProgress?.(1);
  return buffer;
}
