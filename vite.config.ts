import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'
import { createReadStream, existsSync, statSync } from 'node:fs'
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

// ONNX imports its runtime module dynamically. Serve generated assets directly
// in dev too, including models prepared after the dev server was started.
function localASRAssets(): Plugin {
  return {
    name: 'local-asr-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? '').split('?')[0]
        if (!url.startsWith('/asr/')) return next()
        const assetRoot = path.join(server.config.publicDir, 'asr')
        const filePath = path.resolve(assetRoot, url.slice('/asr/'.length))
        if (!filePath.startsWith(`${assetRoot}${path.sep}`) || !existsSync(filePath)) return next()
        const stat = statSync(filePath)
        if (!stat.isFile()) return next()
        const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' }
        response.setHeader('Content-Type', mime[path.extname(filePath) as keyof typeof mime] ?? 'application/octet-stream')
        response.setHeader('Content-Length', stat.size)
        if (request.method === 'HEAD') return response.end()
        createReadStream(filePath).pipe(response)
      })
    },
  }
}

// Root base path: deployed via EdgeOne Pages custom domain, not GitHub Pages subpath.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pdfjsAssets(),
    localASRAssets(),
  ],
  base: '/',
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    watch: { ignored: ['**/public/whisper/**', '**/.cache/whisper/**', '**/public/asr/**', '**/.cache/sherpa/**'] },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
