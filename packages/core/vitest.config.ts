import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts", "src/**/*.test.ts", "tests/**/*.test-d.ts"],
        globals: true,
        typecheck: {
            enabled: true,
            tsconfig: "./tsconfig.typecheck.json",
        },
    },
});
