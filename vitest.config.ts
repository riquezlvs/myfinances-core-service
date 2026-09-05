import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['tests/mocks/**', 'src/index.ts', 'src/bot/index.ts'],
    },
    // free tier: evita paralelismo pesado consumindo memória
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});