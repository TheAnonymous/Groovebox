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
    this.withApi((api) => api.toast({ title, message, tone, duration: 5000 }));
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
