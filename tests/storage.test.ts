import { describe, expect, it } from "vitest";
import { createFactoryProject } from "../src/domain/defaults";
import { sanitizeProject } from "../src/domain/sanitize";
import {
  BACKUP_KEY,
  LEGACY_BACKUP_KEY,
  LEGACY_PROJECT_KEY,
  LocalProjectRepository,
  PROJECT_KEY,
} from "../src/storage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("versionierter lokaler Projektspeicher", () => {
  it("rotiert vor jedem gültigen Schreiben die letzte Primärversion", () => {
    const storage = new MemoryStorage();
    const repository = new LocalProjectRepository(storage);
    const first = createFactoryProject();
    repository.save(first);
    const second = structuredClone(first);
    second.tempo = 110;
    repository.save(second);
    expect(JSON.parse(storage.getItem(BACKUP_KEY)!).tempo).toBe(96);
    expect(JSON.parse(storage.getItem(PROJECT_KEY)!).tempo).toBe(110);
  });

  it("fällt bei beschädigter Primärversion auf das Backup zurück", () => {
    const storage = new MemoryStorage();
    const project = createFactoryProject();
    project.tempo = 101;
    storage.setItem(PROJECT_KEY, "{nicht-json");
    storage.setItem(BACKUP_KEY, JSON.stringify(project));
    const result = new LocalProjectRepository(storage).load();
    expect(result.source).toBe("backup");
    expect(result.project.tempo).toBe(101);
    expect(result.warning).toContain("Sicherung");
  });

  it("lädt bei vollständig beschädigten Daten das Werkprojekt", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_KEY, "null");
    storage.setItem(BACKUP_KEY, "[]");
    const result = new LocalProjectRepository(storage).load();
    expect(result.source).toBe("factory");
    expect(result.warning).toBeTruthy();
  });

  it("migriert V1, übersetzt Drum-Variation und lässt beide V1-Schlüssel unangetastet", () => {
    const storage = new MemoryStorage();
    const legacy = structuredClone(createFactoryProject()) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.soundPresets;
    (legacy.mix as Array<{ instrument: string; volume: number }>).find((mix) => mix.instrument === "lead")!.volume = 0.61;
    const scenes = legacy.scenes as Array<{ tracks: Array<{ instrument: string; bars: Array<{ steps: Array<Record<string, unknown>> }> }> }>;
    (legacy.scenes as Array<{ name: string }>)[2]!.name = "Eigener Höhepunkt";
    const drumSteps = scenes[0]!.tracks.find((track) => track.instrument === "drums")!.bars[0]!.steps;
    for (const step of drumSteps) delete step.drumVoices;
    drumSteps[0]!.variation = 0;
    drumSteps[4]!.variation = 0.5;
    drumSteps[8]!.variation = 0.9;
    const raw = JSON.stringify(legacy);
    storage.setItem(LEGACY_PROJECT_KEY, raw);
    storage.setItem(LEGACY_BACKUP_KEY, raw);

    const result = new LocalProjectRepository(storage).load();
    expect(result.source).toBe("migration");
    expect(result.project.schemaVersion).toBe(2);
    const migrated = result.project.scenes[0]!.tracks.find((track) => track.instrument === "drums")!.bars[0]!.steps;
    expect(migrated[0]!.drumVoices).toEqual(["kick"]);
    expect(migrated[4]!.drumVoices).toEqual(["snare"]);
    expect(migrated[8]!.drumVoices).toEqual(["closedHat"]);
    expect(migrated[8]!.variation).toBe(0);
    expect(result.project.tempo).toBe(96);
    expect(result.project.mix.find((mix) => mix.instrument === "lead")!.volume).toBe(0.61);
    expect(result.project.scenes[2]!.name).toBe("Eigener Höhepunkt");
    expect(storage.getItem(LEGACY_PROJECT_KEY)).toBe(raw);
    expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe(raw);
    expect(JSON.parse(storage.getItem(PROJECT_KEY)!).schemaVersion).toBe(2);
  });

  it("saniert ungültige V2-Presets auf die instrumenteigene Werkseinstellung", () => {
    const damaged = structuredClone(createFactoryProject()) as unknown as Record<string, unknown>;
    (damaged.soundPresets as Record<string, unknown>).bass = "cosmos";
    expect(sanitizeProject(damaged).soundPresets.bass).toBe("round");
  });
});
