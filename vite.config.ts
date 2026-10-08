import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serve o site em /<nome-do-repo>/. O workflow de deploy injeta VITE_BASE.
const base = process.env.VITE_BASE ?? '/PlaySysDesigner/';

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
