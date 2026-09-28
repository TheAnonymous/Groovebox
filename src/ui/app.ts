import type { AudioEngine } from "../audio/engine";
import { chordLabel, currentRole, degreeLabels, effectiveDegree, KEY_LABELS, roleOptions, SCALE_LABELS } from "../domain/music";
import { allowsRatchet, loopPosition, sceneSteps, stepChance, stepRatchet } from "../domain/patterns";
import { SOUND_PRESET_DEFINITIONS } from "../domain/sound-presets";
import type {
  Action,
} from "../store/store";
import { canAddDrumVoice, GrooveboxStore, selectedPattern, selectedStep } from "../store/store";
import type {
  AppState,
  ProjectV2,
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
  LOOP_LENGTHS,
  MAX_TEMPO,
  MIN_TEMPO,
  MACRO_KINDS,
  RATCHETS,
  ROOT_NOTES,
  SCALES,
  SCENE_REPEATS,
  STEP_CHANCES,
  STEP_LENGTHS,
  TRACK_KINDS,
  VARIATION_AMOUNTS,
} from "../domain/types";
import { MAX_PROJECTS, type ProjectCatalog } from "../catalog";
import { planSeconds, renderPlan, renderProject, type ExportMode } from "../audio/render";
import { audibleRange, encodePcm16Wav, encodeWav, trimmedLength } from "../audio/wav";
import { MAX_RECORDING_SECONDS } from "../audio/recorder";
import { stemsArchive } from "../audio/stems";
import { AppLink, fitTempo, type LinkPeer } from "../link";
import type { PerformanceState } from "../audio/engine";
import {
  encodeShareFragment,
  fileSlug,
  nameFromFileName,
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
  type ImportedProject,
} from "../transfer";
import type { BramsAdapter } from "./brams";
import { MidiLink, type MidiStatus } from "../midi";
import { Tour, type TourStep } from "./tour";
import { PlaybackWakeLock } from "./wake-lock";
import { versionLabel } from "../version";

const ICON_SPRITE = `${import.meta.env.BASE_URL}vendor/braun-ui/icons.svg`;
const SCENE_ART = ["auftakt", "fahrt", "hoehepunkt", "ausklang"].map(
  (name) => `${import.meta.env.BASE_URL}assets/scenes/${name}.webp`,
);
const TRACK_ART = Object.fromEntries(
  TRACK_KINDS.map((track) => [track, `${import.meta.env.BASE_URL}assets/tracks/${track}.webp`]),
) as Record<TrackKind, string>;
const PERFORMANCE_ART = `${import.meta.env.BASE_URL}assets/promo/performance-wide.webp`;
const presetArt = (track: TrackKind, preset: SoundPresetId): string =>
  `${import.meta.env.BASE_URL}assets/presets/${track}-${preset}.webp`;

const TRACK_LABELS: Record<TrackKind, { name: string; short: string; description: string }> = {
  drums: { name: "Drums", short: "DR", description: "Sechs Drumcomputer-Stimmen geben Halt und kontrollierte Fills." },
  bass: { name: "Bass", short: "BS", description: "Tiefe Töne tragen den Akkordwechsel." },
  chords: { name: "Chords", short: "CH", description: "Akkorde schaffen Farbe und Bewegung." },
  lead: { name: "Lead / Arp", short: "LD", description: "Eine helle Linie folgt sicheren Tönen." },
  pad: { name: "Pad / FX", short: "PD", description: "Langsame Flächen verbinden die Takte." },
};

const DYNAMIC_LABELS: Record<StepDynamics, string> = { ghost: "Leise", normal: "Normal", accent: "Betont" };
const LENGTH_LABELS: Record<StepLength, string> = { short: "Kurz", normal: "Normal", long: "Lang" };
const CHANCE_LABELS: Record<number, string> = { 1: "Immer", 0.75: "75 %", 0.5: "50 %", 0.25: "25 %" };
const RATCHET_LABELS: Record<number, string> = { 1: "Einmal", 2: "2 × schnell", 3: "3 × schnell", 4: "4 × schnell" };

function loopLabel(steps: number): string {
  const bars = steps / 16;
  return Number.isInteger(bars) ? `${steps} Steps · ${bars} ${bars === 1 ? "Takt" : "Takte"}` : `${steps} Steps`;
}
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
const TOUR_STEPS: readonly TourStep[] = [
  { target: ".gb-start", title: "Start und Stop", text: "Mit Start oder der Leertaste läuft die Musik. Das Werksset klingt sofort, alles entsteht live im Browser." },
  { target: ".gb-scenes", title: "Vier Szenen", text: "Auftakt, Fahrt, Höhepunkt und Ausklang. Eine gewählte Szene übernimmt am nächsten Takt, so bleibt der Groove heil." },
  { target: ".gb-grid-wrap", title: "Das Raster", text: "Links wählst du ein Instrument, hier setzt du Steps: Klick wählt aus, jeder weitere Klick wechselt Aus → Normal → Akzent → Variation. Variieren und Neu würfeln bauen ganze Takte um." },
  { target: ".gb-arrangement", title: "Vom Loop zum Track", text: "Die Szenenfolge spielt alle Szenen nacheinander. Das Ergebnis exportierst du als WAV oder teilst es als Link. Mit ? findest du Tastenkürzel und diese Tour wieder." },
];
const SHORTCUTS: readonly [string, string][] = [
  ["Leertaste", "Start und Stop"],
  ["1 – 5", "Instrument wählen: Drums, Bass, Akkorde, Lead, Pad"],
  ["Umschalt + 1 – 4", "Szene wählen; läuft Musik, wechselt sie am nächsten Takt"],
  ["V", "Variieren in der gewählten Stärke"],
  ["R", "Neu würfeln"],
  ["Umschalt + Entf", "Spur in dieser Szene leeren"],
  ["Pfeiltasten, Pos1, Ende", "Im Raster von Step zu Step"],
  ["A", "Aufnahme starten und beenden"],
  ["P", "Live-Tasten: 1 – 5 schalten Spuren am nächsten Takt stumm"],
  ["F halten, Umschalt + F halten", "Filter zu (Tiefpass) oder auf (Hochpass)"],
  ["B halten", "Break: Kick und Bass raus; loslassen: Drop am nächsten Takt"],
  ["Strg + Z", "Rückgängig"],
  ["Strg + Umschalt + Z", "Wiederholen"],
  ["?", "Diese Hilfe"],
];
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
  private exporting = false;
  private shareUrl = "";
  private sharedOffer: ImportedProject | null = null;
  private readonly overlays = document.createElement("div");
  private readonly wakeLock = new PlaybackWakeLock();
  private readonly tour = new Tour(TOUR_STEPS, { storageKey: "groovebox.tour.v1", className: "gb-tour" });
  private readonly midi = new MidiLink("groovebox.midi.v1", {
    status: () => this.updateMidiDom(),
    learned: () => this.updateMidiDom(),
    clockTempo: (bpm) => this.followClockTempo(bpm),
    start: () => void this.startFromMidi(),
    stop: () => { if (this.store.getState().transport.status === "playing") this.stopPlayback(); },
    control: (index, value) => this.queueMacro(index, value),
  });
  private readonly pendingMacros = new Map<number, number>();
  private performance: PerformanceState = { muted: [], pending: [], breakActive: false, dropPending: false };
  private liveKeys = false;
  private recording = false;
  private recordingTimer: number | null = null;
  private filterValue = 0;
  private filterTarget = 0;
  private filterFrame: number | null = null;
  private linkPeers: LinkPeer[] = [];
  /** The partner's tempo this app follows, or `null` while it plays its own. */
  private linkTempo: number | null = null;
  private readonly link = new AppLink("groovebox", {
    start: (at, bpm, from) => void this.followStart(at, bpm, from),
    stop: () => { if (this.store.getState().transport.status === "playing") this.audio.stop(); },
    tempo: (bpm, from) => this.followTempo(bpm, from),
    peers: (peers) => { this.linkPeers = peers; this.render(); },
  });
  private macroFrame: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: GrooveboxStore,
    private readonly audio: AudioEngine,
    private readonly catalog: ProjectCatalog,
    private readonly brams: BramsAdapter,
  ) {}

  mount(warning?: string): void {
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("change", (event) => this.handleChange(event));
    this.root.addEventListener("keydown", (event) => this.handleGridKeys(event));
    window.addEventListener("keydown", (event) => this.handleGlobalKeys(event));
    window.addEventListener("beforeunload", () => this.audio.dispose(), { once: true });
    window.addEventListener("pagehide", () => this.link.disable());
    window.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    });
    window.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      event.preventDefault();
      void this.importFile(file);
    });

    this.store.subscribe((state, action) => this.handleStateChange(state, action));
    this.overlays.className = "gb-overlays";
    this.overlays.innerHTML = this.overlayDialogs();
    this.overlays.addEventListener("click", (event) => this.handleOverlayClick(event));
    this.overlays.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.overlayChange === "midi-clock") this.midi.setFollowClock(input.checked);
      this.updateMidiDom();
    });
    document.body.append(this.overlays);
    this.brams.init(this.overlays);
    this.audio.onPerformance((state) => {
      this.performance = state;
      this.updateLiveDom();
    });
    this.root.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.matches("[data-perf-filter]")) return;
      this.cancelFilterGlide();
      this.filterValue = Number(input.value) / 100;
      this.audio.setPerformanceFilter(this.filterValue);
    });
    this.root.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).closest("[data-perf-break]")) this.audio.setBreak(true);
    });
    const releasePointer = (event: Event) => {
      if (this.performance.breakActive && !this.performance.dropPending && (event.type !== "pointerleave" || (event.target as Element).closest?.("[data-perf-break]"))) this.audio.setBreak(false);
      if ((event.target as Element).closest?.("[data-perf-filter]")) this.glideFilter(0, 0.18);
    };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("keyup", (event) => this.handleLiveKeyUp(event));
    window.addEventListener("blur", () => {
      if (this.performance.breakActive) this.audio.setBreak(false);
      if (this.filterTarget !== 0 || this.filterValue !== 0) this.glideFilter(0, 0.18);
    });
    this.audio.onStatus(({ status, message }) => {
      this.wakeLock.playing = status === "playing";
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
      const current = this.store.getState();
      if (position.switched && current.ui.sceneChain && current.ui.selectedScene === current.transport.runningScene) {
        this.store.dispatch({ type: "ui/select-scene", scene: position.scene });
      }
      const chainMessage = current.ui.sceneChain && position.step === 0 ? this.chainMessage(position.scene, position.pass, position.chainNext) : null;
      this.store.dispatch({
        type: "transport/update",
        update: {
          ...(chainMessage ? { message: chainMessage } : {}),
          runningScene: position.scene,
          queuedScene: position.switched ? null : this.store.getState().transport.queuedScene,
          bar: position.bar,
          step: position.step,
          pass: position.pass,
          peak: position.peak,
          trackPeaks: position.trackPeaks,
        },
      });
    });
    this.render();
    if (warning) requestAnimationFrame(() => this.brams.toast("Projekt wiederhergestellt", warning, "warning"));
    void this.midi.restore();
    const desktop = !window.matchMedia("(max-width: 1023px)").matches;
    if (desktop && this.tour.pending && !window.location.hash.startsWith("#p=")) requestAnimationFrame(() => this.tour.start());
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
      <div class="gb-app-shell">
        ${this.header(state, isPlaying)}
        <main class="gb-main">
          ${this.controlStrip(state)}
          ${this.arrangementBar(state)}
          ${this.liveBar()}
          ${this.scenes(state)}
          <div class="gb-workspace">
            ${this.mixer(state)}
            <section class="gb-sequencer bu-card" aria-labelledby="sequence-title" style="--performance-art:url(${PERFORMANCE_ART})">
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
                  <label class="gb-loop-field" title="Kürzere Spuren laufen gegen die vier Takte der Szene weiter und verschieben sich dabei."><span>Spurlänge</span><select class="bu-select" data-change="track-loop" data-focus-key="track-loop" aria-label="Spurlänge">${LOOP_LENGTHS.map((steps) => option(String(steps), loopLabel(steps), String(pattern.loopSteps ?? 64))).join("")}</select></label>
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
                <span class="gb-legend__tip">Erster Klick wählt aus · erneuter Klick wechselt: Aus → Normal → Akzent → Variation → Aus</span>
              </footer>
            </section>
            <aside class="gb-inspector" aria-label="Details und Klang">
              ${this.stepInspector(state, activeStep, selectedPosition)}
              ${this.soundInspector(state)}
            </aside>
          </div>
          <p class="gb-local-note"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#info"></use></svg> Deine Projekte liegen nur in diesem Browser. Wichtige Sets sicherst du unter <strong>Projekte → Als Datei sichern</strong>. Eine Projektdatei kannst du auch einfach ins Fenster ziehen.</p>
          <p class="gb-version" data-app-version>${escapeHtml(versionLabel())}</p>
        </main>
        ${this.dialogs(state)}
      </div>
    `;
    this.brams.init(this.root);
    this.updateTransportDom(state);
    this.updateMidiDom();
    if (focusKey) requestAnimationFrame(() => this.root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus());
  }

  private header(state: AppState, isPlaying: boolean): string {
    const statusTone = state.transport.status === "playing" ? "success" : state.transport.status === "error" ? "danger" : state.transport.status === "suspended" ? "warning" : "";
    const saveTone = state.autosave === "error" ? "danger" : state.autosave === "saving" ? "warning" : "success";
    const saveLabel = state.autosave === "saving" ? "Speichert …" : state.autosave === "error" ? "Speicherfehler" : "Lokal gespeichert";
    return `<header class="bu-header gb-header">
      <div class="bu-header__inner gb-header__inner">
        <a class="gb-home-link" href="/" aria-label="Zurück zur Musik-Werkstatt" title="Zurück zur Musik-Werkstatt"><span aria-hidden="true">←</span><span class="gb-home-link__label" aria-hidden="true">Musik-Werkstatt</span></a>
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
          ${AppLink.supported() ? `<button class="bu-button bu-button--sm gb-link-button" type="button" data-action="toggle-link" data-focus-key="link" aria-pressed="${this.link.enabled}" title="${this.linkTitle()}"><span class="gb-link-led" data-state="${!this.link.enabled ? "off" : this.linkPeers.length > 0 ? "linked" : "waiting"}" aria-hidden="true"></span>Gleichtakt</button>` : ""}
          ${MidiLink.supported() ? `<button class="bu-button bu-button--sm gb-midi-button" type="button" data-action="open-midi" data-focus-key="midi" title="MIDI-Controller und MIDI-Clock verbinden"><span class="gb-midi-led" data-midi-led aria-hidden="true"></span>MIDI</button>` : ""}
          <button class="bu-button bu-button--sm" type="button" data-action="open-help" data-focus-key="help" aria-label="Hilfe und Tastenkürzel" title="Hilfe und Tastenkürzel (?)">?</button>
          <button class="bu-button bu-button--sm" type="button" data-action="undo" ${state.canUndo ? "" : "disabled"} title="Letzte musikalische Änderung rückgängig machen (Strg+Z)">↶</button>
          <button class="bu-button bu-button--sm" type="button" data-action="redo" ${state.canRedo ? "" : "disabled"} title="Änderung wiederholen (Strg+Umschalt+Z)">↷</button>
          <button class="bu-button bu-button--sm gb-project-button" type="button" data-action="open-projects" data-focus-key="projects" aria-label="Projekte verwalten, geöffnet: ${escapeHtml(this.catalog.active.name)}" title="Projekte: neu, duplizieren, als Datei sichern oder öffnen"><span class="gb-project-button__name">${escapeHtml(this.catalog.active.name)}</span><span aria-hidden="true">▾</span></button>
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

  private arrangementBar(state: AppState): string {
    const repeats = state.project.sceneRepeats;
    const arcSeconds = planSeconds(state.project, renderPlan(state.project, { kind: "arc" }));
    return `<section class="gb-arrangement" aria-label="Szenenfolge, Export und Teilen">
      <button class="bu-button bu-button--sm gb-chain-toggle" type="button" data-action="toggle-chain" data-focus-key="chain" aria-pressed="${state.ui.sceneChain}" title="Spielt Auftakt, Fahrt, Höhepunkt und Ausklang automatisch nacheinander">
        <span class="gb-chain-toggle__led" aria-hidden="true"></span>Szenenfolge ${state.ui.sceneChain ? "an" : "aus"}
      </button>
      <div class="bu-segmented gb-repeats" role="group" aria-label="Länge jeder Szene in der Szenenfolge">
        ${SCENE_REPEATS.map((value) => `<button class="bu-segmented__item" type="button" data-action="scene-repeats" data-value="${value}" data-focus-key="repeats-${value}" aria-pressed="${repeats === value}">${value * 4} Takte</button>`).join("")}
      </div>
      <span class="gb-arrangement__hint">je Szene · ganzer Bogen ${formatDuration(arcSeconds)}</span>
      <div class="gb-arrangement__actions">
        <button class="bu-button bu-button--sm" type="button" data-action="open-export">Als WAV exportieren</button>
        <button class="bu-button bu-button--sm" type="button" data-action="share-link">Link teilen</button>
      </div>
    </section>`;
  }

  private liveBar(): string {
    return `<section class="gb-live" aria-label="Live spielen und aufnehmen">
      <button class="bu-button bu-button--sm gb-record" type="button" data-action="toggle-record" data-focus-key="record" aria-pressed="${this.recording}" title="Nimmt auf, was du hörst, und speichert es als WAV (A)"><span class="gb-record__dot" aria-hidden="true"></span>${this.recording ? "Aufnahme stoppen" : "Aufnahme"} <output data-record-time>${formatClock(this.audio.recordingSeconds)}</output></button>
      <button class="bu-button bu-button--sm gb-live-keys" type="button" data-action="toggle-live-keys" data-focus-key="live-keys" aria-pressed="${this.liveKeys}" title="Mit Live-Tasten schalten 1–5 die Spuren am nächsten Takt stumm (P)">Live-Tasten <kbd>P</kbd></button>
      <div class="gb-live-mutes" role="group" aria-label="Spuren am nächsten Takt stumm schalten">
        ${TRACK_KINDS.map((track, index) => `<button type="button" class="gb-live-mute" data-action="perf-mute" data-track="${track}" data-focus-key="perf-${track}" aria-pressed="false" aria-label="${TRACK_LABELS[track].name} am nächsten Takt stumm schalten">${TRACK_LABELS[track].short}${this.liveKeys ? `<kbd>${index + 1}</kbd>` : ""}</button>`).join("")}
      </div>
      <label class="gb-live-filter" title="F halten: Tiefpass · Umschalt+F halten: Hochpass · federt beim Loslassen zurück"><span>Filter</span><input class="bu-range__input" type="range" min="-100" max="100" step="1" value="${Math.round(this.filterValue * 100)}" data-perf-filter aria-label="Filter, links Tiefpass, rechts Hochpass"></label>
      <button type="button" class="bu-button bu-button--sm gb-break" data-perf-break title="Halten: Kick und Bass raus, der Hochpass steigt. Loslassen: Drop am nächsten Takt (B)">Break → Drop <kbd>B</kbd></button>
    </section>`;
  }

  private updateLiveDom(): void {
    const { muted, pending, breakActive, dropPending } = this.performance;
    this.root.querySelectorAll<HTMLElement>(".gb-live-mute").forEach((button) => {
      const track = button.dataset.track as TrackKind;
      button.setAttribute("aria-pressed", String(muted.includes(track)));
      button.toggleAttribute("data-pending", pending.includes(track));
    });
    const breakButton = this.root.querySelector<HTMLElement>("[data-perf-break]");
    if (breakButton) {
      breakButton.dataset.state = dropPending ? "drop" : breakActive ? "break" : "idle";
      breakButton.setAttribute("aria-pressed", String(breakActive));
    }
  }

  private togglePerformanceMute(track: TrackKind): void {
    const muted = this.performance.muted.includes(track);
    const pending = this.performance.pending.includes(track);
    // A second press before the bar line takes the change back.
    this.audio.setPerformanceMute(track, pending ? muted : !muted);
  }

  private async toggleRecording(): Promise<void> {
    if (this.recording) {
      await this.finishRecording();
      return;
    }
    try {
      if (this.store.getState().transport.status !== "playing") await this.startPlayback();
      await this.audio.startRecording();
    } catch (error) {
      this.brams.toast("Aufnahme nicht gestartet", error instanceof Error ? error.message : "Unbekannter Fehler", "danger");
      return;
    }
    this.recording = true;
    this.recordingTimer = window.setInterval(() => {
      const seconds = this.audio.recordingSeconds;
      const output = this.root.querySelector<HTMLOutputElement>("[data-record-time]");
      if (output) output.value = formatClock(seconds);
      if (seconds >= MAX_RECORDING_SECONDS) void this.finishRecording("Nach 15 Minuten automatisch beendet.");
    }, 250);
    this.render();
  }

  private async finishRecording(note?: string): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    if (this.recordingTimer !== null) window.clearInterval(this.recordingTimer);
    this.recordingTimer = null;
    const pcm = await this.audio.stopRecording();
    this.render();
    const range = audibleRange(pcm);
    if (!range) {
      this.brams.toast("Aufnahme war still", "Es wurde nichts Hörbares aufgenommen.", "warning");
      return;
    }
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const fileName = `${fileSlug(this.catalog.active.name)}-live-${stamp}.wav`;
    downloadBlob(new Blob([encodePcm16Wav(pcm, range.start, range.end)], { type: "audio/wav" }), fileName);
    const length = formatClock((range.end - range.start) / pcm.sampleRate);
    this.brams.toast("Aufnahme gespeichert", `${fileName} (${length} min) liegt in deinen Downloads.${note ? ` ${note}` : ""}`, "success");
  }

  /** Moves the filter to `target` over `seconds`, as holding F or releasing the fader does. */
  private glideFilter(target: number, seconds: number): void {
    this.cancelFilterGlide();
    this.filterTarget = target;
    const from = this.filterValue;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / (seconds * 1000));
      this.filterValue = from + (target - from) * progress;
      this.audio.setPerformanceFilter(this.filterValue);
      const input = this.root.querySelector<HTMLInputElement>("[data-perf-filter]");
      if (input) input.value = String(Math.round(this.filterValue * 100));
      this.filterFrame = progress < 1 ? requestAnimationFrame(step) : null;
    };
    this.filterFrame = requestAnimationFrame(step);
  }

  private cancelFilterGlide(): void {
    if (this.filterFrame !== null) cancelAnimationFrame(this.filterFrame);
    this.filterFrame = null;
  }

  /** B and F are held; their release belongs to the key-up. */
  private handleLiveKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === "b" && this.performance.breakActive) this.audio.setBreak(false);
    if (key === "f" && this.filterTarget !== 0) this.glideFilter(0, 0.2);
  }

  private chainMessage(scene: number, pass: number, next: number | null): string {
    const { project } = this.store.getState();
    const name = project.scenes[scene]?.name ?? `Szene ${scene + 1}`;
    const following = next === null ? "" : ` → ${project.scenes[next]?.name ?? `Szene ${next + 1}`}`;
    return `Szenenfolge · ${name} ${Math.min(pass + 1, project.sceneRepeats)}/${project.sceneRepeats}${following}`;
  }

  private scenes(state: AppState): string {
    return `<nav class="gb-scenes" aria-label="Szenen">
      ${state.project.scenes.map((scene, index) => {
        const selected = state.ui.selectedScene === index;
        const running = state.transport.status === "playing" && state.transport.runningScene === index;
        const queued = state.transport.queuedScene === index;
        return `<button class="gb-scene ${selected ? "is-selected" : ""} ${running ? "is-running" : ""} ${queued ? "is-queued" : ""}" type="button" data-action="select-scene" data-scene="${index}" data-focus-key="scene-${index}" aria-current="${selected ? "true" : "false"}" title="${state.transport.status === "playing" ? "Zum nächsten Takt vormerken" : "Szene bearbeiten"}">
          <span class="gb-scene__art" aria-hidden="true" style="--scene-art:url(${SCENE_ART[index]})"></span>
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
              <span class="gb-channel__art" aria-hidden="true" style="--track-art:url(${TRACK_ART[track]})"></span>
              <span class="gb-channel__code">${TRACK_LABELS[track].short}</span><strong>${TRACK_LABELS[track].name}</strong>
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
    const playhead = this.trackPlayhead(state);
    const playing = playhead !== null && playhead.bar === bar && playhead.step === index;
    const loopSteps = selectedPattern(state)?.loopSteps ?? 64;
    const outside = bar * 16 + index >= loopSteps;
    const chance = step.enabled ? stepChance(step) : 1;
    const hits = step.enabled && allowsRatchet(state.ui.selectedTrack) ? stepRatchet(step) : 1;
    const extras = `${chance < 1 ? `<small class="gb-step__chance">${Math.round(chance * 100)}</small>` : ""}${hits > 1 ? `<small class="gb-step__ratchet">×${hits}</small>` : ""}`;
    const extraLabel = `${chance < 1 ? `, spielt zu ${Math.round(chance * 100)} %` : ""}${hits > 1 ? `, ${hits} schnelle Wiederholungen` : ""}${outside ? ", außerhalb der Spurlänge" : ""}`;
    const tone = !step.enabled ? "off" : step.dynamics === "accent" ? "accent" : step.variation >= 0.95 ? "variation" : step.dynamics === "ghost" ? "ghost" : "normal";
    const symbol = tone === "off" ? "—" : tone === "accent" ? "!" : tone === "variation" ? "≈" : tone === "ghost" ? "·" : "•";
    const stateLabel = tone === "off" ? "Aus" : tone === "accent" ? "Akzent" : tone === "variation" ? "Variation" : tone === "ghost" ? "Leise" : "Normal";
    const nextLabel = tone === "off" ? "Normal" : tone === "normal" || tone === "ghost" ? "Akzent" : tone === "accent" ? "Variation" : "Aus";
    const interactionLabel = selected ? `Ausgewählt. Erneuter Klick: ${nextLabel}.` : "Klick zum Auswählen.";
    const title = selected ? `${stateLabel} · Erneuter Klick: ${nextLabel}` : `${stateLabel} · Klick: Details auswählen`;
    return `<button class="gb-step gb-step--${tone} ${selected ? "is-selected" : ""} ${playing ? "is-playing" : ""} ${outside ? "is-outside" : ""}" type="button" data-action="select-or-cycle-step" data-bar="${bar}" data-step="${index}" data-focus-key="step-${bar}-${index}" aria-pressed="${step.enabled}" aria-label="Takt ${bar + 1}, Step ${index + 1}: ${stateLabel}${extraLabel}. ${interactionLabel}" title="${title}"><span>${symbol}</span>${extras}</button>`;
  }

  /** Where the selected track's own loop stands, or `null` when its scene is not playing. */
  private trackPlayhead(state: AppState): { bar: number; step: number } | null {
    if (state.transport.status !== "playing" || state.transport.runningScene !== state.ui.selectedScene) return null;
    return loopPosition(selectedPattern(state)?.loopSteps, sceneSteps(state.transport));
  }

  private stepInspector(state: AppState, step: ReturnType<typeof selectedStep>, position: AppState["ui"]["selectedStep"]): string {
    if (!step || !position) {
      return `<section class="bu-card gb-detail-card"><div class="gb-panel-heading"><p class="gb-eyebrow">STEP</p><h2>Details</h2></div><div class="gb-empty-detail"><span>01—64</span><p>Wähle einen Step, um Lautstärke, Länge und eine sichere Tonrolle einzustellen.</p></div></section>`;
    }
    const track = state.ui.selectedTrack;
    const role = track === "drums" ? null : currentRole(track, step);
    return `<section class="bu-card gb-detail-card"><div class="gb-panel-heading"><p class="gb-eyebrow">TAKT ${position.bar + 1} · STEP ${position.step + 1}</p><h2>Step-Details</h2></div>
      <div class="gb-detail-fields ${step.enabled ? "" : "is-disabled"}">
        ${!step.enabled ? "<p class=\"gb-inline-note\">Dieser Step ist aus. Klicke den ausgewählten Step im Raster erneut an, um ihn einzuschalten.</p>" : ""}
        <label class="bu-field"><span class="bu-field__label">Dynamik</span><select class="bu-select" data-change="step-dynamics" ${step.enabled ? "" : "disabled"}>${DYNAMICS.map((dynamic) => option(dynamic, DYNAMIC_LABELS[dynamic], step.dynamics)).join("")}</select><span class="bu-field__help">Wie deutlich dieser Schritt hörbar ist.</span></label>
        <label class="bu-field"><span class="bu-field__label">Länge</span><select class="bu-select" data-change="step-length" ${step.enabled ? "" : "disabled"}>${STEP_LENGTHS.map((length) => option(length, LENGTH_LABELS[length], step.length)).join("")}</select><span class="bu-field__help">Kurze Töne federn, lange Töne verbinden.</span></label>
        <div class="gb-detail-pair">
          <label class="bu-field"><span class="bu-field__label">Chance</span><select class="bu-select" data-change="step-probability" ${step.enabled ? "" : "disabled"}>${STEP_CHANCES.map((chance) => option(String(chance), CHANCE_LABELS[chance]!, String(stepChance(step)))).join("")}</select></label>
          ${allowsRatchet(track) ? `<label class="bu-field"><span class="bu-field__label">Wiederholung</span><select class="bu-select" data-change="step-ratchet" ${step.enabled ? "" : "disabled"}>${RATCHETS.map((count) => option(String(count), RATCHET_LABELS[count]!, String(stepRatchet(step)))).join("")}</select></label>` : ""}
        </div>
        <span class="bu-field__help gb-detail-pair__help">Chance würfelt bei jedem Durchlauf neu; Wiederholungen teilen den Step in schnelle Schläge.</span>
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
          ${SOUND_PRESET_DEFINITIONS[track].map((entry) => `<button class="bu-segmented__item gb-preset-option" type="button" data-action="preset" data-preset="${entry.id}" aria-pressed="${preset === entry.id}" title="${entry.hint}"><span class="gb-preset-option__art" aria-hidden="true" style="--preset-art:url(${presetArt(track, entry.id)})"></span><span class="gb-preset-option__label">${entry.label}</span></button>`).join("")}
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
    return `${this.projectDialogs()}${this.shareDialogs(state)}
      <div id="chord-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="chord-title"><div class="bu-dialog__header"><div><h2 id="chord-title" class="bu-dialog__title">Akkord · Takt ${this.editingChordBar + 1}</h2><p class="bu-dialog__description">Alle Varianten bleiben sicher in ${KEY_LABELS[state.project.key]} ${SCALE_LABELS[state.project.scale]}.</p></div><button class="bu-icon-button" type="button" data-bu-close aria-label="Dialog schließen"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#close"></use></svg></button></div><div class="bu-dialog__body gb-dialog-fields"><label class="bu-field"><span class="bu-field__label">Stufe</span><select class="bu-select" id="chord-degree">${degreeLabels(state.project.scale).map((label, index) => option(String(index + 1), label, String(effectiveDegree(state.project.scale, chord.degree)))).join("")}</select></label><label class="bu-field"><span class="bu-field__label">Farbe</span><select class="bu-select" id="chord-color">${CHORD_COLORS.map((color) => option(color, COLOR_LABELS[color], chord.color)).join("")}</select></label><label class="bu-field"><span class="bu-field__label">Lage</span><select class="bu-select" id="chord-inversion">${[-1, 0, 1].map((value) => option(String(value), value === -1 ? "Tief" : value === 1 ? "Hoch" : "Mitte", String(chord.inversion))).join("")}</select></label></div><div class="bu-dialog__footer"><button class="bu-button" type="button" data-bu-close>Abbrechen</button><button class="bu-button bu-button--primary" type="button" data-action="save-chord">Akkord übernehmen</button></div></section></div>
      <div class="bu-toast-region" data-bu-toast-region aria-live="polite" aria-atomic="false"></div>`;
  }

  private projectDialogs(): string {
    const close = `<button class="bu-icon-button" type="button" data-bu-close aria-label="Dialog schließen"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#close"></use></svg></button>`;
    const full = this.catalog.isFull;
    const fullHint = full ? `<p class="gb-inline-note">Alle ${MAX_PROJECTS} Plätze sind belegt. Lösche zuerst ein Projekt, um ein neues anzulegen oder zu öffnen.</p>` : "";
    return `<div id="projects-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog gb-projects-dialog" role="dialog" aria-modal="true" aria-labelledby="projects-title"><div class="bu-dialog__header"><div><h2 id="projects-title" class="bu-dialog__title">Projekte</h2><p class="bu-dialog__description">${this.catalog.projects.length} von ${MAX_PROJECTS} Plätzen belegt · alles bleibt in diesem Browser</p></div>${close}</div>
        <div class="bu-dialog__body gb-projects-body">
          <ul class="gb-project-list" data-project-list>${this.projectListItems()}</ul>
          <div class="gb-project-rename"><label class="bu-field"><span class="bu-field__label">Name des geöffneten Projekts</span><input class="bu-input" id="project-name-input" maxlength="40" value="${escapeHtml(this.catalog.active.name)}"></label><button class="bu-button" type="button" data-action="rename-project">Umbenennen</button></div>
          ${fullHint}
          <div class="gb-project-actions">
            <button class="bu-button" type="button" data-action="new-project" ${full ? "disabled" : ""}>Neues Set</button>
            <button class="bu-button" type="button" data-action="duplicate-project" ${full ? "disabled" : ""}>Duplizieren</button>
            <button class="bu-button" type="button" data-action="export-project">Als Datei sichern</button>
            <button class="bu-button" type="button" data-action="import-project" ${full ? "disabled" : ""}>Datei öffnen …</button>
            <input type="file" accept=".json,application/json" data-import-input hidden>
          </div>
        </div>
        <div class="bu-dialog__footer"><button class="bu-button bu-button--danger" type="button" data-action="delete-project" ${this.catalog.projects.length <= 1 ? "disabled" : ""}>Löschen …</button><button class="bu-button bu-button--primary" type="button" data-bu-close>Fertig</button></div>
      </section></div>
      <div id="new-project-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><div class="bu-dialog__header"><div><h2 id="new-project-title" class="bu-dialog__title">Neues Set</h2><p class="bu-dialog__description">Startet mit den vier Werksszenen. Deine anderen Projekte bleiben unverändert.</p></div>${close}</div><div class="bu-dialog__body"><label class="bu-field"><span class="bu-field__label">Name</span><input class="bu-input" id="new-project-name" maxlength="40" value="Neues Set"></label></div><div class="bu-dialog__footer"><button class="bu-button" type="button" data-bu-close>Abbrechen</button><button class="bu-button bu-button--primary" type="button" data-action="confirm-new">Set anlegen</button></div></section></div>
      <div id="delete-project-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title"><div class="bu-dialog__header"><div><h2 id="delete-project-title" class="bu-dialog__title">Projekt löschen?</h2><p class="bu-dialog__description">„${escapeHtml(this.catalog.active.name)}“ und seine Sicherung werden aus diesem Browser entfernt.</p></div>${close}</div><div class="bu-dialog__body"><p>Sichere es vorher als Datei, wenn du es später noch brauchst.</p></div><div class="bu-dialog__footer"><button class="bu-button" type="button" data-bu-close>Behalten</button><button class="bu-button bu-button--danger" type="button" data-action="confirm-delete">Endgültig löschen</button></div></section></div>`;
  }

  private shareDialogs(state: AppState): string {
    const close = `<button class="bu-icon-button" type="button" data-bu-close aria-label="Dialog schließen"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#close"></use></svg></button>`;
    const scene = state.project.scenes[state.ui.selectedScene]!;
    const bars = state.project.sceneRepeats * 4;
    const arc = formatDuration(planSeconds(state.project, renderPlan(state.project, { kind: "arc" })));
    const loop = formatDuration(planSeconds(state.project, renderPlan(state.project, { kind: "scene", scene: state.ui.selectedScene })));
    const offer = this.sharedOffer;
    const offerMeta = offer ? `${Math.round(offer.project.tempo)} BPM · ${KEY_LABELS[offer.project.key]} ${SCALE_LABELS[offer.project.scale]}` : "";
    return `<div id="export-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title"><div class="bu-dialog__header"><div><h2 id="export-title" class="bu-dialog__title">Als WAV exportieren</h2><p class="bu-dialog__description">Klingt wie die Wiedergabe und entsteht schneller als in Echtzeit. Läuft gerade Musik, wird sie dafür angehalten.</p></div>${close}</div>
        <div class="bu-dialog__body gb-export-options">
          <label class="gb-export-option"><input type="radio" name="export-mode" value="arc" checked><span><strong>Ganzer Bogen</strong><small>Auftakt, Fahrt, Höhepunkt und Ausklang mit je ${bars} Takten · ${arc}</small></span></label>
          <label class="gb-export-option"><input type="radio" name="export-mode" value="scene"><span><strong>Nur „${escapeHtml(scene.name)}“</strong><small>${bars} Takte als Loop · ${loop}</small></span></label>
          <label class="gb-export-option gb-export-stems"><input type="checkbox" name="export-stems"><span><strong>Spuren einzeln (Stems)</strong><small>Jede Spur als eigene WAV-Datei in einem ZIP, vor dem Master-Bus – zum Weitermischen in einer DAW.</small></span></label>
          <p class="gb-export-status" data-export-status role="status"></p>
        </div>
        <div class="bu-dialog__footer"><button class="bu-button" type="button" data-bu-close>Abbrechen</button><button class="bu-button bu-button--primary" type="button" data-action="confirm-export">WAV erstellen</button></div></section></div>
      <div id="share-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title"><div class="bu-dialog__header"><div><h2 id="share-title" class="bu-dialog__title">Link teilen</h2><p class="bu-dialog__description">Der Link enthält das ganze Set „${escapeHtml(this.catalog.active.name)}“. Er wird nirgends hochgeladen: Wer ihn öffnet, bekommt eine eigene Kopie.</p></div>${close}</div>
        <div class="bu-dialog__body gb-share-body"><label class="bu-field"><span class="bu-field__label">Link</span><input class="bu-input" data-share-url readonly value="${escapeHtml(this.shareUrl)}"></label><button class="bu-button" type="button" data-action="copy-share">Kopieren</button><p class="gb-export-status" data-share-status role="status"></p></div>
        <div class="bu-dialog__footer"><button class="bu-button bu-button--primary" type="button" data-bu-close>Fertig</button></div></section></div>
      <div id="shared-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="shared-title"><div class="bu-dialog__header"><div><h2 id="shared-title" class="bu-dialog__title">Geteiltes Set öffnen?</h2><p class="bu-dialog__description">${offer ? `„${escapeHtml(offer.name)}“ · ${escapeHtml(offerMeta)}` : ""}</p></div>${close}</div>
        <div class="bu-dialog__body"><p>Jemand hat dir dieses Set geschickt. Es wird als neues Set in deiner Projektliste angelegt; deine eigenen Sets bleiben unverändert.</p>${this.catalog.isFull ? `<p class="gb-inline-note">Alle ${MAX_PROJECTS} Plätze sind belegt. Lösche zuerst ein Projekt und öffne den Link dann noch einmal.</p>` : ""}</div>
        <div class="bu-dialog__footer"><button class="bu-button" type="button" data-action="decline-shared">Nicht übernehmen</button><button class="bu-button bu-button--primary" type="button" data-action="accept-shared" ${this.catalog.isFull ? "disabled" : ""}>Als neues Set übernehmen</button></div></section></div>`;
  }

  /** Called at start when the URL carries a shared set. */
  offerSharedProject(imported: ImportedProject): void {
    this.sharedOffer = imported;
    this.render();
    this.brams.open("#shared-dialog");
  }

  showSharedLinkError(message: string): void {
    clearShareFragment();
    this.brams.toast("Geteilter Link nicht lesbar", message, "danger");
  }

  private projectListItems(): string {
    return this.catalog.projects.map((project) => {
      const active = project.id === this.catalog.active.id;
      const updated = new Date(project.updatedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
      return `<li><button type="button" class="gb-project-item ${active ? "is-active" : ""}" data-action="switch-project" data-id="${escapeHtml(project.id)}" aria-current="${active ? "true" : "false"}"><strong>${escapeHtml(project.name)}</strong><span>${active ? "geöffnet · " : ""}${escapeHtml(updated)}</span></button></li>`;
    }).join("");
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
    this.audio.setSceneChain(state.ui.sceneChain ? state.project.sceneRepeats : null);
    if (action.type === "project/tempo" && this.link.enabled) {
      // Turning the tempo takes the lead: this app plays its own tempo and the partner follows.
      this.releaseLinkTempo();
      this.link.announceTempo(state.project.tempo);
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
    const playhead = this.trackPlayhead(state);
    if (playhead) this.root.querySelector(`.gb-step[data-bar="${playhead.bar}"][data-step="${playhead.step}"]`)?.classList.add("is-playing");
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
      this.autosaveTimer = null;
      try {
        this.catalog.saveActive(this.store.getState().project);
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
    else if (action === "panic") { this.audio.panic(); if (this.link.enabled) this.link.announceStop(); }
    else if (action === "toggle-link") this.toggleLink();
    else if (action === "undo") this.store.dispatch({ type: "history/undo" });
    else if (action === "redo") this.store.dispatch({ type: "history/redo" });
    else if (action === "select-scene") this.selectScene(Number(button.dataset.scene));
    else if (action === "select-track") this.store.dispatch({ type: "ui/select-track", track: button.dataset.track as TrackKind });
    else if (action === "mute") this.store.dispatch({ type: "mix/mute", track: button.dataset.track as TrackKind });
    else if (action === "solo") this.store.dispatch({ type: "mix/solo", track: button.dataset.track as TrackKind });
    else if (action === "select-or-cycle-step") this.selectOrCycleStep(Number(button.dataset.bar), Number(button.dataset.step));
    else if (action === "drum-voice") this.store.dispatch({ type: "step/drum-voice", voice: button.dataset.voice as DrumVoice });
    else if (action === "preset") this.store.dispatch({ type: "project/preset", track: this.store.getState().ui.selectedTrack, value: button.dataset.preset as SoundPresetId });
    else if (action === "toggle-lock") this.store.dispatch({ type: "ui/toggle-lock", bar: Number(button.dataset.bar) });
    else if (action === "variation-amount") this.store.dispatch({ type: "ui/variation-amount", amount: button.dataset.value as VariationAmount });
    else if (action === "vary") this.store.dispatch({ type: "track/vary" });
    else if (action === "randomize") this.store.dispatch({ type: "track/randomize" });
    else if (action === "open-projects") this.openProjects();
    else if (action === "toggle-record") void this.toggleRecording();
    else if (action === "toggle-live-keys") { this.liveKeys = !this.liveKeys; this.render(); }
    else if (action === "perf-mute") this.togglePerformanceMute(button.dataset.track as TrackKind);
    else if (action === "open-help") this.brams.open("#help-dialog");
    else if (action === "open-midi") this.openMidi();
    else if (action === "toggle-chain") this.toggleChain();
    else if (action === "scene-repeats") this.store.dispatch({ type: "project/scene-repeats", value: Number(button.dataset.value) as AppState["project"]["sceneRepeats"] });
    else if (action === "open-export") this.brams.open("#export-dialog");
    else if (action === "confirm-export") void this.exportAudio();
    else if (action === "share-link") void this.shareLink();
    else if (action === "copy-share") void this.copyShareUrl();
    else if (action === "accept-shared") this.acceptShared();
    else if (action === "decline-shared") this.declineShared();
    else if (action === "switch-project") this.switchProject(button.dataset.id ?? "");
    else if (action === "new-project") this.brams.open("#new-project-dialog");
    else if (action === "confirm-new") this.confirmNewProject();
    else if (action === "duplicate-project") this.runProjectAction(() => this.catalog.duplicate(this.store.getState().project), "Projekt dupliziert");
    else if (action === "rename-project") this.renameProject();
    else if (action === "export-project") this.exportProject();
    else if (action === "import-project") this.root.querySelector<HTMLInputElement>("[data-import-input]")?.click();
    else if (action === "delete-project") this.brams.open("#delete-project-dialog");
    else if (action === "confirm-delete") this.runProjectAction(() => this.catalog.removeActive(), "Projekt gelöscht");
    else if (action === "edit-chord") this.openChordDialog(Number(button.dataset.bar));
    else if (action === "save-chord") this.saveChord();
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input instanceof HTMLInputElement && input.matches("[data-import-input]")) {
      const file = input.files?.[0];
      input.value = "";
      if (file) void this.importFile(file);
      return;
    }
    const change = input.dataset.change;
    if (!change) return;
    // Arrow keys on a slider fire one change per step; together they are one undo step.
    const slider = { mergeKey: `${change}:${input.dataset.macro ?? input.dataset.track ?? ""}` };
    if (change === "tempo") this.store.dispatch({ type: "project/tempo", value: Number(input.value) }, slider);
    else if (change === "key") this.store.dispatch({ type: "project/key", value: input.value as AppState["project"]["key"] });
    else if (change === "scale") this.store.dispatch({ type: "project/scale", value: input.value as AppState["project"]["scale"] });
    else if (change === "swing") this.store.dispatch({ type: "project/swing", value: Number(input.value) / 100 }, slider);
    else if (change === "master") this.store.dispatch({ type: "project/master", value: Number(input.value) / 100 }, slider);
    else if (change === "track-volume") this.store.dispatch({ type: "mix/volume", track: input.dataset.track as TrackKind, value: Number(input.value) / 100 }, slider);
    else if (change === "step-dynamics") this.store.dispatch({ type: "step/dynamics", value: input.value as StepDynamics });
    else if (change === "step-length") this.store.dispatch({ type: "step/length", value: input.value as StepLength });
    else if (change === "step-probability") this.store.dispatch({ type: "step/probability", value: Number(input.value) });
    else if (change === "step-ratchet") this.store.dispatch({ type: "step/ratchet", value: Number(input.value) });
    else if (change === "track-loop") this.store.dispatch({ type: "track/loop", value: Number(input.value) });
    else if (change === "step-role") {
      const role = roleOptions(this.store.getState().ui.selectedTrack).find((entry) => entry.value === input.value);
      if (role) this.store.dispatch({ type: "step/role", degreeOffset: role.degreeOffset, variation: role.variation });
    } else if (change === "intent") this.store.dispatch({ type: "track/intent", value: input.value as GrooveIntent });
    else if (change === "contour") this.store.dispatch({ type: "track/contour", value: input.value as PhraseContour });
    else if (change === "macro") this.store.dispatch({ type: "track/macro", macro: input.dataset.macro as MacroKind, value: Number(input.value) / 100 }, slider);
  }

  private async togglePlayback(): Promise<void> {
    if (this.store.getState().transport.status === "playing") this.stopPlayback();
    else await this.startPlayback();
  }

  /** Every local start: alone, or as the leader of a coupled app starting at the same moment. */
  private async startPlayback(): Promise<void> {
    const scene = this.store.getState().ui.selectedScene;
    if (!this.link.enabled || this.link.peers.length === 0) {
      await this.audio.start(scene);
      return;
    }
    this.releaseLinkTempo();
    await this.audio.start(scene, this.link.announceStart(this.store.getState().project.tempo));
  }

  private stopPlayback(): void {
    this.audio.stop();
    if (this.link.enabled) this.link.announceStop();
  }

  private toggleLink(): void {
    if (this.link.enabled) {
      this.link.disable();
      this.releaseLinkTempo();
    } else {
      // The click lets this tab start audio later, when the partner starts it.
      void this.audio.initialize();
      this.link.enable();
    }
    this.render();
  }

  private async followStart(at: number, bpm: number, from: LinkPeer): Promise<void> {
    this.linkTempo = fitTempo(bpm, MIN_TEMPO, MAX_TEMPO);
    this.audio.setTempoOverride(this.linkTempo);
    if (this.store.getState().transport.status === "playing") this.audio.stop();
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    await this.audio.start(this.store.getState().ui.selectedScene, at);
    this.store.dispatch({ type: "transport/update", update: { message: `Gleichtakt mit ${appName(from.app)} · ${Math.round(this.linkTempo)} BPM` } });
  }

  private followTempo(bpm: number, from: LinkPeer): void {
    if (this.linkTempo === null) return;
    this.linkTempo = fitTempo(bpm, MIN_TEMPO, MAX_TEMPO);
    this.audio.setTempoOverride(this.linkTempo);
    if (this.store.getState().transport.status === "playing") {
      this.store.dispatch({ type: "transport/update", update: { message: `Gleichtakt mit ${appName(from.app)} · ${Math.round(this.linkTempo)} BPM` } });
    }
  }

  private releaseLinkTempo(): void {
    if (this.linkTempo === null) return;
    this.linkTempo = null;
    this.audio.setTempoOverride(null);
  }

  private selectOrCycleStep(bar: number, step: number): void {
    const selected = this.store.getState().ui.selectedStep;
    const type = selected?.bar === bar && selected.step === step ? "step/cycle" : "ui/select-step";
    this.store.dispatch({ type, bar, step });
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
    const name = this.root.querySelector<HTMLInputElement>("#new-project-name")?.value ?? "Neues Set";
    this.runProjectAction(() => this.catalog.create(name), "Neues Set angelegt");
  }

  private openProjects(): void {
    this.flushAutosave();
    this.render();
    this.brams.open("#projects-dialog");
  }

  private switchProject(id: string): void {
    if (id === this.catalog.active.id) {
      this.brams.close("#projects-dialog");
      return;
    }
    this.runProjectAction(() => this.catalog.switchTo(id), "Projekt geöffnet");
  }

  private renameProject(): void {
    const input = this.root.querySelector<HTMLInputElement>("#project-name-input");
    const summary = this.catalog.rename(input?.value ?? "");
    this.brams.close("#projects-dialog");
    this.render();
    this.brams.open("#projects-dialog");
    this.brams.toast("Umbenannt", summary.name, "success");
  }

  private closeProjectDialogs(): void {
    for (const dialog of ["#projects-dialog", "#new-project-dialog", "#delete-project-dialog", "#shared-dialog"]) this.brams.close(dialog);
  }

  /** Saves pending edits, then opens the project the action returns with a clean history. */
  private runProjectAction(action: () => ProjectV2, title: string): void {
    try {
      this.flushAutosave();
      const project = action();
      this.closeProjectDialogs();
      this.audio.panic();
      this.store.dispatch({ type: "project/load", project });
      requestPersistentStorage();
      this.brams.toast(title, this.catalog.active.name, "success");
    } catch (error) {
      this.brams.toast("Das hat nicht geklappt", error instanceof Error ? error.message : "Unbekannter Fehler", "danger");
    }
  }

  private exportProject(): void {
    this.flushAutosave();
    const name = this.catalog.active.name;
    const blob = new Blob([serializeProjectFile(name, this.store.getState().project)], { type: "application/json" });
    downloadBlob(blob, projectFileName(name));
    requestPersistentStorage();
    this.brams.toast("Projektdatei gesichert", `${projectFileName(name)} liegt jetzt in deinen Downloads.`, "success");
  }

  private async importFile(file: File): Promise<void> {
    if (window.matchMedia("(max-width: 1023px)").matches) return;
    try {
      const imported = parseProjectFile(await file.text(), nameFromFileName(file.name));
      this.runProjectAction(() => this.catalog.importProject(imported.name, imported.project), "Projektdatei geöffnet");
    } catch (error) {
      this.brams.toast("Datei nicht geöffnet", error instanceof Error ? error.message : "Unbekannter Fehler", "danger");
    }
  }

  private toggleChain(): void {
    const state = this.store.getState();
    const enabled = !state.ui.sceneChain;
    this.store.dispatch({ type: "ui/scene-chain", value: enabled });
    if (state.transport.status === "playing") {
      this.store.dispatch({ type: "transport/update", update: { message: enabled ? this.chainMessage(state.transport.runningScene, 0, (state.transport.runningScene + 1) % 4) : "Wiedergabe läuft" } });
    }
  }

  private async exportAudio(): Promise<void> {
    if (this.exporting) return;
    const state = this.store.getState();
    const selected = this.root.querySelector<HTMLInputElement>('input[name="export-mode"]:checked')?.value;
    const mode: ExportMode = selected === "scene" ? { kind: "scene", scene: state.ui.selectedScene } : { kind: "arc" };
    const status = this.root.querySelector<HTMLElement>("[data-export-status]");
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="confirm-export"]');
    this.exporting = true;
    if (button) button.disabled = true;
    const estimate = Math.max(3, Math.round(planSeconds(state.project, renderPlan(state.project, mode)) * 0.7));
    if (status) status.textContent = `Wird gerendert … etwa ${estimate} Sekunden. Du kannst das Fenster dabei offen lassen.`;
    if (state.transport.status === "playing") this.audio.stop();
    // Let the status paint before the synchronous clock pass of the offline render.
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      this.flushAutosave();
      const project = structuredClone(this.store.getState().project);
      const stems = this.root.querySelector<HTMLInputElement>('input[name="export-stems"]')?.checked === true;
      const buffer = await renderProject(project, mode, (fraction) => {
        if (status) status.textContent = `Wird gerendert … ${Math.round(fraction * 100)} % von etwa ${estimate} Sekunden. Du kannst das Fenster dabei offen lassen.`;
      }, { stems });
      const musicFrames = Math.round(planSeconds(project, renderPlan(project, mode)) * buffer.sampleRate);
      const suffix = mode.kind === "arc" ? "bogen" : fileSlug(project.scenes[mode.scene]?.name ?? "szene");
      const base = `${fileSlug(this.catalog.active.name)}-${suffix}`;
      if (stems) {
        const { archive, included, silent } = stemsArchive(buffer, TRACK_KINDS, musicFrames);
        if (included.length === 0) throw new Error("Alle Spuren sind stumm.");
        downloadBlob(archive, `${base}-stems.zip`);
        if (status) status.textContent = "";
        this.brams.close("#export-dialog");
        const skipped = silent.length > 0 ? ` Stumm und deshalb nicht dabei: ${silent.map((track) => TRACK_LABELS[track as TrackKind].name).join(", ")}.` : "";
        this.brams.toast("Stems gespeichert", `${base}-stems.zip mit ${included.length} Spuren liegt jetzt in deinen Downloads.${skipped}`, "success");
        return;
      }
      const wav = encodeWav(buffer, trimmedLength(buffer, musicFrames));
      const fileName = `${base}.wav`;
      downloadBlob(new Blob([wav], { type: "audio/wav" }), fileName);
      if (status) status.textContent = "";
      this.brams.close("#export-dialog");
      this.brams.toast("WAV gespeichert", `${fileName} liegt jetzt in deinen Downloads.`, "success");
    } catch (error) {
      if (status) status.textContent = `Das hat nicht geklappt: ${error instanceof Error ? error.message : "unbekannter Fehler"}`;
    } finally {
      this.exporting = false;
      if (button) button.disabled = false;
    }
  }

  private async shareLink(): Promise<void> {
    try {
      this.flushAutosave();
      const fragment = await encodeShareFragment(this.catalog.active.name, this.store.getState().project);
      this.shareUrl = `${window.location.origin}${window.location.pathname}#${fragment}`;
      const input = this.root.querySelector<HTMLInputElement>("[data-share-url]");
      if (input) input.value = this.shareUrl;
      this.brams.open("#share-dialog");
      await this.copyShareUrl();
    } catch (error) {
      this.brams.toast("Link nicht erstellt", error instanceof Error ? error.message : "Unbekannter Fehler", "danger");
    }
  }

  private async copyShareUrl(): Promise<void> {
    const status = this.root.querySelector<HTMLElement>("[data-share-status]");
    try {
      await navigator.clipboard.writeText(this.shareUrl);
      if (status) status.textContent = "Link kopiert – schick ihn einfach weiter.";
    } catch {
      this.root.querySelector<HTMLInputElement>("[data-share-url]")?.select();
      if (status) status.textContent = "Kopieren war nicht möglich. Der Link ist markiert, kopiere ihn mit Strg+C.";
    }
  }

  private acceptShared(): void {
    const offer = this.sharedOffer;
    if (!offer) return;
    this.brams.close("#shared-dialog");
    this.sharedOffer = null;
    clearShareFragment();
    this.runProjectAction(() => this.catalog.importProject(offer.name, offer.project), "Geteiltes Set übernommen");
  }

  private declineShared(): void {
    this.brams.close("#shared-dialog");
    this.sharedOffer = null;
    clearShareFragment();
  }

  private flushAutosave(): void {
    if (this.autosaveTimer === null) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    try {
      this.catalog.saveActive(this.store.getState().project);
      this.store.dispatch({ type: "autosave/status", status: "saved" });
    } catch {
      this.store.dispatch({ type: "autosave/status", status: "error" });
    }
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

  private linkTitle(): string {
    if (!this.link.enabled) return "Gleichtakt: mit Kitty in einem anderen Tab gemeinsam starten, stoppen und im Tempo bleiben";
    if (this.linkPeers.length === 0) return "Gleichtakt an – öffne Kitty in einem zweiten Tab und schalte dort Gleichtakt ein";
    return `Gleichtakt mit ${[...new Set(this.linkPeers.map((peer) => appName(peer.app)))].join(", ")}: wer startet, gibt das Tempo vor`;
  }

  private overlayDialogs(): string {
    const close = `<button class="bu-icon-button" type="button" data-bu-close aria-label="Dialog schließen"><svg class="bu-icon" aria-hidden="true"><use href="${ICON_SPRITE}#close"></use></svg></button>`;
    return `<div id="help-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="bu-dialog__header"><div><h2 id="help-title" class="bu-dialog__title">Hilfe und Tastenkürzel</h2><p class="bu-dialog__description">Fast alles geht auch über die Tastatur, solange kein Eingabefeld aktiv ist.</p></div>${close}</div>
        <div class="bu-dialog__body"><dl class="gb-shortcuts">${SHORTCUTS.map(([keys, meaning]) => `<div><dt>${keys.split(", ").map((alternative) => alternative.split(" + ").map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join(" + ")).join(", ")}</dt><dd>${escapeHtml(meaning)}</dd></div>`).join("")}</dl></div>
        <div class="bu-dialog__footer"><button class="bu-button" type="button" data-overlay="start-tour">Tour starten</button><button class="bu-button bu-button--primary" type="button" data-bu-close>Fertig</button></div></section></div>
      <div id="midi-dialog" class="bu-overlay" hidden tabindex="-1"><section class="bu-dialog" role="dialog" aria-modal="true" aria-labelledby="midi-title"><div class="bu-dialog__header"><div><h2 id="midi-title" class="bu-dialog__title">MIDI</h2><p class="bu-dialog__description">Ein Controller dreht an den Makros, eine andere App oder ein Gerät gibt mit seiner MIDI-Clock Tempo, Start und Stop vor.</p></div>${close}</div>
        <div class="bu-dialog__body gb-midi" data-midi-body></div>
        <div class="bu-dialog__footer"><button class="bu-button bu-button--primary" type="button" data-bu-close>Fertig</button></div></section></div>`;
  }

  private handleOverlayClick(event: Event): void {
    const button = (event.target as Element).closest<HTMLElement>("[data-overlay]");
    if (!button) return;
    const action = button.dataset.overlay;
    if (action === "start-tour") {
      this.brams.close("#help-dialog");
      requestAnimationFrame(() => this.tour.start());
    } else if (action === "midi-connect") {
      // The click lets the browser start audio, so a later MIDI start can play.
      void this.audio.initialize();
      void this.midi.connect();
    } else if (action === "midi-disconnect") {
      this.midi.disconnect();
      this.followClockTempo(null);
    } else if (action === "midi-learn") {
      const index = Number(button.dataset.index);
      this.midi.learn(this.midi.learningIndex === index ? null : index);
    } else if (action === "midi-reset") {
      this.midi.resetMapping();
    }
    this.updateMidiDom();
  }

  private openMidi(): void {
    this.updateMidiDom();
    this.brams.open("#midi-dialog");
  }

  private updateMidiDom(): void {
    const status = this.midi.status;
    this.root.querySelector<HTMLElement>("[data-midi-led]")?.setAttribute("data-state", status.state);
    const body = this.overlays.querySelector<HTMLElement>("[data-midi-body]");
    if (body) body.innerHTML = this.midiBody(status);
  }

  private midiBody(status: MidiStatus): string {
    if (status.state === "unsupported") return `<p>Dieser Browser kann kein Web MIDI. Chrome und Edge können es, Firefox nach einer Nachfrage.</p>`;
    if (status.state === "connecting") return `<p role="status">Verbinde … Bestätige die Nachfrage des Browsers.</p>`;
    if (status.state !== "ready") {
      const hint = status.state === "denied"
        ? `<p class="gb-inline-note">Der Browser hat MIDI abgelehnt. Erlaube es in den Website-Einstellungen und versuche es noch einmal.</p>`
        : status.state === "error" ? `<p class="gb-inline-note">MIDI ließ sich nicht öffnen. Steck das Gerät neu ein und versuche es noch einmal.</p>` : "";
      return `<p>Die Groovebox hört nur zu: Sie liest Clock und Regler und sendet nichts zurück.</p>${hint}<button class="bu-button bu-button--primary" type="button" data-overlay="midi-connect">MIDI verbinden</button>`;
    }
    const learning = this.midi.learningIndex;
    const clock = this.midi.clockBpm;
    const inputs = status.inputs.length > 0 ? status.inputs.map(escapeHtml).join(", ") : "Noch kein Gerät. Steck einen Controller an, er erscheint hier von selbst.";
    return `<p><strong>Eingänge:</strong> ${inputs}</p>
      <label class="gb-midi-toggle"><input type="checkbox" data-overlay-change="midi-clock" ${this.midi.followClock ? "checked" : ""}> Tempo, Start und Stop folgen der MIDI-Clock</label>
      <p class="gb-midi-clock" role="status">${!this.midi.followClock ? "Die Clock wird ignoriert." : clock === null ? "Keine Clock – die Groovebox spielt in ihrem eigenen Tempo." : `Clock: ${clock} BPM`}</p>
      <h3>Regler → Makros der gewählten Spur</h3>
      <ul class="gb-midi-map">${MACRO_KINDS.map((macro, index) => {
        const controller = this.midi.mapping[index] ?? -1;
        const active = learning === index;
        return `<li><span>${MACRO_LABELS[macro].label}</span><output>${active ? "Dreh jetzt einen Regler …" : controller >= 0 ? `CC ${controller}` : "nicht zugewiesen"}</output><button class="bu-button bu-button--sm" type="button" data-overlay="midi-learn" data-index="${index}" aria-pressed="${active}">${active ? "Abbrechen" : "Zuweisen"}</button></li>`;
      }).join("")}</ul>
      <div class="gb-midi-actions"><button class="bu-button bu-button--sm" type="button" data-overlay="midi-reset">CC 70–74 wiederherstellen</button><button class="bu-button bu-button--sm" type="button" data-overlay="midi-disconnect">MIDI trennen</button></div>`;
  }

  private followClockTempo(bpm: number | null): void {
    this.audio.setTempoOverride(bpm);
    this.root.dataset.midiTempo = bpm === null ? "" : String(bpm);
    const playing = this.store.getState().transport.status === "playing";
    if (bpm !== null || playing) this.store.dispatch({ type: "transport/update", update: { message: bpm === null ? "MIDI-Clock beendet – eigenes Tempo" : `MIDI-Clock · ${bpm} BPM` } });
    this.updateMidiDom();
  }

  private async startFromMidi(): Promise<void> {
    if (this.store.getState().transport.status === "playing") return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
      this.store.dispatch({ type: "transport/update", update: { message: "MIDI-Start: klick einmal in die Groovebox, damit der Browser Ton erlaubt" } });
      return;
    }
    await this.startPlayback();
  }

  private queueMacro(index: number, value: number): void {
    this.pendingMacros.set(index, value);
    this.macroFrame ??= requestAnimationFrame(() => {
      this.macroFrame = null;
      for (const [macroIndex, macroValue] of this.pendingMacros) {
        const macro = MACRO_KINDS[macroIndex];
        if (macro) this.store.dispatch({ type: "track/macro", macro, value: macroValue }, { mergeKey: `midi-${macro}` });
      }
      this.pendingMacros.clear();
    });
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
    if (target.matches("input, select, textarea, [contenteditable=true]") || target.closest("[role=dialog], .gb-tour")) return;
    if (event.key === "?") {
      event.preventDefault();
      this.brams.open("#help-dialog");
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.store.dispatch({ type: event.shiftKey ? "history/redo" : "history/undo" });
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "a" && !event.repeat) { event.preventDefault(); void this.toggleRecording(); return; }
    if (key === "p" && !event.repeat) { event.preventDefault(); this.liveKeys = !this.liveKeys; this.render(); return; }
    if (key === "b") { event.preventDefault(); if (!event.repeat) this.audio.setBreak(true); return; }
    if (key === "f") { event.preventDefault(); if (!event.repeat) this.glideFilter(event.shiftKey ? 0.85 : -0.85, 1.4); return; }
    if (this.liveKeys && !event.shiftKey && /^[1-5]$/.test(event.key)) {
      event.preventDefault();
      this.togglePerformanceMute(TRACK_KINDS[Number(event.key) - 1]!);
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

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Asks the browser not to evict local projects under storage pressure; only after a deliberate save-like action. */
function requestPersistentStorage(): void {
  void navigator.storage?.persisted?.().then((persisted) => {
    if (!persisted) void navigator.storage.persist?.();
  }).catch(() => undefined);
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} min`;
}

function clearShareFragment(): void {
  if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function appName(app: string): string {
  return app === "kitty" ? "Kitty" : app === "groovebox" ? "Groovebox" : app;
}
