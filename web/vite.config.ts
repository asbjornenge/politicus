import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['politicus.coder.surflabs.no', 'localhost'],
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://politicus.coder.surflabs.no',
    },
  },
});
