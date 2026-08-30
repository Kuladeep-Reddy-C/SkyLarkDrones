import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local dev, proxy /api to the backend so the frontend can use relative URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
