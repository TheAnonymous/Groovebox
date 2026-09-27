import * as Tone from "tone";
import type { ProjectV2 } from "../domain/types";
import { ToneAudioEngine, type RenderPlan } from "./engine";

export const RENDER_SAMPLE_RATE = 44_100;
/** Room for pads, echoes and reverb to ring out after the last step. */
export const RENDER_TAIL_SECONDS = 5;
const STEPS_PER_PASS = 64;

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

/**
 * Renders through the same engine, signal path and swing as live playback,
 * faster than real time. Live playback must be stopped first: while the graph
 * is prepared, Tone's global context points at the offline one.
 */
export async function renderProject(project: ProjectV2, mode: ExportMode): Promise<AudioBuffer> {
  const plan = renderPlan(project, mode);
  const duration = planSeconds(project, plan) + RENDER_TAIL_SECONDS;
  const original = Tone.getContext();
  const context = new Tone.OfflineContext(2, duration, RENDER_SAMPLE_RATE);
  Tone.setContext(context);
  try {
    const engine = new ToneAudioEngine(project, { offline: true });
    await engine.scheduleOffline(plan);
    Tone.getTransport().start(0);
  } catch (error) {
    Tone.setContext(original);
    throw error;
  }
  // Tone.Offline would yield to setTimeout once per rendered second, which
  // browsers throttle to about once a second in background tabs. The clock pass
  // is cheap, so run it in one go; the audio itself renders off the main thread.
  const rendering = context.render(false);
  Tone.setContext(original);
  const buffer = (await rendering).get();
  if (!buffer) throw new Error("Das Rendern lieferte kein Audio.");
  return buffer;
}
