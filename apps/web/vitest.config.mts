import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "jsdom",
    // A test that forgets to mock the API must not reach a real API on this machine (the local demo runs one on :8000, which answers 401 and
    // would send a page test to /login). ".invalid" never resolves, so an unmocked call fails the way "nothing is listening" always did.
    env: { NEXT_PUBLIC_API_BASE_URL: "http://api.invalid" },
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
