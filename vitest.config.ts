import { configDefaults, defineConfig } from "vitest/config";

// Unit tests only (pure TS, no DOM). Kept separate from vite.config.ts so the
// app build is unaffected. Leftover agent worktrees under .claude/ hold full
// repo copies and must never be collected.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ".claude/**", "ios/**", "dist/**"],
    environment: "node",
  },
});
