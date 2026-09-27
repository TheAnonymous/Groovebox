import "./styles.css";
import { ToneAudioEngine } from "./audio/engine";
import { GrooveboxStore } from "./store/store";
import { ProjectCatalog } from "./catalog";
import { GrooveboxApp } from "./ui/app";
import { BrowserBramsAdapter } from "./ui/brams";
import { wireShareLink } from "./ui/share-link";
import { decodeShareFragment } from "./transfer";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App-Container fehlt");

const catalog = new ProjectCatalog();
const loaded = catalog.load();
const store = new GrooveboxStore(loaded.project);
const audio = new ToneAudioEngine(loaded.project);
const app = new GrooveboxApp(root, store, audio, catalog, new BrowserBramsAdapter());

app.mount(loaded.warning);
wireShareLink();

/** Offers a set carried in the URL fragment, on load and when a link is pasted into an open tab. */
function offerSharedFragment(): void {
  const desktop = !window.matchMedia("(max-width: 1023px)").matches;
  if (!desktop || !window.location.hash.startsWith("#p=")) return;
  decodeShareFragment(window.location.hash)
    .then((shared) => { if (shared) app.offerSharedProject(shared); })
    .catch((error: unknown) => app.showSharedLinkError(error instanceof Error ? error.message : "Unbekannter Fehler"));
}

offerSharedFragment();
window.addEventListener("hashchange", offerSharedFragment);
