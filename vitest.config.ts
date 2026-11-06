import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'src/**/*.test.ts', 'src/index.ts'],
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});