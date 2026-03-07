import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4748,
    proxy: {
      '/api': {
        target: 'http://localhost:4747',
        changeOrigin: true
      },
      '/download': {
        target: 'http://localhost:4747',
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 4748,
    host: '0.0.0.0',
    allowedHosts: [
      'lottery.adamvosburgh.com',
      'localhost',
      '127.0.0.1'
    ]
  }
});
