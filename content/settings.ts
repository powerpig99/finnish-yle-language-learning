// ==================================
// SETTINGS + STATE MANAGEMENT
// ==================================

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
    const result = await chrome.storage.sync.get("dualSubEnabled") as { dualSubEnabled?: boolean };
    if (result && typeof result.dualSubEnabled === 'boolean') {
      dualSubEnabled = result.dualSubEnabled;
      console.log("YleDualSubExtension: Loaded dual sub preference:", dualSubEnabled);
    } else {
      console.log("YleDualSubExtension: No dual sub preference found in storage, using default:", dualSubEnabled);
    }
    dualSubPreferenceLoaded = true;
    // Update checkbox if it exists
    const dualSubSwitch = document.getElementById("dual-sub-switch") as HTMLInputElement | null;
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

// State of Extension Enabled (global on/off toggle)
let extensionEnabled = true;
let detectedSourceLanguage: string | null = null;

// Target language for translation (loaded from storage)
window._targetLanguage = 'en'; // Default to English
chrome.storage.sync.get(['targetLanguage'], (result: { targetLanguage?: string }) => {
  if (result.targetLanguage) {
    window._targetLanguage = result.targetLanguage;
  }
});

/**
 * Load extension enabled state from Chrome storage
 */
async function loadExtensionEnabledState() {
  try {
    const result = await chrome.storage.sync.get(['extensionEnabled']) as { extensionEnabled?: boolean };
    extensionEnabled = result.extensionEnabled !== false; // Default to true
    console.info('DualSubExtension: Extension enabled state loaded:', extensionEnabled);
  } catch (error) {
    console.warn('DualSubExtension: Error loading extension enabled state:', error);
    extensionEnabled = true;
  }
}

// Load extension enabled state on startup
loadExtensionEnabledState();

/**
 * Check if subtitles should be processed based on extension state
 * @returns {boolean}
 */
function shouldProcessSubtitles() {
  return extensionEnabled;
}

/**
 * Check if translation should be performed
 * Returns false if source and target languages are the same
 * @returns {boolean}
 */
function shouldTranslate() {
  if (!extensionEnabled || !dualSubEnabled) {
    return false;
  }

  // If no detected source language, assume we should translate
  if (!detectedSourceLanguage) {
    return true;
  }

  // Check if same language using the utility function
  if (typeof isSameLanguage === 'function') {
    // Get target language from storage or use default
    const targetLang = window._targetLanguage || 'en';
    if (isSameLanguage(detectedSourceLanguage, targetLang)) {
      return false;
    }
  }

  return true;
}

// Load saved playback speed from chrome storage
chrome.storage.sync.get(['playbackSpeed'], (result: { playbackSpeed?: number }) => {
  if (result.playbackSpeed) {
    playbackSpeed = result.playbackSpeed;
    applyPlaybackSpeed();
  }
});

/**
 * Apply the current playback speed to the video element
 */
function applyPlaybackSpeed() {
  const video = document.querySelector('video') as HTMLVideoElement | null;
  if (video && video.playbackRate !== playbackSpeed) {
    video.playbackRate = playbackSpeed;
  }
}

/**
 * Save playback speed to chrome storage
 * @param {number} speed - The playback speed to save
 */
function savePlaybackSpeed(speed: number) {
  playbackSpeed = speed;
  chrome.storage.sync.set({ playbackSpeed: speed });
  applyPlaybackSpeed();
}

// Track video element to reapply speed on new videos
let lastVideoElement: HTMLVideoElement | null = null;

// Subtitle font size setting (small, medium, large, xlarge)
let subtitleFontSize = "medium";

// Font size scale factors using CSS cqw units (container query width percentage)
// Using CSS clamp() with container queries for automatic scaling based on player size
const FONT_SIZE_VW_MAP: Record<string, { main: string; translated: string; minMain: number; maxMain: number; minTrans: number; maxTrans: number }> = {
  small: { main: '1.8cqw', translated: '1.4cqw', minMain: 12, maxMain: 50, minTrans: 10, maxTrans: 38 },
  medium: { main: '2.2cqw', translated: '1.7cqw', minMain: 14, maxMain: 60, minTrans: 11, maxTrans: 46 },
  large: { main: '2.6cqw', translated: '2.0cqw', minMain: 16, maxMain: 72, minTrans: 12, maxTrans: 55 },
  xlarge: { main: '3.0cqw', translated: '2.3cqw', minMain: 18, maxMain: 84, minTrans: 14, maxTrans: 64 },
  xxlarge: { main: '3.4cqw', translated: '2.6cqw', minMain: 20, maxMain: 96, minTrans: 16, maxTrans: 72 },
  huge: { main: '4.0cqw', translated: '3.0cqw', minMain: 24, maxMain: 120, minTrans: 18, maxTrans: 90 }
};

// Load saved subtitle font size from chrome storage
chrome.storage.sync.get(['subtitleFontSize'], (result: { subtitleFontSize?: string }) => {
  if (result.subtitleFontSize) {
    subtitleFontSize = result.subtitleFontSize;
  }
  // Always apply font size (use default if not set)
  applySubtitleFontSize();
});

/**
 * Apply the current subtitle font size via CSS injection
 * Uses CSS clamp() with cqw units for automatic responsive scaling based on player size
 */
function applySubtitleFontSize() {
  const styleId = 'yle-dual-sub-fontsize-style';
  let styleEl = document.getElementById(styleId);

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  const sizes = FONT_SIZE_VW_MAP[subtitleFontSize] || FONT_SIZE_VW_MAP.medium;

  // Use CSS clamp() for automatic responsive scaling
  // clamp(min, preferred, max) - preferred uses cqw units which scale with container (player) width
  styleEl.textContent = `
    #displayed-subtitles-wrapper span {
      font-size: clamp(${sizes.minMain}px, ${sizes.main}, ${sizes.maxMain}px) !important;
    }
    #displayed-subtitles-wrapper .translated-text-span,
    #displayed-subtitles-wrapper .dual-sub-translated {
      font-size: clamp(${sizes.minTrans}px, ${sizes.translated}, ${sizes.maxTrans}px) !important;
    }
  `;
}

/**
 * Setup speed control for video element
 */
function setupVideoSpeedControl() {
  const video = document.querySelector('video') as HTMLVideoElement | null;
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

/**
 * Check if a valid translation provider is configured
 * Google Translate works without an API key, so it's always valid
 * @returns {Promise<boolean>}
 */
async function checkHasValidProvider() {
  try {
    const result = await chrome.storage.sync.get([
      'translationProvider',
      'providerApiKey',
      'deeplApiKey',
      'claudeApiKey',
      'geminiApiKey',
      'grokApiKey',
      'kimiApiKey',
      'tokenInfos'
    ]) as {
      translationProvider?: string;
      providerApiKey?: string;
      deeplApiKey?: string;
      claudeApiKey?: string;
      geminiApiKey?: string;
      grokApiKey?: string;
      kimiApiKey?: string;
      tokenInfos?: DeepLTokenInfoInStorage[];
    };

    const provider = result.translationProvider || 'google';

    // Google Translate doesn't need a key
    if (provider === 'google') {
      return true;
    }

    // Provider-specific key lookup (fallback to legacy providerApiKey if present)
    const keyMap: Record<string, string | undefined> = {
      deepl: result.deeplApiKey,
      claude: result.claudeApiKey,
      gemini: result.geminiApiKey,
      grok: result.grokApiKey,
      kimi: result.kimiApiKey
    };

    let apiKey = keyMap[provider] || result.providerApiKey || '';

    // Backward compatibility with DeepL tokens
    if (provider === 'deepl' && !apiKey && Array.isArray(result.tokenInfos)) {
      const selectedToken = result.tokenInfos.find(t => t.selected);
      if (selectedToken?.key) {
        apiKey = selectedToken.key;
      }
    }

    return apiKey.trim().length > 0;
  } catch (error) {
    console.error('YleDualSubExtension: Error checking provider:', error);
    // Default to true (Google Translate) on error
    return true;
  }
}

/**
 * Handle dual sub behaviour based on whether a provider key is configured.
 * If no key is selected, display warning icon and disable dual sub switch.
 * @param {boolean} hasSelectedToken
 */
function _handleDualSubBehaviourBasedOnSelectedToken(hasSelectedToken: boolean) {
  const warningSection = document.querySelector(".dual-sub-warning") as HTMLElement | null;
  const dualSubSwitch = document.getElementById("dual-sub-switch") as HTMLInputElement | null;
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
  const warningPopover = document.querySelector(".dual-sub-warning__popover") as HTMLElement | null;
  if (warningPopover) {
    warningPopover.classList.remove("active");
  }
}

// Track the last subtitle text to detect changes for auto-pause
let lastSubtitleText = "";

// Flag to temporarily disable auto-pause during subtitle skipping
let isSkippingSubtitle = false;

// Flag to temporarily disable auto-pause during subtitle repeat
let isRepeatingSubtitle = false;

/**
 * Check if auto-pause should trigger for a new subtitle
 * @param {string} newSubtitleText
 */
function checkAndAutoPause(newSubtitleText: string) {
  // Only proceed if auto-pause is enabled and we're not currently skipping or repeating
  if (!autoPauseEnabled || isSkippingSubtitle || isRepeatingSubtitle) {
    return;
  }

  // Only pause if the subtitle text actually changed (not just styling)
  const normalizedNew = newSubtitleText.trim().toLowerCase();
  const normalizedLast = lastSubtitleText.trim().toLowerCase();

  if (normalizedNew && normalizedNew !== normalizedLast && normalizedNew.length > 1) {
    console.log("YleDualSubExtension: Auto-pause triggered, new subtitle:", normalizedNew.substring(0, 30));
    const videoElement = document.querySelector('video') as HTMLVideoElement | null;
    if (videoElement && !videoElement.paused) {
      // Small delay to let the subtitle fully render before pausing
      setTimeout(() => {
        if (autoPauseEnabled) {
          const video = document.querySelector('video') as HTMLVideoElement | null;
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
    const result = await chrome.storage.sync.get("autoPauseEnabled") as { autoPauseEnabled?: boolean };
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
  const autoPauseSwitch = document.getElementById('auto-pause-switch') as HTMLInputElement | null;
  if (autoPauseSwitch) {
    autoPauseSwitch.checked = autoPauseEnabled;
  }
}

// Load auto-pause preference on startup
loadAutoPausePreference();

// Listen for user setting changes for provider/key selection in Options page
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  // Handle provider or API key changes
  if (namespace === 'sync' && (
    changes.translationProvider ||
    changes.providerApiKey ||
    changes.deeplApiKey ||
    changes.claudeApiKey ||
    changes.geminiApiKey ||
    changes.grokApiKey ||
    changes.kimiApiKey ||
    changes.tokenInfos
  )) {
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
  // Handle subtitle font size changes
  if (namespace === 'sync' && changes.subtitleFontSize) {
    const newSize = changes.subtitleFontSize.newValue;
    if (newSize && typeof newSize === 'string') {
      subtitleFontSize = newSize;
      applySubtitleFontSize();
      console.info(`YleDualSubExtension: Subtitle font size updated to ${newSize}`);
    }
  }
});

// Listen for storage changes (cross-tab sync)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;

  if (changes.extensionEnabled) {
    const newEnabled = changes.extensionEnabled.newValue !== false;
    if (newEnabled !== extensionEnabled) {
      extensionEnabled = newEnabled;
      console.info('DualSubExtension: Extension enabled changed via storage:', newEnabled);

      // Update control integration if available
      if (typeof ControlIntegration !== 'undefined') {
        ControlIntegration.updateState({ extensionEnabled: newEnabled });
      }
    }
  }

  if (changes.targetLanguage) {
    targetLanguage = (changes.targetLanguage.newValue as string | undefined) || 'EN-US';
    console.info('DualSubExtension: Target language changed via storage:', targetLanguage);

    // Update control integration and recalculate activation
    if (typeof ControlIntegration !== 'undefined') {
      ControlIntegration.setTargetLanguage(targetLanguage);
    }
  }
});
