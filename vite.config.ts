import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  // build (a vite preview) pro https://app.makuderovi.cz/mafia-game/ (npm run upload), dev server zůstává na http://localhost:5173/
  base: mode === 'production' ? '/mafia-game/' : '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Soubory .glsl se importují s `?raw` a vkládají se inline jako řetězce.
  assetsInclude: ['**/*.glsl'],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
