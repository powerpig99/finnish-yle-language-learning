# YLE Finnish Learner

A Chrome extension for learning Finnish through YLE Areena (Finnish public broadcasting). Display dual subtitles, click any word for instant translation, and control playback to study at your own pace.

## Currently Supported

- **YLE Areena** (areena.yle.fi) - Finnish public broadcasting with Finnish subtitles

> **Note:** This extension currently supports YLE Areena only. Support for additional platforms (YouTube, Netflix, etc.) is planned for future releases.

## Features

- **Dual Subtitles**: Original subtitles with translations in your target language displayed below
- **Popup Dictionary**: Click any word to see its translation
  - Wiktionary definitions when available
  - AI-powered contextual translation as fallback (Claude/Gemini/Grok)
  - "Ask AI" button for alternative translations
- **Auto-Pause**: Automatically pause after each subtitle line (toggle with P key)
- **Subtitle Navigation**: Skip to previous/next subtitle with `,` and `.` keys
- **Repeat**: Replay current subtitle from the beginning (R key)
- **Playback Speed Control**: Adjust from 0.5x to 2x with `[` and `]` keys
- **Audio Download**: Download speech audio with filler sounds removed (A key)
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
| `D` | Toggle dual subtitles |
| `,` | Skip to previous subtitle |
| `.` | Skip to next subtitle |
| `R` | Repeat current subtitle |
| `P` | Toggle auto-pause |
| `[` | Decrease playback speed |
| `]` | Increase playback speed |
| `A` | Download audio (speech only) |
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

### YLE Areena
1. Go to [YLE Areena](https://areena.yle.fi/)
2. Play any video and enable Finnish subtitles via the player's subtitle menu
3. Enable "Dual Sub" in the control bar
4. Click any word to see its translation

### Settings
Click the extension icon → Settings to:
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

1. Extension intercepts subtitle data from YLE Areena (WebVTT format)
2. Original subtitles are displayed with translations below
3. Clicking a word queries Wiktionary, then falls back to AI translation
4. All translations are cached locally in IndexedDB

## Development

### Project Structure

```
├── manifest.json           # Chrome extension manifest (v3)
├── background.js           # Service worker for API calls
├── contentscript.js        # Main content script
├── database.js             # IndexedDB caching
├── styles.css              # UI styling
├── popup.html/js           # Extension popup
├── platforms/
│   └── yle/                # YLE Areena adapter
├── controls/               # Unified control panel
│   ├── control-panel.js    # UI components
│   ├── control-actions.js  # Action handlers
│   ├── control-keyboard.js # Keyboard shortcuts
│   └── audio-*.js          # Audio recording/download
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

- Originally forked from [yle-dual-sub](https://github.com/anhtumai/yle-dual-sub) by Anh Tu Mai
- Inspired by [Language Reactor](https://www.languagereactor.com/)
- [Wiktionary](https://en.wiktionary.org/) for word definitions
- [YLE Areena](https://areena.yle.fi/) for Finnish content
