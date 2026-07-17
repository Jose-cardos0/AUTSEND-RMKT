import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  // mjml-browser (usado pelo Easy Email) espera `global` no browser.
  define: {
    global: 'globalThis',
  },
})
