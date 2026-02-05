import { useEffect, useState } from "react";
import "./App.css";

const DEFAULT_TARGET_LANGUAGE = "EN-US";

class ChromeStorageSyncHandler {
  static async getTargetLanguage() {
    const result = await chrome.storage.sync.get("targetLanguage");
    if (typeof result !== "object" || result === null) return DEFAULT_TARGET_LANGUAGE;
    if (!Object.prototype.hasOwnProperty.call(result, "targetLanguage")) return DEFAULT_TARGET_LANGUAGE;
    if (typeof result.targetLanguage !== "string" || result.targetLanguage.length === 0) return DEFAULT_TARGET_LANGUAGE;
    return result.targetLanguage;
  }

  static async setTargetLanguage(targetLanguage) {
    await chrome.storage.sync.set({ targetLanguage: targetLanguage });
  }
}

const PROVIDERS = [
  { id: "google", name: "Google Translate", description: "Free, no API key needed" },
  { id: "deepl", name: "DeepL", description: "Best for Finnish", link: "https://www.deepl.com/en/your-account/keys" },
  { id: "claude", name: "Claude (Anthropic)", description: "High quality AI", link: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", name: "Gemini (Google AI)", description: "Google's AI model", link: "https://aistudio.google.com/apikey" },
  { id: "grok", name: "Grok (xAI)", description: "xAI's model", link: "https://console.x.ai" },
  { id: "kimi", name: "Kimi (Moonshot)", description: "Kimi 2.5 for Kimi Coding", link: "https://platform.moonshot.ai" },
];

const FONT_SIZES = [
  { value: "small", label: "S", tooltip: "Small (24px/20px)" },
  { value: "medium", label: "M", tooltip: "Medium (32px/28px)" },
  { value: "large", label: "L", tooltip: "Large (40px/36px)" },
  { value: "xlarge", label: "XL", tooltip: "Extra Large (48px/42px)" },
  { value: "xxlarge", label: "2K", tooltip: "2K Display (56px/50px)" },
  { value: "huge", label: "4K", tooltip: "4K Display (64px/56px)" },
];

const LANGUAGES = [
  { code: "EN-US", name: "English (US)" },
  { code: "EN-GB", name: "English (UK)" },
  { code: "VI", name: "Vietnamese" },
  { code: "AR", name: "Arabic" },
  { code: "BG", name: "Bulgarian" },
  { code: "CS", name: "Czech" },
  { code: "DA", name: "Danish" },
  { code: "DE", name: "German" },
  { code: "EL", name: "Greek" },
  { code: "ES", name: "Spanish" },
  { code: "ES-419", name: "Spanish (Latin American)" },
  { code: "ET", name: "Estonian" },
  { code: "FI", name: "Finnish" },
  { code: "FR", name: "French" },
  { code: "HU", name: "Hungarian" },
  { code: "ID", name: "Indonesian" },
  { code: "IT", name: "Italian" },
  { code: "JA", name: "Japanese" },
  { code: "KO", name: "Korean" },
  { code: "LT", name: "Lithuanian" },
  { code: "LV", name: "Latvian" },
  { code: "NB", name: "Norwegian (Bokmål)" },
  { code: "NL", name: "Dutch" },
  { code: "PL", name: "Polish" },
  { code: "PT-BR", name: "Portuguese (Brazilian)" },
  { code: "PT-PT", name: "Portuguese (European)" },
  { code: "RO", name: "Romanian" },
  { code: "RU", name: "Russian" },
  { code: "SK", name: "Slovak" },
  { code: "SL", name: "Slovenian" },
  { code: "SV", name: "Swedish" },
  { code: "TR", name: "Turkish" },
  { code: "UK", name: "Ukrainian" },
  { code: "ZH-HANS", name: "Chinese (Simplified)" },
  { code: "ZH-HANT", name: "Chinese (Traditional)" },
];

function App() {
  const [translationProvider, setTranslationProvider] = useState("google");
  const [apiKeys, setApiKeys] = useState({
    deepl: "",
    claude: "",
    gemini: "",
    grok: "",
    kimi: "",
  });
  const [targetLanguage, setTargetLanguage] = useState("EN-US");
  const [subtitleFontSize, setSubtitleFontSize] = useState("medium");
  const [cacheCounts, setCacheCounts] = useState({ wordCount: 0, subtitleCount: 0 });

  // Load cache counts
  const refreshCacheCounts = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getCacheCounts" });
      if (response?.success) {
        setCacheCounts({ wordCount: response.wordCount, subtitleCount: response.subtitleCount });
      }
    } catch (e) {
      console.error("Failed to get cache counts:", e);
    }
  };

  // Load settings on mount
  useEffect(() => {
    chrome.storage.sync.get([
      "translationProvider",
      "deeplApiKey",
      "claudeApiKey",
      "geminiApiKey",
      "grokApiKey",
      "kimiApiKey",
      "subtitleFontSize",
    ])
      .then((result) => {
        if (result.translationProvider) setTranslationProvider(result.translationProvider);
        if (result.subtitleFontSize) setSubtitleFontSize(result.subtitleFontSize);
        setApiKeys({
          deepl: result.deeplApiKey || "",
          claude: result.claudeApiKey || "",
          gemini: result.geminiApiKey || "",
          grok: result.grokApiKey || "",
          kimi: result.kimiApiKey || "",
        });
      })
      .catch(console.error);

    ChromeStorageSyncHandler.getTargetLanguage()
      .then(setTargetLanguage)
      .catch(console.error);

    refreshCacheCounts();
  }, []);

  const handleProviderChange = (providerId) => {
    setTranslationProvider(providerId);
    chrome.storage.sync.set({ translationProvider: providerId }).catch(console.error);
  };

  const handleApiKeyChange = (e) => {
    setApiKeys((prev) => ({ ...prev, [translationProvider]: e.target.value }));
  };

  const handleApiKeyBlur = () => {
    const storageKey = `${translationProvider}ApiKey`;
    chrome.storage.sync.set({ [storageKey]: apiKeys[translationProvider] }).catch(console.error);
  };

  const handleLanguageChange = (e) => {
    const lang = e.target.value;
    setTargetLanguage(lang);
    ChromeStorageSyncHandler.setTargetLanguage(lang).catch(console.error);
  };

  const handleFontSizeChange = (e) => {
    const size = e.target.value;
    setSubtitleFontSize(size);
    chrome.storage.sync.set({ subtitleFontSize: size }).catch(console.error);
  };

  const handleClearWordCache = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: "clearWordCache" });
      if (response?.success) {
        refreshCacheCounts();
      } else {
        alert("Failed to clear: " + (response?.error || "Unknown error"));
      }
    } catch (error) {
      alert("Error: " + error.message);
    }
  };

  const handleClearSubtitleCache = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: "clearSubtitleCaches" });
      if (response?.success) {
        refreshCacheCounts();
      } else {
        alert("Failed to clear: " + (response?.error || "Unknown error"));
      }
    } catch (error) {
      alert("Error: " + error.message);
    }
  };

  const currentProvider = PROVIDERS.find((p) => p.id === translationProvider);
  const needsApiKey = translationProvider !== "google";
  const currentApiKey = apiKeys[translationProvider] || "";
  const fontSizeIndex = FONT_SIZES.findIndex((f) => f.value === subtitleFontSize);

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>LLS Settings</h1>
      </header>

      <main className="settings-content">
        {/* Translation Provider */}
        <section className="settings-section">
          <h2>Translation Provider</h2>
          <div className="provider-list">
            {PROVIDERS.map((provider) => (
              <label key={provider.id} className="provider-option">
                <input
                  type="radio"
                  name="provider"
                  checked={translationProvider === provider.id}
                  onChange={() => handleProviderChange(provider.id)}
                />
                <span className="provider-name">{provider.name}</span>
                <span className="provider-desc">{provider.description}</span>
              </label>
            ))}
          </div>

          {needsApiKey && (
            <div className="api-key-section">
              <input
                type="password"
                value={currentApiKey}
                onChange={handleApiKeyChange}
                onBlur={handleApiKeyBlur}
                placeholder={`Enter ${currentProvider?.name} API key`}
                className="api-key-input"
              />
              {currentProvider?.link && (
                <a href={currentProvider.link} target="_blank" rel="noopener noreferrer" className="api-key-link">
                  Get API key →
                </a>
              )}
            </div>
          )}

        </section>

        <hr className="divider" />

        {/* Target Language */}
        <section className="settings-section">
          <h2>Target Language</h2>
          <select value={targetLanguage} onChange={handleLanguageChange} className="language-dropdown">
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </section>

        <hr className="divider" />

        {/* Subtitle Size */}
        <section className="settings-section">
          <h2>Subtitle Size</h2>
          <div className="slider-container">
            <span className="slider-label">S</span>
            <input
              type="range"
              min="0"
              max={FONT_SIZES.length - 1}
              value={fontSizeIndex >= 0 ? fontSizeIndex : 1}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                handleFontSizeChange({ target: { value: FONT_SIZES[idx].value } });
              }}
              className="size-slider"
            />
            <span className="slider-label">4K</span>
          </div>
          <div className="slider-value">{FONT_SIZES[fontSizeIndex >= 0 ? fontSizeIndex : 1].tooltip}</div>
        </section>

        <hr className="divider" />

        {/* Cache Management */}
        <section className="settings-section">
          <h2>Cache Management</h2>
          <div className="cache-buttons">
            <div className="cache-item">
              <button onClick={handleClearWordCache} className="clear-cache-btn">
                Clear Word Cache
              </button>
              <span className="cache-count">{cacheCounts.wordCount} entries</span>
            </div>
            <div className="cache-item">
              <button onClick={handleClearSubtitleCache} className="clear-cache-btn">
                Clear Subtitle Cache
              </button>
              <span className="cache-count">{cacheCounts.subtitleCount} entries</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
