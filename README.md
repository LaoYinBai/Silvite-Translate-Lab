# Silvite Translate Lab

Experimental AI-assisted translation tool for Chinese-English translation scenarios.

## Features

- **Auto Language Detection**: Automatically detects Chinese/English and translates to the other
- **Text Translation**: Direct text input with real-time translation
- **Image Translation**: Drag & drop, paste (Ctrl+V), or upload images; auto-compressed client-side
- **Six Translation Modes**: Auto (dynamic classification), Natural, Literary, Academic, Business, Comic
- **Advanced Options**: Context, Terminology, Preserve Names, Explain Translation
- **Local Export**: PDF (browser print pipeline, searchable/copyable text) and Word (.docx)
- **Demo Samples**: Sidebar samples for offline classroom demonstration

## Architecture

```
GitHub repository
  └─ EdgeOne Pages (auto build on push)
       ├─ Static frontend  (dist/, root base path)
       └─ Edge Function    (functions/api/translate.js → POST /api/translate)
            └─ Xiaomi MiMo V2.5 (model: mimo-v2.5, fixed server-side)
```

- Frontend: React 19 + Vite + TypeScript + Tailwind CSS 4 + Zustand
- Backend: EdgeOne Pages Functions (V8 edge runtime, Web APIs only)
- The MiMo API key lives only in the Edge Function environment (`context.env.MIMO_API_KEY`).
  The frontend bundle contains no keys.
- Prompts are inlined in `functions/api/prompts.mjs` (edge runtime has no filesystem).

## Local Development

```bash
npm ci
npm run api     # local Edge Function server on :3001 (reads .env.local)
npm run dev     # Vite dev server on :5173, proxies /api → :3001
npm test        # node:test suite (15 tests)
npm run build   # tsc + vite build → dist/
```

Create `.env.local` (git-ignored via `*.local`) for local API development:

```
MIMO_API_KEY=sk-xxxx
SERVICE_ENABLED=true
RATE_LIMIT=30
```

## Deploy (EdgeOne Pages)

1. Push to GitHub (`main`).
2. In the EdgeOne Pages console, import the Git repository:
   - Framework: Vite (auto-detected)
   - Install: `npm ci`
   - Build: `npm run build`
   - Output: `dist`
3. Add environment variable `MIMO_API_KEY` in the EdgeOne project settings
   (Functions can also read `SERVICE_ENABLED`, `ALLOWED_ORIGIN`, `RATE_LIMIT`,
   `RATE_LIMIT_WINDOW_MS`, `MAX_INPUT_LENGTH`).
4. Bind your custom domain.

## Shutting Down (end of life)

Set `SERVICE_ENABLED=false` in EdgeOne environment variables and redeploy —
the API responds 503 with "experimental service is currently offline".

## License

MIT
