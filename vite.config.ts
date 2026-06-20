import { defineConfig } from 'vite'
export default defineConfig({
  base: '/',
  build: { target: 'esnext' },
  // Force a single three.js instance — globe.gl bundles its own copy, and a second
  // three breaks our custom ShaderMaterial/TextureLoader (textures never upload).
  resolve: { dedupe: ['three'] },
})
