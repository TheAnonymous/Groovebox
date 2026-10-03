# Drittanbieterhinweise

## BraunUi 0.3.1

Der Ordner `public/vendor/braun-ui/` ist ein unveränderter Snapshot von
BraunUi v0.3.1 (Commit `c659886`). BraunUi steht unter der MIT-Lizenz; der
vollständige Lizenztext liegt unter `public/vendor/braun-ui/LICENSE`.
`public/icons.svg` ist eine unveränderte Kopie von dessen `icons.svg`: Die
Toasts von BraunUi verweisen relativ auf `icons.svg`.

Die mit BraunUi ausgelieferten Archivo-Schriften stehen unter der SIL Open
Font License 1.1. Der Lizenztext liegt unter
`public/vendor/braun-ui/fonts/OFL.txt`.

## Klangwerk und Tone.js

Der Klang läuft auf [Klangwerk](https://github.com/TheAnonymous/Klangwerk)
(MIT-Lizenz, `node_modules/klangwerk/LICENSE`). Klangwerks `Param` und
`klangwerk/tone` bauen die Teile von [Tone.js](https://github.com/Tonejs/Tone.js)
15.5 nach, auf denen Groovebox' Klang beruht (Gain, Panner, Kompressor,
Limiter, Waveshaper, Rauschen, Filter, EQ, Chorus, Stimmen, Notenwerte,
Automation); Feedback-Delay, Hall und Meter bilden Tone.js in
`src/audio/lean.ts` nach. Tone.js steht unter der MIT-Lizenz:

MIT License

Copyright (c) 2014-2025 Yotam Mann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Groovebox ist kein offizielles Braun-Produkt.
