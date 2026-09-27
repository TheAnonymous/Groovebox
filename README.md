# Groovebox

Eine vollständig clientseitige Synthwave-Groovebox für musikalische
Einsteiger. Vier Szenen, fünf Instrumente und ein 4×16-Step-Sequencer laufen
direkt im Browser. Drei kuratierte Klangfarben je Instrument sowie Kick,
Snare, Clap, Closed/Open Hat und Tom werden lokal mit Tone.js synthetisiert.

**Live:** https://musik.jodie-oesterling.de/Groovebox/ (Teil der
[Musik-Werkstatt](https://musik.jodie-oesterling.de/))

![Groovebox · Synthwave Sequencer](docs/assets/promo/groovebox-banner-v2.png)

Weitere Motive stehen als [quadratisches Artwork](docs/assets/promo/groovebox-square-v2.png),
[Hochformat](docs/assets/promo/groovebox-portrait-v2.png) und
[Social-Preview](public/assets/social/groovebox-preview.png) bereit. Der
[Preset-Atlas](docs/assets/promo/preset-atlas-v3.png) zeigt zusätzlich alle 15
Klangfarben. Szenen-, Instrument- und Presetgrafiken werden direkt in der
Anwendung verwendet.

## Entwicklung

Die Toolchain ist über [`mise.toml`](mise.toml) festgelegt (Node.js 24.15.0,
npm 12.0.0); `mise install` richtet sie ein.

```bash
npm ci
npm run dev
npm run verify   # Unit-Tests, Build, E2E (Chromium + Firefox), Audio-Verträge
```

Für die lokale Hörabnahme startet `npm run audio:lab` das nicht im
Produktionsbuild enthaltene Sound-Lab ausschließlich auf
`http://127.0.0.1:4174/audio-lab.html`. Es rendert den Produktionssignalweg
offline, bietet A/B-Hörpegelabgleich und zeigt Peak, RMS, Crest-Faktor,
Bandenergie, Stereokorrelation und Ausklingzeit an; einen Audioexport gibt es
bewusst nicht.

Die App benötigt keine Konten, kein Backend und lädt zur Laufzeit keine
Ressourcen von fremden Origins. Projekte werden nur in `localStorage` des
aktuellen Browserprofils gespeichert. V1-Projekte werden automatisch nach V2
migriert; die V1-Daten bleiben dabei als Rückfalloption unangetastet.
Unterstützt wird eine Desktop-Fläche ab 1024×720 Pixeln.

## Bedienung

- `Leertaste`: Start/Stop
- `1`–`5`: Spur wählen
- `Umschalt+1`–`4`: Szene wählen oder für den nächsten Takt vormerken
- `V`: Pattern variieren, `R`: neues typisches Pattern
- `Strg+Z` / `Strg+Umschalt+Z`: Rückgängig/Wiederholen
- `Umschalt+Entf`: aktive Spur leeren

Die vendorte BraunUi-Version und ihre Lizenzen sind in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) dokumentiert.

## Veröffentlichung

Groovebox läuft unter `/Groovebox/` auf dem eigenen Server. Veröffentlicht wird
nur ein Commit auf `main`: `scripts/musik-build.sh` im Repository
`server-infra-nixos` exportiert ihn per `git archive`, führt `npm run verify`
aus und baut zusammen mit Kitty und der Übersichtsseite ein Release;
`scripts/musik-deploy.sh` schaltet es atomar um und prüft jede Datei über HTTPS,
`scripts/musik-rollback.sh` kehrt zum vorherigen Release zurück.

<!-- github-cicd-policy -->
## Local validation policy

This repository does not use GitHub Actions or any other GitHub-hosted CI/CD. Run tests, linters, builds, and all other checks locally before merging. A documented successful local test run is sufficient for review and merge.
<!-- /github-cicd-policy -->
