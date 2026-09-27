import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { prepareImages } from './scripts/prepare-images.js'

// Makes the photo thumbnails and public/data/images.json before `npm run dev` / `npm run build`
function productImages() {
  let prepared
  return {
    name: 'product-images',
    async buildStart() {
      prepared ??= prepareImages()
      await prepared
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    productImages(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
