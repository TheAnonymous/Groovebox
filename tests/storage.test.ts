import { describe, expect, it } from "vitest";
import { createFactoryProject } from "../src/domain/defaults";
import { BACKUP_KEY, LocalProjectRepository, PROJECT_KEY } from "../src/storage";

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
});
