import nextConfig from "eslint-config-next";
import prettier from "eslint-config-prettier";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      // Клиент Prisma генерируется и в репозиторий не коммитится.
      "src/generated/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "db/**",
      "history/**",
      "next-env.d.ts",
    ],
  },
  ...nextConfig,
  prettier,
  {
    // Плагин @typescript-eslint регистрируется конфигом next/typescript только
    // для TS-файлов, поэтому правило ограничено теми же файлами — иначе ESLint
    // не найдёт плагин, разбирая eslint.config.mjs.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Конвенция из CLAUDE.md: any запрещён, тип выводится или описывается явно.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default config;
