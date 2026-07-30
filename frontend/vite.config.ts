import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

const BASE = '/gw/';

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'mpa-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const originalUrl = req.url || '';
          // Only handle clean page routes (no file extension)
          if (/\.[a-zA-Z0-9]+$/.test(originalUrl)) {
            return next();
          }
          // Admin routes -> admin.html
          if (
            originalUrl === `${BASE}admin` ||
            originalUrl === `${BASE}admin/` ||
            originalUrl.startsWith(`${BASE}admin/`)
          ) {
            req.url = `${BASE}admin.html`;
            return next();
          }
          // Dashboard routes -> index.html
          if (originalUrl === BASE || originalUrl.startsWith(BASE)) {
            req.url = `${BASE}index.html`;
            return next();
          }
          next();
        });
      },
    },
  ],
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
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3019',
      '/v1': 'http://localhost:3019',
    },
  },
});
