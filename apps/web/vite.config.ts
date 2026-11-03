import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build only. No server, no analytics, no external requests.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { sourcemap: true },
});
