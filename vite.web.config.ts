// Versión web: la misma app, para abrir desde el celular sin instalar nada.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  envDir: resolve(__dirname),
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react(), tailwindcss()],
  define: { __PLATAFORMA__: JSON.stringify('web') },
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true },
  server: { port: 5180, host: true }
})
