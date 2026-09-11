import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'
import { createReadStream, existsSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import path from 'node:path'

// pdf.js loads CMaps, standard fonts, wasm decoders and ICC profiles as
// separate files at runtime (see PDFJS_ASSET_BASE in fileParser.ts). Missing
// them makes CID-keyed CJK fonts lose their text silently, so they are served
// from node_modules in dev and copied into the build output.
const PDFJS_ASSET_BASE = '/pdfjs/'
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
const PDFJS_ROOT = path.resolve(
  path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs')),
  '..',
  '..',
)

const ASSET_MIME_TYPES: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

function pdfjsAssets(): Plugin {
  let outDir = 'dist'
  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? '').split('?')[0]
        if (!url.startsWith(PDFJS_ASSET_BASE)) return next()
        const filePath = path.join(PDFJS_ROOT, url.slice(PDFJS_ASSET_BASE.length))
        if (!filePath.startsWith(PDFJS_ROOT) || !existsSync(filePath)) return next()
        response.setHeader('Content-Type', ASSET_MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream')
        createReadStream(filePath).pipe(response)
      })
    },
    async closeBundle() {
      const target = path.join(outDir, 'pdfjs')
      for (const directory of PDFJS_ASSET_DIRS) {
        await cp(path.join(PDFJS_ROOT, directory), path.join(target, directory), { recursive: true })
      }
    },
  }
}

// Root base path: deployed via EdgeOne Pages custom domain, not GitHub Pages subpath.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pdfjsAssets(),
  ],
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
