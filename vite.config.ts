import { defineConfig } from "vitest/config";

// The production Content-Security-Policy of musik.jodie-oesterling.de
// (server-infra hosts/rs2000/site-values.nix), so the E2E tests against the
// preview catch anything the live site would block.
const PRODUCTION_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'none'";

export default defineConfig({
  preview: { headers: { "Content-Security-Policy": PRODUCTION_CSP } },
  base: "/Groovebox/",
  build: {
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
