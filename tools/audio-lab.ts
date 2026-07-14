import * as Tone from "tone";
import { LAB_MACROS, renderFactoryMix, renderPresetPhrase, type DrumAudition, type OfflineRender } from "../src/audio/offline";
import { SOUND_PRESET_DEFINITIONS } from "../src/domain/sound-presets";
import type { SoundPresetId, TrackKind } from "../src/domain/types";
import { TRACK_KINDS } from "../src/domain/types";

type SlotName = "a" | "b";
type MacroProfile = keyof typeof LAB_MACROS;

const presetRoot = required<HTMLDivElement>("#presets");
const metricsRoot = required<HTMLDListElement>("#metrics");
const status = required<HTMLSpanElement>("#status");
const macroProfile = required<HTMLSelectElement>("#macro-profile");
const drumAudition = required<HTMLSelectElement>("#drum-audition");
const levelMatch = required<HTMLInputElement>("#level-match");
const slots: Partial<Record<SlotName, { label: string; render: OfflineRender }>> = {};
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

for (const track of TRACK_KINDS) {
  for (const definition of SOUND_PRESET_DEFINITIONS[track]) {
    const card = document.createElement("article");
    card.className = "preset";
    card.innerHTML = `<button type="button" data-audition><span><strong>${escapeHtml(definition.label)}</strong><small>${trackLabel(track)} · ${escapeHtml(definition.hint)}</small></span></button><span class="slot-actions"><button type="button" data-slot="a">A</button><button type="button" data-slot="b">B</button></span>`;
    card.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const slot = target.closest<HTMLButtonElement>("[data-slot]")?.dataset.slot as SlotName | undefined;
      if (slot || target.closest("[data-audition]")) void audition(track, definition.id, slot);
    });
    presetRoot.append(card);
  }
}

required<HTMLButtonElement>("#factory-mix").addEventListener("click", async () => {
  await runWithStatus("Vier Szenen werden offline gerendert …", async () => {
    const render = await renderFactoryMix();
    showMetrics("Vier-Szenen-Werkmix", render);
    await play(render);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-play-slot]").forEach((button) => {
  button.addEventListener("click", () => {
    const slot = slots[button.dataset.playSlot as SlotName];
    if (slot) void play(slot.render);
  });
});

async function audition(track: TrackKind, preset: SoundPresetId, targetSlot?: SlotName): Promise<void> {
  const definition = SOUND_PRESET_DEFINITIONS[track].find((entry) => entry.id === preset)!;
  await runWithStatus(`${definition.label} wird offline gerendert …`, async () => {
    const profile = macroProfile.value as MacroProfile;
    const drums = drumAudition.value as DrumAudition;
    const render = await renderPresetPhrase(track, preset, LAB_MACROS[profile], drums);
    const label = `${trackLabel(track)} · ${definition.label} · ${profile}`;
    showMetrics(label, render);
    if (targetSlot) setSlot(targetSlot, label, render);
    await play(render);
  });
}

async function play(render: OfflineRender): Promise<void> {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  currentSource?.stop();
  const source = audioContext.createBufferSource();
  source.buffer = render.buffer;
  const gain = audioContext.createGain();
  gain.gain.value = levelMatch.checked ? Math.min(1.5, 0.1 / Math.max(0.001, render.metrics.rms)) : 1;
  source.connect(gain).connect(audioContext.destination);
  source.start();
  currentSource = source;
}

function setSlot(name: SlotName, label: string, render: OfflineRender): void {
  slots[name] = { label, render };
  required<HTMLSpanElement>(`#slot-${name}`).textContent = label;
  required<HTMLButtonElement>(`[data-play-slot="${name}"]`).disabled = false;
}

function showMetrics(label: string, render: OfflineRender): void {
  const metric = render.metrics;
  status.textContent = label;
  const values = [
    ["Sample-Peak", `${format(metric.peakDb)} dBFS`],
    ["RMS", `${format(metric.rmsDb)} dBFS`],
    ["Crest-Faktor", `${format(metric.crestDb)} dB`],
    ["Low-Energie", `${format(metric.lowEnergy * 100)} %`],
    ["Mid-Energie", `${format(metric.midEnergy * 100)} %`],
    ["High-Energie", `${format(metric.highEnergy * 100)} %`],
    ["Spektralschwerpunkt", `${Math.round(metric.spectralCentroid)} Hz`],
    ["Stereo-Korrelation", format(metric.stereoCorrelation, 3)],
    ["Ausklingzeit", `${format(metric.tailSeconds)} s`],
    ["DC-Offset", format(metric.dcOffset, 5)],
  ];
  metricsRoot.replaceChildren(...values.map(([name, value]) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<dt>${name}</dt><dd>${value}</dd>`;
    return wrapper;
  }));
}

async function runWithStatus(message: string, action: () => Promise<void>): Promise<void> {
  status.textContent = message;
  document.body.setAttribute("aria-busy", "true");
  try {
    await Tone.start();
    await action();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Rendering fehlgeschlagen";
  } finally {
    document.body.removeAttribute("aria-busy");
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Sound-Lab-Element fehlt: ${selector}`);
  return element;
}

function format(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "−∞";
}

function trackLabel(track: TrackKind): string {
  return ({ drums: "Drums", bass: "Bass", chords: "Chords", lead: "Lead", pad: "Pad" })[track];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

Object.assign(window, {
  __grooveboxAudioLab: {
    renderPreset: async (track: TrackKind, preset: SoundPresetId, profile: MacroProfile = "nominal", drums: DrumAudition = "full") => {
      const { metrics } = await renderPresetPhrase(track, preset, LAB_MACROS[profile], drums);
      return metrics;
    },
    renderMix: async () => (await renderFactoryMix()).metrics,
  },
});
