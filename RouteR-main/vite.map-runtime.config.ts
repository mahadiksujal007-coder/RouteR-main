import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(projectDirectory, 'frontend/three/charging-station-entry.js'),
      name: 'RouteRMapRuntime',
      formats: ['iife'],
      fileName: () => 'charging-station-runtime.js',
      cssFileName: 'charging-station-runtime'
    },
    cssCodeSplit: false,
    copyPublicDir: false,
    emptyOutDir: false,
    outDir: path.resolve(projectDirectory, 'public/static')
  }
});
