import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site under /<repository-name>/. The deploy workflow injects VITE_BASE.
const base = process.env.VITE_BASE ?? '/PlaySysDesigner/';

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
