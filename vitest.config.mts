import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // См. комментарий в самой пустышке: страж времени сборки Next,
      // в jsdom-окружении срабатывающий всегда.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    globalSetup: ["./tests/db/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // E2E живут отдельно и запускаются Playwright — сюда попадать не должны.
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    // Интеграционные тесты делят один файл БД — параллельные файлы затирали бы
    // друг другу данные между resetDb() и проверкой.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/app/**/layout.tsx"],
    },
  },
});
