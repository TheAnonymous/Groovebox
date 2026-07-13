import { createFactoryProject } from "./domain/defaults";
import { isValidProject, looksLikeLegacyProject, looksLikeProject, sanitizeProject } from "./domain/sanitize";
import type { ProjectV2 } from "./domain/types";

export const PROJECT_KEY = "groovebox.project.v2";
export const BACKUP_KEY = "groovebox.project.v2.backup";
export const LEGACY_PROJECT_KEY = "groovebox.project.v1";
export const LEGACY_BACKUP_KEY = "groovebox.project.v1.backup";

export interface LoadResult {
  project: ProjectV2;
  source: "primary" | "backup" | "migration" | "factory";
  warning?: string;
}

export interface ProjectRepository {
  load(): LoadResult;
  save(project: ProjectV2): void;
  reset(): ProjectV2;
}

export class LocalProjectRepository implements ProjectRepository {
  constructor(private readonly storage: Storage = localStorage) {}

  load(): LoadResult {
    const primary = this.readV2(PROJECT_KEY);
    if (primary) return { project: primary, source: "primary" };

    const backup = this.readV2(BACKUP_KEY);
    if (backup) {
      return {
        project: backup,
        source: "backup",
        warning: "Der letzte Speicherstand war beschädigt. Die gültige Sicherung wurde wiederhergestellt.",
      };
    }

    const legacy = this.readLegacy(LEGACY_PROJECT_KEY) ?? this.readLegacy(LEGACY_BACKUP_KEY);
    if (legacy) {
      const project = sanitizeProject(legacy);
      try {
        this.storage.setItem(PROJECT_KEY, JSON.stringify(project));
      } catch {
        // Migration still succeeds in memory; the untouched V1 value remains the fallback.
      }
      return {
        project,
        source: "migration",
        warning: "Das Projekt wurde sicher auf Version 2 aktualisiert. Der alte V1-Speicherstand bleibt als Rückfalloption erhalten.",
      };
    }

    const hadStoredData = [PROJECT_KEY, BACKUP_KEY, LEGACY_PROJECT_KEY, LEGACY_BACKUP_KEY]
      .some((key) => this.storage.getItem(key) !== null);
    return {
      project: createFactoryProject(),
      source: "factory",
      warning: hadStoredData
        ? "Gespeicherte Daten waren nicht lesbar. Das Werkprojekt wurde geladen."
        : undefined,
    };
  }

  save(project: ProjectV2): void {
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

  reset(): ProjectV2 {
    const factory = createFactoryProject();
    this.save(factory);
    return factory;
  }

  private readV2(key: string): ProjectV2 | null {
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as unknown;
      return looksLikeProject(value) ? sanitizeProject(value) : null;
    } catch {
      return null;
    }
  }


  private readLegacy(key: string): unknown | null {
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as unknown;
      return looksLikeLegacyProject(value) ? value : null;
    } catch {
      return null;
    }
  }
}
