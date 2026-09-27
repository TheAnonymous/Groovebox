/**
 * A short first-visit tour: one card per step, next to a highlighted part of
 * the interface. Non-modal (the app stays usable), Escape ends it, and it is
 * offered once per browser; the help overlay can start it again.
 */
export interface TourStep {
  /** CSS selector of the part to highlight; the card centres when it is missing. */
  target: string;
  title: string;
  text: string;
}

export interface TourOptions {
  storageKey: string;
  /** Class prefix for the app's own styling: `${prefix}`, `${prefix}__spotlight`, `${prefix}__card`, … */
  className: string;
}

export class Tour {
  private element: HTMLElement | null = null;
  private index = 0;
  private returnFocus: HTMLElement | null = null;
  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
  private readonly onLayout = () => this.place();

  constructor(private readonly steps: readonly TourStep[], private readonly options: TourOptions) {}

  /** True until the tour was finished or skipped once in this browser. */
  get pending(): boolean {
    try {
      return localStorage.getItem(this.options.storageKey) !== "done";
    } catch {
      return false;
    }
  }

  get open(): boolean {
    return this.element !== null;
  }

  start(): void {
    this.close(false);
    this.index = 0;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prefix = this.options.className;
    const element = document.createElement("div");
    element.className = prefix;
    element.innerHTML = `<div class="${prefix}__spotlight" aria-hidden="true"></div>
      <section class="${prefix}__card" role="dialog" aria-modal="false" aria-labelledby="${prefix}-title" aria-describedby="${prefix}-text">
        <p class="${prefix}__count" data-tour-count></p>
        <h2 id="${prefix}-title" class="${prefix}__title" data-tour-title></h2>
        <p id="${prefix}-text" class="${prefix}__text" data-tour-text></p>
        <div class="${prefix}__actions">
          <button type="button" class="${prefix}__skip" data-tour="skip">Überspringen</button>
          <span class="${prefix}__spacer"></span>
          <button type="button" class="${prefix}__back" data-tour="back">Zurück</button>
          <button type="button" class="${prefix}__next" data-tour="next">Weiter</button>
        </div>
      </section>`;
    element.addEventListener("click", (event) => {
      const action = (event.target as Element).closest<HTMLElement>("[data-tour]")?.dataset.tour;
      if (action === "skip") this.close(true);
      else if (action === "back") this.show(this.index - 1);
      else if (action === "next") {
        if (this.index >= this.steps.length - 1) this.close(true);
        else this.show(this.index + 1);
      }
    });
    document.body.append(element);
    this.element = element;
    document.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onLayout);
    window.addEventListener("scroll", this.onLayout, true);
    this.show(0);
  }

  close(markDone = true): void {
    if (!this.element) return;
    this.element.remove();
    this.element = null;
    document.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onLayout);
    window.removeEventListener("scroll", this.onLayout, true);
    if (markDone) {
      try {
        localStorage.setItem(this.options.storageKey, "done");
      } catch {
        // The tour may come back next visit.
      }
    }
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  private show(index: number): void {
    const element = this.element;
    const step = this.steps[Math.max(0, Math.min(this.steps.length - 1, index))];
    if (!element || !step) return;
    this.index = this.steps.indexOf(step);
    const last = this.index === this.steps.length - 1;
    element.querySelector("[data-tour-count]")!.textContent = `${this.index + 1} / ${this.steps.length}`;
    element.querySelector("[data-tour-title]")!.textContent = step.title;
    element.querySelector("[data-tour-text]")!.textContent = step.text;
    element.querySelector<HTMLButtonElement>('[data-tour="back"]')!.hidden = this.index === 0;
    element.querySelector<HTMLButtonElement>('[data-tour="skip"]')!.hidden = last;
    const next = element.querySelector<HTMLButtonElement>('[data-tour="next"]')!;
    next.textContent = last ? "Los geht's" : "Weiter";
    document.querySelector(step.target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.place();
    next.focus({ preventScroll: true });
  }

  private place(): void {
    const element = this.element;
    const step = this.steps[this.index];
    if (!element || !step) return;
    const prefix = this.options.className;
    const spotlight = element.querySelector<HTMLElement>(`.${prefix}__spotlight`)!;
    const card = element.querySelector<HTMLElement>(`.${prefix}__card`)!;
    const target = document.querySelector(step.target)?.getBoundingClientRect();
    const margin = 12;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cardRect = card.getBoundingClientRect();
    if (!target || target.width === 0) {
      spotlight.hidden = true;
      card.style.left = `${Math.max(margin, (width - cardRect.width) / 2)}px`;
      card.style.top = `${Math.max(margin, (height - cardRect.height) / 2)}px`;
      return;
    }
    spotlight.hidden = false;
    const pad = 6;
    Object.assign(spotlight.style, {
      left: `${target.left - pad}px`,
      top: `${target.top - pad}px`,
      width: `${target.width + pad * 2}px`,
      height: `${target.height + pad * 2}px`,
    });
    const below = target.bottom + pad + margin;
    const above = target.top - pad - margin - cardRect.height;
    const top = below + cardRect.height <= height - margin ? below : above >= margin ? above : Math.max(margin, height - margin - cardRect.height);
    const left = Math.min(Math.max(margin, target.left), width - margin - cardRect.width);
    card.style.left = `${Math.max(margin, left)}px`;
    card.style.top = `${top}px`;
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
    }
  }
}
