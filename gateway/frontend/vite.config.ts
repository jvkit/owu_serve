import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

const BASE = '/gw/';

export default defineConfig({
  appType: 'mpa',
  plugins: [svelte()],
  root: __dirname,
  base: BASE,
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
      },
    },
  },
  resolve: {
    alias: {
      '$shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3019',
      '/v1': 'http://localhost:3019',
    },
  },
});
