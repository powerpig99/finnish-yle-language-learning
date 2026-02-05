// ==================================
// POPUP DICTIONARY (WORD TRANSLATION)
// ==================================

/** @type {Map<string, string>}
 * In-memory cache for word translations, key is normalized word, value is translation
 */
const wordTranslationCache = new Map<string, string>();

/** @type {HTMLElement | null}
 * Reference to the currently visible tooltip element
 */
let activeTooltip: HTMLElement | null = null;

/** @type {HTMLElement | null}
 * Reference to the currently active word element
 */
let activeWordElement: HTMLElement | null = null;

/** @type {string[]} - Recent subtitle lines for context (max 10) */
const recentSubtitleLines: string[] = [];
const MAX_RECENT_SUBTITLES = 10;

/**
 * Tokenize text into words and non-word characters
 * @param {string} text - Text to tokenize
 * @returns {Array<{type: 'word' | 'separator', value: string}>} - Array of tokens
 */
function tokenizeText(text: string) {
  const tokens: Array<{ type: 'word' | 'separator'; value: string }> = [];
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

/**
 * Track a subtitle line for context
 * @param {string} text - The subtitle text
 */
function trackSubtitleForContext(text: string) {
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
function getSubtitleContext(currentSubtitle: string) {
  const currentIndex = recentSubtitleLines.findIndex(s => s.includes(currentSubtitle) || currentSubtitle.includes(s));
  const before: string[] = [];
  const after: string[] = [];

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
function createSubtitleSpanWithClickableWords(text: string, className: string) {
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
      // Handle line breaks - convert \n to <br> elements
      const separatorValue = token.value;
      if (separatorValue.includes('\n')) {
        const parts = separatorValue.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            span.appendChild(document.createTextNode(parts[i]));
          }
          if (i < parts.length - 1) {
            span.appendChild(document.createElement('br'));
          }
        }
      } else {
        span.appendChild(document.createTextNode(separatorValue));
      }
    }
  }

  return span;
}

/**
 * Handle click on a word to show translation tooltip
 * @param {MouseEvent} event
 */
function handleWordClick(event: MouseEvent) {
  event.stopPropagation();
  const wordElement = event.target as HTMLElement | null;
  if (!wordElement) return;
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
async function showWordTooltip(word: string, wordElement: HTMLElement, context: { current: string; before: string[]; after: string[] }) {
  // Hide any existing tooltip
  hideTooltip();

  // Mark word as active
  activeWordElement = wordElement;
  wordElement.classList.add("active");

  // Create tooltip with Wiktionary link placeholder
  // Use target language for Wiktionary subdomain (falls back to 'en' if not supported)
  const wiktLang = typeof getWiktionaryLang === 'function' ? getWiktionaryLang(targetLanguage) : 'en';
  const sourceLangSection = detectedSourceLanguage ? `#${getLanguageName(detectedSourceLanguage.toUpperCase())}` : '';
  const wiktionaryUrl = `https://${wiktLang}.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}${sourceLangSection}`;
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
  const askAiBtn = tooltip.querySelector(".word-tooltip__ask-ai") as HTMLElement | null;
  if (!askAiBtn) return;

  // Stop all event propagation to prevent YLE's handlers from triggering navigation
  const stopAllPropagation = (e: Event) => {
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
    const translationEl = tooltip.querySelector(".word-tooltip__translation") as HTMLElement | null;
    const sourceEl = tooltip.querySelector(".word-tooltip__source") as HTMLElement | null;
    const actionsEl = tooltip.querySelector(".word-tooltip__actions") as HTMLElement | null;

    if (!translationEl || !sourceEl || !actionsEl) return;

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
          saveWordTranslation(globalDatabaseInstance, word.toLowerCase().trim(), targetLanguage, llmResult, 'llm')
            .catch(err => console.warn("YleDualSubExtension: Error caching AI word translation:", err));
        }
      }
    } catch (error) {
      if (activeTooltip === tooltip) {
        translationEl.classList.remove("word-tooltip__loading");
        translationEl.classList.add("word-tooltip__error");
        translationEl.textContent = (error as Error).message || "AI translation failed";
      }
    }
  });

  // Get translation (Wiktionary first, then LLM fallback with context)
  try {
    const result = await translateWord(word, context);
    if (activeTooltip === tooltip) {
      const translationEl = tooltip.querySelector(".word-tooltip__translation") as HTMLElement | null;
      const sourceEl = tooltip.querySelector(".word-tooltip__source") as HTMLElement | null;
      const actionsEl = tooltip.querySelector(".word-tooltip__actions") as HTMLElement | null;
      if (!translationEl || !sourceEl || !actionsEl) return;
      translationEl.classList.remove("word-tooltip__loading");
      translationEl.textContent = result.translation;

      if (result.source === 'llm') {
        sourceEl.textContent = '(AI translation with context)';
        sourceEl.style.cssText = 'font-size: 10px; color: #9ca3af; margin-top: 4px;';
        // Hide Wiktionary link since the word wasn't found there
        const linkEl = tooltip.querySelector(".word-tooltip__link") as HTMLElement | null;
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
      const translationEl = tooltip.querySelector(".word-tooltip__translation") as HTMLElement | null;
      const actionsEl = tooltip.querySelector(".word-tooltip__actions") as HTMLElement | null;
      if (!translationEl || !actionsEl) return;
      translationEl.classList.remove("word-tooltip__loading");
      translationEl.classList.add("word-tooltip__error");
      translationEl.textContent = (error as Error).message || "Translation failed";
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
function positionTooltip(tooltip: HTMLElement, wordElement: HTMLElement) {
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
function escapeHtml(text: string) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if a cached translation looks like a bad/error response
 * @param {string} translation - The cached translation
 * @returns {boolean} - True if the translation looks invalid
 */
function isInvalidCachedTranslation(translation: string) {
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
async function translateWord(word: string, context: { current: string; before: string[]; after: string[] }) {
  const normalizedWord = word.toLowerCase().trim();
  // Use target language for Wiktionary subdomain (falls back to 'en' if not supported)
  const wiktLang = typeof getWiktionaryLang === 'function' ? getWiktionaryLang(targetLanguage) : 'en';
  const sourceLangSection = detectedSourceLanguage ? `#${getLanguageName(detectedSourceLanguage.toUpperCase())}` : '';
  const wiktionaryUrl = `https://${wiktLang}.wiktionary.org/wiki/${encodeURIComponent(normalizedWord)}${sourceLangSection}`;

  // Check in-memory cache first
  const cacheKey = `${normalizedWord}:${targetLanguage}`;
  if (wordTranslationCache.has(cacheKey)) {
    const cached = wordTranslationCache.get(cacheKey);
    if (cached && !isInvalidCachedTranslation(cached)) {
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
        // Return the original source (wiktionary or llm) so UI can show correct link
        // Default to 'wiktionary' for backward compatibility with old cache entries
        return { translation: cached.translation, wiktionaryUrl, source: cached.source || 'wiktionary' };
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
      console.info('YleDualSubExtension: Saving word to cache:', normalizedWord, targetLanguage);
      saveWordTranslation(globalDatabaseInstance, normalizedWord, targetLanguage, translation, 'wiktionary')
        .then(() => console.info('YleDualSubExtension: Word saved successfully:', normalizedWord))
        .catch(err => console.warn("YleDualSubExtension: Error caching word translation:", err));
    } else {
      console.warn('YleDualSubExtension: No database instance, cannot cache word:', normalizedWord);
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
        console.info('YleDualSubExtension: Saving LLM word to cache:', normalizedWord, targetLanguage);
        saveWordTranslation(globalDatabaseInstance, normalizedWord, targetLanguage, translation, 'llm')
          .then(() => console.info('YleDualSubExtension: LLM word saved successfully:', normalizedWord))
          .catch(err => console.warn("YleDualSubExtension: Error caching word translation:", err));
      } else {
        console.warn('YleDualSubExtension: No database instance, cannot cache LLM word:', normalizedWord);
      }

      return { translation, wiktionaryUrl, source: 'llm' };
    } catch (llmError) {
      console.error("YleDualSubExtension: LLM fallback also failed:", llmError);
      const llmMessage = (llmError as Error).message || String(llmError);
      if (llmMessage.includes('Extension context invalidated')) {
        throw { message: 'Extension updated. Please refresh the page.', wiktionaryUrl };
      }
      throw { message: (wiktionaryError as Error).message || 'Translation failed', wiktionaryUrl };
    }
  }
}

/**
 * Translate a word using LLM with subtitle context
 * @param {string} word - The word to translate
 * @param {{current: string, before: string[], after: string[]}} context - Subtitle context
 * @returns {Promise<string>} - The translation
 */
async function translateWordWithLLM(word: string, context: { current: string; before: string[]; after: string[] }) {
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
function getLanguageName(langCode: string) {
  const languages: Record<string, string> = {
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
 * Uses target language for Wiktionary subdomain, looks for source language entry
 * @param {string} word - Word to look up (in source language)
 * @returns {Promise<string>} - The definition/translation
 */
async function fetchWiktionaryDefinition(word: string) {
  // Use target language for Wiktionary API (definitions will be in target language)
  // Falls back to English if target language not supported
  const wiktLang = typeof getWiktionaryLang === 'function' ? getWiktionaryLang(targetLanguage) : 'en';
  const apiUrl = `https://${wiktLang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;

  // Determine source language code for looking up entries
  // Use detectedSourceLanguage if available, otherwise default to 'fi' (Finnish)
  const sourceLangCode = detectedSourceLanguage ? normalizeLanguageCode(detectedSourceLanguage) : 'fi';

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

    // Look for source language definitions
    const sourceEntry = data[sourceLangCode];
    if (sourceEntry && sourceEntry.length > 0) {
      // Extract definitions from source language entry
      const definitions: string[] = [];
      for (const entry of sourceEntry) {
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

    throw new Error(`No ${getLanguageName(sourceLangCode.toUpperCase())} definition found`);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('Wiktionary') || message.includes('not found') || message.includes('definition')) {
      throw error;
    }
    throw new Error('Failed to fetch from Wiktionary');
  }
}

// Hide tooltip when clicking elsewhere (use capture phase to catch events before they're stopped)
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  // Don't hide if clicking on a word (will show new tooltip for that word)
  if (target.closest('.word-item')) {
    return;
  }
  if (activeTooltip && !activeTooltip.contains(target)) {
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
