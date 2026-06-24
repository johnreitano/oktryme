import { defineConfig } from "vitest/config";

// Core logic (render, edit, store, billing verification) is pure TS and runs in
// the node environment — no Workers pool needed. The Worker shell (src/index.ts)
// is a thin wiring layer exercised manually via `wrangler dev`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
