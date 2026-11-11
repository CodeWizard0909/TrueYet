import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
});
