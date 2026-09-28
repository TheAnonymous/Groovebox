import { describe, expect, it } from "vitest";
import { createFactoryProject } from "../src/domain/defaults";
import { loopPosition, sceneSteps } from "../src/domain/patterns";
import { isValidProject, sanitizeProject } from "../src/domain/sanitize";
import { GrooveboxStore } from "../src/store/store";

describe("Spurlänge, Chance und Wiederholungen", () => {
  it("lässt kürzere Spuren gegen die vier Takte der Szene weiterlaufen", () => {
    expect(loopPosition(undefined, 70)).toEqual({ bar: 0, step: 6 });
    expect(loopPosition(48, 64)).toEqual({ bar: 1, step: 0 });
    expect(loopPosition(15, 15)).toEqual({ bar: 0, step: 0 });
    expect(loopPosition(12, 25)).toEqual({ bar: 0, step: 1 });
    expect(sceneSteps({ pass: 1, bar: 2, step: 3 })).toBe(99);
  });

  it("speichert neue Felder nur, wenn sie vom Standard abweichen", () => {
    const project = createFactoryProject();
    const drums = project.scenes[0]!.tracks.find((track) => track.instrument === "drums")!;
    const chords = project.scenes[0]!.tracks.find((track) => track.instrument === "chords")!;
    Object.assign(drums.bars[0]!.steps[0]!, { probability: 0.5, ratchet: 3 });
    Object.assign(drums.bars[0]!.steps[4]!, { probability: 1, ratchet: 1 });
    Object.assign(drums.bars[1]!.steps[0]!, { probability: 0.33, ratchet: 5 });
    Object.assign(chords.bars[0]!.steps.find((step) => step.enabled)!, { ratchet: 2 });
    drums.loopSteps = 48;
    chords.loopSteps = 47;
    const clean = sanitizeProject(project);
    const cleanDrums = clean.scenes[0]!.tracks.find((track) => track.instrument === "drums")!;
    const cleanChords = clean.scenes[0]!.tracks.find((track) => track.instrument === "chords")!;
    expect(cleanDrums.bars[0]!.steps[0]).toMatchObject({ probability: 0.5, ratchet: 3 });
    expect(cleanDrums.bars[0]!.steps[4]).not.toHaveProperty("probability");
    expect(cleanDrums.bars[0]!.steps[4]).not.toHaveProperty("ratchet");
    expect(cleanDrums.bars[1]!.steps[0]).not.toHaveProperty("probability");
    expect(cleanDrums.bars[1]!.steps[0]).not.toHaveProperty("ratchet");
    expect(cleanChords.bars[0]!.steps.find((step) => step.enabled)).not.toHaveProperty("ratchet");
    expect(cleanDrums.loopSteps).toBe(48);
    expect(cleanChords).not.toHaveProperty("loopSteps");
    expect(isValidProject(clean)).toBe(true);
    expect(JSON.stringify(sanitizeProject(createFactoryProject()))).not.toMatch(/probability|ratchet|loopSteps/);
  });

  it("stellt Chance, Wiederholung und Spurlänge rückgängig machbar ein", () => {
    const store = new GrooveboxStore(createFactoryProject());
    store.dispatch({ type: "step/cycle", bar: 0, step: 0 });
    store.dispatch({ type: "step/probability", value: 0.25 });
    store.dispatch({ type: "step/ratchet", value: 4 });
    store.dispatch({ type: "track/loop", value: 30 });
    const drums = () => store.getState().project.scenes[0]!.tracks.find((track) => track.instrument === "drums")!;
    expect(drums().bars[0]!.steps[0]).toMatchObject({ probability: 0.25, ratchet: 4 });
    expect(drums().loopSteps).toBe(30);
    store.dispatch({ type: "track/loop", value: 64 });
    expect(drums()).not.toHaveProperty("loopSteps");
    store.dispatch({ type: "history/undo" });
    expect(drums().loopSteps).toBe(30);
    store.dispatch({ type: "ui/select-track", track: "chords" });
    store.dispatch({ type: "step/ratchet", value: 2 });
    expect(store.getState().canRedo).toBe(true);
  });
});
