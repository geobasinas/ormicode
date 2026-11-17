import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: { outDir: 'out/renderer' },
    plugins: [react(), tailwindcss()],
  },
});
