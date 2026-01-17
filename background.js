/* global importScripts */
importScripts('utils.js');

// ==================================
// TRANSLATION PROVIDER CONFIGURATION
// ==================================

/**
 * @typedef {Object} ProviderConfig
 * @property {string} provider - Provider name: 'google', 'deepl', 'claude', 'gemini', 'grok'
 * @property {string} [apiKey] - API key (not needed for Google Translate)
 * @property {boolean} [isPro] - For DeepL: whether it's a pro key
 */

/** @type {ProviderConfig} */
let currentProvider = { provider: 'google' }; // Default to free Google Translate

// Load provider config on startup
loadProviderConfig();

async function loadProviderConfig() {
  try {
    const result = await chrome.storage.sync.get(['translationProvider', 'providerApiKey', 'tokenInfos']);

    if (result.translationProvider) {
      currentProvider.provider = result.translationProvider;
      currentProvider.apiKey = result.providerApiKey || '';

      // For backward compatibility with DeepL tokens
      if (result.translationProvider === 'deepl' && result.tokenInfos) {
        const selectedToken = result.tokenInfos.find(t => t.selected);
        if (selectedToken) {
          currentProvider.apiKey = selectedToken.key;
          currentProvider.isPro = selectedToken.type === 'pro';
        }
      }
    }
    console.info('YleDualSubExtension: Loaded provider config:', currentProvider.provider);
  } catch (error) {
    console.error('YleDualSubExtension: Error loading provider config:', error);
  }
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.translationProvider || changes.providerApiKey || changes.tokenInfos) {
      console.info('YleDualSubExtension: Provider configuration changed, reloading...');
      loadProviderConfig();
    }
  }
});

// ==================================
// MESSAGE HANDLING
// ==================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'fetchTranslation') {
    const { rawSubtitleFinnishTexts, targetLanguage } = request.data;
    translateTextsWithErrorHandling(rawSubtitleFinnishTexts, targetLanguage)
      .then(sendResponse)
      .catch((error) => sendResponse([false, error.message || String(error)]));
    return true;
  }

  if (request.action === 'fetchBatchTranslation') {
    const { texts, targetLanguage, isContextual } = request.data;
    translateBatchWithContext(texts, targetLanguage, isContextual)
      .then(sendResponse)
      .catch((error) => sendResponse([false, error.message || String(error)]));
    return true;
  }

  if (request.action === 'translateWordWithContext') {
    const { word, context, targetLanguage, langName } = request.data;
    translateWordWithContext(word, context, targetLanguage, langName)
      .then(sendResponse)
      .catch((error) => sendResponse([false, error.message || String(error)]));
    return true;
  }

  if (request.action === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (request.action === 'clearWordCache') {
    clearWordTranslationCache()
      .then(count => sendResponse({ success: true, count }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

/**
 * Clear all word translations from IndexedDB cache
 * @returns {Promise<number>} Number of entries cleared
 */
async function clearWordTranslationCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('YleDualSubCache', 3);

    request.onerror = () => reject(new Error('Failed to open database'));

    request.onsuccess = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('WordTranslations')) {
        db.close();
        resolve(0);
        return;
      }

      const transaction = db.transaction(['WordTranslations'], 'readwrite');
      const store = transaction.objectStore('WordTranslations');

      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const count = countRequest.result;
        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
          console.info(`YleDualSubExtension: Cleared ${count} word translations from cache`);
          db.close();
          resolve(count);
        };

        clearRequest.onerror = () => {
          db.close();
          reject(new Error('Failed to clear cache'));
        };
      };

      countRequest.onerror = () => {
        db.close();
        reject(new Error('Failed to count cache entries'));
      };
    };
  });
}

// ==================================
// TRANSLATION ROUTER
// ==================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateBackoffDelay(attempt) {
  const exponentialDelay = 200 * Math.pow(2, attempt);
  const jitter = Math.random() * (exponentialDelay / 2);
  return exponentialDelay + jitter;
}

/**
 * Main translation function with error handling and retries
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateTextsWithErrorHandling(texts, targetLanguage) {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await translateTexts(texts, targetLanguage);
      if (result[0]) {
        return result;
      }

      // Check if error is retryable
      const errorMsg = result[1];
      if (typeof errorMsg === 'string' && errorMsg.includes('rate limit')) {
        if (attempt < MAX_RETRIES - 1) {
          await sleep(calculateBackoffDelay(attempt));
          continue;
        }
      }
      return result;
    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(calculateBackoffDelay(attempt));
        continue;
      }
      return [false, error.message || 'Translation failed'];
    }
  }
  return [false, 'Translation failed after retries'];
}

/**
 * Route translation to the appropriate provider
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateTexts(texts, targetLanguage) {
  const provider = currentProvider.provider;

  switch (provider) {
    case 'google':
      return translateWithGoogle(texts, targetLanguage);
    case 'deepl':
      return translateWithDeepL(texts, targetLanguage);
    case 'claude':
      return translateWithClaude(texts, targetLanguage);
    case 'gemini':
      return translateWithGemini(texts, targetLanguage);
    case 'grok':
      return translateWithGrok(texts, targetLanguage);
    default:
      return translateWithGoogle(texts, targetLanguage);
  }
}

/**
 * Translate batch of subtitles with context awareness
 * Uses special prompts for AI providers to maintain narrative consistency
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @param {boolean} isContextual - Whether to use contextual translation
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateBatchWithContext(texts, targetLanguage, isContextual) {
  const provider = currentProvider.provider;

  // For Google and DeepL, use regular translation (they don't benefit from context prompts)
  if (provider === 'google' || provider === 'deepl') {
    return translateTextsWithErrorHandling(texts, targetLanguage);
  }

  // For AI providers, use contextual translation
  if (isContextual && (provider === 'claude' || provider === 'gemini' || provider === 'grok')) {
    return translateWithContextualAI(texts, targetLanguage, provider);
  }

  // Fallback to regular translation
  return translateTextsWithErrorHandling(texts, targetLanguage);
}

/**
 * Translate with contextual AI prompt for better subtitle translation
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @param {string} provider - AI provider name
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithContextualAI(texts, targetLanguage, provider) {
  const apiKey = currentProvider.apiKey;
  if (!apiKey) {
    return [false, `${provider} API key not configured`];
  }

  const langName = getLanguageName(targetLanguage);

  // Create a contextual prompt for better translation
  const contextualPrompt = `You are translating Finnish TV/movie subtitles to ${langName}. These subtitles are sequential dialogue from the same show.

IMPORTANT RULES:
1. Maintain consistency for character names, places, and recurring terms
2. Keep translations natural and conversational
3. Preserve the emotional tone and register of speech
4. Return EXACTLY ${texts.length} translations, one per line
5. Do NOT add numbering, explanations, or any extra text
6. Each line of your response corresponds to each input subtitle in order

Finnish subtitles to translate:
${texts.map((t, i) => `[${i + 1}] ${t}`).join('\n')}

Translations (${texts.length} lines, no numbering):`;

  try {
    let response;
    let content;

    if (provider === 'claude') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 4096,
          messages: [{ role: 'user', content: contextualPrompt }]
        })
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 401) return [false, 'Invalid Claude API key'];
        if (status === 429) return [false, 'Claude rate limit exceeded'];
        return [false, `Claude error: ${status}`];
      }

      const data = await response.json();
      content = data.content[0].text;

    } else if (provider === 'gemini') {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: contextualPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
        })
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 400) return [false, 'Invalid Gemini API key'];
        if (status === 429) return [false, 'Gemini rate limit exceeded'];
        return [false, `Gemini error: ${status}`];
      }

      const data = await response.json();
      content = data.candidates[0].content.parts[0].text;

    } else if (provider === 'grok') {
      response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-non-reasoning-latest',
          messages: [{ role: 'user', content: contextualPrompt }],
          temperature: 0.1,
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 401) return [false, 'Invalid Grok API key'];
        if (status === 429) return [false, 'Grok rate limit exceeded'];
        return [false, `Grok error: ${status}`];
      }

      const data = await response.json();
      content = data.choices[0].message.content;
    }

    // Parse the response - split by newlines and filter empty lines
    const translations = content.split('\n').filter(line => line.trim()).slice(0, texts.length);

    // Ensure we have the right number of translations
    while (translations.length < texts.length) {
      translations.push(texts[translations.length]);
    }

    return [true, translations];

  } catch (error) {
    console.error(`YleDualSubExtension: Contextual ${provider} error:`, error);
    return [false, `${provider} translation failed: ${error.message}`];
  }
}

// ==================================
// SINGLE WORD TRANSLATION WITH CONTEXT
// ==================================

/**
 * Translate a single word using LLM with subtitle context for better accuracy
 * @param {string} word - The word to translate
 * @param {string} context - The subtitle context (formatted string)
 * @param {string} targetLanguage - Target language code
 * @param {string} langName - Human-readable language name
 * @returns {Promise<[true, string]|[false, string]>}
 */
async function translateWordWithContext(word, context, targetLanguage, langName) {
  const provider = currentProvider.provider;
  const apiKey = currentProvider.apiKey;

  // For Google Translate, fall back to simple translation (no context support)
  if (provider === 'google') {
    const result = await translateWithGoogle([word], targetLanguage);
    if (result[0] && Array.isArray(result[1])) {
      return [true, result[1][0]]; // Extract first translation from array
    }
    return result;
  }

  // For DeepL, also fall back to simple translation
  if (provider === 'deepl') {
    const result = await translateWithDeepL([word], targetLanguage);
    if (result[0] && Array.isArray(result[1])) {
      return [true, result[1][0]]; // Extract first translation from array
    }
    return result;
  }

  if (!apiKey) {
    return [false, `${provider} API key not configured`];
  }

  const contextualPrompt = `You are helping someone learn Finnish by translating a single word from Finnish TV subtitles.

Context from the subtitles:
${context}

Translate the Finnish word "${word}" to ${langName}.

IMPORTANT:
- Consider the context to choose the most appropriate meaning
- Return ONLY the translation, nothing else
- If it's a verb form, give the meaning of that specific form
- Keep the translation concise (1-5 words)`;

  try {
    let response;
    let content;

    if (provider === 'claude') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 100,
          messages: [{ role: 'user', content: contextualPrompt }]
        })
      });

      if (!response.ok) {
        return [false, `Claude error: ${response.status}`];
      }

      const data = await response.json();
      content = data.content[0].text.trim();

    } else if (provider === 'gemini') {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: contextualPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 100 }
        })
      });

      if (!response.ok) {
        return [false, `Gemini error: ${response.status}`];
      }

      const data = await response.json();
      content = data.candidates[0].content.parts[0].text.trim();

    } else if (provider === 'grok') {
      response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-non-reasoning-latest',
          messages: [{ role: 'user', content: contextualPrompt }],
          temperature: 0.1,
          max_tokens: 100
        })
      });

      if (!response.ok) {
        return [false, `Grok error: ${response.status}`];
      }

      const data = await response.json();
      content = data.choices[0].message.content.trim();
    } else {
      return [false, 'Unsupported provider for contextual word translation'];
    }

    return [true, content];

  } catch (error) {
    console.error(`YleDualSubExtension: Word translation error:`, error);
    return [false, error.message || 'Translation failed'];
  }
}

// ==================================
// GOOGLE TRANSLATE (FREE)
// ==================================

/**
 * Translate using Google Translate (free, no API key needed)
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithGoogle(texts, targetLanguage) {
  try {
    // Convert language code to Google format
    const googleLang = convertToGoogleLangCode(targetLanguage);
    console.log('YleDualSubExtension: Google Translate request - texts:', texts.length, 'target:', googleLang);

    const translations = [];

    // Process sequentially with delays to avoid rate limiting
    for (let index = 0; index < texts.length; index++) {
      const text = texts[index];

      // Add delay between requests to avoid rate limiting (except for first request)
      if (index > 0) {
        await sleep(150); // 150ms delay between requests
      }

      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=fi&tl=${googleLang}&dt=t&q=${encodeURIComponent(text)}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`YleDualSubExtension: Google Translate HTTP error for text ${index}:`, response.status);
          // On error, use original text instead of failing entire batch
          translations.push(text);
          continue;
        }

        const data = await response.json();
        // Google returns nested arrays, extract translated text
        let translated = '';
        if (data && data[0]) {
          for (const part of data[0]) {
            if (part[0]) {
              translated += part[0];
            }
          }
        }

        if (!translated) {
          console.warn(`YleDualSubExtension: Google Translate returned empty for text ${index}:`, text.substring(0, 30));
        }

        translations.push(translated || text);
      } catch (fetchError) {
        console.error(`YleDualSubExtension: Google Translate fetch error for text ${index}:`, fetchError);
        // On error, use original text instead of failing entire batch
        translations.push(text);
      }
    }

    console.log('YleDualSubExtension: Google Translate success - translated:', translations.length);
    return [true, translations];
  } catch (error) {
    console.error('YleDualSubExtension: Google Translate error:', error);
    return [false, 'Google Translate failed: ' + error.message];
  }
}

function convertToGoogleLangCode(langCode) {
  // Convert DeepL-style codes to Google codes
  const mapping = {
    'EN-US': 'en',
    'EN-GB': 'en',
    'PT-PT': 'pt',
    'PT-BR': 'pt',
    'ZH': 'zh-CN',
  };
  return mapping[langCode] || langCode.toLowerCase().split('-')[0];
}

// ==================================
// DEEPL TRANSLATION
// ==================================

/**
 * Translate using DeepL API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithDeepL(texts, targetLanguage) {
  const apiKey = currentProvider.apiKey;
  if (!apiKey) {
    return [false, 'DeepL API key not configured. Please add your API key in settings.'];
  }

  const url = currentProvider.isPro
    ? 'https://api.deepl.com/v2/translate'
    : 'https://api-free.deepl.com/v2/translate';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${apiKey}`
      },
      body: JSON.stringify({
        text: texts,
        source_lang: 'FI',
        target_lang: targetLanguage,
      })
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 403) return [false, 'Invalid DeepL API key'];
      if (status === 456) return [false, 'DeepL quota exceeded'];
      if (status === 429) return [false, 'DeepL rate limit exceeded'];
      return [false, `DeepL error: ${status}`];
    }

    const data = await response.json();
    const translations = data.translations.map(t => t.text);
    return [true, translations];
  } catch (error) {
    console.error('YleDualSubExtension: DeepL error:', error);
    return [false, 'DeepL translation failed: ' + error.message];
  }
}

// ==================================
// CLAUDE (ANTHROPIC) TRANSLATION
// ==================================

/**
 * Translate using Claude API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithClaude(texts, targetLanguage) {
  const apiKey = currentProvider.apiKey;
  if (!apiKey) {
    return [false, 'Claude API key not configured. Please add your API key in settings.'];
  }

  const langName = getLanguageName(targetLanguage);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Translate the following Finnish texts to ${langName}. Return ONLY the translations, one per line, in the same order. No explanations or numbering.

${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
        }]
      })
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401) return [false, 'Invalid Claude API key'];
      if (status === 429) return [false, 'Claude rate limit exceeded'];
      return [false, `Claude error: ${status}`];
    }

    const data = await response.json();
    const content = data.content[0].text;
    const translations = content.split('\n').filter(line => line.trim()).slice(0, texts.length);

    // Ensure we have the right number of translations
    while (translations.length < texts.length) {
      translations.push(texts[translations.length]);
    }

    return [true, translations];
  } catch (error) {
    console.error('YleDualSubExtension: Claude error:', error);
    return [false, 'Claude translation failed: ' + error.message];
  }
}

// ==================================
// GEMINI (GOOGLE AI) TRANSLATION
// ==================================

/**
 * Translate using Gemini API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithGemini(texts, targetLanguage) {
  const apiKey = currentProvider.apiKey;
  if (!apiKey) {
    return [false, 'Gemini API key not configured. Please add your API key in settings.'];
  }

  const langName = getLanguageName(targetLanguage);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Translate the following Finnish texts to ${langName}. Return ONLY the translations, one per line, in the same order. No explanations, no numbering, no extra formatting.

${texts.join('\n')}`
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 400) return [false, 'Invalid Gemini API key'];
      if (status === 429) return [false, 'Gemini rate limit exceeded'];
      return [false, `Gemini error: ${status}`];
    }

    const data = await response.json();
    const content = data.candidates[0].content.parts[0].text;
    const translations = content.split('\n').filter(line => line.trim()).slice(0, texts.length);

    while (translations.length < texts.length) {
      translations.push(texts[translations.length]);
    }

    return [true, translations];
  } catch (error) {
    console.error('YleDualSubExtension: Gemini error:', error);
    return [false, 'Gemini translation failed: ' + error.message];
  }
}

// ==================================
// GROK (xAI) TRANSLATION
// ==================================

/**
 * Translate using Grok/xAI API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithGrok(texts, targetLanguage) {
  const apiKey = currentProvider.apiKey;
  if (!apiKey) {
    return [false, 'Grok API key not configured. Please add your API key in settings.'];
  }

  const langName = getLanguageName(targetLanguage);

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning-latest',
        messages: [{
          role: 'user',
          content: `Translate the following Finnish texts to ${langName}. Return ONLY the translations, one per line, in the same order. No explanations, no numbering.

${texts.join('\n')}`
        }],
        temperature: 0.1,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401) return [false, 'Invalid Grok API key'];
      if (status === 429) return [false, 'Grok rate limit exceeded'];
      return [false, `Grok error: ${status}`];
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const translations = content.split('\n').filter(line => line.trim()).slice(0, texts.length);

    while (translations.length < texts.length) {
      translations.push(texts[translations.length]);
    }

    return [true, translations];
  } catch (error) {
    console.error('YleDualSubExtension: Grok error:', error);
    return [false, 'Grok translation failed: ' + error.message];
  }
}

// ==================================
// UTILITIES
// ==================================

/**
 * Get human-readable language name from code
 * @param {string} langCode
 * @returns {string}
 */
function getLanguageName(langCode) {
  const languages = {
    'EN-US': 'English',
    'EN-GB': 'English',
    'DE': 'German',
    'FR': 'French',
    'ES': 'Spanish',
    'IT': 'Italian',
    'NL': 'Dutch',
    'PL': 'Polish',
    'PT-PT': 'Portuguese',
    'PT-BR': 'Brazilian Portuguese',
    'RU': 'Russian',
    'JA': 'Japanese',
    'ZH': 'Chinese',
    'KO': 'Korean',
    'VI': 'Vietnamese',
    'SV': 'Swedish',
    'DA': 'Danish',
    'NO': 'Norwegian',
    'FI': 'Finnish',
  };
  return languages[langCode] || langCode;
}
