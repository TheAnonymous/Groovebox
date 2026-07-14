import type {
  BarPattern,
  GrooveIntent,
  PhraseContour,
  Step,
  TrackKind,
  TrackPattern,
  VariationAmount,
} from "./types";
import { BARS_PER_SCENE, STEPS_PER_BAR } from "./types";
import { safeDegreeOffset } from "./music";

type Random = () => number;

const TEMPLATES: Record<TrackKind, readonly (readonly number[])[]> = {
  drums: [
    [0, 2, 4, 6, 8, 10, 12, 14],
    [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
    [0, 2, 4, 6, 8, 10, 11, 12, 14],
  ],
  bass: [
    [0, 3, 6, 8, 11, 14],
    [0, 2, 5, 8, 10, 13],
    [0, 3, 7, 8, 11, 14],
    [0, 3, 6, 8, 12, 15],
  ],
  chords: [[0], [0, 8], [0, 6, 12], [0, 4, 8, 12]],
  lead: [
    [0, 2, 5, 8, 10, 13],
    [1, 3, 6, 9, 11, 14],
    [0, 3, 6, 10, 13, 15],
    [2, 5, 10, 13],
    [0, 3, 5, 8, 11, 13],
  ],
  pad: [[0], [0, 8], [0, 12]],
};

function xorshift(seed: number): Random {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

export function emptyStep(): Step {
  return {
    enabled: false,
    dynamics: "normal",
    variation: 0,
    degreeOffset: 0,
    length: "normal",
    drumVoices: [],
  };
}

export function emptyBar(): BarPattern {
  return { steps: Array.from({ length: STEPS_PER_BAR }, emptyStep) };
}

function setHit(bar: BarPattern, index: number, track: TrackKind, accent = false): void {
  const step = bar.steps[index];
  if (!step) return;
  step.enabled = true;
  step.dynamics = accent ? "accent" : "normal";
  if (track === "drums") {
    step.drumVoices = defaultDrumVoices(index);
  }
}

function choose<T>(values: readonly T[], random: Random): T {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))]!;
}

function applyIntent(track: TrackKind, intent: GrooveIntent, bar: BarPattern, barIndex: number): void {
  if (intent === "driving") {
    if (track === "drums") setHit(bar, barIndex % 2 ? 15 : 7, track);
    if (track === "bass") setHit(bar, barIndex % 2 ? 15 : 7, track);
    for (const step of bar.steps) if (step.enabled) step.length = "short";
  } else if (intent === "spacious") {
    bar.steps.forEach((step, index) => {
      if (step.enabled && index !== 0 && index % 4 !== 0) Object.assign(step, emptyStep());
      else if (step.enabled) step.length = "long";
    });
  } else if (intent === "playful") {
    const target = (barIndex * 3 + (track === "lead" ? 5 : 3)) % STEPS_PER_BAR;
    if (track !== "pad" && track !== "chords") setHit(bar, target, track);
    const enabled = bar.steps.filter((step) => step.enabled);
    if (enabled.length > 1) enabled[enabled.length - 1]!.dynamics = "ghost";
  }
}

function applyContour(
  track: TrackKind,
  contour: PhraseContour,
  bars: BarPattern[],
  locks: readonly boolean[] = [],
): void {
  if (track === "drums" || track === "chords" || track === "pad") return;
  const enabled = bars.flatMap((bar, barIndex) =>
    locks[barIndex]
      ? []
      : bar.steps.flatMap((step, stepIndex) => (step.enabled ? [{ step, stepIndex }] : [])),
  );
  enabled.forEach(({ step, stepIndex }, index) => {
    const progress = enabled.length <= 1 ? 0 : index / (enabled.length - 1);
    let offset = 0;
    if (contour === "rising") offset = Math.round(progress * 4) - 1;
    if (contour === "falling") offset = 3 - Math.round(progress * 4);
    if (contour === "callResponse") offset = index % 4 < 2 ? 0 : 2;
    step.degreeOffset = safeDegreeOffset(track, stepIndex, offset);
  });
}

export function setPatternIntent(
  pattern: TrackPattern,
  intent: GrooveIntent,
  locks: readonly boolean[],
): boolean {
  const before = JSON.stringify(pattern);
  pattern.intent = intent;
  pattern.bars.forEach((bar, barIndex) => {
    if (locks[barIndex]) return;
    bar.steps.forEach((step, stepIndex) => {
      if (!step.enabled) return;
      const anchor = isAnchor(pattern.instrument, stepIndex, step);
      if (intent === "driving") {
        step.length = "short";
        if (!anchor && step.dynamics === "ghost") step.dynamics = "normal";
      } else if (intent === "spacious") {
        step.length = "long";
      } else if (intent === "playful") {
        step.length = stepIndex % 4 === 3 ? "short" : "normal";
        if (!anchor && stepIndex % 4 === 3) step.dynamics = "ghost";
      } else {
        step.length = "normal";
        if (!anchor && step.dynamics === "ghost") step.dynamics = "normal";
      }
    });
  });
  return JSON.stringify(pattern) !== before;
}

export function setPatternContour(
  pattern: TrackPattern,
  contour: PhraseContour,
  locks: readonly boolean[],
): boolean {
  const before = JSON.stringify(pattern);
  pattern.contour = contour;
  applyContour(pattern.instrument, contour, pattern.bars, locks);
  return JSON.stringify(pattern) !== before;
}

export function generateTypicalPattern(
  track: TrackKind,
  contour: PhraseContour,
  intent: GrooveIntent,
  seed: number,
): BarPattern[] {
  const random = xorshift(seed ^ hash(`${track}:${contour}:${intent}`));
  const bars = Array.from({ length: BARS_PER_SCENE }, (_, barIndex) => {
    const bar = emptyBar();
    const template = choose(TEMPLATES[track], random);
    template.forEach((step) => setHit(bar, step, track));

    if (track === "drums") {
      setHit(bar, 0, track, true);
      setHit(bar, 4, track);
      setHit(bar, 8, track, random() > 0.3);
      setHit(bar, 12, track);
      bar.steps.forEach((step, stepIndex) => {
        if (!step.enabled || isAnchor(track, stepIndex, step)) return;
        step.dynamics = stepIndex % 4 === 2 ? "ghost" : "normal";
        step.variation = ((barIndex * 3 + stepIndex) % 5) / 5;
      });
      if (barIndex % 2 === 1 && bar.steps[14]?.enabled) {
        bar.steps[14]!.drumVoices = ["openHat"];
        bar.steps[14]!.dynamics = "normal";
        bar.steps[14]!.length = "long";
      }
      if (barIndex === 3 && random() > 0.35) {
        setHit(bar, 15, track);
        bar.steps[15]!.drumVoices = random() > 0.48 ? ["tom"] : ["openHat"];
        bar.steps[15]!.variation = 0.35 + random() * 0.55;
      }
      if (barIndex === 3 && random() > 0.62) {
        setHit(bar, 14, track);
        bar.steps[14]!.drumVoices = ["tom", "clap"];
        bar.steps[14]!.dynamics = "ghost";
        bar.steps[14]!.variation = 0.2 + random() * 0.45;
      }
    } else {
      const first = bar.steps.find((step) => step.enabled);
      if (first) first.dynamics = "accent";
      const active = bar.steps.filter((step) => step.enabled);
      active.forEach((step, index) => {
        if (index > 0 && index % 3 === 2) step.dynamics = "ghost";
        if (track === "chords" || track === "pad") step.length = "long";
      });
      const varied = active[Math.max(0, active.length - 1)];
      if (varied) varied.variation = 0.58 + ((barIndex + active.length) % 3) * 0.2;
    }
    applyIntent(track, intent, bar, barIndex);
    return bar;
  });
  applyContour(track, contour, bars);
  return bars;
}

export function cycleStep(step: Step, track: TrackKind, stepIndex: number): Step {
  const next = structuredClone(step);
  if (!next.enabled) {
    next.enabled = true;
    next.dynamics = "normal";
    next.variation = 0;
    next.drumVoices = track === "drums" ? defaultDrumVoices(stepIndex) : [];
  } else if (next.dynamics !== "accent" && next.variation < 0.95) {
    next.dynamics = "accent";
  } else if (next.dynamics === "accent") {
    next.dynamics = "normal";
    next.variation = 1;
  } else {
    return emptyStep();
  }
  next.degreeOffset = safeDegreeOffset(track, stepIndex, next.degreeOffset);
  return next;
}

function defaultDrumVoices(stepIndex: number): Step["drumVoices"] {
  if (stepIndex === 4 || stepIndex === 12) return ["snare", "clap"];
  if (stepIndex === 0 || stepIndex === 8) return ["kick", "closedHat"];
  return ["closedHat"];
}

export function isAnchor(track: TrackKind, stepIndex: number, step: Step): boolean {
  if (!step.enabled) return false;
  if (track === "drums") return stepIndex === 0 || stepIndex === 4 || stepIndex === 8 || stepIndex === 12;
  if (track === "bass") return stepIndex === 0 || stepIndex === 8;
  return stepIndex === 0;
}

function varyExpression(pattern: TrackPattern, random: Random, locks: readonly boolean[]): boolean {
  const candidates = pattern.bars.flatMap((bar, barIndex) =>
    locks[barIndex]
      ? []
      : bar.steps.flatMap((step, stepIndex) =>
          step.enabled ? [{ step, stepIndex, anchor: isAnchor(pattern.instrument, stepIndex, step) }] : [],
        ),
  );
  if (!candidates.length) return false;
  const candidate = choose(candidates, random);
  if (pattern.instrument === "drums") {
    candidate.step.variation = Math.round(random() * 1000) / 1000;
    candidate.step.length = candidate.step.variation > 0.68 ? "long" : candidate.step.variation < 0.28 ? "short" : "normal";
    return true;
  }
  if (candidate.anchor || random() > 0.5) {
    candidate.step.length = candidate.step.length === "normal" ? "short" : "normal";
  } else {
    candidate.step.dynamics = candidate.step.dynamics === "ghost" ? "normal" : "ghost";
  }
  return true;
}

export function varyPattern(
  pattern: TrackPattern,
  amount: VariationAmount,
  locks: readonly boolean[],
): boolean {
  const before = JSON.stringify(pattern.bars);
  const random = xorshift(hash(`${before}:${amount}`));
  if (amount === "subtle") return varyExpression(pattern, random, locks);

  if (pattern.instrument === "drums") {
    const candidates = pattern.bars.flatMap((bar, barIndex) =>
      locks[barIndex] ? [] : bar.steps.filter((step) => step.enabled),
    );
    const count = Math.min(amount === "bold" ? 4 : 2, candidates.length);
    for (let index = 0; index < count; index += 1) {
      const step = candidates.splice(Math.floor(random() * candidates.length), 1)[0];
      if (!step) break;
      step.variation = Math.round(random() * 1000) / 1000;
      step.length = step.variation > 0.68 ? "long" : step.variation < 0.28 ? "short" : "normal";
    }
    return JSON.stringify(pattern.bars) !== before;
  }

  const available = pattern.bars.map((_, index) => index).filter((index) => !locks[index]);
  const count = Math.min(amount === "bold" ? 2 : 1, available.length);
  for (let changed = 0; changed < count; changed += 1) {
    const availableIndex = Math.floor(random() * available.length);
    const barIndex = available.splice(availableIndex, 1)[0];
    if (barIndex === undefined) break;
    const generated = generateTypicalPattern(pattern.instrument, pattern.contour, pattern.intent, hash(before) + changed + 1);
    pattern.bars[barIndex] = structuredClone(generated[barIndex] ?? emptyBar());
  }
  return JSON.stringify(pattern.bars) !== before;
}

export function randomizePattern(pattern: TrackPattern, locks: readonly boolean[]): boolean {
  const before = JSON.stringify(pattern.bars);
  const generated = generateTypicalPattern(
    pattern.instrument,
    pattern.contour,
    pattern.intent,
    hash(before) ^ 0x52414e44,
  );
  generated.forEach((bar, index) => {
    if (!locks[index]) pattern.bars[index] = bar;
  });
  return JSON.stringify(pattern.bars) !== before;
}

export function clearPattern(pattern: TrackPattern, locks: readonly boolean[]): boolean {
  const before = JSON.stringify(pattern.bars);
  pattern.bars.forEach((_, index) => {
    if (!locks[index]) pattern.bars[index] = emptyBar();
  });
  return JSON.stringify(pattern.bars) !== before;
}
