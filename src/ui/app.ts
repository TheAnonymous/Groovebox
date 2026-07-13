import type { AudioEngine } from "../audio/engine";
import { chordLabel, currentRole, DEGREE_LABELS, KEY_LABELS, roleOptions, SCALE_LABELS } from "../domain/music";
import { SOUND_PRESET_DEFINITIONS } from "../domain/sound-presets";
import { createFactoryProject } from "../domain/defaults";
import type {
  Action,
} from "../store/store";
import { canAddDrumVoice, GrooveboxStore, selectedPattern, selectedStep } from "../store/store";
import type {
  AppState,
  ChordColor,
  DrumVoice,
  GrooveIntent,
  MacroKind,
  PhraseContour,
  StepDynamics,
  StepLength,
  SoundPresetId,
  TrackKind,
  VariationAmount,
} from "../domain/types";
import {
  CHORD_COLORS,
  CONTOURS,
  DYNAMICS,
  DRUM_VOICES,
  INTENTS,
  MACRO_KINDS,
  ROOT_NOTES,
  SCALES,
  STEP_LENGTHS,
  TRACK_KINDS,
  VARIATION_AMOUNTS,
} from "../domain/types";
import type { ProjectRepository } from "../storage";
import type { BramsAdapter } from "./brams";

const ICON_SPRITE = `${import.meta.env.BASE_URL}vendor/braun-ui/icons.svg`;

const TRACK_LABELS: Record<TrackKind, { name: string; short: string; description: string }> = {
  drums: { name: "Drums", short: "DR", description: "Sechs Drumcomputer-Stimmen geben Halt und kontrollierte Fills." },
  bass: { name: "Bass", short: "BS", description: "Tiefe Töne tragen den Akkordwechsel." },
  chords: { name: "Chords", short: "CH", description: "Akkorde schaffen Farbe und Bewegung." },
  lead: { name: "Lead / Arp", short: "LD", description: "Eine helle Linie folgt sicheren Tönen." },
  pad: { name: "Pad / FX", short: "PD", description: "Langsame Flächen verbinden die Takte." },
};

const DYNAMIC_LABELS: Record<StepDynamics, string> = { ghost: "Leise", normal: "Normal", accent: "Betont" };
const LENGTH_LABELS: Record<StepLength, string> = { short: "Kurz", normal: "Normal", long: "Lang" };
const INTENT_LABELS: Record<GrooveIntent, string> = {
  steady: "Stabil",
  driving: "Treibend",
  spacious: "Weit",
  playful: "Verspielt",
};
const CONTOUR_LABELS: Record<PhraseContour, string> = {
  balanced: "Ausgewogen",
  rising: "Steigend",
  falling: "Fallend",
  callResponse: "Ruf & Antwort",
};
const MACRO_LABELS: Record<MacroKind, { label: string; hint: string }> = {
  warmth: { label: "Wärme", hint: "Dunkler und weicher, ohne dumpf zu werden." },
  drive: { label: "Drive", hint: "Mehr Druck und Kante in sicherem Bereich." },
  space: { label: "Raum", hint: "Mehr Tiefe, mit begrenzter Ausklingzeit." },
  motion: { label: "Motion", hint: "Mehr Bewegung und Echo im Klang." },
  density: { label: "Dichte", hint: "Wie voll und präsent die Spur wirkt." },
};
const COLOR_LABELS: Record<ChordColor, string> = {
  triad: "Klar",
  open: "Offen",
  suspended: "Schwebend",
  rich: "Reich",
};
const VARIATION_LABELS: Record<VariationAmount, string> = {
  subtle: "Dezent",
  lively: "Lebendig",
  bold: "Mutig",
};
const DRUM_VOICE_LABELS: Record<DrumVoice, { label: string; hint: string }> = {
  kick: { label: "Kick", hint: "Tiefe, geschichtete Bassdrum aus Pitch- und Sub-Anteil." },
  snare: { label: "Snare", hint: "Rauschen und gestimmter Körper; darf mit Clap geschichtet werden." },
  clap: { label: "Clap", hint: "Mehrteiliger Handclap-Transient; darf mit Snare geschichtet werden." },
  closedHat: { label: "Closed Hat", hint: "Kurze geschlossene Hi-Hat; nicht gleichzeitig mit Open Hat." },
  openHat: { label: "Open Hat", hint: "Länger ausklingende Hi-Hat; nicht gleichzeitig mit Closed Hat." },
  tom: { label: "Tom", hint: "Gestimmte Tom für Fills; nicht gleichzeitig mit Kick." },
};

export class GrooveboxApp {
  private autosaveTimer: number | null = null;
  private editingChordBar = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: GrooveboxStore,
    private readonly audio: AudioEngine,
    private readonly repository: ProjectRepository,
    private readonly brams: BramsAdapter,
  ) {}

  mount(warning?: string): void {
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("change", (event) => this.handleChange(event));
    this.root.addEventListener("keydown", (event) => this.handleGridKeys(event));
    window.addEventListener("keydown", (event) => this.handleGlobalKeys(event));
    window.addEventListener("beforeunload", () => this.audio.dispose(), { once: true });

    this.store.subscribe((state, action) => this.handleStateChange(state, action));
    this.audio.onStatus(({ status, message }) => {
      this.store.dispatch({
        type: "transport/update",
        update: {
          status,
          message,
          ...(status === "idle" ? { peak: 0, bar: 0, step: 0, queuedScene: null } : {}),
          ...(status === "idle" ? { trackPeaks: Object.fromEntries(TRACK_KINDS.map((track) => [track, 0])) as AppState["transport"]["trackPeaks"] } : {}),
        },
      });
    });
    this.audio.onPlayhead((position) => {
      this.store.dispatch({
        type: "transport/update",
        update: {
          runningScene: position.scene,
          queuedScene: position.switched ? null : this.store.getState().transport.queuedScene,
          bar: position.bar,
          step: position.step,
          peak: position.peak,
          trackPeaks: position.trackPeaks,
        },
      });
    });
    this.render();
    if (warning) requestAnimationFrame(() => this.brams.toast("Projekt wiederhergestellt", warning, "warning"));
  }

  private render(): void {
    const state = this.store.getState() as AppState;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset.focusKey;
    const pattern = selectedPattern(state)!;
    const scene = state.project.scenes[state.ui.selectedScene]!;
    const activeStep = selectedStep(state);
    const selectedPosition = state.ui.selectedStep;
    const isPlaying = state.transport.status === "playing";

    this.root.innerHTML = `
      <div class="gb-small-screen" role="status">
        <span class="gb-small-screen__mark" aria-hidden="true">GB</span>
        <h1>Groovebox braucht etwas Platz.</h1>
        <p>Öffne die Anwendung auf einem Desktop-Fenster ab 1024 × 720 Pixeln, damit alle 64 Steps zuverlässig bedienbar bleiben.</p>
      </div>
      <div class="gb-app-shell">
        ${this.header(state, isPlaying)}
        <main class="gb-main">
          ${this.controlStrip(state)}
          ${this.scenes(state)}
          <div class="gb-workspace">
            ${this.mixer(state)}
            <section class="gb-sequencer bu-card" aria-labelledby="sequence-title">
              <header class="gb-section-heading">
                <div>
                  <p class="gb-eyebrow">${escapeHtml(scene.name)} · ${TRACK_LABELS[state.ui.selectedTrack].short}</p>
                  <h2 id="sequence-title">${TRACK_LABELS[state.ui.selectedTrack].name}</h2>
                  <p>${TRACK_LABELS[state.ui.selectedTrack].description}</p>
                </div>
                <div class="gb-pattern-actions">
                  <div class="bu-segmented gb-variation" role="group" aria-label="Stärke der Variation">
                    ${VARIATION_AMOUNTS.map((amount) => `<button class="bu-segmented__item" type="button" data-action="variation-amount" data-value="${amount}" aria-pressed="${state.ui.variationAmount === amount}" title="${variationHint(amount)}">${VARIATION_LABELS[amount]}</button>`).join("")}
                  </div>
                  <button class="bu-button bu-button--sm" type="button" data-action="vary" title="Verändert ${variationBarCount(state.ui.variationAmount)}; gesperrte Takte bleiben erhalten.">Variieren <kbd>V</kbd></button>
                  <button class="bu-button bu-button--sm" type="button" data-action="randomize" title="Erzeugt ein neues, instrumenttypisches Pattern. Gesperrte Takte bleiben erhalten.">Neu würfeln <kbd>R</kbd></button>
                </div>
              </header>
              ${this.chords(state)}
              <div class="gb-grid-wrap" aria-label="Vier Takte mit je 16 Steps">
                <div class="gb-step-numbers" aria-hidden="true"><span></span>${Array.from({ length: 16 }, (_, index) => `<span>${index + 1}</span>`).join("")}</div>
                ${pattern.bars.map((bar, barIndex) => `
                  <div class="gb-bar-row" data-bar-row="${barIndex}">
                    <div class="gb-bar-label">
                      <span>Takt ${barIndex + 1}</span>
                      <button type="button" class="gb-lock" data-action="toggle-lock" data-bar="${barIndex}" aria-pressed="${state.ui.locks[state.ui.selectedTrack][barIndex]}" title="${state.ui.locks[state.ui.selectedTrack][barIndex] ? "Takt entsperren" : "Takt sperren; Variationen lassen ihn danach unverändert"}">
                        <svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#lock"></use></svg>
                        <span>${state.ui.locks[state.ui.selectedTrack][barIndex] ? "Fest" : "Frei"}</span>
                      </button>
                    </div>
                    <div class="gb-step-row" role="group" aria-label="Takt ${barIndex + 1}">
                      ${bar.steps.map((step, stepIndex) => this.stepButton(state, step, barIndex, stepIndex)).join("")}
                    </div>
                  </div>
                `).join("")}
              </div>
              <footer class="gb-legend">
                <span><i class="gb-key gb-key--off">—</i> Aus</span>
                <span><i class="gb-key gb-key--normal">•</i> Normal</span>
                <span><i class="gb-key gb-key--accent">!</i> Akzent</span>
                <span><i class="gb-key gb-key--variation">≈</i> Variation</span>
                <span class="gb-legend__tip">Klicken wechselt: Aus → Normal → Akzent → Variation → Aus</span>
              </footer>
            </section>
            <aside class="gb-inspector" aria-label="Details und Klang">
              ${this.stepInspector(state, activeStep, selectedPosition)}
              ${this.soundInspector(state)}
            </aside>
          </div>
          <p class="gb-local-note"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#info"></use></svg> Dein Projekt wird ausschließlich in diesem Browserprofil gespeichert. Es gibt in Version 2 keinen Datei- oder Audioexport.</p>
        </main>
        ${this.dialogs(state)}
      </div>
    `;
    this.brams.init(this.root);
    this.updateTransportDom(state);
    if (focusKey) requestAnimationFrame(() => this.root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus());
  }

  private header(state: AppState, isPlaying: boolean): string {
    const statusTone = state.transport.status === "playing" ? "success" : state.transport.status === "error" ? "danger" : state.transport.status === "suspended" ? "warning" : "";
    const saveTone = state.autosave === "error" ? "danger" : state.autosave === "saving" ? "warning" : "success";
    const saveLabel = state.autosave === "saving" ? "Speichert …" : state.autosave === "error" ? "Speicherfehler" : "Lokal gespeichert";
    return `<header class="bu-header gb-header">
      <div class="bu-header__inner gb-header__inner">
        <div class="gb-brand" aria-label="Groovebox">
          <span class="gb-brand__index">GB–01</span>
          <span class="gb-brand__name">GROOVEBOX</span>
          <span class="gb-brand__tag">SYNTHWAVE SEQUENCER</span>
        </div>
        <div class="gb-transport">
          <button class="bu-button bu-button--primary gb-start" type="button" data-action="toggle-play" data-focus-key="play" aria-label="${isPlaying ? "Wiedergabe stoppen" : "Wiedergabe starten"}">
            <span aria-hidden="true">${isPlaying ? "■" : "▶"}</span> ${isPlaying ? "Stop" : "Start"} <kbd>Leertaste</kbd>
          </button>
          <button class="bu-button bu-button--danger" type="button" data-action="panic" title="Stoppt Transport, Echos und alle klingenden Stimmen sofort.">Panik</button>
        </div>
        <div class="gb-system-status">
          <span class="bu-status ${statusTone ? `bu-status--${statusTone}` : ""}" data-audio-status>${escapeHtml(state.transport.message)}</span>
          <span class="bu-status bu-status--${saveTone}" data-save-status>${saveLabel}</span>
        </div>
        <div class="gb-header-actions">
          <button class="bu-button bu-button--sm" type="button" data-action="undo" ${state.canUndo ? "" : "disabled"} title="Letzte musikalische Änderung rückgängig machen (Strg+Z)">↶</button>
          <button class="bu-button bu-button--sm" type="button" data-action="redo" ${state.canRedo ? "" : "disabled"} title="Änderung wiederholen (Strg+Umschalt+Z)">↷</button>
          <button class="bu-button bu-button--sm" type="button" data-action="new-project">Neues Projekt</button>
        </div>
      </div>
    </header>`;
  }

  private controlStrip(state: AppState): string {
    return `<section class="gb-controls" aria-label="Globale musikalische Einstellungen">
      <label class="gb-compact-field"><span>Tempo</span><span class="gb-field-control"><input class="bu-range__input" type="range" min="80" max="120" step="1" value="${state.project.tempo}" data-change="tempo" aria-label="Tempo"><output>${Math.round(state.project.tempo)} BPM</output></span></label>
      <label class="gb-compact-field"><span>Tonart</span><select class="bu-select" data-change="key" aria-label="Tonart">${ROOT_NOTES.map((key) => option(key, KEY_LABELS[key], state.project.key)).join("")}</select></label>
      <label class="gb-compact-field"><span>Skala</span><select class="bu-select" data-change="scale" aria-label="Skala">${SCALES.map((scale) => option(scale, SCALE_LABELS[scale], state.project.scale)).join("")}</select></label>
      <label class="gb-compact-field"><span>Swing</span><span class="gb-field-control"><input class="bu-range__input" type="range" min="0" max="40" step="1" value="${Math.round(state.project.swing * 100)}" data-change="swing" aria-label="Swing"><output>${Math.round(state.project.swing * 100)} %</output></span></label>
      <label class="gb-compact-field"><span>Master</span><span class="gb-field-control"><input class="bu-range__input" type="range" min="0" max="100" step="1" value="${Math.round(state.project.masterVolume * 100)}" data-change="master" aria-label="Masterpegel"><output>${Math.round(state.project.masterVolume * 100)} %</output></span></label>
    </section>`;
  }

  private scenes(state: AppState): string {
    return `<nav class="gb-scenes" aria-label="Szenen">
      ${state.project.scenes.map((scene, index) => {
        const selected = state.ui.selectedScene === index;
        const running = state.transport.status === "playing" && state.transport.runningScene === index;
        const queued = state.transport.queuedScene === index;
        return `<button class="gb-scene ${selected ? "is-selected" : ""} ${running ? "is-running" : ""} ${queued ? "is-queued" : ""}" type="button" data-action="select-scene" data-scene="${index}" data-focus-key="scene-${index}" aria-current="${selected ? "true" : "false"}" title="${state.transport.status === "playing" ? "Zum nächsten Takt vormerken" : "Szene bearbeiten"}">
          <span class="gb-scene__number">0${index + 1}</span>
          <span class="gb-scene__copy"><strong>${escapeHtml(scene.name)}</strong><small>${escapeHtml(scene.subtitle)}</small></span>
          <span class="gb-scene__states">${selected ? "BEARBEITUNG" : ""}${running ? " · LÄUFT" : ""}${queued ? " · NÄCHSTER TAKT" : ""}</span>
        </button>`;
      }).join("")}
    </nav>`;
  }

  private mixer(state: AppState): string {
    return `<section class="gb-mixer bu-card" aria-labelledby="mixer-title">
      <header class="gb-panel-heading"><p class="gb-eyebrow">05 KANÄLE</p><h2 id="mixer-title">Mixer</h2></header>
      <div class="gb-mixer__tracks">
        ${TRACK_KINDS.map((track, index) => {
          const mix = state.project.mix.find((entry) => entry.instrument === track)!;
          const selected = state.ui.selectedTrack === track;
          const meter = mix.muted ? 0 : Math.max(0, Math.min(1, state.transport.trackPeaks[track]));
          return `<article class="gb-channel ${selected ? "is-selected" : ""}">
            <button class="gb-channel__select" type="button" data-action="select-track" data-track="${track}" data-focus-key="track-${track}" aria-pressed="${selected}" title="Spur ${index + 1} auswählen (Taste ${index + 1})">
              <span>${TRACK_LABELS[track].short}</span><strong>${TRACK_LABELS[track].name}</strong>
            </button>
            <div class="gb-channel__meter" data-meter-track="${track}" data-track-peak="${meter}" role="meter" aria-label="Pegel ${TRACK_LABELS[track].name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(meter * 100)}"><i style="--level:${meter}"></i></div>
            <div class="gb-channel__buttons">
              <button type="button" data-action="mute" data-track="${track}" aria-pressed="${mix.muted}" title="${mix.muted ? "Stummschaltung aufheben" : "Spur stummschalten"}">M</button>
              <button type="button" data-action="solo" data-track="${track}" aria-pressed="${mix.solo}" title="${mix.solo ? "Solo aufheben" : "Nur diese Solo-Spuren hören"}">S</button>
            </div>
            <label class="gb-channel__volume"><span class="sr-only">Lautstärke ${TRACK_LABELS[track].name}</span><input type="range" min="0" max="100" value="${Math.round(mix.volume * 100)}" data-change="track-volume" data-track="${track}"><output>${Math.round(mix.volume * 100)}</output></label>
          </article>`;
        }).join("")}
      </div>
    </section>`;
  }

  private chords(state: AppState): string {
    const scene = state.project.scenes[state.ui.selectedScene]!;
    return `<div class="gb-chords" aria-label="Akkorde pro Takt">
      ${scene.chords.map((chord, index) => `<button class="gb-chord" type="button" data-action="edit-chord" data-bar="${index}" title="Akkord für Takt ${index + 1} ändern">
        <span>TAKT 0${index + 1}</span><strong>${chordLabel(state.project.key, state.project.scale, chord)}</strong><small>${COLOR_LABELS[chord.color]}</small>
      </button>`).join("")}
    </div>`;
  }

  private stepButton(state: AppState, step: ReturnType<typeof selectedStep> extends infer _ ? NonNullable<ReturnType<typeof selectedStep>> : never, bar: number, index: number): string {
    const selected = state.ui.selectedStep?.bar === bar && state.ui.selectedStep.step === index;
    const playing = state.transport.status === "playing" && state.transport.runningScene === state.ui.selectedScene && state.transport.bar === bar && state.transport.step === index;
    const tone = !step.enabled ? "off" : step.dynamics === "accent" ? "accent" : step.variation >= 0.95 ? "variation" : step.dynamics === "ghost" ? "ghost" : "normal";
    const symbol = tone === "off" ? "—" : tone === "accent" ? "!" : tone === "variation" ? "≈" : tone === "ghost" ? "·" : "•";
    const stateLabel = tone === "off" ? "Aus" : tone === "accent" ? "Akzent" : tone === "variation" ? "Variation" : tone === "ghost" ? "Leise" : "Normal";
    const nextLabel = tone === "off" ? "Normal" : tone === "normal" || tone === "ghost" ? "Akzent" : tone === "accent" ? "Variation" : "Aus";
    return `<button class="gb-step gb-step--${tone} ${selected ? "is-selected" : ""} ${playing ? "is-playing" : ""}" type="button" data-action="cycle-step" data-bar="${bar}" data-step="${index}" data-focus-key="step-${bar}-${index}" aria-pressed="${step.enabled}" aria-label="Takt ${bar + 1}, Step ${index + 1}: ${stateLabel}. Nächster Zustand ${nextLabel}." title="${stateLabel} · Klick: ${nextLabel}"><span>${symbol}</span></button>`;
  }

  private stepInspector(state: AppState, step: ReturnType<typeof selectedStep>, position: AppState["ui"]["selectedStep"]): string {
    if (!step || !position) {
      return `<section class="bu-card gb-detail-card"><div class="gb-panel-heading"><p class="gb-eyebrow">STEP</p><h2>Details</h2></div><div class="gb-empty-detail"><span>01—64</span><p>Wähle einen Step, um Lautstärke, Länge und eine sichere Tonrolle einzustellen.</p></div></section>`;
    }
    const track = state.ui.selectedTrack;
    const role = track === "drums" ? null : currentRole(track, step);
    return `<section class="bu-card gb-detail-card"><div class="gb-panel-heading"><p class="gb-eyebrow">TAKT ${position.bar + 1} · STEP ${position.step + 1}</p><h2>Step-Details</h2></div>
      <div class="gb-detail-fields ${step.enabled ? "" : "is-disabled"}">
        ${!step.enabled ? "<p class=\"gb-inline-note\">Dieser Step ist aus. Klicke ihn im Raster einmal an, um Details zu bearbeiten.</p>" : ""}
        <label class="bu-field"><span class="bu-field__label">Dynamik</span><select class="bu-select" data-change="step-dynamics" ${step.enabled ? "" : "disabled"}>${DYNAMICS.map((dynamic) => option(dynamic, DYNAMIC_LABELS[dynamic], step.dynamics)).join("")}</select><span class="bu-field__help">Wie deutlich dieser Schritt hörbar ist.</span></label>
        <label class="bu-field"><span class="bu-field__label">Länge</span><select class="bu-select" data-change="step-length" ${step.enabled ? "" : "disabled"}>${STEP_LENGTHS.map((length) => option(length, LENGTH_LABELS[length], step.length)).join("")}</select><span class="bu-field__help">Kurze Töne federn, lange Töne verbinden.</span></label>
        ${track === "drums" ? this.drumVoiceControls(step) : `<label class="bu-field"><span class="bu-field__label">Tonrolle</span><select class="bu-select" data-change="step-role" ${step.enabled ? "" : "disabled"}>${roleOptions(track).map((entry) => option(entry.value, entry.label, role!.value)).join("")}</select><span class="bu-field__help">Nur passende Skalentöne sind möglich.</span></label>`}
      </div></section>`;
  }

  private drumVoiceControls(step: NonNullable<ReturnType<typeof selectedStep>>): string {
    return `<fieldset class="gb-drum-voices" ${step.enabled ? "" : "disabled"}>
      <legend>Drumrollen <span>${step.drumVoices.length}/2</span></legend>
      <div class="gb-drum-voice-grid">
        ${DRUM_VOICES.map((voice) => {
          const active = step.drumVoices.includes(voice);
          const disabled = !step.enabled || (active ? step.drumVoices.length === 1 : !canAddDrumVoice(step.drumVoices, voice));
          return `<button type="button" data-action="drum-voice" data-voice="${voice}" data-focus-key="drum-voice-${voice}" aria-pressed="${active}" ${disabled ? "disabled" : ""} title="${DRUM_VOICE_LABELS[voice].hint}">${DRUM_VOICE_LABELS[voice].label}</button>`;
        }).join("")}
      </div>
      <span class="bu-field__help">Höchstens zwei Rollen. Die letzte Rolle bleibt erhalten, solange der Step aktiv ist.</span>
    </fieldset>`;
  }

  private soundInspector(state: AppState): string {
    const pattern = selectedPattern(state)!;
    const track = state.ui.selectedTrack;
    const preset = state.project.soundPresets[track];
    return `<section class="bu-card gb-sound-card"><div class="gb-panel-heading"><p class="gb-eyebrow">KLANG</p><h2>Charakter</h2></div>
      <div class="gb-sound-fields">
        <fieldset class="gb-preset-field"><legend>Klangfarbe</legend><div class="bu-segmented gb-presets" role="group" aria-label="Klangfarbe ${TRACK_LABELS[track].name}">
          ${SOUND_PRESET_DEFINITIONS[track].map((entry) => `<button class="bu-segmented__item" type="button" data-action="preset" data-preset="${entry.id}" aria-pressed="${preset === entry.id}" title="${entry.hint}">${entry.label}</button>`).join("")}
        </div><span class="bu-field__help">Gilt für alle Szenen.</span></fieldset>
        <label class="bu-field"><span class="bu-field__label">Spielabsicht</span><select class="bu-select" data-change="intent">${INTENTS.map((intent) => option(intent, INTENT_LABELS[intent], pattern.intent)).join("")}</select></label>
        <label class="bu-field"><span class="bu-field__label">Melodieverlauf</span><select class="bu-select" data-change="contour">${CONTOURS.map((contour) => option(contour, CONTOUR_LABELS[contour], pattern.contour)).join("")}</select></label>
        <div class="gb-macros">
          ${MACRO_KINDS.map((macro) => `<label class="gb-macro" title="${MACRO_LABELS[macro].hint}"><span>${MACRO_LABELS[macro].label}</span><input type="range" min="0" max="100" step="1" value="${Math.round(pattern.macros[macro] * 100)}" data-change="macro" data-macro="${macro}"><output>${Math.round(pattern.macros[macro] * 100)} %</output></label>`).join("")}
        </div>
      </div></section>`;
  }

  private dialogs(state: AppState): string {
    const chord = state.project.scenes[state.ui.selectedScene]!.chords[this.editingChordBar]!;
    return `<div id="new-project-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><div class="bu-dialog__header"><div><h2 id="new-project-title" class="bu-dialog__title">Neues Projekt beginnen?</h2><p class="bu-dialog__description">Das aktuelle Projekt wird durch die vier Werksszenen ersetzt.</p></div><button class="bu-icon-button" type="button" data-bu-close aria-label="Dialog schließen"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#close"></use></svg></button></div><div class="bu-dialog__body"><p>Die letzte gültige Version bleibt bis zum nächsten Speichern als Sicherung erhalten. Ein Datei-Export ist in Version 2 nicht verfügbar.</p></div><div class="bu-dialog__footer"><button class="bu-button" type="button" data-bu-close>Abbrechen</button><button class="bu-button bu-button--danger" type="button" data-action="confirm-new">Werkprojekt laden</button></div></section></div>
      <div id="chord-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="chord-title"><div class="bu-dialog__header"><div><h2 id="chord-title" class="bu-dialog__title">Akkord · Takt ${this.editingChordBar + 1}</h2><p class="bu-dialog__description">Alle Varianten bleiben sicher in ${KEY_LABELS[state.project.key]} ${SCALE_LABELS[state.project.scale]}.</p></div><button class="bu-icon-button" type="button" data-bu-close aria-label="Dialog schließen"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#close"></use></svg></button></div><div class="bu-dialog__body gb-dialog-fields"><label class="bu-field"><span class="bu-field__label">Stufe</span><select class="bu-select" id="chord-degree">${DEGREE_LABELS.map((label, index) => option(String(index + 1), label, String(chord.degree))).join("")}</select></label><label class="bu-field"><span class="bu-field__label">Farbe</span><select class="bu-select" id="chord-color">${CHORD_COLORS.map((color) => option(color, COLOR_LABELS[color], chord.color)).join("")}</select></label><label class="bu-field"><span class="bu-field__label">Lage</span><select class="bu-select" id="chord-inversion">${[-1, 0, 1].map((value) => option(String(value), value === -1 ? "Tief" : value === 1 ? "Hoch" : "Mitte", String(chord.inversion))).join("")}</select></label></div><div class="bu-dialog__footer"><button class="bu-button" type="button" data-bu-close>Abbrechen</button><button class="bu-button bu-button--primary" type="button" data-action="save-chord">Akkord übernehmen</button></div></section></div>
      <div class="bu-toast-region" data-bu-toast-region aria-live="polite" aria-atomic="false"></div>`;
  }

  private handleStateChange(state: AppState, action: Action): void {
    if (action.type === "transport/update") {
      this.updateTransportDom(state);
      return;
    }
    if (action.type === "autosave/status") {
      this.updateSaveDom(state);
      return;
    }
    if (!action.type.startsWith("ui/")) {
      this.audio.syncProject(state.project);
      if (state.autosave === "saving") this.scheduleAutosave();
    }
    this.render();
  }

  private updateTransportDom(state: AppState): void {
    this.root.dataset.audioPeak = String(state.transport.peak);
    const status = this.root.querySelector<HTMLElement>("[data-audio-status]");
    if (status) {
      status.textContent = state.transport.message;
      status.className = `bu-status ${state.transport.status === "playing" ? "bu-status--success" : state.transport.status === "error" ? "bu-status--danger" : state.transport.status === "suspended" ? "bu-status--warning" : ""}`;
    }
    const playButton = this.root.querySelector<HTMLButtonElement>('[data-action="toggle-play"]');
    if (playButton) {
      const playing = state.transport.status === "playing";
      playButton.setAttribute("aria-label", playing ? "Wiedergabe stoppen" : "Wiedergabe starten");
      playButton.innerHTML = `<span aria-hidden="true">${playing ? "■" : "▶"}</span> ${playing ? "Stop" : "Start"} <kbd>Leertaste</kbd>`;
    }
    this.root.querySelectorAll(".gb-step.is-playing").forEach((element) => element.classList.remove("is-playing"));
    if (state.transport.status === "playing" && state.transport.runningScene === state.ui.selectedScene) {
      this.root.querySelector(`.gb-step[data-bar="${state.transport.bar}"][data-step="${state.transport.step}"]`)?.classList.add("is-playing");
    }
    this.root.querySelectorAll<HTMLElement>(".gb-channel__meter").forEach((meter) => {
      const track = meter.dataset.meterTrack as TrackKind;
      const mix = state.project.mix.find((entry) => entry.instrument === track);
      const level = mix?.muted ? 0 : Math.max(0, Math.min(1, state.transport.trackPeaks[track] ?? 0));
      meter.dataset.trackPeak = String(level);
      meter.setAttribute("aria-valuenow", String(Math.round(level * 100)));
      meter.querySelector<HTMLElement>("i")?.style.setProperty("--level", String(level));
    });
    this.root.querySelectorAll(".gb-scene").forEach((element, index) => {
      element.classList.toggle("is-running", state.transport.status === "playing" && index === state.transport.runningScene);
      element.classList.toggle("is-queued", index === state.transport.queuedScene);
    });
  }

  private updateSaveDom(state: AppState): void {
    const save = this.root.querySelector<HTMLElement>("[data-save-status]");
    if (!save) return;
    save.textContent = state.autosave === "saving" ? "Speichert …" : state.autosave === "error" ? "Speicherfehler" : "Lokal gespeichert";
    save.className = `bu-status bu-status--${state.autosave === "error" ? "danger" : state.autosave === "saving" ? "warning" : "success"}`;
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        this.repository.save(this.store.getState().project);
        this.store.dispatch({ type: "autosave/status", status: "saved" });
      } catch {
        this.store.dispatch({ type: "autosave/status", status: "error" });
        this.brams.toast("Nicht gespeichert", "Der Browser konnte den lokalen Speicher nicht aktualisieren.", "danger");
      }
    }, 300);
  }

  private handleClick(event: Event): void {
    const button = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "toggle-play") void this.togglePlayback();
    else if (action === "panic") this.audio.panic();
    else if (action === "undo") this.store.dispatch({ type: "history/undo" });
    else if (action === "redo") this.store.dispatch({ type: "history/redo" });
    else if (action === "select-scene") this.selectScene(Number(button.dataset.scene));
    else if (action === "select-track") this.store.dispatch({ type: "ui/select-track", track: button.dataset.track as TrackKind });
    else if (action === "mute") this.store.dispatch({ type: "mix/mute", track: button.dataset.track as TrackKind });
    else if (action === "solo") this.store.dispatch({ type: "mix/solo", track: button.dataset.track as TrackKind });
    else if (action === "cycle-step") this.store.dispatch({ type: "step/cycle", bar: Number(button.dataset.bar), step: Number(button.dataset.step) });
    else if (action === "drum-voice") this.store.dispatch({ type: "step/drum-voice", voice: button.dataset.voice as DrumVoice });
    else if (action === "preset") this.store.dispatch({ type: "project/preset", track: this.store.getState().ui.selectedTrack, value: button.dataset.preset as SoundPresetId });
    else if (action === "toggle-lock") this.store.dispatch({ type: "ui/toggle-lock", bar: Number(button.dataset.bar) });
    else if (action === "variation-amount") this.store.dispatch({ type: "ui/variation-amount", amount: button.dataset.value as VariationAmount });
    else if (action === "vary") this.store.dispatch({ type: "track/vary" });
    else if (action === "randomize") this.store.dispatch({ type: "track/randomize" });
    else if (action === "new-project") this.brams.open("#new-project-dialog");
    else if (action === "confirm-new") this.confirmNewProject();
    else if (action === "edit-chord") this.openChordDialog(Number(button.dataset.bar));
    else if (action === "save-chord") this.saveChord();
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const change = input.dataset.change;
    if (!change) return;
    if (change === "tempo") this.store.dispatch({ type: "project/tempo", value: Number(input.value) });
    else if (change === "key") this.store.dispatch({ type: "project/key", value: input.value as AppState["project"]["key"] });
    else if (change === "scale") this.store.dispatch({ type: "project/scale", value: input.value as AppState["project"]["scale"] });
    else if (change === "swing") this.store.dispatch({ type: "project/swing", value: Number(input.value) / 100 });
    else if (change === "master") this.store.dispatch({ type: "project/master", value: Number(input.value) / 100 });
    else if (change === "track-volume") this.store.dispatch({ type: "mix/volume", track: input.dataset.track as TrackKind, value: Number(input.value) / 100 });
    else if (change === "step-dynamics") this.store.dispatch({ type: "step/dynamics", value: input.value as StepDynamics });
    else if (change === "step-length") this.store.dispatch({ type: "step/length", value: input.value as StepLength });
    else if (change === "step-role") {
      const role = roleOptions(this.store.getState().ui.selectedTrack).find((entry) => entry.value === input.value);
      if (role) this.store.dispatch({ type: "step/role", degreeOffset: role.degreeOffset, variation: role.variation });
    } else if (change === "intent") this.store.dispatch({ type: "track/intent", value: input.value as GrooveIntent });
    else if (change === "contour") this.store.dispatch({ type: "track/contour", value: input.value as PhraseContour });
    else if (change === "macro") this.store.dispatch({ type: "track/macro", macro: input.dataset.macro as MacroKind, value: Number(input.value) / 100 });
  }

  private async togglePlayback(): Promise<void> {
    if (this.store.getState().transport.status === "playing") {
      this.audio.stop();
    } else {
      await this.audio.start(this.store.getState().ui.selectedScene);
    }
  }

  private selectScene(scene: number): void {
    const playing = this.store.getState().transport.status === "playing";
    this.store.dispatch({ type: "ui/select-scene", scene });
    if (playing) {
      const queued = this.audio.queueScene(scene);
      this.store.dispatch({ type: "transport/update", update: { queuedScene: queued } });
    } else {
      this.store.dispatch({ type: "transport/update", update: { runningScene: scene, queuedScene: null } });
    }
  }

  private confirmNewProject(): void {
    this.audio.panic();
    this.repository.reset();
    this.store.dispatch({ type: "project/replace", project: createFactoryProject() });
    this.brams.close("#new-project-dialog");
    this.brams.toast("Werkprojekt geladen", "Vier neue Synthwave-Szenen sind bereit.", "success");
  }

  private openChordDialog(bar: number): void {
    this.editingChordBar = Math.max(0, Math.min(3, bar));
    this.render();
    this.brams.open("#chord-dialog");
  }

  private saveChord(): void {
    const degree = Number(this.root.querySelector<HTMLSelectElement>("#chord-degree")?.value ?? 1);
    const inversion = Number(this.root.querySelector<HTMLSelectElement>("#chord-inversion")?.value ?? 0);
    const color = (this.root.querySelector<HTMLSelectElement>("#chord-color")?.value ?? "triad") as ChordColor;
    this.brams.close("#chord-dialog");
    this.store.dispatch({ type: "chord/update", bar: this.editingChordBar, value: { degree, inversion, color } });
  }

  private handleGridKeys(event: KeyboardEvent): void {
    const target = (event.target as Element).closest<HTMLElement>(".gb-step");
    if (!target || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let bar = Number(target.dataset.bar);
    let step = Number(target.dataset.step);
    if (event.key === "ArrowLeft") step = Math.max(0, step - 1);
    if (event.key === "ArrowRight") step = Math.min(15, step + 1);
    if (event.key === "ArrowUp") bar = Math.max(0, bar - 1);
    if (event.key === "ArrowDown") bar = Math.min(3, bar + 1);
    if (event.key === "Home") step = 0;
    if (event.key === "End") step = 15;
    this.root.querySelector<HTMLElement>(`.gb-step[data-bar="${bar}"][data-step="${step}"]`)?.focus();
  }

  private handleGlobalKeys(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.matches("input, select, textarea, [contenteditable=true]") || target.closest("[role=dialog]")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.store.dispatch({ type: event.shiftKey ? "history/redo" : "history/undo" });
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      void this.togglePlayback();
      return;
    }
    if (event.shiftKey && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      this.selectScene(Number(event.key) - 1);
      return;
    }
    if (!event.shiftKey && /^[1-5]$/.test(event.key)) {
      event.preventDefault();
      this.store.dispatch({ type: "ui/select-track", track: TRACK_KINDS[Number(event.key) - 1]! });
      return;
    }
    if (event.key.toLowerCase() === "v") this.store.dispatch({ type: "track/vary" });
    if (event.key.toLowerCase() === "r") this.store.dispatch({ type: "track/randomize" });
    if (event.shiftKey && event.key === "Delete") this.store.dispatch({ type: "track/clear" });
  }
}

function option(value: string, label: string, current: string): string {
  return `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function variationHint(amount: VariationAmount): string {
  if (amount === "subtle") return "Ändert nur die Spielweise eines vorhandenen Steps.";
  if (amount === "lively") return "Ersetzt höchstens einen freien Takt.";
  return "Ersetzt höchstens zwei freie Takte.";
}

function variationBarCount(amount: VariationAmount): string {
  if (amount === "subtle") return "nur den Ausdruck eines Steps";
  return amount === "lively" ? "höchstens einen freien Takt" : "höchstens zwei freie Takte";
}
