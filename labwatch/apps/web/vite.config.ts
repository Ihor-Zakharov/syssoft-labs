import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the gateway runs on the host; in docker nginx does this proxying
    proxy: { '/trpc': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
