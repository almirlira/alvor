import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Copilot DRE — web. Chamadas /api/* sao encaminhadas para a API local (:3800).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://localhost:3800', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  build: { outDir: 'dist', target: 'es2022' },
});
