import { looksLikeLegacyProject, looksLikeProject, sanitizeProject } from "./domain/sanitize";
import type { ProjectV2 } from "./domain/types";
import { cleanName } from "./catalog";

export const FILE_FORMAT = "groovebox-project";
export const FILE_VERSION = 1;
export const FILE_EXTENSION = ".groovebox.json";
const MAX_FILE_CHARACTERS = 2_000_000;

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  name: string;
  exportedAt: string;
  app: string;
  project: ProjectV2;
}

export interface ImportedProject {
  name: string;
  project: ProjectV2;
}

export function serializeProjectFile(name: string, project: ProjectV2, now: Date = new Date()): string {
  const file: ProjectFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: cleanName(name),
    exportedAt: now.toISOString(),
    app: "https://musik.jodie-oesterling.de/Groovebox/",
    project: sanitizeProject(project),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Accepts own project files and bare project JSON; everything else is rejected with a readable reason. */
export function parseProjectFile(text: string, fallbackName = "Importiertes Set"): ImportedProject {
  if (text.length > MAX_FILE_CHARACTERS) throw new Error("Die Datei ist zu groß für ein Groovebox-Projekt.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein lesbares JSON.");
  }
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  if (source.format === "kitty-project") throw new Error("Das ist ein Kitty-Projekt. Öffne es in Kitty.");
  if (source.format === FILE_FORMAT) {
    if (source.version !== FILE_VERSION) throw new Error("Diese Projektdatei stammt aus einer neueren Groovebox-Version.");
    if (!looksLikeProject(source.project) && !looksLikeLegacyProject(source.project)) {
      throw new Error("Die Projektdatei enthält kein vollständiges Projekt.");
    }
    return {
      name: cleanName(typeof source.name === "string" ? source.name : fallbackName),
      project: sanitizeProject(source.project),
    };
  }
  if (looksLikeProject(value) || looksLikeLegacyProject(value)) {
    return { name: cleanName(fallbackName), project: sanitizeProject(value) };
  }
  throw new Error("Das ist keine Groovebox-Projektdatei.");
}

export function projectFileName(name: string): string {
  return `${fileSlug(name, "groovebox-set")}${FILE_EXTENSION}`;
}

export function fileSlug(name: string, fallback = "groovebox"): string {
  const slug = cleanName(name)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function nameFromFileName(fileName: string): string {
  return cleanName(fileName.replace(/\.groovebox\.json$|\.json$/i, "").replace(/[-_]+/g, " "));
}

export const SHARE_PREFIX = "p=1.";
const MAX_SHARE_CHARACTERS = 60_000;

/** Packs a set into a URL fragment: deflate-compressed JSON, base64url. Fragments never reach the server. */
export async function encodeShareFragment(name: string, project: ProjectV2): Promise<string> {
  const json = JSON.stringify({ n: cleanName(name), p: sanitizeProject(project) });
  const compressed = await transform(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return `${SHARE_PREFIX}${toBase64Url(compressed)}`;
}

/** Reads a fragment made by {@link encodeShareFragment}; `null` when the fragment carries no set. */
export async function decodeShareFragment(fragment: string): Promise<ImportedProject | null> {
  const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!value.startsWith("p=")) return null;
  if (!value.startsWith(SHARE_PREFIX)) throw new Error("Dieser Link stammt aus einer neueren Groovebox-Version.");
  const encoded = value.slice(SHARE_PREFIX.length);
  if (!encoded || encoded.length > MAX_SHARE_CHARACTERS || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Der geteilte Link ist unvollständig.");
  }
  try {
    const json = new TextDecoder().decode(await transform(fromBase64Url(encoded), new DecompressionStream("deflate-raw")));
    const source = JSON.parse(json) as Record<string, unknown>;
    if (!looksLikeProject(source.p)) throw new Error("kein Projekt");
    return { name: cleanName(typeof source.n === "string" ? source.n : "Geteiltes Set"), project: sanitizeProject(source.p) };
  } catch {
    throw new Error("Der geteilte Link ist beschädigt oder unvollständig.");
  }
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
