# Silvite Translate Lab

Experimental AI-assisted translation tool for Chinese-English translation scenarios.

## Features

- **Auto Language Detection**: Automatically detects Chinese/English and translates to the other
- **Text Translation**: Direct text input with real-time translation
- **Image Translation**: Drag & drop, paste, or upload images for translation
- **Translation Modes**: Auto, Natural, Literary, Academic, Business, Comic
- **Advanced Options**: Context, Terminology, Preserve Names, Explain Translation
- **Demo Mode**: Pre-loaded samples for demonstration

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Environment Variables

Create a `.env.local` file for local development:

```bash
MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
SERVICE_ENABLED=true
```

### Deploy to GitHub Pages

1. Push to GitHub
2. Go to Settings > Pages
3. Select "GitHub Actions" as source
4. The workflow will automatically deploy on push to main

### Deploy Serverless Backend

The `api/translate.ts` file can be deployed to:
- Vercel Functions
- Cloudflare Workers
- Netlify Functions

Set the environment variables in your hosting platform.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + Design Tokens
- **State**: Zustand
- **AI Model**: Xiaomi MiMo V2.5
- **Deployment**: GitHub Pages + Serverless Functions

## Project Structure

```
silvite-translate-lab/
├── api/                    # Serverless functions
│   └── translate.ts        # Translation API endpoint
├── public/                 # Static assets
├── src/
│   ├── api/               # API client
│   ├── components/        # React components
│   │   ├── Layout/        # Header
│   │   ├── SourcePanel/   # Input area
│   │   ├── Toolbar/       # Mode/settings bar
│   │   └── TranslationPanel/ # Output area
│   ├── demo/              # Demo samples
│   ├── store/             # State management
│   ├── App.tsx            # Main app
│   └── main.tsx           # Entry point
├── tokens.css             # Design system tokens
└── DESIGN.md              # Design documentation
```

## License

MIT
