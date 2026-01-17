# Finnish Language Learning for YLE Areena

A Chrome extension that transforms YLE Areena into an immersive Finnish language learning platform. Display dual subtitles, click any word for instant translation, and control playback to study at your own pace.

## Features

- **Dual Subtitles**: Finnish subtitles with translations in your target language displayed below
- **Popup Dictionary**: Click any Finnish word to see its translation
  - Wiktionary definitions when available
  - AI-powered contextual translation as fallback (Claude/Gemini/Grok)
  - "Ask AI" button for alternative translations
- **Auto-Pause**: Automatically pause after each subtitle line (toggle with P key)
- **Subtitle Navigation**: Skip to previous/next subtitle with `,` and `.` keys
- **Playback Speed Control**: Adjust from 1x to 2x in 0.25x increments
- **Multiple Translation Providers**:
  - Google Translate (free, no API key required)
  - DeepL (high quality, free API key available)
  - Claude, Gemini, Grok (AI-powered with context)
- **Smart Caching**: Translations cached locally for instant replay
- **Clean Viewing Mode**: Controls hide during playback, appear on mouse movement
- **Fullscreen Support**: All features work in fullscreen mode

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `,` | Skip to previous subtitle |
| `.` | Skip to next subtitle |
| `P` | Toggle auto-pause |
| `Space` | Play/pause video |

## Installation

### Chrome Web Store
*Coming soon*

### Manual Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

## Setup

1. Go to [YLE Areena](https://areena.yle.fi/)
2. Play any video with Finnish subtitles
3. Enable "Dual Sub" in the video controls
4. (Optional) Click the extension icon → Settings to:
   - Choose your target language
   - Select translation provider
   - Add API keys for premium providers

### Translation Providers

| Provider | API Key Required | Best For |
|----------|-----------------|----------|
| Google Translate | No | Quick setup, basic translations |
| DeepL | Yes (free tier available) | High-quality translations |
| Claude | Yes | Context-aware word lookups |
| Gemini | Yes | Context-aware word lookups |
| Grok | Yes | Context-aware word lookups |

## How It Works

1. Extension intercepts YLE Areena's subtitle data (WebVTT format)
2. Finnish subtitles are displayed with translations below
3. Clicking a word queries Wiktionary, then falls back to AI translation
4. All translations are cached locally in IndexedDB

## Development

### Project Structure

```
├── manifest.json           # Chrome extension manifest (v3)
├── background.js           # Service worker for API calls
├── contentscript.js        # Main content script
├── injected.js            # Page context script
├── database.js            # IndexedDB caching
├── styles.css             # UI styling
├── popup.html/js          # Extension popup
└── extension-options-page/ # React settings page
```

### Building

```bash
# Build the options page
cd extension-options-page
npm install
npm run build
```

### Testing

Load the extension in developer mode and test on YLE Areena.

## Privacy

- All caching is local (IndexedDB in your browser)
- API keys stored in Chrome sync storage
- No analytics or tracking
- Only sends data to your chosen translation provider

## Contributing

Contributions welcome! Please open issues for bugs or feature requests.

## License

GPL v3 (GNU General Public License v3)

## Acknowledgments

- Inspired by [Language Reactor](https://www.languagereactor.com/)
- [Wiktionary](https://en.wiktionary.org/) for word definitions
- [YLE Areena](https://areena.yle.fi/) for Finnish content
