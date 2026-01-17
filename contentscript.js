// ==================================
// SECTION 1: STATE & INITIALIZATION
// ==================================

/* global loadTargetLanguageFromChromeStorageSync, loadSelectedTokenFromChromeStorageSync */
/* global openDatabase, saveSubtitlesBatch, loadSubtitlesByMovieName, upsertMovieMetadata, cleanupOldMovieData */
/* global getWordTranslation, saveWordTranslation, cleanupOldWordTranslations, clearAllWordTranslations */

/**
 * Check if the extension context is still valid
 * @returns {boolean}
 */
function isExtensionContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id !== undefined;
  } catch {
    return false;
  }
}

/**
 * Safely send a message to the background script
 * Handles cases where the extension context is invalidated
 * @param {Object} message - The message to send
 * @returns {Promise<any>} - The response or null if context is invalid
 */
async function safeSendMessage(message) {
  if (!isExtensionContextValid()) {
    console.warn('YleDualSubExtension: Extension context invalidated, message not sent');
    return null;
  }

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (error.message?.includes('Extension context invalidated') ||
        error.message?.includes('message port closed')) {
      console.warn('YleDualSubExtension: Extension context invalidated');
      return null;
    }
    throw error;
  }
}

/** @type {Map<string, string>}
 * Shared translation map, with key is normalized Finnish text, and value is translated text
 */
const sharedTranslationMap = new Map();
/** @type {Map<string, string>} */
const sharedTranslationErrorMap = new Map();

/**
 *
 * @param {string} rawSubtitleFinnishText
 * @returns {string}
 */
function toTranslationKey(rawSubtitleFinnishText) {
  return rawSubtitleFinnishText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// State of target_language (cached from chrome storage sync)
let targetLanguage = "EN-US";
loadTargetLanguageFromChromeStorageSync().then((loadedTargetLanguage) => {
  targetLanguage = loadedTargetLanguage;
}).catch((error) => {
  console.error("YleDualSubExtension: Error loading target language from storage:", error);
});

// State of Dual Sub Switch, to manage whether to add display subtitles wrapper
let dualSubEnabled = false;
let dualSubPreferenceLoaded = false;

/**
 * Load dual sub preference from Chrome storage
 * @returns {Promise<boolean>} - The loaded preference value
 */
async function loadDualSubPreference() {
  try {
    const result = await chrome.storage.sync.get("dualSubEnabled");
    if (result && typeof result.dualSubEnabled === 'boolean') {
      dualSubEnabled = result.dualSubEnabled;
      console.log("YleDualSubExtension: Loaded dual sub preference:", dualSubEnabled);
    } else {
      console.log("YleDualSubExtension: No dual sub preference found in storage, using default:", dualSubEnabled);
    }
    dualSubPreferenceLoaded = true;
    // Update checkbox if it exists
    const dualSubSwitch = document.getElementById("dual-sub-switch");
    if (dualSubSwitch) {
      dualSubSwitch.checked = dualSubEnabled;
    }
    return dualSubEnabled;
  } catch (error) {
    console.warn("YleDualSubExtension: Error loading dual sub preference:", error);
    dualSubPreferenceLoaded = true;
    return dualSubEnabled;
  }
}

// Load dual sub preference on startup
loadDualSubPreference();

// State of Auto-Pause feature
let autoPauseEnabled = false;

// State of Playback Speed (1x to 2x in 0.25 steps)
let playbackSpeed = 1.0;

// Load saved playback speed from chrome storage
chrome.storage.sync.get(['playbackSpeed'], (result) => {
  if (result.playbackSpeed) {
    playbackSpeed = result.playbackSpeed;
    applyPlaybackSpeed();
  }
});

/**
 * Apply the current playback speed to the video element
 */
function applyPlaybackSpeed() {
  const video = document.querySelector('video');
  if (video && video.playbackRate !== playbackSpeed) {
    video.playbackRate = playbackSpeed;
  }
}

/**
 * Save playback speed to chrome storage
 * @param {number} speed - The playback speed to save
 */
function savePlaybackSpeed(speed) {
  playbackSpeed = speed;
  chrome.storage.sync.set({ playbackSpeed: speed });
  applyPlaybackSpeed();
}

// Track video element to reapply speed on new videos
let lastVideoElement = null;

/**
 * Setup speed control for video element
 */
function setupVideoSpeedControl() {
  const video = document.querySelector('video');
  if (video && video !== lastVideoElement) {
    lastVideoElement = video;
    applyPlaybackSpeed();
    // Reapply when video metadata loads (new video)
    video.addEventListener('loadedmetadata', applyPlaybackSpeed);
    video.addEventListener('play', applyPlaybackSpeed, { once: true });
  }
}

// Initial setup after a short delay
setTimeout(setupVideoSpeedControl, 500);

// Track the last subtitle text to detect changes for auto-pause
let lastSubtitleText = "";

// Flag to temporarily disable auto-pause during subtitle skipping
let isSkippingSubtitle = false;

/** @type {Array<{time: number, text: string}>}
 * Array of subtitle appearances with their video timestamps
 * Used for skip to next/previous subtitle feature
 */
const subtitleTimestamps = [];

/** @type {Map<string, string>}
 * In-memory cache for word translations, key is normalized word, value is translation
 */
const wordTranslationCache = new Map();

/** @type {HTMLElement | null}
 * Reference to the currently visible tooltip element
 */
let activeTooltip = null;

/** @type {HTMLElement | null}
 * Reference to the currently active word element
 */
let activeWordElement = null;

/**
 * @type {string | null}
 * Memory cached current movie name
 */
let currentMovieName = null;

/**
 * @type {IDBDatabase | null}
 * Memory cached current database connection to write data to Index DB
 */
let globalDatabaseInstance = null;
openDatabase().then(db => {
  globalDatabaseInstance = db;

  cleanupOldMovieData(db).then((cleanCount) => {
    console.info(`YleDualSubExtension: Clean ${cleanCount} movies data`);
  }).catch(error => { console.error("YleDualSubExtension: Error when cleaning old movie data: ", error) });
}).
  catch((error) => {
    console.error("YleDualSubExtension: Failed to established connection to indexDB: ", error);
  })

// ==================================
// END SECTION
// ==================================

// ==================================
// SECTION 2: TRANSLATION QUEUE
// ==================================

class TranslationQueue {
  /* Queue to manage translation requests to avoid hitting rate limits */

  BATCH_MAXIMUM_SIZE = 7;
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * @param {string} rawSubtitleFinnishText - Finnish text to translate
   * @returns {void}
   */
  addToQueue(rawSubtitleFinnishText) {
    this.queue.push(rawSubtitleFinnishText);
  }

  /**
   * Process the translation queue in batches
   * By sending to background.js to handle translation and store results in
   * sharedTranslationMap or sharedTranslationErrorMap
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) { return; }

    while (this.queue.length > 0 && dualSubEnabled) {
      this.isProcessing = true;

      /** @type {Array<string>} */
      const toProcessItems = [];
      for (let i = 0; i < Math.min(this.queue.length, this.BATCH_MAXIMUM_SIZE); i++) {
        toProcessItems.push(this.queue.shift());
      }

      try {
        console.log("YleDualSubExtension: Sending translation request for", toProcessItems.length, "items");
        const [isSucceeded, translationResponse] = await fetchTranslation(toProcessItems);
        console.log("YleDualSubExtension: Translation response - success:", isSucceeded, "response:", typeof translationResponse);

        if (isSucceeded) {
          const translatedTexts = translationResponse;
          /**
           * @type {Array<SubtitleRecord>}
           */
          const toCacheSubtitleRecords = [];
          for (let i = 0; i < toProcessItems.length; i++) {
            const translatedText = translatedTexts[i];
            const rawSubtitleFinnishText = toProcessItems[i];
            const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);
            const sharedTranslationMapValue = translatedText.trim().replace(/\n/g, ' ');
            sharedTranslationMap.set(
              sharedTranslationMapKey,
              sharedTranslationMapValue,
            );
            if (currentMovieName) {
              toCacheSubtitleRecords.push({
                "movieName": currentMovieName,
                "originalLanguage": "FI",
                targetLanguage,
                "originalText": sharedTranslationMapKey,
                "translatedText": sharedTranslationMapValue,
              })
            }
          }
          if (globalDatabaseInstance) {
            saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords)
              .then(() => { })
              .catch((error) => {
                console.error("YleDualSubExtension: Error saving subtitles batch to cache:", error);
              });
          }
        }
        else {
          const translationErrorMessage = translationResponse;
          for (let i = 0; i < toProcessItems.length; i++) {
            const rawSubtitleFinnishText = toProcessItems[i];
            sharedTranslationErrorMap.set(
              toTranslationKey(rawSubtitleFinnishText),
              `Error: ${translationErrorMessage}`
            );
          }
        }

      } catch (error) {
        console.error("YleDualSubExtension: System error when translating text:", error);
        // Record error for all items in this batch so they don't stay as "Translating..."
        for (const rawText of toProcessItems) {
          const key = toTranslationKey(rawText);
          if (!sharedTranslationMap.has(key) && !sharedTranslationErrorMap.has(key)) {
            sharedTranslationErrorMap.set(key, rawText); // Fall back to original text
          }
        }
      }
    }

    this.isProcessing = false;
  }
}

const translationQueue = new TranslationQueue();

// Batch translation state
let isBatchTranslating = false;
let batchTranslationProgress = { current: 0, total: 0 };

/**
 * Handle batch translation of all subtitles with context
 * @param {Array<{text: string, startTime: number, endTime: number}>} subtitles - All subtitles with timing
 * @returns {Promise<void>}
 */
async function handleBatchTranslation(subtitles) {
  // Set flag IMMEDIATELY to block individual event processing
  if (isBatchTranslating) {
    console.info("YleDualSubExtension: Batch translation already in progress, skipping...");
    return;
  }
  isBatchTranslating = true;

  console.info(`YleDualSubExtension: Received ${subtitles.length} total subtitles for batch translation`);

  // Pre-populate ALL subtitle timestamps for skip feature FIRST (before any early returns)
  for (const sub of subtitles) {
    if (sub.startTime !== undefined) {
      const existingTimestamp = subtitleTimestamps.find(ts => Math.abs(ts.time - sub.startTime) < 0.5);
      if (!existingTimestamp) {
        subtitleTimestamps.push({ time: sub.startTime, text: sub.text });
      }
    }
  }
  subtitleTimestamps.sort((a, b) => a.time - b.time);
  console.info(`YleDualSubExtension: Pre-populated ${subtitleTimestamps.length} subtitle timestamps for skip feature`);

  // Filter out subtitles that are already translated (from cache)
  const untranslatedSubtitles = subtitles.filter(sub => {
    const key = toTranslationKey(sub.text);
    return !sharedTranslationMap.has(key) && !sharedTranslationErrorMap.has(key);
  });

  if (untranslatedSubtitles.length === 0) {
    console.info("YleDualSubExtension: All subtitles already cached, no batch translation needed");
    isBatchTranslating = false;
    return;
  }

  console.info(`YleDualSubExtension: Starting batch translation of ${untranslatedSubtitles.length} untranslated subtitles (${subtitles.length - untranslatedSubtitles.length} already cached)`);
  batchTranslationProgress = { current: 0, total: untranslatedSubtitles.length };

  showBatchTranslationIndicator();

  // Process in chunks of 10 for better reliability with Google Translate
  const CHUNK_SIZE = 10;
  const chunks = [];
  for (let i = 0; i < untranslatedSubtitles.length; i += CHUNK_SIZE) {
    chunks.push(untranslatedSubtitles.slice(i, i + CHUNK_SIZE));
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const texts = chunk.map(sub => sub.text);

    // Add delay between chunks to avoid rate limiting
    if (chunkIndex > 0) {
      await sleep(500);
    }

    try {
      const [isSucceeded, translationResponse] = await fetchBatchTranslation(texts);

      if (isSucceeded) {
        const translatedTexts = translationResponse;
        const toCacheSubtitleRecords = [];

        for (let i = 0; i < texts.length; i++) {
          const translatedText = translatedTexts[i] || texts[i];
          const rawSubtitleFinnishText = texts[i];
          const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);
          const sharedTranslationMapValue = translatedText.trim().replace(/\n/g, ' ');

          sharedTranslationMap.set(sharedTranslationMapKey, sharedTranslationMapValue);

          // Also populate subtitle timestamps for skip feature
          const subtitleData = chunk[i];
          if (subtitleData && subtitleData.startTime !== undefined) {
            const existingTimestamp = subtitleTimestamps.find(
              ts => Math.abs(ts.time - subtitleData.startTime) < 0.5
            );
            if (!existingTimestamp) {
              subtitleTimestamps.push({ time: subtitleData.startTime, text: rawSubtitleFinnishText });
            }
          }

          if (currentMovieName) {
            toCacheSubtitleRecords.push({
              movieName: currentMovieName,
              originalLanguage: "FI",
              targetLanguage,
              originalText: sharedTranslationMapKey,
              translatedText: sharedTranslationMapValue,
            });
          }
        }

        // Save to cache
        if (globalDatabaseInstance && toCacheSubtitleRecords.length > 0) {
          saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords).catch((error) => {
            console.error("YleDualSubExtension: Error saving batch to cache:", error);
          });
        }
      } else {
        console.error("YleDualSubExtension: Batch translation error:", translationResponse);
        // Record failed translations so they don't stay as "Translating..."
        for (const text of texts) {
          const key = toTranslationKey(text);
          if (!sharedTranslationMap.has(key) && !sharedTranslationErrorMap.has(key)) {
            sharedTranslationErrorMap.set(key, text); // Fall back to original text
          }
        }
      }
    } catch (error) {
      console.error("YleDualSubExtension: Error in batch translation chunk:", error);
      // Record failed translations so they don't stay as "Translating..."
      for (const text of texts) {
        const key = toTranslationKey(text);
        if (!sharedTranslationMap.has(key) && !sharedTranslationErrorMap.has(key)) {
          sharedTranslationErrorMap.set(key, text); // Fall back to original text
        }
      }
    }

    batchTranslationProgress.current += chunk.length;
    updateBatchTranslationIndicator();
  }

  // Sort subtitle timestamps after batch population
  subtitleTimestamps.sort((a, b) => a.time - b.time);

  isBatchTranslating = false;
  hideBatchTranslationIndicator();
  console.info("YleDualSubExtension: Batch translation completed");
}

/**
 * Fetch batch translation with context from background script
 * @param {Array<string>} texts - Texts to translate
 * @returns {Promise<[true, Array<string>]|[false, string]>}
 */
async function fetchBatchTranslation(texts) {
  try {
    const response = await safeSendMessage({
      action: 'fetchBatchTranslation',
      data: { texts, targetLanguage, isContextual: true }
    });
    if (response === null) {
      return [false, 'Extension context invalidated'];
    }
    return response;
  } catch (error) {
    console.error("YleDualSubExtension: Error sending batch translation request:", error);
    return [false, error.message || String(error)];
  }
}

/**
 * Show batch translation loading indicator
 */
function showBatchTranslationIndicator() {
  let indicator = document.getElementById('batch-translation-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'batch-translation-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    indicator.innerHTML = `
      <div style="width: 20px; height: 20px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <div>
        <div style="font-weight: 600;">Pre-translating subtitles...</div>
        <div id="batch-progress-text" style="font-size: 12px; opacity: 0.8; margin-top: 4px;">0 / 0</div>
      </div>
    `;

    // Add spinner animation
    const style = document.createElement('style');
    style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);

    document.body.appendChild(indicator);
  }
  indicator.style.display = 'flex';
  updateBatchTranslationIndicator();
}

/**
 * Update batch translation progress indicator
 */
function updateBatchTranslationIndicator() {
  const progressText = document.getElementById('batch-progress-text');
  if (progressText) {
    progressText.textContent = `${batchTranslationProgress.current} / ${batchTranslationProgress.total} subtitles`;
  }
}

/**
 * Hide batch translation loading indicator
 */
function hideBatchTranslationIndicator() {
  const indicator = document.getElementById('batch-translation-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

/**
 *
 * @param {Array<string>} rawSubtitleFinnishTexts - Finnish text to translate
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.

 */
async function fetchTranslation(rawSubtitleFinnishTexts) {
  try {
    /**
     * @type {[true, Array<string>] | [false, string] | null}
     */
    const response = await safeSendMessage({
      action: 'fetchTranslation',
      data: { rawSubtitleFinnishTexts, targetLanguage }
    });
    if (response === null) {
      return [false, 'Extension context invalidated'];
    }
    return response;
  } catch (error) {
    console.error("YleDualSubExtension: Error sending message to background for translation:", error);
    return [false, error.message || String(error)];
  }
}

// ==================================
// END SECTION
// ==================================


// ==================================
// SECTION 3: UI MANIPULATION UTILS
// ==================================


/**
 * Create another div for displaying translated subtitles,
 * which inherits class name from original subtitles wrapper.
 * When the extension is turned on, the original subtitles wrapper will stay hidden
 * while this displayed subtitles wrapper will be shown.
 * 
 * Because, we need to listen to mutations on original subtitles wrapper,
 * so we want to avoid modifying it directly, which can trigger mutation observer recursively.
 * @param {string} className - class name to set for the new div 
 * @returns {HTMLDivElement} - new subtitles wrapper div to be displayed
 */
function copySubtitlesWrapper(className) {
  const displayedSubtitlesWrapper = document.createElement("div");
  displayedSubtitlesWrapper.setAttribute("aria-live", "polite");
  displayedSubtitlesWrapper.setAttribute("class", className);
  displayedSubtitlesWrapper.setAttribute("id", "displayed-subtitles-wrapper");
  return displayedSubtitlesWrapper;
}

/**
 *
 * Create a span element for subtitle text.
 *
 * @param {string} text - text content of the span
 * @param {string} className - class name to set for the span
 * @returns {HTMLSpanElement} - created span element to display
 */
function createSubtitleSpan(text, className) {
  const span = document.createElement("span");
  span.setAttribute("class", className);
  span.textContent = text;
  return span;
}

// ==================================
// SECTION 3.5: POPUP DICTIONARY
// ==================================

/**
 * Tokenize text into words and non-word characters
 * @param {string} text - Text to tokenize
 * @returns {Array<{type: 'word' | 'separator', value: string}>} - Array of tokens
 */
function tokenizeText(text) {
  const tokens = [];
  // Match Finnish words (including umlauts) or non-word characters
  const regex = /([a-zA-ZäöåÄÖÅ]+)|([^a-zA-ZäöåÄÖÅ]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      tokens.push({ type: 'word', value: match[1] });
    } else if (match[2]) {
      tokens.push({ type: 'separator', value: match[2] });
    }
  }
  return tokens;
}

/** @type {string[]} - Recent subtitle lines for context (max 10) */
const recentSubtitleLines = [];
const MAX_RECENT_SUBTITLES = 10;

/**
 * Track a subtitle line for context
 * @param {string} text - The subtitle text
 */
function trackSubtitleForContext(text) {
  const normalized = text.trim();
  if (normalized && recentSubtitleLines[recentSubtitleLines.length - 1] !== normalized) {
    recentSubtitleLines.push(normalized);
    if (recentSubtitleLines.length > MAX_RECENT_SUBTITLES) {
      recentSubtitleLines.shift();
    }
  }
}

/**
 * Get context for word translation (surrounding subtitles)
 * @param {string} currentSubtitle - The subtitle containing the word
 * @returns {{current: string, before: string[], after: string[]}}
 */
function getSubtitleContext(currentSubtitle) {
  const currentIndex = recentSubtitleLines.findIndex(s => s.includes(currentSubtitle) || currentSubtitle.includes(s));
  const before = [];
  const after = [];

  if (currentIndex >= 0) {
    // Get 2 lines before
    for (let i = Math.max(0, currentIndex - 2); i < currentIndex; i++) {
      before.push(recentSubtitleLines[i]);
    }
    // Get 2 lines after (if available)
    for (let i = currentIndex + 1; i < Math.min(recentSubtitleLines.length, currentIndex + 3); i++) {
      after.push(recentSubtitleLines[i]);
    }
  }

  return { current: currentSubtitle, before, after };
}

/**
 * Create a subtitle span with clickable words for popup dictionary
 * @param {string} text - The subtitle text
 * @param {string} className - Base class name for the span
 * @returns {HTMLSpanElement} - Span element with clickable words
 */
function createSubtitleSpanWithClickableWords(text, className) {
  const span = document.createElement("span");
  span.setAttribute("class", className);

  // Track this subtitle for context
  trackSubtitleForContext(text);

  const tokens = tokenizeText(text);
  for (const token of tokens) {
    if (token.type === 'word' && token.value.length > 1) {
      const wordSpan = document.createElement("span");
      wordSpan.className = "word-item";
      wordSpan.textContent = token.value;
      wordSpan.dataset.word = token.value;
      wordSpan.dataset.subtitle = text; // Store the full subtitle for context
      wordSpan.addEventListener("click", handleWordClick);
      span.appendChild(wordSpan);
    } else {
      span.appendChild(document.createTextNode(token.value));
    }
  }

  return span;
}

/**
 * Handle click on a word to show translation tooltip
 * @param {MouseEvent} event
 */
function handleWordClick(event) {
  event.stopPropagation();
  const wordElement = event.target;
  const word = wordElement.dataset.word;
  const subtitle = wordElement.dataset.subtitle || '';

  if (!word) return;

  // If clicking the same word, hide tooltip
  if (activeWordElement === wordElement && activeTooltip) {
    hideTooltip();
    return;
  }

  // Get context from surrounding subtitles
  const context = getSubtitleContext(subtitle);

  // Show tooltip for this word with context
  showWordTooltip(word, wordElement, context);
}

/**
 * Show tooltip with word translation
 * @param {string} word - The word to translate
 * @param {HTMLElement} wordElement - The word element to position tooltip near
 * @param {{current: string, before: string[], after: string[]}} context - Subtitle context
 */
async function showWordTooltip(word, wordElement, context) {
  // Hide any existing tooltip
  hideTooltip();

  // Mark word as active
  activeWordElement = wordElement;
  wordElement.classList.add("active");

  // Create tooltip with Wiktionary link placeholder
  const wiktionaryUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}#Finnish`;
  const tooltip = document.createElement("div");
  tooltip.className = "word-tooltip";
  tooltip.innerHTML = `
    <div class="word-tooltip__original">${escapeHtml(word)}</div>
    <div class="word-tooltip__translation word-tooltip__loading">Looking up...</div>
    <div class="word-tooltip__source"></div>
    <div class="word-tooltip__actions" style="display: none;">
      <button type="button" class="word-tooltip__btn word-tooltip__ask-ai">Ask AI</button>
    </div>
    <a class="word-tooltip__link" href="${wiktionaryUrl}" target="_blank" rel="noopener">View on Wiktionary →</a>
  `;

  // In fullscreen mode, append to the fullscreen element; otherwise append to body
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  const tooltipContainer = fullscreenElement || document.body;
  tooltipContainer.appendChild(tooltip);
  activeTooltip = tooltip;

  // Position tooltip
  positionTooltip(tooltip, wordElement);

  // Make tooltip visible
  requestAnimationFrame(() => {
    tooltip.classList.add("visible");
  });

  // Set up "Ask AI" button handler
  const askAiBtn = tooltip.querySelector(".word-tooltip__ask-ai");

  // Stop all event propagation to prevent YLE's handlers from triggering navigation
  const stopAllPropagation = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  askAiBtn.addEventListener("mousedown", stopAllPropagation, true);
  askAiBtn.addEventListener("pointerdown", stopAllPropagation, true);
  askAiBtn.addEventListener("mouseup", stopAllPropagation, true);
  askAiBtn.addEventListener("pointerup", stopAllPropagation, true);

  askAiBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const translationEl = tooltip.querySelector(".word-tooltip__translation");
    const sourceEl = tooltip.querySelector(".word-tooltip__source");
    const actionsEl = tooltip.querySelector(".word-tooltip__actions");

    // Show loading state
    translationEl.textContent = "Asking AI...";
    translationEl.classList.add("word-tooltip__loading");
    actionsEl.style.display = "none";

    try {
      const llmResult = await translateWordWithLLM(word, context);
      if (activeTooltip === tooltip) {
        translationEl.classList.remove("word-tooltip__loading");
        translationEl.textContent = llmResult;
        sourceEl.textContent = '(AI translation with context)';
        sourceEl.style.cssText = 'font-size: 10px; color: #9ca3af; margin-top: 4px;';

        // Update cache with AI translation
        const cacheKey = `${word.toLowerCase().trim()}:${targetLanguage}`;
        wordTranslationCache.set(cacheKey, llmResult);
        if (globalDatabaseInstance) {
          saveWordTranslation(globalDatabaseInstance, word.toLowerCase().trim(), targetLanguage, llmResult)
            .catch(err => console.warn("YleDualSubExtension: Error caching AI word translation:", err));
        }
      }
    } catch (error) {
      if (activeTooltip === tooltip) {
        translationEl.classList.remove("word-tooltip__loading");
        translationEl.classList.add("word-tooltip__error");
        translationEl.textContent = error.message || "AI translation failed";
      }
    }
  });

  // Get translation (Wiktionary first, then LLM fallback with context)
  try {
    const result = await translateWord(word, context);
    if (activeTooltip === tooltip) {
      const translationEl = tooltip.querySelector(".word-tooltip__translation");
      const sourceEl = tooltip.querySelector(".word-tooltip__source");
      const actionsEl = tooltip.querySelector(".word-tooltip__actions");
      translationEl.classList.remove("word-tooltip__loading");
      translationEl.textContent = result.translation;

      if (result.source === 'llm') {
        sourceEl.textContent = '(AI translation with context)';
        sourceEl.style.cssText = 'font-size: 10px; color: #9ca3af; margin-top: 4px;';
        // Hide Wiktionary link since the word wasn't found there
        const linkEl = tooltip.querySelector(".word-tooltip__link");
        if (linkEl) {
          linkEl.style.display = 'none';
        }
      } else {
        // Show "Ask AI" button for Wiktionary/cache results
        actionsEl.style.display = "flex";
      }
    }
  } catch (error) {
    console.error("YleDualSubExtension: Error looking up word:", error);
    if (activeTooltip === tooltip) {
      const translationEl = tooltip.querySelector(".word-tooltip__translation");
      const actionsEl = tooltip.querySelector(".word-tooltip__actions");
      translationEl.classList.remove("word-tooltip__loading");
      translationEl.classList.add("word-tooltip__error");
      translationEl.textContent = error.message || "Translation failed";
      // Show "Ask AI" button as fallback option
      actionsEl.style.display = "flex";
    }
  }
}

/**
 * Position tooltip near the word element
 * @param {HTMLElement} tooltip
 * @param {HTMLElement} wordElement
 */
function positionTooltip(tooltip, wordElement) {
  const rect = wordElement.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  // Position above the word by default
  let top = rect.top - tooltipRect.height - 10;
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

  // If tooltip would go above viewport, position below
  if (top < 10) {
    top = rect.bottom + 10;
  }

  // Keep tooltip within horizontal bounds
  if (left < 10) {
    left = 10;
  } else if (left + tooltipRect.width > window.innerWidth - 10) {
    left = window.innerWidth - tooltipRect.width - 10;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

/**
 * Hide the active tooltip
 */
function hideTooltip() {
  if (activeTooltip) {
    activeTooltip.classList.remove("visible");
    setTimeout(() => {
      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }
    }, 200);
  }
  if (activeWordElement) {
    activeWordElement.classList.remove("active");
    activeWordElement = null;
  }
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if a cached translation looks like a bad/error response
 * @param {string} translation - The cached translation
 * @returns {boolean} - True if the translation looks invalid
 */
function isInvalidCachedTranslation(translation) {
  if (!translation || typeof translation !== 'string') return true;
  // Clean the translation first
  const cleaned = translation.trim();
  if (cleaned.length === 0 || cleaned.length > 200) return true;
  const lowerTranslation = cleaned.toLowerCase();
  const badPatterns = [
    'please provide',
    'finnish text',
    'translate to',
    'i cannot',
    'i can\'t',
    'sorry, ',
    'error:',
    'failed to',
    'undefined'
  ];
  return badPatterns.some(pattern => lowerTranslation.includes(pattern));
}

/**
 * Clear all word translations from cache (call from console: clearWordCache())
 */
async function clearWordCache() {
  if (globalDatabaseInstance) {
    const count = await clearAllWordTranslations(globalDatabaseInstance);
    wordTranslationCache.clear();
    console.info(`YleDualSubExtension: Cleared ${count} word translations from IndexedDB and in-memory cache`);
    return count;
  } else {
    wordTranslationCache.clear();
    console.info('YleDualSubExtension: Cleared in-memory word cache (IndexedDB not available)');
    return 0;
  }
}

// Expose clearWordCache to window for debugging
// @ts-ignore
window.clearWordCache = clearWordCache;

/**
 * Translate a single word using Wiktionary, with LLM fallback using context
 * @param {string} word - The word to translate
 * @param {{current: string, before: string[], after: string[]}} context - Subtitle context
 * @returns {Promise<{translation: string, wiktionaryUrl: string, source: string}>} - The translation, URL, and source
 */
async function translateWord(word, context) {
  const normalizedWord = word.toLowerCase().trim();
  const wiktionaryUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(normalizedWord)}#Finnish`;

  // Check in-memory cache first
  const cacheKey = `${normalizedWord}:${targetLanguage}`;
  if (wordTranslationCache.has(cacheKey)) {
    const cached = wordTranslationCache.get(cacheKey);
    if (!isInvalidCachedTranslation(cached)) {
      return { translation: cached, wiktionaryUrl, source: 'cache' };
    }
    // Invalid cache entry, remove it
    wordTranslationCache.delete(cacheKey);
    console.info(`YleDualSubExtension: Removed invalid cached translation for "${normalizedWord}"`);
  }

  // Check IndexedDB cache
  if (globalDatabaseInstance) {
    try {
      const cached = await getWordTranslation(globalDatabaseInstance, normalizedWord, targetLanguage);
      if (cached && !isInvalidCachedTranslation(cached.translation)) {
        wordTranslationCache.set(cacheKey, cached.translation);
        return { translation: cached.translation, wiktionaryUrl, source: 'cache' };
      }
    } catch (error) {
      console.warn("YleDualSubExtension: Error reading word translation from cache:", error);
    }
  }

  // Try Wiktionary first
  try {
    const translation = await fetchWiktionaryDefinition(normalizedWord);

    // Cache the translation
    wordTranslationCache.set(cacheKey, translation);

    if (globalDatabaseInstance) {
      saveWordTranslation(globalDatabaseInstance, normalizedWord, targetLanguage, translation)
        .catch(err => console.warn("YleDualSubExtension: Error caching word translation:", err));
    }

    return { translation, wiktionaryUrl, source: 'wiktionary' };
  } catch (wiktionaryError) {
    console.info(`YleDualSubExtension: Wiktionary lookup failed for "${word}", falling back to LLM with context`);

    // Fallback to LLM with subtitle context
    try {
      const rawTranslation = await translateWordWithLLM(word, context);
      // Clean the translation (remove extra whitespace, newlines)
      const translation = rawTranslation.trim().replace(/\s+/g, ' ');

      // Cache the translation (LLM translations are generally reliable)
      wordTranslationCache.set(cacheKey, translation);

      if (globalDatabaseInstance) {
        saveWordTranslation(globalDatabaseInstance, normalizedWord, targetLanguage, translation)
          .catch(err => console.warn("YleDualSubExtension: Error caching word translation:", err));
      }

      return { translation, wiktionaryUrl, source: 'llm' };
    } catch (llmError) {
      console.error("YleDualSubExtension: LLM fallback also failed:", llmError);
      throw { message: wiktionaryError.message || 'Translation failed', wiktionaryUrl };
    }
  }
}

/**
 * Translate a word using LLM with subtitle context
 * @param {string} word - The word to translate
 * @param {{current: string, before: string[], after: string[]}} context - Subtitle context
 * @returns {Promise<string>} - The translation
 */
async function translateWordWithLLM(word, context) {
  // Build context string
  let contextText = '';
  if (context.before.length > 0) {
    contextText += 'Previous lines:\n' + context.before.map(s => `  "${s}"`).join('\n') + '\n\n';
  }
  contextText += `Current line: "${context.current}"\n`;
  contextText += `Word to translate: "${word}"\n`;
  if (context.after.length > 0) {
    contextText += '\nFollowing lines:\n' + context.after.map(s => `  "${s}"`).join('\n');
  }

  const langName = getLanguageName(targetLanguage);

  try {
    const response = await safeSendMessage({
      action: 'translateWordWithContext',
      data: {
        word,
        context: contextText,
        targetLanguage,
        langName
      }
    });

    if (response === null) {
      throw new Error('Extension context invalidated');
    }

    if (response && response[0]) {
      return response[1];
    } else {
      throw new Error(response ? response[1] : 'LLM translation failed');
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Get human-readable language name (duplicated from background.js for use in content script)
 * @param {string} langCode
 * @returns {string}
 */
function getLanguageName(langCode) {
  const languages = {
    'EN-US': 'English', 'EN-GB': 'English', 'DE': 'German', 'FR': 'French',
    'ES': 'Spanish', 'IT': 'Italian', 'NL': 'Dutch', 'PL': 'Polish',
    'PT-PT': 'Portuguese', 'PT-BR': 'Brazilian Portuguese', 'RU': 'Russian',
    'JA': 'Japanese', 'ZH': 'Chinese', 'KO': 'Korean', 'VI': 'Vietnamese',
    'SV': 'Swedish', 'DA': 'Danish', 'NO': 'Norwegian', 'FI': 'Finnish',
  };
  return languages[langCode] || langCode;
}

/**
 * Fetch word definition from Wiktionary API
 * @param {string} word - Finnish word to look up
 * @returns {Promise<string>} - The definition/translation
 */
async function fetchWiktionaryDefinition(word) {
  // Use Wiktionary REST API to get definitions
  const apiUrl = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (response.status === 404) {
      throw new Error('Word not found in Wiktionary');
    }

    if (!response.ok) {
      throw new Error(`Wiktionary error: ${response.status}`);
    }

    const data = await response.json();

    // Look for Finnish definitions
    const finnishEntry = data.fi;
    if (finnishEntry && finnishEntry.length > 0) {
      // Extract definitions from Finnish entry
      const definitions = [];
      for (const entry of finnishEntry) {
        if (entry.definitions && entry.definitions.length > 0) {
          for (const def of entry.definitions.slice(0, 3)) { // Limit to 3 definitions
            // Clean up HTML tags from definition
            const cleanDef = def.definition
              .replace(/<[^>]*>/g, '') // Remove HTML tags
              .replace(/\([^)]*\)/g, '') // Remove parenthetical notes
              .trim();
            if (cleanDef && cleanDef.length > 0) {
              definitions.push(cleanDef);
            }
          }
        }
      }

      if (definitions.length > 0) {
        return definitions.join('; ');
      }
    }

    throw new Error('No Finnish definition found');
  } catch (error) {
    if (error.message.includes('Wiktionary') || error.message.includes('not found') || error.message.includes('Finnish')) {
      throw error;
    }
    throw new Error('Failed to fetch from Wiktionary');
  }
}

// Hide tooltip when clicking elsewhere (use capture phase to catch events before they're stopped)
document.addEventListener("click", (e) => {
  // Don't hide if clicking on a word (will show new tooltip for that word)
  if (e.target.closest('.word-item')) {
    return;
  }
  if (activeTooltip && !activeTooltip.contains(e.target)) {
    hideTooltip();
  }
}, true);

// Hide tooltip when video controls are interacted with
document.addEventListener("keydown", (e) => {
  // Hide tooltip on space (play/pause) or arrow keys
  if (e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight") {
    hideTooltip();
  }
});

// ==================================
// END POPUP DICTIONARY SECTION
// ==================================

// ==================================
// SECTION 3.55: MOUSE ACTIVITY TRACKING
// Show YLE controls on mouse movement, hide after inactivity
// Extension controls stay visible always (handled by CSS)
// ==================================

let mouseActivityTimer = null;
const MOUSE_HIDE_DELAY = 2500; // Hide after 2.5 seconds of inactivity

function showYleControls() {
  const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
  if (playerUI) {
    playerUI.classList.add('yle-mouse-active');
  }
  document.body.classList.add('yle-mouse-active');
}

function hideYleControls() {
  const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
  if (playerUI) {
    playerUI.classList.remove('yle-mouse-active');
  }
  document.body.classList.remove('yle-mouse-active');
}

function onMouseActivity() {
  showYleControls();

  if (mouseActivityTimer) {
    clearTimeout(mouseActivityTimer);
  }

  mouseActivityTimer = setTimeout(hideYleControls, MOUSE_HIDE_DELAY);
}

// Track mouse movement
document.addEventListener('mousemove', onMouseActivity, { passive: true });
document.addEventListener('touchstart', onMouseActivity, { passive: true });

// Start with controls hidden
setTimeout(hideYleControls, 1000);

/**
 * Focus the video/player to enable keyboard controls
 */
function focusVideo() {
  // Don't focus if a word tooltip is active (user is looking up a word)
  if (activeTooltip) {
    return;
  }

  // Find the player UI element that likely handles keyboard events
  const playerUI = document.querySelector('[class*="PlayerUI__UI"]');

  if (playerUI) {
    // Make it focusable and focus it
    playerUI.setAttribute('tabindex', '0');
    playerUI.focus();

    // If focus successful, we're done
    if (document.activeElement === playerUI) {
      return;
    }
  }

  // Try clicking on the player area to trigger native focus
  // We'll click on an area that doesn't toggle play/pause (like the bottom area)
  const video = document.querySelector('video');
  if (video) {
    const rect = video.getBoundingClientRect();
    // Create a click at the bottom edge of the video (near controls, won't toggle play)
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom - 5
    });

    // Dispatch on the player UI, not the video (to avoid play/pause toggle)
    if (playerUI) {
      playerUI.dispatchEvent(clickEvent);
    }
  }
}

// Focus video after clicking on any control bar element (extension or YLE)
document.addEventListener('click', (e) => {
  const target = e.target;

  // Don't focus video when interacting with dropdowns/selects - wait for change event
  if (target.tagName === 'SELECT' || target.tagName === 'OPTION' || target.closest('select')) {
    return;
  }

  // Don't focus video when clicking on words in subtitles (for tooltip)
  if (target.closest('.word-item') || target.closest('#displayed-subtitles-wrapper')) {
    return;
  }

  // Don't focus video when clicking on the tooltip itself
  if (target.closest('.word-tooltip')) {
    return;
  }

  // Check if click was on control bar area
  const isControlBarClick = target.closest('[class*="BottomControlBar"]') ||
                            target.closest('[class*="TopControlBar"]') ||
                            target.closest('.dual-sub-extension-section') ||
                            target.closest('[class*="Timeline"]');

  if (isControlBarClick) {
    // Small delay to let the control action complete first
    setTimeout(focusVideo, 100);
  }
}, true);


// ==================================
// END MOUSE ACTIVITY TRACKING
// ==================================

// ==================================
// SECTION 3.6: AUTO-PAUSE FEATURE
// ==================================

/**
 * Check if subtitle text has changed and trigger auto-pause if enabled
 * @param {string} newSubtitleText - The new subtitle text
 */
function checkAndAutoPause(newSubtitleText) {
  // Only proceed if auto-pause is enabled and we're not currently skipping
  if (!autoPauseEnabled || isSkippingSubtitle) {
    return;
  }

  // Only pause if the subtitle text actually changed (not just styling)
  const normalizedNew = newSubtitleText.trim().toLowerCase();
  const normalizedLast = lastSubtitleText.trim().toLowerCase();

  if (normalizedNew && normalizedNew !== normalizedLast && normalizedNew.length > 1) {
    console.log("YleDualSubExtension: Auto-pause triggered, new subtitle:", normalizedNew.substring(0, 30));
    const videoElement = document.querySelector('video');
    if (videoElement && !videoElement.paused) {
      // Small delay to let the subtitle fully render before pausing
      setTimeout(() => {
        if (autoPauseEnabled) {
          const video = document.querySelector('video');
          if (video && !video.paused) {
            video.pause();
            console.log("YleDualSubExtension: Video paused by auto-pause");
          }
        }
      }, 300);
    }
  }

  lastSubtitleText = newSubtitleText;
}

/**
 * Load auto-pause preference from Chrome storage
 */
async function loadAutoPausePreference() {
  try {
    const result = await chrome.storage.sync.get("autoPauseEnabled");
    if (result && typeof result.autoPauseEnabled === 'boolean') {
      autoPauseEnabled = result.autoPauseEnabled;
      console.log("YleDualSubExtension: Loaded auto-pause preference:", autoPauseEnabled);
    }
  } catch (error) {
    console.warn("YleDualSubExtension: Error loading auto-pause preference:", error);
  }
}

/**
 * Update auto-pause switch UI to match current state
 */
function updateAutoPauseSwitchUI() {
  const autoPauseSwitch = document.getElementById('auto-pause-switch');
  if (autoPauseSwitch) {
    autoPauseSwitch.checked = autoPauseEnabled;
  }
}

// Load auto-pause preference on startup
loadAutoPausePreference();

// ==================================
// END AUTO-PAUSE SECTION
// ==================================

/**
 * Check if a mutation is related to subtitles wrapper 
 * @param {MutationRecord} mutation
 * @returns {boolean} - true if the mutation is related to subtitles wrapper
 */
function isMutationRelatedToSubtitlesWrapper(mutation) {
  try {
    return (mutation?.target?.dataset["testid"] === "subtitles-wrapper");
  } catch (error) {
    console.warn("YleDualSubExtension: Catch error checking mutation related to subtitles wrapper:", error);
    return false;
  }
}

/**
 * Create and position the displayed subtitles wrapper next to the original subtitles wrapper
 * if it does not exist yet
 *
 * @param {HTMLElement} originalSubtitlesWrapper
 * @returns {HTMLElement}
 */
function createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper) {
  let displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
  if (!displayedSubtitlesWrapper) {
    displayedSubtitlesWrapper = copySubtitlesWrapper(
      originalSubtitlesWrapper.className,
    );
    originalSubtitlesWrapper.parentNode.insertBefore(
      displayedSubtitlesWrapper,
      originalSubtitlesWrapper.nextSibling,
    );
  }

  return displayedSubtitlesWrapper;
}

/**
 * Add both Finnish and target language subtitles to the displayed subtitles wrapper
 *
 * @param {HTMLElement} displayedSubtitlesWrapper
 * @param {NodeListOf<HTMLSpanElement>} originalSubtitlesWrapperSpans
 * original Finnish Subtitles Wrapper Spans
 */
function addContentToDisplayedSubtitlesWrapper(
  displayedSubtitlesWrapper,
  originalSubtitlesWrapperSpans,
) {
  if (!originalSubtitlesWrapperSpans || originalSubtitlesWrapperSpans.length === 0) {
    return;
  }
  const spanClassName = originalSubtitlesWrapperSpans[0].className;

  const finnishText = Array.from(originalSubtitlesWrapperSpans).map(
    span => span.innerText
  ).join(" ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!finnishText || finnishText.length === 0) {
    return;
  }

  // Create Finnish span with clickable words for popup dictionary
  const finnishSpan = createSubtitleSpanWithClickableWords(finnishText, spanClassName);
  const translationKey = toTranslationKey(finnishText);
  let targetLanguageText =
    sharedTranslationMap.get(translationKey) ||
    sharedTranslationErrorMap.get(translationKey);

  // Generate unique ID for this translation span
  const spanId = `translation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // If no translation yet, show "Translating..." and set up a retry mechanism
  if (!targetLanguageText) {
    targetLanguageText = "Translating...";
    const startTime = Date.now();
    // Set up a periodic check to update the translation when it arrives
    const checkTranslation = setInterval(() => {
      const translation = sharedTranslationMap.get(translationKey) || sharedTranslationErrorMap.get(translationKey);
      // Find the specific span by ID to avoid updating wrong subtitle
      const translationSpan = document.getElementById(spanId);

      if (!translationSpan) {
        // Span no longer exists (subtitle changed), stop checking
        clearInterval(checkTranslation);
        return;
      }

      if (translation) {
        translationSpan.textContent = translation;
        clearInterval(checkTranslation);
      } else if (Date.now() - startTime > 15000) {
        // After 15 seconds, fall back to showing original text
        translationSpan.textContent = finnishText;
        translationSpan.style.opacity = '0.6';
        translationSpan.title = 'Translation timed out - showing original';
        clearInterval(checkTranslation);
        console.warn("YleDualSubExtension: Translation timed out for:", finnishText.substring(0, 30));
      }
    }, 500);
    // Clear interval after 20 seconds as final safety net
    setTimeout(() => clearInterval(checkTranslation), 20000);
  }

  const targetLanguageSpan = createSubtitleSpan(targetLanguageText, `${spanClassName} translated-text-span`);
  targetLanguageSpan.id = spanId;

  displayedSubtitlesWrapper.appendChild(finnishSpan);
  displayedSubtitlesWrapper.appendChild(targetLanguageSpan);

  // Check for auto-pause
  checkAndAutoPause(finnishText);
}

/**
 * Handle mutation related to subtitles wrapper
 * Hide the original subtitles wrapper and create another div for displaying translated subtitles
 * along with original Finnish subtitles.
 * 
 * @param {MutationRecord} mutation
 * @returns {void}
 */
function handleSubtitlesWrapperMutation(mutation) {
  const originalSubtitlesWrapper = mutation.target;
  originalSubtitlesWrapper.style.display = "none";

  const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(
    // @ts-ignore - Node is used as HTMLElement at runtime
    originalSubtitlesWrapper
  );
  displayedSubtitlesWrapper.innerHTML = "";

  if (mutation.addedNodes.length > 0) {
    const finnishTextSpans = mutation.target.querySelectorAll("span");
    addContentToDisplayedSubtitlesWrapper(
      displayedSubtitlesWrapper,
      // @ts-ignore - NodeListOf<Element> is used as NodeListOf<HTMLSpanElement> at runtime
      finnishTextSpans,
    )

    // Record subtitle timestamp for skip feature
    const videoElement = document.querySelector('video');
    if (videoElement && finnishTextSpans.length > 0) {
      const subtitleText = Array.from(finnishTextSpans).map(span => span.textContent).join(' ').trim();
      if (subtitleText) {
        const currentTime = videoElement.currentTime;
        // Only add if this is a new timestamp (not already recorded within 0.5s)
        const lastEntry = subtitleTimestamps[subtitleTimestamps.length - 1];
        if (!lastEntry || Math.abs(lastEntry.time - currentTime) > 0.5) {
          subtitleTimestamps.push({ time: currentTime, text: subtitleText });
          // Keep array sorted and limit size to prevent memory issues
          subtitleTimestamps.sort((a, b) => a.time - b.time);
          if (subtitleTimestamps.length > 1000) {
            subtitleTimestamps.shift();
          }
        }
      }
    }
  }
}


// Debounce flag to prevent duplicate initialization during rapid DOM mutations.
// Set to true when video detection starts, prevents re-triggering for 1.5 seconds.
// This handles the case where video player construction fires multiple sequential mutations.

let checkVideoAppearMutationDebounceFlag = false;
/**
 * Generic video element detection - detects when any <video> element appears in the DOM
 * Works for both:
 * - Initial load: when video container is added with video already inside
 * - Episode transitions: when video element is added to existing container
 *
 * Future-proof: doesn't rely on YLE Areena's specific class names
 * NOTE: This function relies on an assumption that there is only one video element in the page at any time.
 * If YLE Areena changes to have multiple video elements, this logic may need to be revised.
 * @param {MutationRecord} mutation
 * @returns {boolean}
 */
function isVideoElementAppearMutation(mutation) {
  if (checkVideoAppearMutationDebounceFlag) {
    return false;
  }
  try {
    // Must be a childList mutation with added nodes
    if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
      return false;
    }

    // Check each added node
    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = /** @type {HTMLElement} */ (node);

      // Case 1: The added node IS a video element
      // Case 2: The added node CONTAINS a video element (initial load scenario)
      if (element.tagName === "VIDEO" || element.querySelector?.('video')) {
        checkVideoAppearMutationDebounceFlag = true;
        // eslint-disable-next-line no-loop-func
        setTimeout(() => { checkVideoAppearMutationDebounceFlag = false; }, 1500);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn("YleDualSubExtension: Error checking video element mutation:", error);
    return false;
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a valid translation provider is configured
 * Google Translate works without an API key, so it's always valid
 * @returns {Promise<boolean>}
 */
async function checkHasValidProvider() {
  try {
    const result = await chrome.storage.sync.get(['translationProvider', 'providerApiKey']);
    const provider = result.translationProvider || 'google';
    
    // Google Translate doesn't need a key
    if (provider === 'google') {
      return true;
    }
    
    // Other providers need an API key
    const apiKey = result.providerApiKey;
    return apiKey && apiKey.trim().length > 0;
  } catch (error) {
    console.error('YleDualSubExtension: Error checking provider:', error);
    // Default to true (Google Translate) on error
    return true;
  }
}

/**
 * Handle dual sub behaviour based on whether the system has valid key selected.
 * If no key is selected, display warning icon and disable dual sub switch.
 * @param {boolean} hasSelectedToken
 */
function _handleDualSubBehaviourBasedOnSelectedToken(hasSelectedToken) {
  const warningSection = document.querySelector(".dual-sub-warning");
  const dualSubSwitch = document.getElementById("dual-sub-switch");
  if (hasSelectedToken) {
    if (warningSection) {
      warningSection.style.display = "none";
    }
    if (dualSubSwitch) {
      dualSubSwitch.disabled = false;
    }
  } else {
    if (warningSection) {
      warningSection.style.display = "inline-block";
    }
    if (dualSubSwitch) {
      if (dualSubSwitch.checked) {
        dualSubSwitch.click();
      }
      dualSubSwitch.disabled = true;
    }
  }
  const warningPopover = document.querySelector(".dual-sub-warning__popover");
  if (warningPopover) {
    warningPopover.classList.remove("active");
  }
}

/**
 * Add Dual Sub extension section to the video player's bottom control bar
 * next to the volume control.
 * @returns {Promise<void>}
 */
async function addDualSubExtensionSection() {
  // Load preferences FIRST before creating the UI
  // This ensures the template has the correct values
  try {
    const result = await chrome.storage.sync.get(["dualSubEnabled", "autoPauseEnabled"]);
    console.log("YleDualSubExtension: Pre-loading preferences:", result);
    if (typeof result.dualSubEnabled === 'boolean') {
      dualSubEnabled = result.dualSubEnabled;
    }
    if (typeof result.autoPauseEnabled === 'boolean') {
      autoPauseEnabled = result.autoPauseEnabled;
    }
  } catch (e) {
    console.warn("YleDualSubExtension: Error pre-loading preferences:", e);
  }

  let bottomControlBarLeftControls = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    bottomControlBarLeftControls = document.querySelector(
      '[class^="BottomControlBar__LeftControls"]'
    );
    if (bottomControlBarLeftControls) {
      break;
    };
    await sleep(150);
  }

  if (!bottomControlBarLeftControls) {
    console.error("YleDualSubExtension: Cannot find bottom control bar left controls");
    return;
  }

  const existingSection = document.querySelector(".dual-sub-extension-section");
  if (existingSection) {
    try {
      existingSection.remove();
    } catch (err) {
      // Probably never happens, but just in case
      console.error("YleDualSubExtension: Error removing existing dual sub extension section:", err);
      if (existingSection.parentNode) {
        try {
          existingSection.parentNode.removeChild(existingSection);
        } catch (error) {
          console.error("YleDualSubExtension: Error removing existing dual sub extension section via parentNode:", error);
        }
      }
    }
  }

  const dualSubExtensionSection = `
    <div class="dual-sub-extension-section">
      <span>Dual Sub:</span>
      <input id="dual-sub-switch" class="dual-sub-switch" type="checkbox" ${dualSubEnabled ? 'checked' : ''}>
      <span class="dual-sub-warning" style="display: none;">
        <span class="dual-sub-warning__icon">
          !
        </span>
        <span class="dual-sub-warning__popover">
          Translation provider not configured!<br>
          Please configure your provider in <a href="#" id="open-options-link">the settings</a>.<br>
          (Google Translate works without an API key)<br>
          See
          <a href="https://anhtumai.github.io/yle-dual-sub"
             target="_blank"
             rel="noopener noreferrer">
            guide
          </a>
          for more information.
        </span>
      </span>

      <button aria-label="Open settings" type="button" id="yle-dual-sub-settings-button" style="margin-left: 16px;">
        <svg width="22" height="22" fill="none" viewBox="0 0 22 22" aria-hidden="true">
          <path fill="currentColor" d="M20.207 9.017l-1.845-.424a7.2 7.2 0 0 0-.663-1.6l1.045-1.536a1 1 0 0 0-.121-1.29l-1.398-1.398a1 1 0 0 0-1.29-.121l-1.536 1.045a7.2 7.2 0 0 0-1.6-.663l-.424-1.845A1 1 0 0 0 11.4.75h-1.978a1 1 0 0 0-.975.435l-.424 1.845a7.2 7.2 0 0 0-1.6.663L4.887 2.648a1 1 0 0 0-1.29.121L2.199 4.167a1 1 0 0 0-.121 1.29l1.045 1.536a7.2 7.2 0 0 0-.663 1.6l-1.845.424A1 1 0 0 0 .18 10v1.978a1 1 0 0 0 .435.975l1.845.424a7.2 7.2 0 0 0 .663 1.6l-1.045 1.536a1 1 0 0 0 .121 1.29l1.398 1.398a1 1 0 0 0 1.29.121l1.536-1.045a7.2 7.2 0 0 0 1.6.663l.424 1.845a1 1 0 0 0 .975.435h1.978a1 1 0 0 0 .975-.435l.424-1.845a7.2 7.2 0 0 0 1.6-.663l1.536 1.045a1 1 0 0 0 1.29-.121l1.398-1.398a1 1 0 0 0 .121-1.29l-1.045-1.536a7.2 7.2 0 0 0 .663-1.6l1.845-.424a1 1 0 0 0 .435-.975V10a1 1 0 0 0-.435-.975v-.008zM11 15a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_settings_tooltip" style="top: -72px;">
          Open settings
        </div>
      </button>

      <button aria-label="Previous subtitle" type="button" id="yle-dual-sub-rewind-button">
        <svg width="22" height="22" fill="none" viewBox="0 0 22 22" aria-hidden="true">
          <path fill="currentColor" d="M6 4a1 1 0 0 0-1 1v12a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1zm11.707 1.293a1 1 0 0 0-1.414 0L11 10.586V5a1 1 0 1 0-2 0v12a1 1 0 1 0 2 0v-5.586l5.293 5.293a1 1 0 0 0 1.414-1.414L12.414 11l5.293-5.293a1 1 0 0 0 0-1.414z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_rewind_tooltip">
          Previous subtitle<br />
          Tip: Press "," (comma) key
        </div>
      </button>
      <button aria-label="Next subtitle" type="button" id="yle-dual-sub-forward-button">
        <svg width="22" height="22" fill="none" viewBox="0 0 22 22" aria-hidden="true">
          <path fill="currentColor" d="M16 4a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1zM4.293 5.293a1 1 0 0 1 1.414 0L11 10.586V5a1 1 0 1 1 2 0v12a1 1 0 1 1-2 0v-5.586l-5.293 5.293a1 1 0 0 1-1.414-1.414L9.586 11 4.293 6.707a1 1 0 0 1 0-1.414z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_forward_tooltip">
          Next subtitle<br />
          Tip: Press "." (dot) key
        </div>
      </button>

      <span style="margin-left: 12px; border-left: 1px solid rgba(255,255,255,0.2); padding-left: 12px; display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 12px; opacity: 0.8;">Auto-Pause:</span>
        <input id="auto-pause-switch" class="auto-pause-switch" type="checkbox" ${autoPauseEnabled ? 'checked' : ''} title="Pause video after each subtitle line (Shortcut: P)">
      </span>

      <span style="margin-left: 12px; border-left: 1px solid rgba(255,255,255,0.2); padding-left: 12px; display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 12px; opacity: 0.8;">Speed:</span>
        <select id="yle-playback-speed" class="yle-speed-select" title="Playback speed">
          <option value="1" ${playbackSpeed === 1 ? 'selected' : ''}>1x</option>
          <option value="1.25" ${playbackSpeed === 1.25 ? 'selected' : ''}>1.25x</option>
          <option value="1.5" ${playbackSpeed === 1.5 ? 'selected' : ''}>1.5x</option>
          <option value="1.75" ${playbackSpeed === 1.75 ? 'selected' : ''}>1.75x</option>
          <option value="2" ${playbackSpeed === 2 ? 'selected' : ''}>2x</option>
        </select>
      </span>

    </div>
  `
  bottomControlBarLeftControls.insertAdjacentHTML('beforeend', dualSubExtensionSection);

  // Display warning section if no provider is configured
  // Google Translate doesn't need a key, so check if provider is set
  const hasValidProvider = await checkHasValidProvider();
  _handleDualSubBehaviourBasedOnSelectedToken(hasValidProvider);

  // Load and set initial state of dual sub switch from storage
  const dualSubSwitch = document.getElementById("dual-sub-switch");
  if (dualSubSwitch) {
    // Load from storage to ensure we have the latest value
    try {
      const result = await chrome.storage.sync.get("dualSubEnabled");
      console.log("YleDualSubExtension: Storage result for dualSubEnabled:", result);
      if (result && typeof result.dualSubEnabled === 'boolean') {
        dualSubEnabled = result.dualSubEnabled;
        console.log("YleDualSubExtension: Set dualSubEnabled to:", dualSubEnabled);
      } else {
        console.log("YleDualSubExtension: No boolean value in storage, keeping dualSubEnabled as:", dualSubEnabled);
      }
    } catch (e) {
      console.warn("YleDualSubExtension: Error loading dual sub preference:", e);
    }

    dualSubSwitch.checked = dualSubEnabled;
    console.log("YleDualSubExtension: Set checkbox checked to:", dualSubSwitch.checked);

    // If enabled, trigger the change handler to set up subtitles
    if (dualSubEnabled && hasValidProvider) {
      console.log("YleDualSubExtension: Triggering change event for enabled dual sub");
      dualSubSwitch.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Dual sub warning logic
  const warningIcon = document.querySelector(".dual-sub-warning__icon");
  const warningPopover = document.querySelector(".dual-sub-warning__popover");
  const openOptionsLink = document.getElementById("open-options-link");

  warningIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    warningPopover.classList.toggle("active");
  })

  document.addEventListener("click", (e) => {
    // @ts-ignore - EventTarget is used as Node at runtime
    if (!warningPopover.contains(e.target) && !warningIcon.contains(e.target)) {
      warningPopover.classList.remove("active");
    }
  })

  warningPopover.addEventListener("click", (e) => {
    e.stopPropagation();
  })

  openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    safeSendMessage({ action: 'openOptionsPage' });
  })

  // Setting button logic
  const settingsButton = document.getElementById('yle-dual-sub-settings-button');
  if (settingsButton) {
    settingsButton.addEventListener('click', (e) => {
      safeSendMessage({ action: 'openOptionsPage' });
      // Focus video to enable keyboard controls
      focusVideo();
    });
  }
  else {
    console.error("YleDualSubExtension: Cannot find settings button");
  }

  // Playback speed control logic
  const speedSelect = document.getElementById('yle-playback-speed');
  if (speedSelect) {
    speedSelect.addEventListener('change', (e) => {
      const newSpeed = parseFloat(e.target.value);
      savePlaybackSpeed(newSpeed);
      console.info(`YleDualSubExtension: Playback speed set to ${newSpeed}x`);
      // Focus video to enable keyboard controls
      focusVideo();
    });
    // Apply saved speed immediately
    applyPlaybackSpeed();
  }

  // Skip to previous/next subtitle button logic
  function subtitleSkipLogicHandle() {
    const videoElement = document.querySelector('video');
    if (!videoElement) {
      console.error("YleDualSubExtension: Cannot find video element");
      return;
    }

    function skipToNextSubtitle() {
      // Temporarily disable auto-pause during skip
      isSkippingSubtitle = true;
      const currentTime = videoElement.currentTime;
      // Find the next subtitle timestamp after current time
      const nextSubtitle = subtitleTimestamps.find(entry => entry.time > currentTime + 0.5);
      if (nextSubtitle) {
        videoElement.currentTime = nextSubtitle.time;
      } else {
        // No next subtitle found, skip forward 5 seconds as fallback
        videoElement.currentTime = currentTime + 5;
      }
      // Re-enable auto-pause after a short delay to let the new subtitle appear
      setTimeout(() => { isSkippingSubtitle = false; }, 800);
    }

    function skipToPreviousSubtitle() {
      // Temporarily disable auto-pause during skip
      isSkippingSubtitle = true;
      const currentTime = videoElement.currentTime;
      // Find the previous subtitle timestamp before current time
      // We look for subtitles at least 1 second before current position
      const previousSubtitles = subtitleTimestamps.filter(entry => entry.time < currentTime - 1);
      if (previousSubtitles.length > 0) {
        const previousSubtitle = previousSubtitles[previousSubtitles.length - 1];
        videoElement.currentTime = previousSubtitle.time;
      } else {
        // No previous subtitle found, skip back 5 seconds as fallback
        videoElement.currentTime = Math.max(0, currentTime - 5);
      }
      // Re-enable auto-pause after a short delay to let the new subtitle appear
      setTimeout(() => { isSkippingSubtitle = false; }, 800);
    }

    document.addEventListener('keydown', (event) => {
      if (!videoElement) { return; }
      // Don't trigger if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }

      if (event.key === ',') {
        event.preventDefault();
        skipToPreviousSubtitle();
      } else if (event.key === '.') {
        event.preventDefault();
        skipToNextSubtitle();
      }
    });

    const prevButton = document.getElementById('yle-dual-sub-rewind-button');
    const nextButton = document.getElementById('yle-dual-sub-forward-button');

    if (prevButton) {
      prevButton.addEventListener('click', (e) => {
        skipToPreviousSubtitle();
        // Focus video to enable keyboard controls
        focusVideo();
      });
    }
    else {
      console.error("YleDualSubExtension: Cannot find previous subtitle button");
    }

    if (nextButton) {
      nextButton.addEventListener('click', (e) => {
        skipToNextSubtitle();
        // Focus video to enable keyboard controls
        focusVideo();
      });
    }
    else {
      console.error("YleDualSubExtension: Cannot find next subtitle button");
    }

    // Add keyboard shortcut for auto-pause toggle (P key)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'p' || event.key === 'P') {
        // Don't toggle if user is typing in an input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
          return;
        }
        event.preventDefault();
        const autoPauseSwitch = document.getElementById('auto-pause-switch');
        if (autoPauseSwitch) {
          autoPauseSwitch.click();
        }
      }
    });
  }
  subtitleSkipLogicHandle();

  // Auto-pause switch logic
  const autoPauseSwitch = document.getElementById('auto-pause-switch');
  if (autoPauseSwitch) {
    // Set initial state
    autoPauseSwitch.checked = autoPauseEnabled;

    autoPauseSwitch.addEventListener('change', (e) => {
      autoPauseEnabled = e.target.checked;
      console.log("YleDualSubExtension: Auto-pause toggled:", autoPauseEnabled);
      // Reset last subtitle text when toggling to avoid immediate pause
      lastSubtitleText = "";
      // Save preference to Chrome storage
      chrome.storage.sync.set({ autoPauseEnabled }).then(() => {
        console.log("YleDualSubExtension: Auto-pause preference saved:", autoPauseEnabled);
      }).catch(err => {
        console.warn("YleDualSubExtension: Error saving auto-pause preference:", err);
      });
      // Focus video to enable keyboard controls
      focusVideo();
    });

    // Also handle clicks directly on the switch (for better compatibility)
    autoPauseSwitch.addEventListener('click', (e) => {
      // The change event will handle the state update
      e.stopPropagation();
      // Focus video to enable keyboard controls
      setTimeout(focusVideo, 100);
    });
  } else {
    console.warn("YleDualSubExtension: Auto-pause switch not found in DOM");
  }
}

/**
 * Get video title once the video player is loaded
 * @returns {Promise<string | null>}
 */
async function getVideoTitle() {

  let titleElement = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    titleElement = document.querySelector('[class*="VideoTitle__Titles"]');
    if (titleElement) {
      break;
    };
    await sleep(150);
  }

  if (!titleElement) {
    console.error("YleDualSubExtension: Cannot get movie name. Title Element is null.");
    return null;
  }

  const texts = Array.from(titleElement.querySelectorAll('span'))
    .map(span => span.textContent.trim())
    .filter(text => text.length > 0);
  return texts.join(" | ")
}

// ==================================
// END SECTION
// ==================================

// =========================================
// MAIN SECTION: OBSERVERS & EVENT LISTENERS
// =========================================

/**
 * This function acts as a handler when new movie is played.
 * It will load that movie's subtitle from database and update metadata.
 * @returns {Promise<void>}
 */
async function loadMovieCacheAndUpdateMetadata() {

  const db = await openDatabase();

  currentMovieName = await getVideoTitle();
  if (!currentMovieName) {
    return;
  }

  const subtitleRecords = await loadSubtitlesByMovieName(db, currentMovieName, targetLanguage);
  if (Array.isArray(subtitleRecords) && subtitleRecords.length >= 0) {
    console.info(`YleDualSubExtension: Loaded ${subtitleRecords.length} cached subtitles for movie: ${currentMovieName}`);
  }
  for (const subtitleRecord of subtitleRecords) {
    sharedTranslationMap.set(
      subtitleRecord.originalText,
      subtitleRecord.translatedText
    );
  }

  const lastAccessedDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));

  await upsertMovieMetadata(db, currentMovieName, lastAccessedDays);
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      if (isMutationRelatedToSubtitlesWrapper(mutation)) {
        if (dualSubEnabled) {
          handleSubtitlesWrapperMutation(mutation);
          return;
        }
      }
      if (isVideoElementAppearMutation(mutation)) {
        addDualSubExtensionSection().then(() => { }).catch((error) => {
          console.error("YleDualSubExtension: Error adding dual sub extension section:", error);
        });
        loadMovieCacheAndUpdateMetadata().then(() => { }).catch((error) => {
          console.error("YleDualSubExtension: Error populating shared translation map from cache:", error);
        });
        // Apply saved playback speed
        setupVideoSpeedControl();
      }
    }
  });
});

// Start observing the document for added nodes
if (document.body instanceof Node) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}


document.addEventListener("sendTranslationTextEvent", (e) => {
  /**
   * Listening for incoming subtitle texts loaded into video player from injected.js
   * Send raw Finnish text from subtitle to a translation queue
   * Skip if batch translation is in progress (batch handles everything)
   * @param {Event} e
   */

  // Skip individual processing if batch translation is handling it
  if (isBatchTranslating) {
    return;
  }

  /** @type {string} */
  const rawSubtitleFinnishText = e.detail;

  const translationKey = toTranslationKey(rawSubtitleFinnishText);
  if (sharedTranslationMap.has(translationKey)) {
    return;
  }

  if (translationKey.length <= 1 || !/[a-zäöå]/.test(translationKey)) {
    sharedTranslationMap.set(translationKey, translationKey);
    return;
  }

  translationQueue.addToQueue(rawSubtitleFinnishText);
  translationQueue.processQueue().then(() => {
  }).catch((error) => {
    console.error("YleDualSubExtension: Error processing translation queue:", error);
  });
});

// Listen for batch translation events from injected.js
document.addEventListener("sendBatchTranslationEvent", (e) => {
  /**
   * Handle batch translation of all subtitles with context
   * This is triggered when a VTT file is loaded
   */
  const { subtitles } = e.detail;

  if (!subtitles || subtitles.length === 0) {
    return;
  }

  // Start batch translation in the background
  handleBatchTranslation(subtitles).catch((error) => {
    console.error("YleDualSubExtension: Error in batch translation:", error);
  });
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
  /**
   * Listen for user setting changes for provider/key selection in Options page
   * @param {Object} changes
   * @param {string} namespace
   */
  // Handle provider or API key changes
  if (namespace === 'sync' && (changes.translationProvider || changes.providerApiKey || changes.tokenInfos)) {
    const hasValidProvider = await checkHasValidProvider();
    _handleDualSubBehaviourBasedOnSelectedToken(hasValidProvider);
  }
  if (namespace === 'sync' && changes.targetLanguage) {
    if (changes.targetLanguage.newValue && typeof changes.targetLanguage.newValue === 'string') {
      alert(`Your target language has changed to ${changes.targetLanguage.newValue}. ` +
        `We need to reload the page for the change to work.`);
      location.reload();
    }
  }
});

document.addEventListener("change", (e) => {
  /**
   * Listen for user interaction events in YLE Areena page,
   * for example: dual sub switch change event
   * @param {Event} e
   */
  if (e.target.id === "dual-sub-switch") {
    dualSubEnabled = e.target.checked;
    console.log("YleDualSubExtension: Dual sub switch changed to:", dualSubEnabled);
    // Focus video to enable keyboard controls
    focusVideo();
    // Save preference to chrome storage
    chrome.storage.sync.set({ dualSubEnabled }).then(async () => {
      console.log("YleDualSubExtension: Saved dualSubEnabled to storage:", dualSubEnabled);
      // Verify the save worked by reading it back
      const verify = await chrome.storage.sync.get("dualSubEnabled");
      console.log("YleDualSubExtension: Verified storage value:", verify);
    }).catch(err => {
      console.error("YleDualSubExtension: Error saving dualSubEnabled:", err);
    });
    if (e.target.checked) {
      const originalSubtitlesWrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
      if (!originalSubtitlesWrapper) {
        console.error(
          "YleDualSubExtension: This should not happen: " +
          "When the video is loaded the subtitles wrapper should be there"
        );
        e.target.checked = false;
        dualSubEnabled = false;
        return;
      }
      originalSubtitlesWrapper.style.display = "none";
      const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(
        // @ts-ignore - Element is used as HTMLElement at runtime
        originalSubtitlesWrapper
      );
      displayedSubtitlesWrapper.innerHTML = "";
      displayedSubtitlesWrapper.style.display = "flex";

      const originalSubtitlesWrapperSpans = originalSubtitlesWrapper.querySelectorAll('span');
      if (originalSubtitlesWrapperSpans) {
        addContentToDisplayedSubtitlesWrapper(
          displayedSubtitlesWrapper,
          // @ts-ignore - NodeListOf<Element> is used as NodeListOf<HTMLSpanElement> at runtime
          originalSubtitlesWrapperSpans,
        )
      }
      translationQueue.processQueue().then(() => { }).catch((error) => {
        console.error("YleDualSubExtension: Error processing translation queue after enabling dual subtitles:", error);
      });
    }
    else {
      const displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
      if (displayedSubtitlesWrapper) {
        displayedSubtitlesWrapper.innerHTML = "";
        displayedSubtitlesWrapper.style.display = "none";
      }
      const originalSubtitlesWrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
      if (originalSubtitlesWrapper) {
        originalSubtitlesWrapper.style.display = "flex";
      }
    }
  }
});
