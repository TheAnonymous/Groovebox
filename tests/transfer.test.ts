import { describe, expect, it } from "vitest";
import { createFactoryProject } from "../src/domain/defaults";
import { FILE_FORMAT, nameFromFileName, parseProjectFile, projectFileName, serializeProjectFile } from "../src/transfer";

describe("Projektdateien", () => {
  it("schreibt und liest eine Projektdatei ohne Verlust", () => {
    const project = createFactoryProject();
    project.tempo = 117;
    project.scenes[1]!.name = "Eigene Fahrt";
    const text = serializeProjectFile("Nachtfahrt", project, new Date("2026-09-27T20:00:00Z"));
    const file = JSON.parse(text);
    expect(file.format).toBe(FILE_FORMAT);
    expect(file.exportedAt).toBe("2026-09-27T20:00:00.000Z");
    const imported = parseProjectFile(text);
    expect(imported.name).toBe("Nachtfahrt");
    expect(imported.project).toEqual(project);
  });

  it("akzeptiert nacktes Projekt-JSON und nimmt den Dateinamen als Namen", () => {
    const imported = parseProjectFile(JSON.stringify(createFactoryProject()), nameFromFileName("mein_set.groovebox.json"));
    expect(imported.name).toBe("mein set");
  });

  it("repariert manipulierte Werte über den Sanitizer", () => {
    const project = createFactoryProject() as unknown as Record<string, unknown>;
    project.tempo = 999;
    const imported = parseProjectFile(JSON.stringify({ format: FILE_FORMAT, version: 1, name: "x", project }));
    expect(imported.project.tempo).toBe(120);
  });

  it("lehnt fremde und kaputte Dateien verständlich ab", () => {
    expect(() => parseProjectFile("{kaputt")).toThrow("kein lesbares JSON");
    expect(() => parseProjectFile(JSON.stringify({ format: "kitty-project" }))).toThrow("Kitty");
    expect(() => parseProjectFile(JSON.stringify({ format: FILE_FORMAT, version: 2 }))).toThrow("neueren");
    expect(() => parseProjectFile(JSON.stringify({ hallo: "welt" }))).toThrow("keine Groovebox-Projektdatei");
  });

  it("bildet sichere Dateinamen", () => {
    expect(projectFileName("Größe & Straße!")).toBe("groesse-strasse.groovebox.json");
    expect(projectFileName("   ")).toBe("unbenanntes-set.groovebox.json");
  });
});
