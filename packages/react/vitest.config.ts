import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        pool: "forks",
        singleThread: true,
        include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
        globals: true,
    },
});
