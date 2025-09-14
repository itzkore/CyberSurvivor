import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.ts', 'backend/tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    // Match the old "basic" reporter without printing the summary footer.
    // Note: CLI flags like --reporter=basic will still override this.
    reporters: [["default", { summary: false }]]
  },
});
