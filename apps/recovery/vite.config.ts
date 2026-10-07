import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/recovery',
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  esbuild: { jsx: 'automatic' },
});
