# Groovebox

Eine vollständig clientseitige Synthwave-Groovebox für musikalische
Einsteiger. Vier Szenen, fünf Instrumente und ein 4×16-Step-Sequencer laufen
direkt im Browser. Drei kuratierte Klangfarben je Instrument sowie Kick,
Snare, Clap, Closed/Open Hat und Tom werden lokal mit Tone.js synthetisiert.

**Live:** https://theanonymous.github.io/Groovebox/

## Entwicklung

```bash
npm install
npm run dev
npm test
npm run build
npm run test:e2e
```

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

Jeder Push auf `main` wird nach erfolgreichen Unit-Tests automatisch über
GitHub Pages veröffentlicht.
