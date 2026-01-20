# Language Learning Subtitles Extension - Development Guide

## Development Workflow Reminders

> **TEST ON CHROME:** Always test changes directly in Chrome browser. Don't assume code works - verify it:
> 1. Reload extension at `chrome://extensions`
> 2. Refresh the target page (YLE Areena, YouTube, etc.)
> 3. Verify the feature works visually
> 4. Check browser console for errors/logs

> **IMPORTANT:** After fixing bugs that required significant debugging effort, update this CLAUDE.md file with:
> 1. The problem description
> 2. Root cause analysis
> 3. The fix location (file and line numbers)
> 4. Code snippets if helpful
>
> This prevents re-debugging the same issues in future sessions.

---

## Project Overview
A Chrome extension (v4.0.0, Manifest v3) that provides dual subtitles (original + translation), popup dictionary, and playback controls for YLE Areena, YouTube, and generic HTML5 video players.

## Directory Structure

```
yle-language-reactor/
├── Root files (main entry points)
│   ├── manifest.json         # Chrome Extension Manifest v3
│   ├── background.js         # Service worker for translation handling (~888 lines)
│   ├── contentscript.js      # Main content script (~2942 lines)
│   ├── inject.js             # Platform detector & script injector (~40 lines)
│   ├── injected.js           # WebVTT parser for YLE (~1018 lines)
│   ├── database.js           # IndexedDB word translation cache (~652 lines)
│   ├── utils.js              # Storage utilities (~60 lines)
│   ├── styles.css            # Unified styles with `dsc-*` prefix (~1320 lines)
│   ├── popup.js              # Minimal popup handler
│   └── types.js              # Type definitions
│
├── controls/                 # Unified control panel modules (~3700 lines total)
│   ├── control-panel.js      # Main ControlPanel class (~547 lines)
│   ├── control-actions.js    # Platform-agnostic action handlers (~360 lines)
│   ├── control-keyboard.js   # Unified keyboard handler (~263 lines)
│   ├── control-integration.js # Bridge to contentscript (~1241 lines)
│   ├── control-icons.js      # SVG icon definitions (~141 lines)
│   ├── audio-recorder.js     # Web Audio API recording (~539 lines)
│   ├── audio-encoder.js      # MP3 encoding using lamejs (~291 lines)
│   ├── audio-filters.js      # Speech vs non-verbal detection (~215 lines)
│   ├── audio-download-ui.js  # Download dialog UI (~334 lines)
│   └── screen-recorder.js    # Screen capture recording for DRM (~362 lines)
│
├── platforms/                # Platform-specific adapters
│   ├── platform-base.js      # Abstract base class
│   ├── yle/
│   │   ├── yle-adapter.js    # YLE Areena implementation
│   │   └── yle-injected.js   # Page-context VTT interception
│   ├── youtube/
│   │   ├── youtube-adapter.js    # YouTube implementation
│   │   └── youtube-injected.js   # Page-context timedtext API interception
│   └── html5/
│       └── html5-adapter.js  # Generic HTML5 video support
│
├── extension-options-page/   # React-based settings UI
│   ├── src/                  # React source
│   ├── dist/                 # Built files
│   └── package.json          # Build config
│
├── lib/
│   └── lamejs.min.js         # MP3 encoding library
│
└── icons/
    └── icon.png              # Extension icon
```

## Architecture

### GUIDING PRINCIPLE: Unified Interface, Platform-Specific Translation Only

**CRITICAL:** Keep a unified interface and controls across ALL platforms. Only adjust the translation/adapter layers, NOT the control logic.

### GUIDING PRINCIPLE: Bug Fixes Must Respect the Architecture

**BEFORE FIXING ANY BUG, ASK:**

1. **Where does this fix belong?**
   - Is it a UI/control issue? → Fix in unified `controls/` modules
   - Is it a platform-specific issue? → Fix in platform adapter or platform section of contentscript.js
   - Is it a translation/subtitle issue? → Check if it affects all platforms or just one

2. **Am I adding platform-specific code to unified modules?**
   - ❌ NEVER add `ytCurrentSubtitles`, `YouTubeAdapter`, or YouTube-specific logic to `control-integration.js`, `control-panel.js`, `control-actions.js`
   - ❌ NEVER add YLE-specific selectors or logic to unified modules
   - ✅ Use platform-agnostic variables like `fullSubtitles`, `subtitleTimestamps`
   - ✅ Use the adapter pattern: call `ControlActions.getVideoElement(platform)` not `document.querySelector('video.html5-main-video')`

3. **Will this fix work on ALL platforms?**
   - If fixing in unified code, test on YLE, YouTube, AND HTML5
   - If it only works on one platform, it belongs in platform-specific code

**WRONG approach:**
```javascript
// In control-integration.js (UNIFIED)
if (typeof ytCurrentSubtitles !== 'undefined') {  // ❌ YouTube-specific!
  this.setSubtitles(ytCurrentSubtitles);
}
```

**RIGHT approach:**
```javascript
// In control-integration.js (UNIFIED)
if (typeof fullSubtitles !== 'undefined') {  // ✅ Platform-agnostic
  this.setSubtitles(fullSubtitles);
}
```

```
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED LAYER (ONE implementation)       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ControlPanel │  │ControlActions│  │ControlIntegration│   │
│  │  (UI)       │  │ (skip/repeat │  │   (bridge)       │    │
│  │             │  │  /autopause) │  │                  │    │
│  └─────────────┘  └─────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                    Events & Callbacks
                              │
┌─────────────────────────────────────────────────────────────┐
│              TRANSLATION LAYER (platform-specific)          │
│  ┌──────────┐    ┌───────────────┐    ┌─────────────┐      │
│  │YLE Adapter│    │YouTube Adapter│    │HTML5 Adapter│      │
│  │-getVideo()│    │-getVideo()    │    │-getVideo()  │      │
│  │-mount()   │    │-mount()       │    │-mount()     │      │
│  │-subtitles │    │-subtitles     │    │-subtitles   │      │
│  └──────────┘    └───────────────┘    └─────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**Rules:**
1. **ControlActions** is the ONLY place for action logic (skip, repeat, speed, auto-pause)
2. **ControlIntegration** is the ONLY bridge between controls and contentscript
3. **Platform adapters** ONLY provide: video element, subtitle data, mount points, keyboard config
4. **contentscript.js** should NOT have platform-specific control logic
5. **Fix once, works everywhere** - if you fix a bug, it should work on ALL platforms automatically

### Manifest Configuration (v3)

| Platform | URL Match | Adapters Loaded | Special Handling |
|----------|-----------|-----------------|------------------|
| **YLE** | `https://areena.yle.fi/*` | YLE adapter + screen recorder | inject.js for VTT interception |
| **YouTube** | `https://www.youtube.com/*` | YouTube adapter | inject.js for timedtext interception |
| **HTML5** | `<all_urls>` (excluded YLE/YouTube) | HTML5 adapter | No inject.js needed |

### Control Modules Detail

**control-panel.js** - Main ControlPanel class
- Single implementation for all platforms
- Manages UI state (dualSubEnabled, autoPauseEnabled, speed, language)
- Handles mount/unmount to platform-specific locations

**control-actions.js** - Platform-agnostic action handlers
- `togglePlayPause()` - Play/pause video
- `skipToPreviousSubtitle()` - Navigate to prev subtitle
- `skipToNextSubtitle()` - Navigate to next subtitle
- `repeatCurrentSubtitle()` - Play subtitle segment loop
- `setPlaybackSpeed()` - Speed control (0.5x - 2.0x)
- `getVideoElement(platform)` - Platform-specific video selector

**control-keyboard.js** - Unified keyboard handler
- `ControlKeyboard` class with unified key bindings
- Platform-specific configuration (capture phase for YouTube)

**control-integration.js** - Bridge to contentscript
- Manages subtitle data: `_subtitles` array (with startTime/endTime)
- State management: loads/saves to Chrome storage.sync
- Audio download handlers (recorder + screen capture)
- Handles all callbacks from ControlPanel

**control-icons.js** - SVG icon definitions (18x18 viewBox)
- Icons: settings, previous, next, repeat, warning, speed, play, pause, subtitles, language, autoPause, download

### Platform Adapters

Each adapter provides:
- `isMatch()` - Detect if this adapter should run
- `isVideoPage()` - Check if on a video page
- `getVideoElement()` - Selector for video element
- `getControlPanelMountConfig()` - Where to insert controls UI
- `getKeyboardConfig()` - Platform-specific keyboard settings
- `SELECTORS` - DOM selectors for the platform

| Platform | Hostname | Source Lang | Controls Mount | Keyboard | Subtitle Selector |
|----------|----------|-------------|----------------|----------|-------------------|
| **YLE** | `areena.yle.fi` | Finnish (FI) | `[class^="BottomControlBar__LeftControls"]` | Standard | `[data-testid="subtitles-wrapper"]` |
| **YouTube** | `www.youtube.com` | English (en) | `.ytp-left-controls` | **Capture phase** | `.ytp-caption-window-container` |
| **HTML5** | Any | Auto-detect | Floating overlay | Standard | `textTracks` API |

### GENERAL Features (must work on ALL platforms the same way)

| Feature | Behavior | Location |
|---------|----------|----------|
| Clickable original text | ALWAYS shown, even when dual sub OFF | `addContentToDisplayedSubtitlesWrapper`, `displayYouTubeSubtitle` |
| Translation line | Only shown when dual sub ON | Same functions, check `dualSubEnabled` |
| Word popup dictionary | Click any word -> translation popup | `createSubtitleSpanWithClickableWords` |
| Skip prev/next | Jump to previous/next subtitle | `ControlActions.skipToPreviousSubtitle/skipToNextSubtitle` |
| Repeat | Play from subtitle start to current position | `ControlActions.repeatCurrentSubtitle` |
| Auto-pause | Pause after each subtitle change | Check `isSkippingSubtitle`, `isRepeatingSubtitle` flags |
| Speed control | 0.5x - 2.0x playback | `ControlActions.setPlaybackSpeed` |

### Subtitle Processing Pipeline

**Detection & Interception:**
- YLE: Page-context VTT interception via `yle-injected.js`
- YouTube: Page-context timedtext API interception via `youtube-injected.js`
- HTML5: Direct TextTrack API monitoring (content script)

**Main Processing (contentscript.js):**
1. MutationObserver watches subtitle wrapper
2. Batch translation (~2-4 subtitles at a time for YLE)
3. Accumulates into `fullSubtitles` array (CRITICAL: must accumulate, not replace)
4. Maps original -> translated text
5. Displays in dual-line format when enabled

**Key Arrays Maintained:**
- `subtitleTimestamps` - Quick lookup for skip/repeat (time, text)
- `fullSubtitles` - Complete array with startTime/endTime for repeat feature
- `sharedTranslationMap` - Cache of translations

### Audio Download Pipeline

**Files Involved:**
- `audio-recorder.js` - Records from Web Audio API (standard videos)
- `screen-recorder.js` - Records screen/tab with audio (DRM videos like YLE)
- `audio-filters.js` - Removes non-verbal segments (music, effects)
- `audio-encoder.js` - Encodes to MP3 using lamejs
- `audio-download-ui.js` - Shows progress and download UI

**Flow:**
1. User presses `A` or clicks download button
2. `ControlIntegration._handleDownloadAudio()` called
3. For YLE: Use ScreenRecorder (DRM protection)
4. For YouTube/HTML5: Use AudioRecorder (Web Audio API)
5. Extract speech segments using AudioFilters
6. Encode to MP3 using lamejs
7. Trigger chrome.downloads API via background.js

### Core Scripts

**background.js** - Service worker (Manifest v3)
- Message handlers: `fetchTranslation`, `fetchBatchTranslation`, `translateWordWithContext`, `clearWordCache`, `downloadBlob`
- Translation provider management (Google, DeepL, Claude, Gemini, xAI)
- Listens to `chrome.storage.onChanged` for provider updates

**contentscript.js** - Main content script
- Platform detection and initialization
- Subtitle observation and display
- Translation request batching
- Word click handlers (popup dictionary)
- Auto-pause logic
- Integration with ControlIntegration

**database.js** - IndexedDB wrapper
- Schema: `{word, context, translation, provider, timestamp}`
- Methods: `addWordTranslation()`, `getWordTranslation()`, `clearOldCache()`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `D` | Toggle dual subtitles |
| `,` | Previous subtitle |
| `.` | Next subtitle |
| `R` | Repeat current subtitle |
| `P` | Toggle auto-pause |
| `[` | Decrease speed |
| `]` | Increase speed |
| `A` | Download audio (screen recording on YLE) |
| `Space` | Play/Pause (YouTube/HTML5 only) |

## Translation Providers

Configured in extension options:
- Google Translate (free, default)
- DeepL (free/pro API)
- Claude AI (Anthropic)
- Gemini (Google)
- xAI (Grok)

---

## Critical Learnings

### 1. YLE Menu Focus Issue (IMPORTANT)
**Problem:** YLE's settings menus (Audio/Subtitles) close immediately when clicked.

**Root Cause:** In `contentscript.js`, there's a click handler that calls `setTimeout(focusVideo, 100)` after clicks on the control bar area. This steals focus from YLE's menus.

**Solution (lines ~1448-1457 in contentscript.js):**
```javascript
// Don't focus video when clicking on YLE settings buttons or menus
if (target.closest('[class*="SettingsButton"]') ||
    target.closest('[class*="Settings__"]') ||
    target.closest('[class*="TopLevelSettings"]') ||
    target.closest('[aria-label*="Tekstitykset"]') ||
    target.closest('[aria-label*="Asetukset"]') ||
    target.closest('[aria-label*="Ääni"]')) {
  return;
}
```

### 2. YLE Subtitles Requirement
YLE's native subtitles MUST be enabled through their player UI first. Our extension intercepts and enhances them - it doesn't create subtitles from scratch.

- Subtitles wrapper selector: `[data-testid="subtitles-wrapper"]`
- MutationObserver watches for changes to this wrapper
- When `dualSubEnabled` is true, original wrapper is hidden, displayed wrapper shows clickable words + translation

### 3. YouTube Keyboard Handling
YouTube requires `useCapture: true` for keyboard event listeners to intercept before YouTube's own handlers. See `control-keyboard.js` line 54.

### 4. Extension Reload Required
Chrome extensions do NOT auto-reload when source files change. After editing:
1. Go to `chrome://extensions`
2. Find the extension and click reload
3. Refresh the target page

### 5. Control Panel Mount Points
Each platform has a `getControlPanelMountConfig()` method:
- **YLE:** Appends to `[class^="BottomControlBar__LeftControls"]`
- **YouTube:** Appends to `.ytp-left-controls`
- **HTML5:** Floating overlay on video parent

### 6. Subtitle Navigation (Skip/Repeat) - CRITICAL
For skip prev/next/repeat to work, subtitles must be synced to `ControlIntegration`.

**Subtitle Accumulation Issue:**

YLE loads subtitles in small batches (2-4 at a time) via `handleBatchTranslation()`. The repeat function needs ALL subtitles with `startTime` and `endTime` to work properly.

**Problem:** If you call `ControlIntegration.setSubtitles(currentBatch)` with each batch, it REPLACES the previous subtitles. The repeat function then only sees the latest small batch (2-4 subtitles) instead of all 90+ subtitles.

**Solution:** Use `fullSubtitles` array that ACCUMULATES like `subtitleTimestamps`:
```javascript
// In handleBatchTranslation() - ACCUMULATE, don't replace
for (const sub of subtitles) {
  if (sub.startTime !== undefined && sub.endTime !== undefined) {
    const existing = fullSubtitles.find(fs => Math.abs(fs.startTime - sub.startTime) < 0.5);
    if (!existing) {
      fullSubtitles.push({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text });
    }
  }
}
fullSubtitles.sort((a, b) => a.startTime - b.startTime);

// Sync ACCUMULATED array, not current batch
ControlIntegration.setSubtitles(fullSubtitles);
```

**Key locations:**
- `fullSubtitles` array declared at ~line 316-320 in contentscript.js
- YLE: `handleBatchTranslation()` accumulates into `fullSubtitles` (~line 488-513)
- YouTube: Initial load at `youtubeSubtitlesLoaded` handler (~line 2577-2591)
- Clear arrays in `loadMovieCacheAndUpdateMetadata()` and YouTube navigation handler

### 7. YLE Mouse Activity
YLE hides controls on mouse inactivity. To show controls programmatically:
```javascript
const playerUI = document.querySelector('[class*="PlayerUI"]');
playerUI.classList.add('yle-mouse-active');
```

### 8. YLE Video Overlay Closes When Showing Modals (IMPORTANT)
**Problem:** On YLE, clicking buttons that show modal dialogs (like the audio download confirmation) would close the video overlay, returning to the series page.

**Root Cause:** YLE's video player opens as an overlay on the series page (URL stays the same). When our extension appends modal elements to `document.body`, YLE interprets this DOM manipulation as a signal to close the video overlay.

**Key Discovery:**
- Keyboard shortcuts that don't show modals work fine (video stays open)
- Button clicks that trigger modal creation close the video
- Even programmatic DOM appends to `document.body` trigger this behavior

**Solution (in `control-integration.js`):**
For YLE platform, skip showing any custom modals and go directly to the action:
```javascript
async _handleDownloadAudio() {
  // YLE uses DRM protection - offer screen recording instead
  if (this._platform === 'yle') {
    // On YLE, showing any modal closes the video overlay
    // So we skip the confirmation and go directly to screen recording
    const video = ControlActions.getVideoElement(this._platform);
    if (!video) {
      console.error('DualSubExtension: No video found');
      return;
    }

    // Start recording directly without modal
    await this._startYLERecording(video, speechSegments);
    return;
  }
  // ... show modal for other platforms
}
```

**Key files:**
- `controls/control-integration.js` - `_handleDownloadAudio()` and `_startYLERecording()`
- Keyboard shortcut "A" triggers the same code path

### 9. YouTube Subtitle Overlay Can Be Removed by DOM Updates
**Problem:** YouTube may re-render its player (during ads, fullscreen transitions, etc.), which removes our subtitle overlay. The `displayYouTubeSubtitle()` function would silently return if the wrapper doesn't exist, causing subtitles to stop showing.

**Solution (in `contentscript.js`):**
Added `ensureYouTubeSubtitleOverlay()` function that recreates the overlay if it's been removed:
```javascript
function ensureYouTubeSubtitleOverlay() {
  let wrapper = document.getElementById('displayed-subtitles-wrapper');
  if (wrapper) return wrapper;

  // Overlay was removed - recreate it
  const player = YouTubeAdapter.getPlayerContainer();
  if (!player) return null;

  const overlay = YouTubeAdapter.createSubtitleOverlay();
  const subtitleWrapper = YouTubeAdapter.createSubtitleDisplayWrapper();
  overlay.appendChild(subtitleWrapper);
  YouTubeAdapter.positionSubtitleOverlay(overlay);

  return subtitleWrapper;
}
```

### 10. Manifest V3 Service Worker Termination
**Problem:** Chrome can terminate the background service worker at any time to save resources. If a translation request is pending when this happens, the content script receives "message channel closed before a response was received" error, causing translations to fail.

**Solution (in `contentscript.js`):**
Added retry logic to `fetchTranslation()` and `fetchBatchTranslation()`:
```javascript
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    const response = await safeSendMessage({...});
    if (response === null && attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY);  // Wait for service worker to restart
      continue;
    }
    return response;
  } catch (error) {
    const isServiceWorkerError = error.message?.includes('message channel closed');
    if (isServiceWorkerError && attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY);
      continue;
    }
  }
}
```

### 11. Subtitle Sync Timing for Audio Download
**Problem:** The "Please wait for subtitles to load" error appears even when subtitles are loaded, because they weren't synced to `ControlIntegration._subtitles` due to timing issues (subtitles load before ControlIntegration initializes, or the sync happens but gets missed).

**Root Cause:** Same as Critical Learning #6 - subtitles must be synced to ControlIntegration. Race conditions between subtitle loading and ControlIntegration initialization can cause the sync to be skipped.

**Solution (in `control-integration.js` `_handleDownloadAudio()`):**
Added fallback sync from the platform-agnostic `fullSubtitles` array:
```javascript
if (!this._subtitles || this._subtitles.length === 0) {
  // Fallback: try to sync from global fullSubtitles array
  // NOTE: Only use fullSubtitles - it's platform-agnostic (used by YLE, YouTube, HTML5)
  // Do NOT add platform-specific variables to unified modules!
  if (typeof fullSubtitles !== 'undefined' && fullSubtitles.length > 0) {
    this.setSubtitles(fullSubtitles);
  }
}
```

**IMPORTANT:** This fallback only uses `fullSubtitles` because it's the platform-agnostic array that ALL platforms populate. Never add platform-specific variables (like `ytCurrentSubtitles`) to unified control modules - that violates the architecture principle.

**Key insight:** Always ensure multiple sync points for subtitles:
1. When subtitles load (if ControlIntegration is ready)
2. When ControlIntegration initializes (if subtitles already loaded)
3. As fallback before features that need subtitles (download, repeat, etc.)

---

## Common Issues & Debugging

### Subtitles not showing
1. Check if YLE native subtitles are enabled (via their menu)
2. Check if `dualSubEnabled` is true
3. Verify `[data-testid="subtitles-wrapper"]` exists and has content
4. Check console for MutationObserver activity

### Skip/Repeat not working
1. Verify subtitles are loaded into ControlIntegration
2. Check `ControlIntegration._subtitles` array has data
3. Ensure video element is accessible via `ControlActions.getVideoElement(platform)`

### Menu closes immediately
See "YLE Menu Focus Issue" above - likely focusVideo() stealing focus.

### Audio download not working
1. Check if DRM content (YLE) - must use screen recording
2. Verify Web Audio API access for non-DRM content
3. Check console for lamejs encoding errors

---

## Testing Checklist

### YLE Areena
- [ ] Dual subtitle toggle
- [ ] Auto-pause on subtitle change
- [ ] Skip previous/next subtitle
- [ ] Repeat current subtitle
- [ ] Playback speed control (0.5x - 2.0x)
- [ ] Word click popup dictionary
- [ ] Screen recording audio download
- [ ] Settings menus don't close unexpectedly

### YouTube
- [ ] All above features
- [ ] Keyboard shortcuts work (capture phase)
- [ ] Shorts page handling

### HTML5 (Generic)
- [ ] All above features
- [ ] Floating control panel positioning

### All Platforms
- [ ] Keyboard shortcuts (D, comma, period, R, P, [, ], A, Space)
- [ ] Translation providers (Google, DeepL, Claude, Gemini, xAI)
- [ ] Extension options page

---

## Key Statistics

| Category | Count |
|----------|-------|
| Total Lines of Code | ~9,900 |
| Platform Adapters | 3 (YLE, YouTube, HTML5) |
| Control Modules | 10 |
| Keyboard Shortcuts | 9 |
| Translation Providers | 5 |
| Chrome API Permissions | storage, downloads |

---

## Violations to Clean Up (Technical Debt)

- `contentscript.js` has duplicate auto-pause logic for YLE vs YouTube
- `contentscript.js` has legacy skip/repeat functions that should be removed
- Platform-specific keyboard handlers should use unified `ControlKeyboard`
