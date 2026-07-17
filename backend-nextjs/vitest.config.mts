import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
