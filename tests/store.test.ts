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
});
