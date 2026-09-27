import { createFactoryProject } from "./domain/defaults";
import { isValidProject, looksLikeProject, sanitizeProject } from "./domain/sanitize";
import type { ProjectV2 } from "./domain/types";
import { LocalProjectRepository } from "./storage";

export const CATALOG_KEY = "groovebox.projects.v1";
export const CATALOG_BACKUP_KEY = "groovebox.projects.v1.backup";
export const PROJECT_PREFIX = "groovebox.projects.v1.project.";
export const MAX_PROJECTS = 8;
export const FIRST_PROJECT_NAME = "Mein erstes Set";
export const MIGRATED_PROJECT_NAME = "Mein Set";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

interface CatalogV1 {
  schemaVersion: 1;
  activeId: string;
  projects: ProjectSummary[];
}

export interface CatalogLoadResult {
  project: ProjectV2;
  source: "catalog" | "backup" | "migration" | "factory";
  warning?: string;
}

/**
 * Up to eight named projects in localStorage. Every project keeps a primary
 * value and the last valid value as backup, the catalog itself as well. The
 * single-project keys of earlier versions are only read, never changed, so
 * they stay available as a fallback.
 */
export class ProjectCatalog {
  private catalog: CatalogV1 = { schemaVersion: 1, activeId: "", projects: [] };

  constructor(
    private readonly storage: Storage = localStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = defaultId,
  ) {}

  get active(): ProjectSummary {
    return this.catalog.projects.find((entry) => entry.id === this.catalog.activeId) ?? this.catalog.projects[0]!;
  }

  get projects(): readonly ProjectSummary[] {
    return this.catalog.projects;
  }

  get isFull(): boolean {
    return this.catalog.projects.length >= MAX_PROJECTS;
  }

  load(): CatalogLoadResult {
    const primary = this.readCatalog(CATALOG_KEY);
    const backup = this.readCatalog(CATALOG_BACKUP_KEY);
    for (const [candidate, fromBackup] of [[primary, false], [backup, true]] as const) {
      if (!candidate) continue;
      const ordered = [
        candidate.projects.find((entry) => entry.id === candidate.activeId),
        ...candidate.projects,
      ].filter((entry): entry is ProjectSummary => Boolean(entry));
      for (const summary of ordered) {
        const stored = this.readProject(this.projectKey(summary.id));
        const restored = stored ? null : this.readProject(this.backupKey(summary.id));
        const project = stored ?? restored;
        if (!project) continue;
        this.catalog = { ...candidate, activeId: summary.id };
        const warning = restored
          ? "Der letzte Speicherstand war beschädigt. Die gültige Sicherung wurde wiederhergestellt."
          : fromBackup
            ? "Die Projektliste wurde aus der letzten gültigen Sicherung wiederhergestellt."
            : summary.id !== candidate.activeId
              ? "Das zuletzt geöffnete Projekt war nicht lesbar. Ein anderes Projekt wurde geöffnet."
              : undefined;
        return { project, source: restored || fromBackup ? "backup" : "catalog", ...(warning ? { warning } : {}) };
      }
    }

    const hadCatalog = this.safeGet(CATALOG_KEY) !== null || this.safeGet(CATALOG_BACKUP_KEY) !== null;
    const legacy = new LocalProjectRepository(this.storage).load();
    const migrated = legacy.source !== "factory";
    const summary = this.summary(migrated ? MIGRATED_PROJECT_NAME : FIRST_PROJECT_NAME);
    this.catalog = { schemaVersion: 1, activeId: summary.id, projects: [summary] };
    try {
      this.safeSet(this.projectKey(summary.id), JSON.stringify(legacy.project));
      this.writeCatalog();
    } catch {
      // The app stays usable in memory; the next autosave reports the storage error.
    }
    const warning = hadCatalog ? "Die Projektliste war nicht lesbar. Ein neues Werkprojekt wurde angelegt." : legacy.warning;
    return { project: legacy.project, source: migrated ? "migration" : "factory", ...(warning ? { warning } : {}) };
  }

  saveActive(project: ProjectV2): void {
    const id = this.active.id;
    const key = this.projectKey(id);
    const current = this.safeGet(key);
    if (current) {
      try {
        if (isValidProject(JSON.parse(current) as unknown)) this.safeSet(this.backupKey(id), current);
      } catch {
        // A damaged primary never replaces the last valid backup.
      }
    }
    this.safeSet(key, JSON.stringify(sanitizeProject(project)));
    this.touch(id);
    this.writeCatalog();
  }

  create(name: string, project: ProjectV2 = createFactoryProject()): ProjectV2 {
    return this.add(name, project);
  }

  duplicate(project: ProjectV2): ProjectV2 {
    return this.add(`${this.active.name} Kopie`, project);
  }

  importProject(name: string, project: ProjectV2): ProjectV2 {
    return this.add(name, project);
  }

  switchTo(id: string): ProjectV2 {
    const summary = this.catalog.projects.find((entry) => entry.id === id);
    if (!summary) throw new Error("Projekt wurde nicht gefunden.");
    const project = this.readProject(this.projectKey(id)) ?? this.readProject(this.backupKey(id));
    if (!project) throw new Error("Projekt ist beschädigt und besitzt keine gültige Sicherung.");
    this.catalog = { ...this.catalog, activeId: id };
    this.writeCatalog();
    return project;
  }

  rename(name: string): ProjectSummary {
    const id = this.active.id;
    this.catalog = {
      ...this.catalog,
      projects: this.catalog.projects.map((entry) => entry.id === id
        ? { ...entry, name: cleanName(name), updatedAt: this.now().toISOString() }
        : entry),
    };
    this.writeCatalog();
    return this.active;
  }

  removeActive(): ProjectV2 {
    if (this.catalog.projects.length <= 1) throw new Error("Das letzte Projekt kann nicht gelöscht werden.");
    const removed = this.active;
    const remaining = this.catalog.projects.filter((entry) => entry.id !== removed.id);
    const replacement = remaining.find((entry) => this.readProject(this.projectKey(entry.id)) ?? this.readProject(this.backupKey(entry.id)));
    if (!replacement) throw new Error("Kein anderes Projekt ist lesbar.");
    const project = (this.readProject(this.projectKey(replacement.id)) ?? this.readProject(this.backupKey(replacement.id)))!;
    this.catalog = { schemaVersion: 1, activeId: replacement.id, projects: remaining };
    this.writeCatalog();
    this.storage.removeItem(this.projectKey(removed.id));
    this.storage.removeItem(this.backupKey(removed.id));
    return project;
  }

  private add(name: string, project: ProjectV2): ProjectV2 {
    if (this.isFull) throw new Error(`Höchstens ${MAX_PROJECTS} Projekte sind möglich. Lösche zuerst eines.`);
    const clean = sanitizeProject(structuredClone(project));
    const summary = this.summary(name);
    this.safeSet(this.projectKey(summary.id), JSON.stringify(clean));
    this.catalog = { schemaVersion: 1, activeId: summary.id, projects: [...this.catalog.projects, summary] };
    this.writeCatalog();
    return clean;
  }

  private touch(id: string): void {
    const updatedAt = this.now().toISOString();
    this.catalog = {
      ...this.catalog,
      projects: this.catalog.projects.map((entry) => entry.id === id ? { ...entry, updatedAt } : entry),
    };
  }

  private writeCatalog(): void {
    const current = this.readCatalog(CATALOG_KEY);
    if (current) this.safeSet(CATALOG_BACKUP_KEY, JSON.stringify(current));
    this.safeSet(CATALOG_KEY, JSON.stringify(this.catalog));
  }

  private readProject(key: string): ProjectV2 | null {
    const raw = this.safeGet(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as unknown;
      return looksLikeProject(value) ? sanitizeProject(value) : null;
    } catch {
      return null;
    }
  }

  private readCatalog(key: string): CatalogV1 | null {
    const raw = this.safeGet(key);
    if (!raw) return null;
    try {
      const source = JSON.parse(raw) as Record<string, unknown>;
      if (source.schemaVersion !== 1 || typeof source.activeId !== "string" || !Array.isArray(source.projects)) return null;
      const projects = source.projects
        .flatMap((entry) => {
          const value = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
          return typeof value.id === "string" && typeof value.name === "string" && typeof value.updatedAt === "string"
            ? [{ id: value.id.slice(0, 80), name: cleanName(value.name), updatedAt: value.updatedAt }]
            : [];
        })
        .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
        .slice(0, MAX_PROJECTS);
      return projects.length ? { schemaVersion: 1, activeId: source.activeId, projects } : null;
    } catch {
      return null;
    }
  }

  private summary(name: string): ProjectSummary {
    return { id: this.createId(), name: cleanName(name), updatedAt: this.now().toISOString() };
  }

  private projectKey(id: string): string {
    return `${PROJECT_PREFIX}${id}`;
  }

  private backupKey(id: string): string {
    return `${PROJECT_PREFIX}${id}.backup`;
  }

  private safeGet(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private safeSet(key: string, value: string): void {
    this.storage.setItem(key, value);
  }
}

export function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  return clean || "Unbenanntes Set";
}

function defaultId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `groovebox-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
