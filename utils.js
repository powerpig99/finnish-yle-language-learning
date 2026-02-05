const DEFAULT_TARGET_LANGUAGE = 'EN-US';

// ================================
// Extension Context Validation
// ================================

/**
 * Flag to track if extension context has been invalidated
 * Once true, all chrome API calls should be skipped
 */
let extensionContextInvalidated = false;

/**
 * Check if the extension context is still valid
 * @returns {boolean} - True if context is valid, false if invalidated
 */
// eslint-disable-next-line no-unused-vars
function isExtensionContextValid() {
  if (extensionContextInvalidated) {
    return false;
  }
  try {
    // Try to access chrome.runtime.id - this throws if context is invalidated
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      return true;
    }
    return false;
  } catch (e) {
    extensionContextInvalidated = true;
    return false;
  }
}

/**
 * Wrapper for chrome.storage.sync.get that handles context invalidation
 * @param {string|string[]} keys - Keys to retrieve
 * @returns {Promise<Object>} - Storage result or empty object if context invalid
 */
// eslint-disable-next-line no-unused-vars
async function safeStorageGet(keys) {
  if (!isExtensionContextValid()) {
    return {};
  }
  try {
    return await chrome.storage.sync.get(keys);
  } catch (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      extensionContextInvalidated = true;
      showExtensionInvalidatedToast();
    }
    return {};
  }
}

/**
 * Wrapper for chrome.storage.sync.set that handles context invalidation
 * @param {Object} items - Items to store
 * @returns {Promise<boolean>} - True if successful, false if failed
 */
// eslint-disable-next-line no-unused-vars
async function safeStorageSet(items) {
  if (!isExtensionContextValid()) {
    return false;
  }
  try {
    await chrome.storage.sync.set(items);
    return true;
  } catch (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      extensionContextInvalidated = true;
      showExtensionInvalidatedToast();
    }
    return false;
  }
}

/**
 * Wrapper for chrome.runtime.sendMessage that handles context invalidation
 * @param {Object} message - Message to send
 * @returns {Promise<any>} - Response or null if context invalid
 */
// eslint-disable-next-line no-unused-vars
async function safeSendMessage(message) {
  if (!isExtensionContextValid()) {
    showExtensionInvalidatedToast();
    return null;
  }
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (e) {
    if (e.message && (e.message.includes('Extension context invalidated') ||
                      e.message.includes('message channel closed'))) {
      extensionContextInvalidated = true;
      showExtensionInvalidatedToast();
    }
    throw e;
  }
}

/**
 * Show a toast message when extension context is invalidated
 * Only shows once per page session
 */
let toastShown = false;
// eslint-disable-next-line no-unused-vars
function showExtensionInvalidatedToast() {
  if (toastShown) return;
  // Guard: Don't run in service worker (no document)
  if (typeof document === 'undefined') return;
  toastShown = true;

  const toast = document.createElement('div');
  toast.className = 'dsc-context-toast';
  toast.innerHTML = `
    <div class="dsc-context-toast__content">
      <span class="dsc-context-toast__icon">⚠️</span>
      <span class="dsc-context-toast__text">Extension updated. Refresh the page to re-enable controls and settings.</span>
      <button class="dsc-context-toast__refresh" onclick="location.reload()">Refresh</button>
      <button class="dsc-context-toast__close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;
  document.body.appendChild(toast);

  // Auto-remove after 30 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 30000);
}

// ================================
// Wiktionary Language Utilities
// ================================

/**
 * Map of language codes to Wiktionary subdomains
 * Most languages use their ISO 639-1 code as subdomain
 */
const WIKTIONARY_LANG_MAP = {
  'en': 'en',
  'zh': 'zh',      // Chinese
  'de': 'de',      // German
  'fr': 'fr',      // French
  'es': 'es',      // Spanish
  'ru': 'ru',      // Russian
  'ja': 'ja',      // Japanese
  'pt': 'pt',      // Portuguese
  'it': 'it',      // Italian
  'pl': 'pl',      // Polish
  'nl': 'nl',      // Dutch
  'sv': 'sv',      // Swedish
  'fi': 'fi',      // Finnish
  'vi': 'vi',      // Vietnamese
  'ko': 'ko',      // Korean
  'ar': 'ar',      // Arabic
  'cs': 'cs',      // Czech
  'hu': 'hu',      // Hungarian
  'id': 'id',      // Indonesian
  'tr': 'tr',      // Turkish
  'th': 'th',      // Thai
  'el': 'el',      // Greek
  'uk': 'uk',      // Ukrainian
  'he': 'he',      // Hebrew
  'da': 'da',      // Danish
  'no': 'no',      // Norwegian
  'ro': 'ro',      // Romanian
  'hi': 'hi',      // Hindi
  'ms': 'ms'       // Malay
};

/**
 * Get the Wiktionary subdomain for a target language
 * @param {string} targetLang - Target language code (e.g., 'en', 'zh', 'EN-US')
 * @returns {string} - Wiktionary subdomain (defaults to 'en')
 */
// eslint-disable-next-line no-unused-vars
function getWiktionaryLang(targetLang) {
  const normalized = normalizeLanguageCode(targetLang);
  return WIKTIONARY_LANG_MAP[normalized] || 'en';
}

/**
 * Get the Wiktionary URL for a word in the target language
 * @param {string} word - The word to look up
 * @param {string} targetLang - Target language code
 * @returns {string} - Full Wiktionary URL
 */
// eslint-disable-next-line no-unused-vars
function getWiktionaryUrl(word, targetLang) {
  const lang = getWiktionaryLang(targetLang);
  return `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(word)}`;
}

/**
 * Get the Wiktionary API URL for a word
 * @param {string} word - The word to look up
 * @param {string} targetLang - Target language code
 * @returns {string} - Wiktionary API URL
 */
// eslint-disable-next-line no-unused-vars
function getWiktionaryApiUrl(word, targetLang) {
  const lang = getWiktionaryLang(targetLang);
  return `https://${lang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
}

// ================================
// Language Detection Utilities
// ================================

/**
 * Language code mapping for normalization
 * Maps various language codes to ISO 639-1 two-letter codes
 */
const LANGUAGE_CODE_MAP = {
  // Common variations
  'en-us': 'en', 'en-gb': 'en', 'en-au': 'en', 'eng': 'en', 'english': 'en',
  'fi': 'fi', 'fin': 'fi', 'finnish': 'fi', 'suomi': 'fi',
  'sv': 'sv', 'sv-se': 'sv', 'sv-fi': 'sv', 'swe': 'sv', 'swedish': 'sv', 'svenska': 'sv',
  'de': 'de', 'de-de': 'de', 'de-at': 'de', 'de-ch': 'de', 'deu': 'de', 'german': 'de',
  'fr': 'fr', 'fr-fr': 'fr', 'fr-ca': 'fr', 'fra': 'fr', 'french': 'fr',
  'es': 'es', 'es-es': 'es', 'es-mx': 'es', 'spa': 'es', 'spanish': 'es',
  'pt': 'pt', 'pt-br': 'pt', 'pt-pt': 'pt', 'por': 'pt', 'portuguese': 'pt',
  'it': 'it', 'it-it': 'it', 'ita': 'it', 'italian': 'it',
  'nl': 'nl', 'nl-nl': 'nl', 'nl-be': 'nl', 'nld': 'nl', 'dutch': 'nl',
  'ru': 'ru', 'ru-ru': 'ru', 'rus': 'ru', 'russian': 'ru',
  'ja': 'ja', 'ja-jp': 'ja', 'jpn': 'ja', 'japanese': 'ja',
  'ko': 'ko', 'ko-kr': 'ko', 'kor': 'ko', 'korean': 'ko',
  'zh': 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh', 'zho': 'zh', 'chinese': 'zh',
  'ar': 'ar', 'ar-sa': 'ar', 'ara': 'ar', 'arabic': 'ar',
  'hi': 'hi', 'hi-in': 'hi', 'hin': 'hi', 'hindi': 'hi',
  'no': 'no', 'nb': 'no', 'nn': 'no', 'nor': 'no', 'norwegian': 'no',
  'da': 'da', 'da-dk': 'da', 'dan': 'da', 'danish': 'da',
  'pl': 'pl', 'pl-pl': 'pl', 'pol': 'pl', 'polish': 'pl',
  'tr': 'tr', 'tr-tr': 'tr', 'tur': 'tr', 'turkish': 'tr',
  'uk': 'uk', 'uk-ua': 'uk', 'ukr': 'uk', 'ukrainian': 'uk',
  'el': 'el', 'el-gr': 'el', 'ell': 'el', 'greek': 'el',
  'cs': 'cs', 'cs-cz': 'cs', 'ces': 'cs', 'czech': 'cs',
  'ro': 'ro', 'ro-ro': 'ro', 'ron': 'ro', 'romanian': 'ro',
  'hu': 'hu', 'hu-hu': 'hu', 'hun': 'hu', 'hungarian': 'hu',
  'th': 'th', 'th-th': 'th', 'tha': 'th', 'thai': 'th',
  'vi': 'vi', 'vi-vn': 'vi', 'vie': 'vi', 'vietnamese': 'vi',
  'id': 'id', 'id-id': 'id', 'ind': 'id', 'indonesian': 'id',
  'ms': 'ms', 'ms-my': 'ms', 'msa': 'ms', 'malay': 'ms',
  'he': 'he', 'he-il': 'he', 'heb': 'he', 'hebrew': 'he', 'iw': 'he'
};

/**
 * Normalize a language code to ISO 639-1 two-letter format
 * @param {string} langCode - The language code to normalize (e.g., 'EN-US', 'en', 'english')
 * @returns {string} - Normalized two-letter code (e.g., 'en')
 */
// eslint-disable-next-line no-unused-vars
function normalizeLanguageCode(langCode) {
  if (!langCode || typeof langCode !== 'string') {
    return 'en'; // Default to English
  }

  // Lowercase and trim
  const normalized = langCode.toLowerCase().trim();

  // Check direct mapping
  if (LANGUAGE_CODE_MAP[normalized]) {
    return LANGUAGE_CODE_MAP[normalized];
  }

  // Try without region suffix (e.g., 'en-US' -> 'en')
  const withoutRegion = normalized.split(/[-_]/)[0];
  if (LANGUAGE_CODE_MAP[withoutRegion]) {
    return LANGUAGE_CODE_MAP[withoutRegion];
  }

  // If it's already a 2-letter code, return it as-is
  if (/^[a-z]{2}$/.test(withoutRegion)) {
    return withoutRegion;
  }

  // Default to the input lowercased (best effort)
  return withoutRegion || 'en';
}

/**
 * Compare two language codes for equality (after normalization)
 * @param {string} lang1 - First language code
 * @param {string} lang2 - Second language code
 * @returns {boolean} - True if languages are the same
 */
// eslint-disable-next-line no-unused-vars
function isSameLanguage(lang1, lang2) {
  return normalizeLanguageCode(lang1) === normalizeLanguageCode(lang2);
}

/**
 * Get the effective target language using cascade:
 * 1. User-configured target language (from storage)
 * 2. Browser/interface language (navigator.language)
 * 3. Chrome UI language (chrome.i18n.getUILanguage())
 * 4. Fallback to 'en'
 *
 * @returns {Promise<string>} - Normalized target language code
 */
// eslint-disable-next-line no-unused-vars
async function getEffectiveTargetLanguage() {
  try {
    // 1. Check user-configured target language
    const storageSyncInformation = await chrome.storage.sync.get('targetLanguage');
    if (storageSyncInformation && storageSyncInformation.targetLanguage) {
      return normalizeLanguageCode(storageSyncInformation.targetLanguage);
    }

    // 2. Try navigator.language (browser's interface language)
    if (typeof navigator !== 'undefined' && navigator.language) {
      return normalizeLanguageCode(navigator.language);
    }

    // 3. Try Chrome's UI language
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage) {
      return normalizeLanguageCode(chrome.i18n.getUILanguage());
    }

    // 4. Default fallback
    return 'en';
  } catch (error) {
    console.warn('DualSubExtension: Error getting effective target language:', error);
    return 'en';
  }
}

/**
 * Load extension enabled state from storage
 * @returns {Promise<boolean>} - Whether the extension is enabled
 */
// eslint-disable-next-line no-unused-vars
async function loadExtensionEnabledFromStorage() {
  try {
    const result = await chrome.storage.sync.get('extensionEnabled');
    // Default to true if not set
    return result.extensionEnabled !== false;
  } catch (error) {
    console.warn('DualSubExtension: Error loading extension enabled state:', error);
    return true;
  }
}

/**
 * Save extension enabled state to storage
 * @param {boolean} enabled - Whether the extension should be enabled
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
async function saveExtensionEnabledToStorage(enabled) {
  try {
    await chrome.storage.sync.set({ extensionEnabled: enabled });
  } catch (error) {
    console.error('DualSubExtension: Error saving extension enabled state:', error);
  }
}

// ================================
// End Language Detection Utilities
// ================================

/**
 * Load selected DeepL token from Chrome storage sync
 * @returns {Promise<{key: string, isPro: boolean} | null>} Returns token info or null if not found
 */
// eslint-disable-next-line no-unused-vars
async function loadSelectedTokenFromChromeStorageSync() {
  try {
    const result = await chrome.storage.sync.get("tokenInfos");

    if (result && result.tokenInfos && Array.isArray(result.tokenInfos)) {
      /**
       * @type {DeepLTokenInfoInStorage[]}
       */
      const deeplTokenInfos = result.tokenInfos;
      const selectedTokenInfo = deeplTokenInfos.find(token => token.selected === true);
      if (selectedTokenInfo) {
        return {
          key: selectedTokenInfo.key,
          isPro: selectedTokenInfo.type === "pro"
        };
      } else {
        console.info('YleDualSubExtension: No selected token found in storage');
        return null;
      }
    } else {
      console.info('YleDualSubExtension: No tokens found in storage');
      return null;
    }
  } catch (error) {
    console.error('YleDualSubExtension: Error loading application settings (to get token information) from storage:', error);
    return null;
  }
}

/**
 * Load all information
 * @returns {Promise<string>} return target language code (e.g., 'EN-US')
 */
// eslint-disable-next-line no-unused-vars
async function loadTargetLanguageFromChromeStorageSync() {
  try {
    const storageSyncInformation = await chrome.storage.sync.get("targetLanguage");
    if (!storageSyncInformation || typeof storageSyncInformation !== 'object') {
      console.info('YleDualSubExtension: No settings found in storage');
      return DEFAULT_TARGET_LANGUAGE;
    }

    if (storageSyncInformation.targetLanguage &&
      typeof storageSyncInformation.targetLanguage === 'string') {
      return storageSyncInformation.targetLanguage;
    } else {
      console.info('YleDualSubExtension: No target language found in storage, using default');
    }
    return DEFAULT_TARGET_LANGUAGE;
  } catch (error) {
    console.error('YleDualSubExtension: Error loading application settings (to get target language) from storage:', error);
    return DEFAULT_TARGET_LANGUAGE;
  }
}
