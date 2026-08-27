import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `vite build --mode singlefile` folds the lazily loaded parcel snapshot into
  // the main bundle. It exists for the one-file preview build, which has no
  // server to fetch a second chunk from. The normal build keeps the snapshot
  // out of the first load.
  build: mode === 'singlefile'
    ? { rollupOptions: { output: { inlineDynamicImports: true } } }
    : {},
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
}))
