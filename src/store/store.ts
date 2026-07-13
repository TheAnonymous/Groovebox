import { createTransportState, createUiState } from "../domain/defaults";
import {
  clearPattern,
  cycleStep,
  isAnchor,
  randomizePattern,
  setPatternContour,
  setPatternIntent,
  varyPattern,
} from "../domain/patterns";
import { sanitizeProject } from "../domain/sanitize";
import type {
  AppState,
  ChordSlot,
  GrooveIntent,
  MacroKind,
  PhraseContour,
  ProjectV1,
  RootNote,
  Scale,
  StepDynamics,
  StepLength,
  TrackKind,
  VariationAmount,
} from "../domain/types";

export type Action =
  | { type: "ui/select-scene"; scene: number }
  | { type: "ui/select-track"; track: TrackKind }
  | { type: "ui/select-step"; bar: number; step: number }
  | { type: "ui/toggle-lock"; bar: number }
  | { type: "ui/variation-amount"; amount: VariationAmount }
  | { type: "transport/update"; update: Partial<AppState["transport"]> }
  | { type: "autosave/status"; status: AppState["autosave"] }
  | { type: "project/replace"; project: ProjectV1 }
  | { type: "project/tempo"; value: number }
  | { type: "project/key"; value: RootNote }
  | { type: "project/scale"; value: Scale }
  | { type: "project/swing"; value: number }
  | { type: "project/master"; value: number }
  | { type: "mix/mute"; track: TrackKind }
  | { type: "mix/solo"; track: TrackKind }
  | { type: "mix/volume"; track: TrackKind; value: number }
  | { type: "step/cycle"; bar: number; step: number }
  | { type: "step/dynamics"; value: StepDynamics }
  | { type: "step/length"; value: StepLength }
  | { type: "step/role"; degreeOffset: number; variation?: number }
  | { type: "track/macro"; macro: MacroKind; value: number }
  | { type: "track/intent"; value: GrooveIntent }
  | { type: "track/contour"; value: PhraseContour }
  | { type: "track/vary" }
  | { type: "track/randomize" }
  | { type: "track/clear" }
  | { type: "chord/update"; bar: number; value: ChordSlot }
  | { type: "history/undo" }
  | { type: "history/redo" };

export type StoreListener = (state: AppState, action: Action) => void;

const HISTORY_LIMIT = 100;

export class GrooveboxStore {
  private state: AppState;
  private readonly listeners = new Set<StoreListener>();
  private undoStack: ProjectV1[] = [];
  private redoStack: ProjectV1[] = [];

  constructor(project: ProjectV1) {
    this.state = {
      project: sanitizeProject(project),
      ui: createUiState(),
      transport: createTransportState(),
      canUndo: false,
      canRedo: false,
      autosave: "ready",
    };
  }

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(action: Action): void {
    if (action.type === "history/undo") {
      this.undo(action);
      return;
    }
    if (action.type === "history/redo") {
      this.redo(action);
      return;
    }

    const before = structuredClone(this.state.project);
    const changedProject = this.reduce(action);
    if (changedProject) {
      this.undoStack.push(before);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      this.state.canUndo = true;
      this.state.canRedo = false;
      this.state.autosave = "saving";
    }
    this.emit(action);
  }

  private reduce(action: Action): boolean {
    const { project, ui } = this.state;
    switch (action.type) {
      case "ui/select-scene":
        ui.selectedScene = Math.max(0, Math.min(3, Math.round(action.scene)));
        ui.selectedStep = null;
        return false;
      case "ui/select-track":
        ui.selectedTrack = action.track;
        ui.selectedStep = null;
        return false;
      case "ui/select-step":
        ui.selectedStep = { bar: action.bar, step: action.step };
        return false;
      case "ui/toggle-lock": {
        const locks = ui.locks[ui.selectedTrack];
        const index = Math.max(0, Math.min(3, action.bar));
        locks[index] = !locks[index];
        return false;
      }
      case "ui/variation-amount":
        ui.variationAmount = action.amount;
        return false;
      case "transport/update":
        Object.assign(this.state.transport, action.update);
        return false;
      case "autosave/status":
        this.state.autosave = action.status;
        return false;
      case "project/replace":
        this.state.project = sanitizeProject(action.project);
        this.state.ui = createUiState();
        this.state.transport = createTransportState();
        return JSON.stringify(this.state.project) !== JSON.stringify(project);
      case "project/tempo":
        return assignIfChanged(project, "tempo", Math.max(80, Math.min(120, action.value)));
      case "project/key":
        return assignIfChanged(project, "key", action.value);
      case "project/scale":
        return assignIfChanged(project, "scale", action.value);
      case "project/swing":
        return assignIfChanged(project, "swing", Math.max(0, Math.min(0.4, action.value)));
      case "project/master":
        return assignIfChanged(project, "masterVolume", Math.max(0, Math.min(1, action.value)));
      case "mix/mute": {
        const mix = findMix(project, action.track);
        if (!mix) return false;
        mix.muted = !mix.muted;
        if (mix.muted) mix.solo = false;
        return true;
      }
      case "mix/solo": {
        const mix = findMix(project, action.track);
        if (!mix) return false;
        mix.solo = !mix.solo;
        if (mix.solo) mix.muted = false;
        return true;
      }
      case "mix/volume": {
        const mix = findMix(project, action.track);
        return mix ? assignIfChanged(mix, "volume", Math.max(0, Math.min(1, action.value))) : false;
      }
      case "step/cycle": {
        const step = findStep(this.state, action.bar, action.step);
        if (!step) return false;
        const next = cycleStep(step, ui.selectedTrack, action.step);
        Object.assign(step, next);
        ui.selectedStep = { bar: action.bar, step: action.step };
        return true;
      }
      case "step/dynamics": {
        const step = selectedStep(this.state);
        if (!step?.enabled) return false;
        const position = ui.selectedStep;
        const value = position && action.value === "ghost" && isAnchor(ui.selectedTrack, position.step, step)
          ? "normal"
          : action.value;
        return assignIfChanged(step, "dynamics", value);
      }
      case "step/length": {
        const step = selectedStep(this.state);
        return step && step.enabled ? assignIfChanged(step, "length", action.value) : false;
      }
      case "step/role": {
        const step = selectedStep(this.state);
        if (!step || !step.enabled) return false;
        const beforeStep = JSON.stringify(step);
        step.degreeOffset = action.degreeOffset;
        if (action.variation !== undefined) step.variation = action.variation;
        return JSON.stringify(step) !== beforeStep;
      }
      case "track/macro": {
        const pattern = selectedPattern(this.state);
        return pattern ? assignIfChanged(pattern.macros, action.macro, Math.max(0, Math.min(1, action.value))) : false;
      }
      case "track/intent": {
        const pattern = selectedPattern(this.state);
        return pattern ? setPatternIntent(pattern, action.value, ui.locks[ui.selectedTrack]) : false;
      }
      case "track/contour": {
        const pattern = selectedPattern(this.state);
        return pattern ? setPatternContour(pattern, action.value, ui.locks[ui.selectedTrack]) : false;
      }
      case "track/vary": {
        const pattern = selectedPattern(this.state);
        return pattern ? varyPattern(pattern, ui.variationAmount, ui.locks[ui.selectedTrack]) : false;
      }
      case "track/randomize": {
        const pattern = selectedPattern(this.state);
        return pattern ? randomizePattern(pattern, ui.locks[ui.selectedTrack]) : false;
      }
      case "track/clear": {
        const pattern = selectedPattern(this.state);
        return pattern ? clearPattern(pattern, ui.locks[ui.selectedTrack]) : false;
      }
      case "chord/update": {
        const chord = project.scenes[ui.selectedScene]?.chords[action.bar];
        if (!chord) return false;
        const beforeChord = JSON.stringify(chord);
        Object.assign(chord, action.value);
        return JSON.stringify(chord) !== beforeChord;
      }
    }
    return false;
  }

  private undo(action: Action): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(structuredClone(this.state.project));
    this.state.project = previous;
    this.state.canUndo = this.undoStack.length > 0;
    this.state.canRedo = true;
    this.state.autosave = "saving";
    this.emit(action);
  }

  private redo(action: Action): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.state.project));
    this.state.project = next;
    this.state.canUndo = true;
    this.state.canRedo = this.redoStack.length > 0;
    this.state.autosave = "saving";
    this.emit(action);
  }

  private emit(action: Action): void {
    for (const listener of this.listeners) listener(this.state, action);
  }
}

function assignIfChanged<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): boolean {
  if (target[key] === value) return false;
  target[key] = value;
  return true;
}

function findMix(project: ProjectV1, track: TrackKind) {
  return project.mix.find((mix) => mix.instrument === track);
}

export function selectedPattern(state: AppState) {
  return state.project.scenes[state.ui.selectedScene]?.tracks.find(
    (pattern) => pattern.instrument === state.ui.selectedTrack,
  );
}

export function findStep(state: AppState, bar: number, step: number) {
  return selectedPattern(state)?.bars[bar]?.steps[step];
}

export function selectedStep(state: AppState) {
  const selected = state.ui.selectedStep;
  return selected ? findStep(state, selected.bar, selected.step) : undefined;
}

export function effectiveTrackGains(project: ProjectV1): Record<TrackKind, number> {
  const hasSolo = project.mix.some((mix) => mix.solo && !mix.muted);
  return Object.fromEntries(
    project.mix.map((mix) => [
      mix.instrument,
      mix.muted || (hasSolo && !mix.solo) ? 0 : Math.max(0, Math.min(1, mix.volume)),
    ]),
  ) as Record<TrackKind, number>;
}
