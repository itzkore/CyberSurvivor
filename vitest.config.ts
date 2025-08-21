import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'backend/tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
