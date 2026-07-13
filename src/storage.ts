import { createFactoryProject } from "./domain/defaults";
import { isValidProject, looksLikeProject, sanitizeProject } from "./domain/sanitize";
import type { ProjectV1 } from "./domain/types";

export const PROJECT_KEY = "groovebox.project.v1";
export const BACKUP_KEY = "groovebox.project.v1.backup";

export interface LoadResult {
  project: ProjectV1;
  source: "primary" | "backup" | "factory";
  warning?: string;
}

export interface ProjectRepository {
  load(): LoadResult;
  save(project: ProjectV1): void;
  reset(): ProjectV1;
}

export class LocalProjectRepository implements ProjectRepository {
  constructor(private readonly storage: Storage = localStorage) {}

  load(): LoadResult {
    const primary = this.read(PROJECT_KEY);
    if (primary) return { project: primary, source: "primary" };

    const backup = this.read(BACKUP_KEY);
    if (backup) {
      return {
        project: backup,
        source: "backup",
        warning: "Der letzte Speicherstand war beschädigt. Die gültige Sicherung wurde wiederhergestellt.",
      };
    }

    const hadStoredData = this.storage.getItem(PROJECT_KEY) !== null || this.storage.getItem(BACKUP_KEY) !== null;
    return {
      project: createFactoryProject(),
      source: "factory",
      warning: hadStoredData
        ? "Gespeicherte Daten waren nicht lesbar. Das Werkprojekt wurde geladen."
        : undefined,
    };
  }

  save(project: ProjectV1): void {
    const validated = sanitizeProject(project);
    const currentRaw = this.storage.getItem(PROJECT_KEY);
    if (currentRaw) {
      try {
        const current = JSON.parse(currentRaw) as unknown;
        if (isValidProject(current)) this.storage.setItem(BACKUP_KEY, currentRaw);
      } catch {
        // A damaged primary never replaces the last valid backup.
      }
    }
    this.storage.setItem(PROJECT_KEY, JSON.stringify(validated));
  }

  reset(): ProjectV1 {
    const factory = createFactoryProject();
    this.save(factory);
    return factory;
  }

  private read(key: string): ProjectV1 | null {
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as unknown;
      return looksLikeProject(value) ? sanitizeProject(value) : null;
    } catch {
      return null;
    }
  }
}
