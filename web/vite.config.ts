import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const allowedHost = process.env.VITE_ALLOWED_HOST;
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: allowedHost ? [allowedHost, 'localhost'] : ['localhost'],
    proxy: {
      '/api': apiTarget,
    },
  },
});
