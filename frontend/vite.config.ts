/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
  },
  test: {
    // Node, deliberately, and not jsdom. The suite's 158 pre-existing cases
    // were written against this environment and keep running in it; the files
    // that need a DOM opt in with a `@vitest-environment jsdom` docblock. A
    // global switch would have changed the footing under every existing test
    // in the same change that restructured the application.
    environment: "node",
    // Without this, Vitest stubs every CSS import to an empty string, including
    // `?raw` ones. tokens.test.ts reads index.css to assert the palette, so the
    // stub would make it pass by vacuity on an empty file.
    css: true,
  },
});
