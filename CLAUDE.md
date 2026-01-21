# Language Learning Subtitles Extension - Development Guide

## Development Workflow Reminders

> **TEST ON CHROME:** Always test changes directly in Chrome browser. Don't assume code works - verify it:
> 1. Reload extension at `chrome://extensions`
> 2. Refresh the target page (YLE Areena)
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
A Chrome extension (v5.0.0, Manifest v3) that provides dual subtitles (original + translation), popup dictionary, and playback controls for YLE Areena (Finnish public broadcasting).

**Chrome Web Store:** Submitted January 2026 (pending review)

**Supported Platform:** YLE Areena only (`https://areena.yle.fi/*`)

## Directory Structure

```
yle-language-reactor/
├── Root files (main entry points)
│   ├── manifest.json         # Chrome Extension Manifest v3
│   ├── background.js         # Service worker for translation handling
│   ├── contentscript.js      # Main content script (YLE-specific)
│   ├── inject.js             # Script injector for YLE
│   ├── database.js           # IndexedDB word translation cache
│   ├── utils.js              # Storage utilities
│   ├── styles.css            # Unified styles with `dsc-*` prefix
│   ├── popup.js              # Minimal popup handler
│   └── types.js              # Type definitions
│
├── controls/                 # Control panel modules
│   ├── control-panel.js      # Main ControlPanel class
│   ├── control-actions.js    # Action handlers (skip/repeat/speed)
│   ├── control-keyboard.js   # Keyboard handler
│   ├── control-integration.js # Bridge to contentscript
│   ├── control-icons.js      # SVG icon definitions
│   ├── audio-recorder.js     # Web Audio API recording
│   ├── audio-encoder.js      # MP3 encoding using lamejs
│   ├── audio-filters.js      # Speech vs non-verbal detection
│   ├── audio-download-ui.js  # Download dialog UI
│   └── screen-recorder.js    # Screen capture recording for DRM
│
├── platforms/yle/            # YLE-specific adapter
│   ├── yle-adapter.js        # YLE Areena implementation
│   └── yle-injected.js       # Page-context VTT interception
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

### Control Modules Detail

**control-panel.js** - Main ControlPanel class
- Manages UI state (dualSubEnabled, autoPauseEnabled, speed, language)
- Handles mount/unmount to YLE's control bar

**control-actions.js** - Action handlers
- `togglePlayPause()` - Play/pause video
- `skipToPreviousSubtitle()` - Navigate to prev subtitle
- `skipToNextSubtitle()` - Navigate to next subtitle
- `repeatCurrentSubtitle()` - Play subtitle segment loop
- `setPlaybackSpeed()` - Speed control (0.5x - 2.0x)
- `getVideoElement()` - Get video element

**control-keyboard.js** - Keyboard handler
- `ControlKeyboard` class with unified key bindings

**control-integration.js** - Bridge to contentscript
- Manages subtitle data: `_subtitles` array (with startTime/endTime)
- State management: loads/saves to Chrome storage.sync
- Audio download handlers (screen capture for YLE's DRM)
- Handles all callbacks from ControlPanel

**control-icons.js** - SVG icon definitions (18x18 viewBox)
- Icons: settings, previous, next, repeat, warning, speed, play, pause, subtitles, language, autoPause, download

### YLE Configuration

| Setting | Value |
|---------|-------|
| URL Match | `https://areena.yle.fi/*` |
| Source Language | Finnish (FI) - auto-detected |
| Controls Mount | `[class^="BottomControlBar__LeftControls"]` |
| Subtitle Selector | `[data-testid="subtitles-wrapper"]` |
| Audio Download | Screen recording (DRM protection) |

### Features

| Feature | Behavior | Location |
|---------|----------|----------|
| Clickable original text | ALWAYS shown, even when dual sub OFF | `addContentToDisplayedSubtitlesWrapper` |
| Translation line | Only shown when dual sub ON | Same function, check `dualSubEnabled` |
| Word popup dictionary | Click any word -> translation popup | `createSubtitleSpanWithClickableWords` |
| Skip prev/next | Jump to previous/next subtitle | `ControlActions.skipToPreviousSubtitle/skipToNextSubtitle` |
| Repeat | Play from subtitle start to current position | `ControlActions.repeatCurrentSubtitle` |
| Auto-pause | Pause after each subtitle change | Check `isSkippingSubtitle`, `isRepeatingSubtitle` flags |
| Speed control | 0.5x - 2.0x playback | `ControlActions.setPlaybackSpeed` |

### Subtitle Processing Pipeline

**Detection & Interception:**
- Page-context VTT interception via `yle-injected.js`

**Main Processing (contentscript.js):**
1. MutationObserver watches subtitle wrapper
2. Batch translation (~2-4 subtitles at a time)
3. Accumulates into `fullSubtitles` array (CRITICAL: must accumulate, not replace)
4. Maps original -> translated text
5. Displays in dual-line format when enabled

**Key Arrays Maintained:**
- `subtitleTimestamps` - Quick lookup for skip/repeat (time, text)
- `fullSubtitles` - Complete array with startTime/endTime for repeat feature
- `sharedTranslationMap` - Cache of translations

### Audio Download Pipeline

**Files Involved:**
- `screen-recorder.js` - Records screen/tab with audio (YLE uses DRM)
- `audio-filters.js` - Removes non-verbal segments (music, effects)
- `audio-encoder.js` - Encodes to MP3 using lamejs
- `audio-download-ui.js` - Shows progress and download UI

**Flow:**
1. User presses `A` or clicks download button
2. `ControlIntegration._handleDownloadAudio()` called
3. Use ScreenRecorder (YLE has DRM protection)
4. Extract speech segments using AudioFilters
5. Encode to MP3 using lamejs
6. Trigger chrome.downloads API via background.js

### Core Scripts

**background.js** - Service worker (Manifest v3)
- Message handlers: `fetchTranslation`, `fetchBatchTranslation`, `translateWordWithContext`, `clearWordCache`, `downloadBlob`
- Translation provider management (Google, DeepL, Claude, Gemini, xAI)
- Listens to `chrome.storage.onChanged` for provider updates

**contentscript.js** - Main content script
- YLE-specific initialization
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
| `A` | Download audio (screen recording) |

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

### 3. Extension Reload Required
Chrome extensions do NOT auto-reload when source files change. After editing:
1. Go to `chrome://extensions`
2. Find the extension and click reload
3. Refresh the target page

### 4. Control Panel Mount Point
YLE control panel mounts to `[class^="BottomControlBar__LeftControls"]`

### 5. Subtitle Navigation (Skip/Repeat) - CRITICAL
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

### 6. YLE Mouse Activity
YLE hides controls on mouse inactivity. To show controls programmatically:
```javascript
const playerUI = document.querySelector('[class*="PlayerUI"]');
playerUI.classList.add('yle-mouse-active');
```

### 7. YLE Video Overlay Closes When Showing Modals (IMPORTANT)
**Problem:** On YLE, clicking buttons that show modal dialogs (like the audio download confirmation) would close the video overlay, returning to the series page.

**Root Cause:** YLE's video player opens as an overlay on the series page (URL stays the same). When our extension appends modal elements to `document.body`, YLE interprets this DOM manipulation as a signal to close the video overlay.

**Solution (in `control-integration.js`):**
For YLE, skip showing any custom modals and go directly to the action:
```javascript
async _handleDownloadAudio() {
  // YLE uses DRM protection - go directly to screen recording
  // Showing any modal closes the video overlay
  const video = ControlActions.getVideoElement();
  if (!video) {
    console.error('DualSubExtension: No video found');
    return;
  }

  // Start recording directly without modal
  await this._startYLERecording(video, speechSegments);
}
```

### 8. Manifest V3 Service Worker Termination
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

### 9. Subtitle Sync Timing for Audio Download (IMPORTANT - REGRESSION PRONE)
**Problem:** The "Please wait for subtitles to load" error appears even when subtitles are loaded, because they weren't synced to `ControlIntegration._subtitles`.

**Root Cause:** The sync calls had an `isInitialized()` check:
```javascript
// WRONG - this was the bug
if (typeof ControlIntegration !== 'undefined' && ControlIntegration.isInitialized()) {
  ControlIntegration.setSubtitles(fullSubtitles);  // Never called if panel not mounted!
}
```
`isInitialized()` requires the panel to be MOUNTED, but `setSubtitles()` just stores data - it doesn't need the panel. When panel mount was delayed (retry pending), subtitles never got synced.

**Solution:**
1. Remove `isInitialized()` check from all `setSubtitles` calls:
```javascript
// CORRECT - just check if ControlIntegration exists
if (typeof ControlIntegration !== 'undefined') {
  ControlIntegration.setSubtitles(fullSubtitles);
}
```

2. Export `fullSubtitles` to window for cross-module access:
```javascript
const fullSubtitles = [];
window.fullSubtitles = fullSubtitles;  // For fallback access from control-integration.js
```

**Key insight:** `setSubtitles()` just stores data - don't guard it with UI-dependent checks like `isInitialized()`.

### 10. Array Reference Bug in setSubtitles (CRITICAL)
**Problem:** Even after `setSubtitles(fullSubtitles)` was called, `_subtitles` would be empty when download was triggered.

**Root Cause:** `setSubtitles` stored a REFERENCE to the array, not a copy:
```javascript
// WRONG - stores reference
this._subtitles = subtitles;
```
When the navigation handler later did `fullSubtitles.length = 0`, it cleared the SAME array that `_subtitles` pointed to!

**Solution:** Deep copy the array in `setSubtitles()`:
```javascript
// CORRECT - stores a copy
this._subtitles = subtitles.map(sub => ({ ...sub }));
```

**Key insight:** When storing arrays that may be modified elsewhere, ALWAYS copy them. Watch out for `.length = 0` pattern which clears arrays in-place.

### 11. Extension Context Invalidated Error (PENDING FIX)
**Problem:** After switching tabs or changing language settings, the extension panel stops working. Console shows "Extension context invalidated" errors.

**Root Cause:** When the extension is reloaded (manually or via Chrome update), the content scripts on already-open pages keep running but lose access to `chrome.*` APIs. Any call to `chrome.storage.sync.get()`, `chrome.runtime.sendMessage()`, etc. will throw "Extension context invalidated".

**Symptoms:**
- "DualSubExtension: Error loading preferences: Error: Extension context invalidated"
- "Uncaught Error: Extension context invalidated"
- "Google Translate fetch error: Failed to fetch"
- Panel doesn't respond to keyboard shortcuts
- Translations stop loading

**Workaround:** Refresh the page after the extension is reloaded.

### 12. Same Language Mode Disabling ALL Controls (Session 2026-01-20)
**Problem:** With source=target language (Finnish→Finnish), ALL control panel features were disabled (skip/repeat/speed/download grayed out), not just the DS (Dual Subtitles) toggle.

**Root Cause:** In `control-panel.js`, the `featuresDisabled` logic incorrectly used `isActive`:
```javascript
// Line 258 - WRONG
const featuresDisabled = !extensionEnabled || !isActive;
```

When same language is detected, `isActive` becomes `false` (because translation isn't needed), which caused ALL features to be disabled. But playback features (skip/repeat/speed/download) should work even when translation isn't needed.

**Solution:** Only consider `extensionEnabled` for disabling features:
```javascript
// Line 258-260 - CORRECT
// Features (skip/repeat/speed/download) are only disabled when extension is OFF
// NOT when same language - user should still be able to use playback features
const featuresDisabled = !extensionEnabled;
```

### 13. Events Module Using ControlPanel Class Instead of Instance (Session 2026-01-21)
**Problem:** The extension switch was always disabled even when CC was on and subtitles were detected.

**Root Cause:** In `events.js`, the `_updateUI()` method was checking `ControlPanel._mounted` and calling `ControlPanel.updateFromState()`, but `ControlPanel` is a CLASS - the actual panel instance is stored in `ControlIntegration._panel`.

**Solution (events.js):**
```javascript
// CORRECT - Use the actual panel instance from ControlIntegration
if (typeof ControlIntegration !== 'undefined' && ControlIntegration._panel && ControlIntegration._panel._mounted) {
  ControlIntegration._panel.updateFromState({...});
}
```

### 14. YLE CC Off Not Detected - Wrapper Hidden Instead of Removed (Session 2026-01-21)
**Problem:** The extension toggle wasn't disabled when CC was turned off. The toggle should be grayed out when there are no subtitles to process.

**Root Cause:** The MutationObserver only watched for `removedNodes` to detect CC being turned off. But YLE doesn't REMOVE the subtitles-wrapper when CC is turned off - it just HIDES it (`display: none`). Since the element was still in the DOM, `yleSubtitlesGone` was never dispatched.

**Solution (contentscript.js):**
Use a **dedicated** observer only on the subtitles-wrapper element:
```javascript
// Separate observer ONLY for the subtitles-wrapper element
function setupSubtitlesWrapperStyleObserver(wrapper) {
  subtitlesWrapperObserver = new MutationObserver((mutations) => {
    // Handle style changes on just this element
  });

  // Observe ONLY this specific element's attributes
  subtitlesWrapperObserver.observe(wrapper, {
    attributes: true,
    attributeFilter: ['style']
  });
}
```

**Key insight:** MutationObserver performance depends on WHAT you observe. Observing attributes on the entire document is almost always a mistake. Target specific elements.

### 15. Property Name Mismatch Between Modules - captionsEnabled vs ccEnabled (Session 2026-01-21)
**Problem:** The panel wasn't disabled when CC was turned off, even after adding CC detection logic.

**Root Cause:** Property name mismatch between modules:
- `ControlIntegration` passed `captionsEnabled: true/false`
- `ControlPanel` expected `ccEnabled: true/false`

**Solution (control-integration.js):**
```javascript
// BEFORE - wrong property name
captionsEnabled: this._state.captionsEnabled,

// AFTER - correct property name
ccEnabled: this._state.captionsEnabled,  // Note: panel uses ccEnabled, not captionsEnabled
```

**Key insight:** When integrating modules, verify that property names match between caller and callee.

### 16. Missing Initial CC Status Detection on Page Load (Session 2026-01-21)
**Problem:** When the page loaded with CC already OFF, the State module's `ccStatus` was `false` (correct), but the panel was created before State was initialized, so it used the default value.

**Solution (contentscript.js):**
Added initial CC detection in `initializeStateAndEvents()`:
```javascript
// Initial CC status detection for YLE
// The MutationObserver only catches CHANGES, so we need to check the initial state
const wrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
if (wrapper) {
  const computedDisplay = getComputedStyle(wrapper).display;
  const isVisible = computedDisplay !== 'none';
  State.setCCStatus(isVisible);
} else {
  State.setCCStatus(false);
}
```

**Key insight:** Observers/listeners only catch changes, not initial state. Always check the initial state at startup.

### 17. Failed Translations Being Cached as Original Text (Session 2026-01-22)
**Problem:** When translation API calls failed (network error, rate limit, etc.), the extension would fall back to showing the original Finnish text AND cache it as the "translation". This meant the text would never be retried.

**Root Cause:** In `background.js`, the batch translation function returned the original text on error:
```javascript
// WRONG - caches original text as "translation"
if (!response.ok) {
  translations.push(text);  // Original text cached as translation!
  continue;
}
```

**Solution (background.js):**
Return `null` for failed translations so they can be retried:
```javascript
// CORRECT - return null so it will be retried
if (!response.ok) {
  translations.push(null);
  continue;
}
```

And in `contentscript.js`, skip null translations:
```javascript
// Skip failed translations (null) - they will be retried next time
if (translatedText === null || translatedText === undefined) {
  console.info(`Translation failed for "${text.substring(0, 30)}..." - will retry later`);
  continue;
}
```

**Key insight:** Don't cache failures. Return a sentinel value (null) that callers can check, and let the retry logic handle it.

---

## Debugging Methodology

### Debugging Checklist for Subtitle Issues
1. **Check if data is loaded**: Look for console logs showing subtitle count
2. **Check if data is synced**: Look for `setSubtitles called with X subtitles`
3. **Check if data persists**: When the feature is triggered, is the data still there?
4. **Trace the data flow**: Where is the array created? Where is it modified? Who else has a reference?

### Common JavaScript Pitfalls in This Codebase

**1. Array References vs Copies**
```javascript
// WRONG - stores reference, clearing source clears this too
this._subtitles = subtitles;

// CORRECT - stores independent copy
this._subtitles = subtitles.map(sub => ({ ...sub }));
```

**2. Clearing Arrays In-Place**
```javascript
// This clears ALL references to the array!
fullSubtitles.length = 0;

// If you did this earlier:
this._subtitles = fullSubtitles;  // Same reference!
// Now _subtitles is also empty!
```

**3. Conditional Guards That Are Too Strict**
```javascript
// WRONG - isInitialized() requires UI to be mounted
if (ControlIntegration.isInitialized()) {
  ControlIntegration.setSubtitles(data);  // Never called if UI pending!
}

// CORRECT - setSubtitles just stores data, doesn't need UI
if (typeof ControlIntegration !== 'undefined') {
  ControlIntegration.setSubtitles(data);
}
```

**4. Cross-Module Variable Access**
```javascript
// Variables in contentscript.js aren't automatically visible in control-integration.js
// Export to window if needed:
const fullSubtitles = [];
window.fullSubtitles = fullSubtitles;  // Now accessible as window.fullSubtitles
```

### Key Questions When Debugging
1. **Is the data there?** (console.log the array length)
2. **Is it the same array?** (reference vs copy issue)
3. **Who else modifies it?** (search for `.length = 0`, `.splice()`, `= []`)
4. **When is it cleared?** (navigation handlers, cleanup functions)
5. **Is the timing right?** (async operations, race conditions)

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
3. Ensure video element is accessible via `ControlActions.getVideoElement()`

### Menu closes immediately
See "YLE Menu Focus Issue" above - likely focusVideo() stealing focus.

### Audio download not working
1. YLE uses DRM - must use screen recording
2. Check console for lamejs encoding errors

---

## Testing Checklist

### YLE Areena
- [ ] Dual subtitle toggle (D key)
- [ ] Auto-pause on subtitle change (P key)
- [ ] Skip previous/next subtitle (comma/period)
- [ ] Repeat current subtitle (R key)
- [ ] Playback speed control ([ and ] keys)
- [ ] Word click popup dictionary
- [ ] Screen recording audio download (A key)
- [ ] Settings menus don't close unexpectedly
- [ ] Extension toggle enables/disables correctly
- [ ] CC on/off correctly enables/disables extension toggle

### Cache Management
- [ ] Word cache count displays correctly in options page
- [ ] Subtitle cache count displays correctly
- [ ] Clear word cache works
- [ ] Clear subtitle cache works

### Language Switch Test
1. [ ] Target=English → dual sub ON, translations showing
2. [ ] Change target to Simplified Chinese → dual sub should still work
3. [ ] Change target to Finnish (same as source) → dual sub should auto-disable
4. [ ] Change target back to English → verify dual sub re-enables automatically

### Error Handling
- [ ] Extension options page loads and saves correctly
- [ ] No console errors on page load
- [ ] No "Extension context invalidated" after reload (refresh page)

---

## Key Statistics

| Category | Count |
|----------|-------|
| Total Lines of Code | ~5,500 |
| Platform | YLE Areena only |
| Control Modules | 10 |
| Keyboard Shortcuts | 8 |
| Translation Providers | 5 |
| Chrome API Permissions | storage, downloads |
