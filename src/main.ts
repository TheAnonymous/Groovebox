import "./styles.css";
import { ToneAudioEngine } from "./audio/engine";
import { GrooveboxStore } from "./store/store";
import { LocalProjectRepository } from "./storage";
import { GrooveboxApp } from "./ui/app";
import { BrowserBramsAdapter } from "./ui/brams";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App-Container fehlt");

const repository = new LocalProjectRepository();
const loaded = repository.load();
const store = new GrooveboxStore(loaded.project);
const audio = new ToneAudioEngine(loaded.project);
const app = new GrooveboxApp(root, store, audio, repository, new BrowserBramsAdapter());

app.mount(loaded.warning);
