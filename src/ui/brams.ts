interface BraunUiApi {
  init(root?: ParentNode): void;
  open(target: string | Element): void;
  close(target: string | Element): void;
  toast(options: {
    title: string;
    message: string;
    tone?: "neutral" | "success" | "warning" | "danger";
    duration?: number;
  }): HTMLElement;
}

declare global {
  interface Window {
    BraunUI?: BraunUiApi;
  }
}

const ICON_SPRITE = `${import.meta.env.BASE_URL}vendor/braun-ui/icons.svg`;

export interface BramsAdapter {
  init(root?: ParentNode): void;
  open(target: string | Element): void;
  close(target: string | Element): void;
  toast(title: string, message: string, tone?: "neutral" | "success" | "warning" | "danger"): void;
}

export class BrowserBramsAdapter implements BramsAdapter {
  init(root: ParentNode = document): void {
    this.withApi((api) => api.init(root));
  }

  open(target: string | Element): void {
    this.withApi((api) => api.open(target));
  }

  close(target: string | Element): void {
    this.withApi((api) => api.close(target));
  }

  toast(
    title: string,
    message: string,
    tone: "neutral" | "success" | "warning" | "danger" = "neutral",
  ): void {
    this.withApi((api) => {
      const item = api.toast({ title, message, tone, duration: 5000 });
      // The vendored toast points at a relative icons.svg; the sprite lives under vendor/braun-ui/.
      item.querySelectorAll("use").forEach((use) => {
        const href = use.getAttribute("href");
        if (href?.startsWith("icons.svg#")) use.setAttribute("href", `${ICON_SPRITE}${href.slice("icons.svg".length)}`);
      });
    });
  }

  private withApi(action: (api: BraunUiApi) => void): void {
    if (window.BraunUI) {
      action(window.BraunUI);
      return;
    }
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        if (window.BraunUI) action(window.BraunUI);
      },
      { once: true },
    );
  }
}
