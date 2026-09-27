/**
 * Wires the "remember this link" button on the small-screen page: the native
 * share sheet where available, otherwise the clipboard, otherwise the plain URL.
 */
export function wireShareLink(root: ParentNode = document): void {
  const button = root.querySelector<HTMLButtonElement>("[data-share-link]");
  const feedback = root.querySelector<HTMLElement>("[data-share-feedback]");
  const sharedHint = root.querySelector<HTMLElement>("[data-shared-hint]");
  if (sharedHint) sharedHint.hidden = !window.location.hash.startsWith("#p=");
  if (!button || !feedback) return;
  button.addEventListener("click", async () => {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      feedback.textContent = "Link kopiert – öffne ihn später am Laptop oder Desktop.";
    } catch {
      feedback.textContent = `Dieser Link führt später wieder hierher: ${url}`;
    }
  });
}
