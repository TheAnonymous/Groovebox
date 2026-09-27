// Renders the Hörprobe on the phone page and the Musik-Werkstatt overview:
// the factory set's whole arc at four bars per scene, exported through the
// app's own WAV export, then encoded as Opus (WebM) with an MP3 fallback.
// Needs a fresh `npm run build` and ffmpeg with libopus and libmp3lame.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const port = 4391;
const output = "public/hoerprobe";
const server = spawn("node_modules/.bin/vite", ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
const work = mkdtempSync(join(tmpdir(), "groovebox-demo-"));
const wav = join(work, "hoerprobe.wav");

try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await page.goto(`http://127.0.0.1:${port}/Groovebox/`);
        break;
      } catch (error) {
        if (attempt > 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "4 Takte" }).click();
    await page.getByRole("button", { name: "Als WAV exportieren" }).click();
    const download = page.waitForEvent("download", { timeout: 180_000 });
    await page.getByRole("button", { name: "WAV erstellen" }).click();
    await (await download).saveAs(wav);
  } finally {
    await browser.close();
  }
  const encode = (args) => {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, ...args], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`ffmpeg ${args.at(-1)} fehlgeschlagen`);
  };
  encode(["-c:a", "libopus", "-b:a", "64k", "-vbr", "on", "-map_metadata", "-1", "-fflags", "+bitexact", `${output}.webm`]);
  encode(["-c:a", "libmp3lame", "-q:a", "4", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", `${output}.mp3`]);
  for (const extension of ["webm", "mp3"]) console.log(`${output}.${extension}: ${Math.round(statSync(`${output}.${extension}`).size / 1024)} KiB`);
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
