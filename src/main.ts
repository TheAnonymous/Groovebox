import "./styles.css";
import { ToneAudioEngine } from "./audio/engine";
import { GrooveboxStore } from "./store/store";
import { ProjectCatalog } from "./catalog";
import { GrooveboxApp } from "./ui/app";
import { BrowserBramsAdapter } from "./ui/brams";
import { wireShareLink } from "./ui/share-link";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App-Container fehlt");

const catalog = new ProjectCatalog();
const loaded = catalog.load();
const store = new GrooveboxStore(loaded.project);
const audio = new ToneAudioEngine(loaded.project);
const app = new GrooveboxApp(root, store, audio, catalog, new BrowserBramsAdapter());

app.mount(loaded.warning);
wireShareLink();
