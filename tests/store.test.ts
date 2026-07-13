import { describe, expect, it } from "vitest";
import { createFactoryProject } from "../src/domain/defaults";
import { GrooveboxStore, effectiveTrackGains } from "../src/store/store";

describe("zentraler Store", () => {
  it("nimmt UI-Auswahl nicht in die Historie auf", () => {
    const store = new GrooveboxStore(createFactoryProject());
    store.dispatch({ type: "ui/select-scene", scene: 2 });
    store.dispatch({ type: "ui/select-track", track: "lead" });
    expect(store.getState().canUndo).toBe(false);
  });

  it("macht musikalische Änderungen rückgängig und wiederholt sie", () => {
    const store = new GrooveboxStore(createFactoryProject());
    const original = store.getState().project.tempo;
    store.dispatch({ type: "project/tempo", value: 108 });
    expect(store.getState().project.tempo).toBe(108);
    store.dispatch({ type: "history/undo" });
    expect(store.getState().project.tempo).toBe(original);
    store.dispatch({ type: "history/redo" });
    expect(store.getState().project.tempo).toBe(108);
  });

  it("begrenzt den Verlauf auf 100 Snapshots", () => {
    const store = new GrooveboxStore(createFactoryProject());
    for (let index = 0; index < 110; index += 1) {
      store.dispatch({ type: "project/tempo", value: 80 + (index % 41) });
    }
    for (let index = 0; index < 100; index += 1) store.dispatch({ type: "history/undo" });
    expect(store.getState().canUndo).toBe(false);
  });

  it("berechnet Mute und mehrere Solo-Spuren korrekt", () => {
    const project = createFactoryProject();
    project.mix.find((mix) => mix.instrument === "bass")!.solo = true;
    project.mix.find((mix) => mix.instrument === "lead")!.solo = true;
    project.mix.find((mix) => mix.instrument === "lead")!.muted = true;
    const gains = effectiveTrackGains(project);
    expect(gains.bass).toBeGreaterThan(0);
    expect(gains.lead).toBe(0);
    expect(gains.drums).toBe(0);
  });

  it("schützt tragende Anker vor einer unhörbar leisen Dynamik", () => {
    const store = new GrooveboxStore(createFactoryProject());
    store.dispatch({ type: "ui/select-step", bar: 0, step: 0 });
    store.dispatch({ type: "step/dynamics", value: "ghost" });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.dynamics).not.toBe("ghost");
  });

  it("macht projektweite Presetwechsel rückgängig und wiederholt sie", () => {
    const store = new GrooveboxStore(createFactoryProject());
    store.dispatch({ type: "project/preset", track: "lead", value: "laser" });
    expect(store.getState().project.soundPresets.lead).toBe("laser");
    store.dispatch({ type: "ui/select-scene", scene: 3 });
    expect(store.getState().project.soundPresets.lead).toBe("laser");
    store.dispatch({ type: "history/undo" });
    expect(store.getState().project.soundPresets.lead).toBe("clear");
    store.dispatch({ type: "history/redo" });
    expect(store.getState().project.soundPresets.lead).toBe("laser");
  });

  it("erzwingt Drum-Konflikte, Zwei-Rollen-Limit und eine letzte aktive Rolle", () => {
    const store = new GrooveboxStore(createFactoryProject());
    store.dispatch({ type: "ui/select-step", bar: 0, step: 0 });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.drumVoices).toEqual(["kick", "closedHat"]);
    store.dispatch({ type: "step/drum-voice", voice: "closedHat" });
    store.dispatch({ type: "step/drum-voice", voice: "tom" });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.drumVoices).toEqual(["kick"]);
    store.dispatch({ type: "step/drum-voice", voice: "clap" });
    store.dispatch({ type: "step/drum-voice", voice: "snare" });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.drumVoices).toEqual(["kick", "clap"]);
    store.dispatch({ type: "step/drum-voice", voice: "kick" });
    store.dispatch({ type: "step/drum-voice", voice: "clap" });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.drumVoices).toEqual(["clap"]);
  });

  it("nimmt Drumrollen-Änderungen vollständig in Undo und Redo auf", () => {
    const store = new GrooveboxStore(createFactoryProject());
    store.dispatch({ type: "ui/select-step", bar: 0, step: 0 });
    store.dispatch({ type: "step/drum-voice", voice: "closedHat" });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.drumVoices).toEqual(["kick"]);
    store.dispatch({ type: "history/undo" });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.drumVoices).toEqual(["kick", "closedHat"]);
    store.dispatch({ type: "history/redo" });
    expect(store.getState().project.scenes[0]!.tracks[0]!.bars[0]!.steps[0]!.drumVoices).toEqual(["kick"]);
  });
});
