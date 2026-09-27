import { describe, expect, it } from "vitest";
import {
  CATALOG_BACKUP_KEY,
  CATALOG_KEY,
  FIRST_PROJECT_NAME,
  MAX_PROJECTS,
  MIGRATED_PROJECT_NAME,
  PROJECT_PREFIX,
  ProjectCatalog,
} from "../src/catalog";
import { createFactoryProject } from "../src/domain/defaults";
import { BACKUP_KEY, LEGACY_PROJECT_KEY, PROJECT_KEY } from "../src/storage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
  keys() { return [...this.values.keys()]; }
}

function sequentialIds() {
  let next = 0;
  return () => `id-${++next}`;
}

function catalog(storage: MemoryStorage) {
  return new ProjectCatalog(storage, () => new Date("2026-09-27T20:00:00Z"), sequentialIds());
}

describe("Projektkatalog", () => {
  it("legt beim ersten Start ein benanntes Werkprojekt an", () => {
    const storage = new MemoryStorage();
    const repository = catalog(storage);
    const result = repository.load();
    expect(result.source).toBe("factory");
    expect(result.warning).toBeUndefined();
    expect(repository.active.name).toBe(FIRST_PROJECT_NAME);
    expect(JSON.parse(storage.getItem(CATALOG_KEY)!).projects).toHaveLength(1);
    expect(storage.getItem(`${PROJECT_PREFIX}id-1`)).not.toBeNull();
  });

  it("übernimmt das bisherige Einzelprojekt und lässt dessen Schlüssel unverändert", () => {
    const storage = new MemoryStorage();
    const project = createFactoryProject();
    project.tempo = 104;
    const raw = JSON.stringify(project);
    storage.setItem(PROJECT_KEY, raw);
    storage.setItem(BACKUP_KEY, raw);
    const repository = catalog(storage);
    const result = repository.load();
    expect(result.source).toBe("migration");
    expect(result.project.tempo).toBe(104);
    expect(repository.active.name).toBe(MIGRATED_PROJECT_NAME);
    expect(storage.getItem(PROJECT_KEY)).toBe(raw);
    expect(storage.getItem(BACKUP_KEY)).toBe(raw);
    expect(JSON.parse(storage.getItem(`${PROJECT_PREFIX}id-1`)!).tempo).toBe(104);
  });

  it("reicht die Warnung einer V1-Migration durch", () => {
    const storage = new MemoryStorage();
    const legacy = structuredClone(createFactoryProject()) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 1;
    storage.setItem(LEGACY_PROJECT_KEY, JSON.stringify(legacy));
    const result = catalog(storage).load();
    expect(result.source).toBe("migration");
    expect(result.warning).toContain("Version 2");
  });

  it("speichert mit Sicherung und öffnet nach einem Neustart das zuletzt aktive Projekt", () => {
    const storage = new MemoryStorage();
    const first = catalog(storage);
    first.load();
    const second = first.create("Zweites Set");
    second.tempo = 88;
    first.saveActive(second);
    second.tempo = 90;
    first.saveActive(second);
    expect(JSON.parse(storage.getItem(`${PROJECT_PREFIX}id-2.backup`)!).tempo).toBe(88);

    const reopened = catalog(storage);
    const result = reopened.load();
    expect(result.source).toBe("catalog");
    expect(reopened.active.name).toBe("Zweites Set");
    expect(result.project.tempo).toBe(90);
  });

  it("wechselt, dupliziert, benennt um und löscht ohne andere Projekte zu verändern", () => {
    const storage = new MemoryStorage();
    const repository = catalog(storage);
    const initial = repository.load().project;
    initial.tempo = 111;
    repository.saveActive(initial);
    const copy = repository.duplicate(initial);
    expect(copy.tempo).toBe(111);
    expect(repository.active.name).toBe(`${FIRST_PROJECT_NAME} Kopie`);
    repository.rename("  Nacht   Fahrt ");
    expect(repository.active.name).toBe("Nacht Fahrt");
    const back = repository.switchTo("id-1");
    expect(back.tempo).toBe(111);
    repository.switchTo("id-2");
    const replacement = repository.removeActive();
    expect(repository.projects.map((entry) => entry.id)).toEqual(["id-1"]);
    expect(replacement.tempo).toBe(111);
    expect(storage.getItem(`${PROJECT_PREFIX}id-2`)).toBeNull();
    expect(() => repository.removeActive()).toThrow("letzte Projekt");
  });

  it("begrenzt den Katalog auf acht Projekte", () => {
    const storage = new MemoryStorage();
    const repository = catalog(storage);
    repository.load();
    for (let index = 1; index < MAX_PROJECTS; index += 1) repository.create(`Set ${index}`);
    expect(repository.isFull).toBe(true);
    expect(() => repository.importProject("Zu viel", createFactoryProject())).toThrow("Höchstens 8");
  });

  it("stellt Projektliste und Projekt aus den Sicherungen wieder her", () => {
    const storage = new MemoryStorage();
    const repository = catalog(storage);
    const project = repository.load().project;
    project.tempo = 99;
    repository.saveActive(project);
    project.tempo = 100;
    repository.saveActive(project);
    storage.setItem(CATALOG_KEY, "{kaputt");
    storage.setItem(`${PROJECT_PREFIX}id-1`, "[]");
    const result = catalog(storage).load();
    expect(result.source).toBe("backup");
    expect(result.project.tempo).toBe(99);
    expect(result.warning).toContain("Sicherung");
    expect(storage.getItem(CATALOG_BACKUP_KEY)).not.toBeNull();
  });
});
