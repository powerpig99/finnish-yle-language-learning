import { useEffect, useState } from "react";
import { Trash2, RefreshCw, Check, TriangleAlert } from "lucide-react";
import "./App.css";

const DEEPL_FREE_ENDPOINT = import.meta.env.DEV
  ? "/api/deepl"
  : "https://api-free.deepl.com/v2";
const DEEPL_PRO_ENDPOINT = import.meta.env.DEV
  ? "/api/deepl"
  : "https://api.deepl.com/v2";
const DEFAULT_TARGET_LANGUAGE = "EN-US";

/**
 *
 * @param {string} str  - confidential DeepL token that we want to mask for display
 * @param {number} visibleStart - number of characters to show at the start
 * @param {number} visibleEnd - number of characters to show at the end
 * @returns
 */
function maskString(str, visibleStart = 3, visibleEnd = 6) {
  if (str.length <= visibleStart + visibleEnd) {
    return str; // don't mask if string is too short
  }

  return (
    str.slice(0, visibleStart) +
    "*".repeat(str.length - visibleStart - visibleEnd) +
    str.slice(-visibleEnd)
  );
}

class DeepLUsageResponse {
  /**
   * Init DeepLUsageResponse from DeepL API usage response object
   * @param {Object} usageResponse - The response object from DeepL API usage endpoint.
   * @returns
   */
  constructor(usageResponse) {
    const errorMessage = `Error when parsing usage response from DeepL: ${usageResponse}`;
    if (!usageResponse || typeof usageResponse !== "object") {
      throw new Error(errorMessage);
    }
    if (
      typeof usageResponse.character_count !== "number" ||
      typeof usageResponse.character_limit !== "number"
    ) {
      throw new Error(errorMessage);
    }
    if (
      isNaN(usageResponse.character_count) ||
      isNaN(usageResponse.character_limit)
    ) {
      throw new Error(errorMessage);
    }

    /**
     * @type {number}
     * @description The number of characters already translated in the month
     */
    this.characterCount = usageResponse.character_count;
    /**
     * @type {number}
     * @description The character limit for the current month
     */
    this.characterLimit = usageResponse.character_limit;
  }
}

class DeepLUsageError {
  /**
   * Init DeepLUsageError for DeepL API usage request failures
   * @param {number} status - The HTTP status code from the failed request
   */
  constructor(status) {
    if (typeof status !== "number" || isNaN(status)) {
      throw new Error("Status must be a valid number");
    }
    /**
     * @type {number}
     * @description The HTTP status code from the failed request
     */
    this.status = status;
    /**
     * @type {string}
     * @description The error message describing what went wrong
     */
    this.errorMessage = this._getErrorMessageFromStatus(status);
  }

  /**
   * Get a user-friendly error message based on the HTTP status code
   * @param {number} status - The HTTP status code
   * @returns {string} A descriptive error message
   * @private
   */
  _getErrorMessageFromStatus(status) {
    switch (status) {
      case 400:
        return "Bad request. Please check your API key format and try again.";
      case 403:
        return "Authorization failed. The API key is invalid or missing. Please verify your DeepL API key.";
      case 404:
        return "The requested resource could not be found. Please check your API endpoint configuration.";
      case 413:
        return "The request size exceeds the limit.";
      case 429:
        return "Too many requests. You're hitting the API too frequently. Please wait a moment and try again.";
      case 456:
        return "Quota exceeded. You've reached your monthly character limit for this key. Please use a different key or upgrade your DeepL plan.";
      case 500:
        return "Internal server error. DeepL is experiencing technical issues. Please try again later.";
      case 504:
        return "Service unavailable. DeepL service is temporarily down. Please try again later.";
      case 529:
        return "Too many requests. You're hitting the API too frequently. Please wait a moment and try again.";
      default:
        return `Checking key usage failed with error code ${status}. Please try again or contact support.`;
    }
  }
}

/**
 * @typedef {import('../../types.js').DeepLTokenInfoInStorage} DeepLTokenInfoInStorage
 */

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ChromeStorageSyncHandler {
  /**
   * @param {DeepLTokenInfoInStorage[]} tokenInfos
   * @returns {Promise[void]}
   */
  static async setAllDeepLTokens(tokenInfos) {
    await chrome.storage.sync.set({ tokenInfos: tokenInfos });
  }

  /**
   * @returns {Promise<DeepLTokenInfoInStorage[]>}
   */
  static async getAllDeepLTokens() {
    const result = await chrome.storage.sync.get("tokenInfos");

    // Check if result is an object
    if (typeof result !== "object" || result === null) {
      return [];
    }

    // Check if result contains the deepLToken field
    if (Object.prototype.hasOwnProperty.call(result, "tokenInfos") === false) {
      return [];
    }

    // Check if result.deepLToken is an array
    if (!Array.isArray(result.tokenInfos)) {
      return [];
    }

    return result.tokenInfos;
  }

  /**
   * @returns {Promise<string>}
   */
  static async getTargetLanguage() {
    const result = await chrome.storage.sync.get("targetLanguage");

    if (typeof result !== "object" || result === null) {
      return DEFAULT_TARGET_LANGUAGE;
    }
    if (!Object.prototype.hasOwnProperty.call(result, "targetLanguage")) {
      return DEFAULT_TARGET_LANGUAGE;
    }
    if (
      typeof result.targetLanguage !== "string" ||
      result.targetLanguage.length === 0
    ) {
      return DEFAULT_TARGET_LANGUAGE;
    }
    return result.targetLanguage;
  }

  /**
   * @param {string} targetLanguage
   * @returns {Promise<void>}
   */
  static async setTargetLanguage(targetLanguage) {
    await chrome.storage.sync.set({ targetLanguage: targetLanguage });
  }
}

function Header() {
  return (
    <div className="header-section">
      <h1>Settings</h1>
    </div>
  );
}

/**
 *
 * @param {string} tokenKey - The DeepL API token key to validate.
 * @returns
 */
function validateDeeplApiTokenKey(tokenKey) {
  if (typeof tokenKey !== "string" || tokenKey.length === 0) {
    return false;
  }
  return true;
}

/**
 *
 * @param {string} tokenKey
 * @param {"free" | "pro"} tokenType
 * @returns {Promise<[true, DeepLUsageResponse]|[false, DeepLUsageError]|[false, string]>} -
 * Returns a tuple where the first element indicates validity and the second is either usage data, usage error or an error message.
 */
async function queryTokenUsageInfo(tokenKey, tokenType) {
  const url =
    tokenType === "free"
      ? `${DEEPL_FREE_ENDPOINT}/usage`
      : `${DEEPL_PRO_ENDPOINT}/usage`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DeepL-Auth-Key ${tokenKey}`,
      },
    });
    if (!response.ok) {
      const deepLUsageError = new DeepLUsageError(response.status);
      return [false, deepLUsageError];
    }

    const data = await response.json();
    const deepLUsageResponse = new DeepLUsageResponse(data);
    return [true, deepLUsageResponse];
  } catch (error) {
    const errorMessage = `
      Parsing usage response failed with ${error}.
      Probably network error or DeepL has changed response format.
      Please contact extension developers for this issue.
    `;
    console.error("YleDualSubExtension: " + errorMessage);
    return [false, errorMessage];
  }
}

/**
 *
 * @param {number} num
 * @returns
 * @description Format number with commas as thousands separators. Example: 1234567 -> "1,234,567"
 */
function formatCharacterUsageNumber(num) {
  return num.toLocaleString();
}

/**
 *
 * @param {Date} date
 * @returns {string} formatted date in en-GB locale string. For example: '01/11/2025, 16:30:35'
 */
function formatDateInEnglishLocale(date) {
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 *
 * @param {string} word
 * @returns {string} For example: "pro" => "Pro"
 */
function capitalizeFirstLetter(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * @param {number} percentage
 * @returns {string} return either "token-card__progress-green", "token-card__progress-yellow" or "token-card_progress-red" based on percentage level
 */
function getProgressBarColorCssClassname(percentage) {
  if (percentage <= 50) {
    return "token-card__progress-green";
  }
  if (percentage <= 75) {
    return "token-card__progress-yellow";
  }
  return "token-card__progress-red";
}

/**
 * @typedef {Object} TokenInfoCardProps
 * @property {DeepLTokenInfoInStorage} tokenInfo - The DeepL token information to display.
 * @property {(tokenKey: string) => void} handleSelectToken - Function to handle token selection.
 * @property {(tokenKey: string) => void} handleCheckUsage - Function to handle when user wants to check new usage time.
 * @property {(tokenKey: string) => void} handleRemoveToken - Function to handle remove token.
 */

/**
 *
 * @param {TokenInfoCardProps} props
 * @returns
 */
function TokenInfoCard(props) {
  const { tokenInfo, handleSelectToken, handleCheckUsage, handleRemoveToken } =
    props;
  const usagePercentage = (
    (tokenInfo.characterCount / tokenInfo.characterLimit) *
    100
  ).toFixed(1);
  return (
    <div
      key={tokenInfo.key}
      onClick={() => handleSelectToken(tokenInfo.key)}
      className={`token-card ${
        tokenInfo.selected ? "token-card-selected" : ""
      }`}
    >
      <div className="token-card__content">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="token-card__header">
            <div
              className={`token-card__checkbox ${
                tokenInfo.selected ? "token-card__checkbox-selected" : ""
              }`}
            >
              {tokenInfo.selected && <Check size={14} className="check-icon" />}
            </div>
            <div className="token-card__details">
              <h3 className="token-card__token-type">
                DeepL {capitalizeFirstLetter(tokenInfo.type)}
              </h3>
              <p className="token-card__token-key">
                {maskString(tokenInfo.key)}
              </p>
            </div>
          </div>

          <div className="token-card__usage-container">
            <div className="token-card__usage-stats">
              <span className="token-card__usage-text">
                {formatCharacterUsageNumber(tokenInfo.characterCount)} /{" "}
                {formatCharacterUsageNumber(tokenInfo.characterLimit)}{" "}
                characters
              </span>
              <span className="token-card__usage-percentage">
                {usagePercentage}%
              </span>
            </div>

            <div className="token-card__progress-bar">
              <div
                className={`token-card__progress-fill ${getProgressBarColorCssClassname(
                  usagePercentage
                )}`}
                style={{ width: `${Math.min(usagePercentage, 100)}%` }}
              ></div>
            </div>

            <p className="token-card__last-checked-text">
              Last checked: {tokenInfo.lastUsageCheckedAt}
            </p>
          </div>
        </div>

        <div className="token-card__action-buttons">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCheckUsage(tokenInfo.key);
            }}
            className="token-card__button token-card__check-usage-button"
          >
            <RefreshCw size={16} />
            Check usage
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (
                confirm(
                  `Are you sure you want to remove this translation key: ${maskString(
                    tokenInfo.key
                  )}?`
                )
              ) {
                handleRemoveToken(tokenInfo.key);
              }
            }}
            className="token-card__button token-card__remove_button"
          >
            <Trash2 size={16} />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @typedef {Object} TokenInfoCardListProps
 * @property {DeepLTokenInfoInStorage[]} tokenInfos - An array of DeepL token information.
 * @property {(newTokenInfos: DeepLTokenInfoInStorage[]) => void} setTokenInfos - A function to update the tokenInfos.
 */

/**
 *
 * @param {TokenInfoCardListProps} props
 */
function TokenInfoCardList(props) {
  const { tokenInfos, setTokenInfos } = props;

  /**
   * Handle select token
   * @param {string} tokenKey
   * @return {void}
   */
  function handleSelectToken(tokenKey) {
    const newTokenInfos = structuredClone(tokenInfos);

    for (const tokenInfo of newTokenInfos) {
      if (tokenInfo.key === tokenKey) {
        tokenInfo.selected = true;
      } else {
        tokenInfo.selected = false;
      }
    }
    setTokenInfos(newTokenInfos);
  }

  /**
   * Handle check usage
   * @param {string} tokenKey
   * @return {void}
   */
  async function handleCheckUsage(tokenKey) {
    for (const tokenInfo of tokenInfos) {
      if (tokenInfo.key === tokenKey) {
        try {
          const [isSucceeded, queryResponse] = await queryTokenUsageInfo(
            tokenInfo.key,
            tokenInfo.type
          );

          if (!isSucceeded) {
            if (queryResponse instanceof DeepLUsageError) {
              const deeplUsageError = queryResponse;
              if (deeplUsageError.status === 403) {
                alert(
                  "This translation key has been deactivated. It will be removed from the list."
                );
                const wasSelected = tokenInfo.selected;
                const newTokenInfos = tokenInfos.filter(
                  (tokenInfo) => tokenInfo.key !== tokenKey
                );
                if (wasSelected && newTokenInfos.length > 0) {
                  newTokenInfos[0].selected = true;
                  for (let i = 1; i < newTokenInfos.length; i++) {
                    newTokenInfos[i].selected = false;
                  }
                }
                setTokenInfos(newTokenInfos);
                return;
              }
              alert(deeplUsageError.errorMessage);
              return;
            }
            const errorMessage = queryResponse;
            alert(errorMessage);
            return;
          }
          const deeplUsageResponse = queryResponse;
          tokenInfo.characterCount = deeplUsageResponse.characterCount;
          tokenInfo.characterLimit = deeplUsageResponse.characterLimit;
          tokenInfo.lastUsageCheckedAt = formatDateInEnglishLocale(new Date());

          const newTokenInfos = structuredClone(tokenInfos);
          setTokenInfos(newTokenInfos);
        } catch (error) {
          alert(`Error when checking usage: ${error}`);
          return;
        }
      }
    }
  }

  /**
   * Handle remove token
   * @param {string} tokenKey
   * @return {void}
   */
  function handleRemoveToken(tokenKey) {
    const removedToken = tokenInfos.find(
      (tokenInfo) => tokenInfo.key === tokenKey
    );
    const wasSelected = removedToken ? removedToken.selected : false;

    const newTokenInfos = tokenInfos.filter(
      (tokenInfo) => tokenInfo.key !== tokenKey
    );

    if (wasSelected && newTokenInfos.length > 0) {
      const tokenWithMostUsageRemaining = newTokenInfos.reduce(
        (best, current) => {
          const bestCharacterLeftInUsage =
            best.characterLimit - best.characterCount;
          const currentCharacterLeftInUsage =
            current.characterLimit - current.characterCount;
          return currentCharacterLeftInUsage > bestCharacterLeftInUsage
            ? current
            : best;
        }
      );
      tokenWithMostUsageRemaining.selected = true;

      for (const tokenInfo of newTokenInfos) {
        if (tokenInfo.key !== tokenWithMostUsageRemaining.key) {
          tokenInfo.selected = false;
        }
      }
    }

    setTokenInfos(newTokenInfos);
  }

  return (
    <div>
      <p>Here is your list of translation keys:</p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          marginTop: "20px",
        }}
      >
        {tokenInfos.map((tokenInfo) => {
          return (
            <TokenInfoCard
              key={tokenInfo.key}
              tokenInfo={tokenInfo}
              handleSelectToken={handleSelectToken}
              handleCheckUsage={handleCheckUsage}
              handleRemoveToken={handleRemoveToken}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * @typedef {Object} AddNewTokenFormProps
 * @property {DeepLTokenInfoInStorage[]} tokenInfos - DeepL tokens info.
 * @property {(newTokenInfos: DeepLTokenInfoInStorage[] ) => void} setTokenInfos - A function to update the tokenInfosMap.
 */

/**
 * @param {AddNewTokenFormProps} props
 * @returns
 */
function AddNewTokenForm(props) {
  const { tokenInfos, setTokenInfos } = props;
  const tokenKeysSet = new Set(tokenInfos.map((tokenInfo) => tokenInfo.key));
  async function handleSubmit(event) {
    event.preventDefault();
    const formElement = event.target;
    const formData = new FormData(formElement);

    const deepLApiTokenKey = formData.get("apiTokenKey");
    const deepLApiTokenType = formData.get("apiTokenType");

    if (!validateDeeplApiTokenKey(deepLApiTokenKey)) {
      alert(
        "Please enter a valid DeepL translation key.\n" +
          "Sample key format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx(:fx).\n" +
          "Note: DeepL Free keys may have ':fx' suffix."
      );
      return;
    }

    if (!deepLApiTokenType) {
      alert("Please select an API type.");
      return;
    }

    if (tokenKeysSet.has(deepLApiTokenKey)) {
      alert(
        "You have already added this translation key.\n" +
          "If the key is not visible, please refresh the page."
      );
      return;
    }

    const [validateSuccess, checkTokenUsageResponse] =
      await queryTokenUsageInfo(deepLApiTokenKey, deepLApiTokenType);
    if (!validateSuccess) {
      if (checkTokenUsageResponse instanceof DeepLUsageError) {
        const deepLUsageError = checkTokenUsageResponse;
        alert(deepLUsageError.errorMessage);
      } else {
        const errorMessage = checkTokenUsageResponse;
        alert(errorMessage);
      }
      return;
    }

    const deepLUsageResponse = checkTokenUsageResponse;

    /**
     * @type {DeepLTokenInfoInStorage}
     */
    const deeplTokenInfoInStorage = {
      key: deepLApiTokenKey,
      type: deepLApiTokenType,
      characterCount: deepLUsageResponse.characterCount,
      characterLimit: deepLUsageResponse.characterLimit,
      lastUsageCheckedAt: formatDateInEnglishLocale(new Date()),
      selected: tokenInfos.length === 0,
    };

    const newTokenInfos = [...tokenInfos, deeplTokenInfoInStorage];

    setTokenInfos(newTokenInfos);

    formElement.reset();
  }

  return (
    <form className="add-token-form" onSubmit={handleSubmit}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label className="add-token-form__input-label">
          New translation key
        </label>
        <input
          type="text"
          name="apiTokenKey"
          className="add-token-form__input-field"
          placeholder="Paste your DeepL API key here (e.g., xxxx-xxxx-xxxx-xxxx:fx)"
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <label className="add-token-form__input-label">Account Type</label>

        <div className="add-token-form__radio-group">
          <label className="add-token-form__radio-option">
            <input type="radio" name="apiTokenType" value="free" />
            <div className="add-token-form__radio-content">
              <div className="add-token-form__radio-title">DeepL Free</div>
              <div className="add-token-form__radio-description">
                500,000 characters/month, perfect for casual use.
              </div>
            </div>
          </label>

          <label className="add-token-form__radio-option">
            <input type="radio" name="apiTokenType" value="pro" />
            <div className="add-token-form__radio-content">
              <div className="add-token-form__radio-title">DeepL Pro</div>
              <div className="add-token-form__radio-description">
                Unlimited usage, pay-as-you-go model, ideal for a group of heavy
                users.
                <br />
                <strong>⚠️ Warning: This is expensive!</strong> Consider using
                the free tier instead.
              </div>
            </div>
          </label>
        </div>
      </div>

      <button
        type="submit"
        className="add-token-form__button"
        style={{ margin: "8px 0" }}
      >
        Add new translation key
      </button>
    </form>
  );
}

function TokenManagementSection() {
  /**
   * @type {[DeepLTokenInfoInStorage[], (tokenKey: string) => void]}
   */
  const [tokenInfos, setTokenInfos] = useState([]);

  useEffect(() => {
    ChromeStorageSyncHandler.getAllDeepLTokens()
      .then((chromeStorageTokenInfos) => {
        setTokenInfos(chromeStorageTokenInfos);
      })
      .catch((error) => {
        console.error(
          "YleDualSubExtension: Error when getting all DeepL tokens from Chrome storage:",
          error
        );
      });
  }, []);

  function setTokenInfosAndPersist(newTokenInfos) {
    setTokenInfos(newTokenInfos);

    ChromeStorageSyncHandler.setAllDeepLTokens(newTokenInfos).catch((error) => {
      console.error(
        "YleDualSubExtension: Error when setting all DeepL tokens to Chrome storage:",
        error
      );
    });
  }

  return (
    <>
      <TokenInfoCardList
        tokenInfos={tokenInfos}
        setTokenInfos={setTokenInfosAndPersist}
      />
      <AddNewTokenForm
        tokenInfos={tokenInfos}
        setTokenInfos={setTokenInfosAndPersist}
      />
    </>
  );
}

function TokenManagementHelpSection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="token-management-setting-card__help-section">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="token-management-setting-card__help-section-button"
      >
        <span>
          ℹ️ What is a translation key? How do I get one? (Click to too
          instruction)
        </span>
        <span
          className={`token-management-setting-card__help-section-arrow ${
            isOpen
              ? "token-management-setting-card__help-section-arrow--open"
              : ""
          }`}
          title="Click to see instruction"
        >
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="token-management-setting-card__help-section-content">
          <p className="token-management-setting-card__help-section-paragraph">
            <strong>📖 What is a translation key (API key)?</strong>
            <br />A translation key is like a password that allows this
            extension to use DeepL's translation service. It's completely free
            for basic usage!
            <br />
            <br />
            ⚠️ <strong>Important:</strong> You'll need a credit card to sign up
            for DeepL's API, but <strong>the free tier is 100% free</strong> -
            you won't be charged unless you manually upgrade to a paid plan.
          </p>

          <p className="token-management-setting-card__help-section-paragraph">
            <strong>🤔 Why do I need to set this up?</strong>
            <br />
            <br />
            You might wonder: "Other dual-sub extensions like Language Reactor,
            Trancy, and InterSub work instantly—why not this one?"
            <br />
            <br />
            Here's the truth: Free services either use low-quality translation
            APIs, run at a loss (subsidized by premium users), or monetize your
            data. 💰
            <br />
            <br />
            <strong>
              I built this extension differently because I believe you deserve:
            </strong>
            <br />
            <br />✨ <strong>Best-in-class translations</strong> – DeepL is
            objectively the best for Finnish (especially puhekieli!)
            <br />
            🔒 <strong>Complete privacy</strong> – No data collection, no ads,
            no tracking
            <br />
            ♻️ <strong>Sustainability</strong> – No active maintenance burden on
            my end
            <br />
            🆓 <strong>Truly free</strong> – DeepL's free tier gives you 500,000
            characters/month!
            <br />
            <br />
            Yes, it takes 5-10 minutes for one-time setup, but you get premium
            quality without compromise. Worth it? I think so! 😊
          </p>

          <p>
            <strong>
              🔑 How to get your free translation key (one-time setup):
            </strong>
          </p>

          <p>
            <strong>📺 Video walkthrough (recommended):</strong>{" "}
            <a
              href="https://www.youtube.com/watch?v=VgpxUH7SbSY"
              target="_blank"
              className="token-management-setting-card__help-section-link"
            >
              Watch 1 min tutorial from Youtube
            </a>
            <br />
          </p>

          <p>
            <strong>📝 Step-by-step instructions:</strong>
          </p>

          <ol className="token-management-setting-card__help-section-list">
            <li>
              <strong>Sign up for a free DeepL account</strong>
              <br />
              Visit{" "}
              <a
                href="https://www.deepl.com/en/your-account"
                target="_blank"
                rel="noopener noreferrer"
                className="token-management-setting-card__help-section-link"
              >
                DeepL Account Signup
              </a>{" "}
              and create your account
            </li>

            <li>
              <strong>Select your DeepL API plan</strong>
              <br />
              Go to{" "}
              <a
                href="https://www.deepl.com/en/pro#developer"
                target="_blank"
                rel="noopener noreferrer"
                className="token-management-setting-card__help-section-link"
              >
                DeepL Developer Page
              </a>
              , look for <strong>"Find your perfect plan"</strong>, then click
              the <strong>"DeepL API"</strong> tab. Select either Free or Pro
              plan depending on your needs.
              <br />
              <br />
              <img
                src="./assets/find_your_perfect_plan.png"
                alt="Find your perfect plan section"
                style={{
                  maxWidth: "100%",
                  borderRadius: "8px",
                  border: "1px solid #404040",
                }}
              />
            </li>

            <li>
              <strong>Create your free subscription</strong>
              <br />
              Click <strong>"Sign up for free"</strong> under the DeepL API Free
              plan (for Pro users, click <strong>"Buy now"</strong>).
              <br />
              <small>
                💳 You'll be asked for a credit card, but it won't be charged
                for the free plan
              </small>
            </li>

            <li>
              <strong>Create your API key</strong>
              <br />
              After the subscription has been made, go to{" "}
              <a
                href="https://www.deepl.com/en/your-account/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="token-management-setting-card__help-section-link"
              >
                DeepL Key Page
              </a>
              . Click the <strong>"Create Key"</strong> button and give it a
              name (e.g., "YLE Dualsub translation key")
              <br />
              <br />
              <img
                src="./assets/create_your_key.png"
                alt="Create your API key"
                style={{
                  maxWidth: "100%",
                  borderRadius: "8px",
                  border: "1px solid #404040",
                }}
              />
            </li>

            <li>
              <strong>Copy your key</strong>
              <br />
              Your API key will look like this:
              <br />
              <small className="token-management-setting-card__help-section-small">
                • Free tier:{" "}
                <code>fcb8779e-4837-4e2f-99ef-1ac7255d2ed2:fx</code> (ends with
                :fx)
                <br />• Pro tier:{" "}
                <code>fcb8779e-4837-4e2f-99ef-1ac7255d2ed2</code> (no :fx
                suffix)
              </small>
            </li>

            <li>
              <strong>Paste it below</strong>
              <br />
              Copy the entire key and paste it in the form below, select your
              account type (Free/Pro), and click "Add new translation key"
            </li>
          </ol>

          <p className="token-management-setting-card__help-section-footer">
            🎉 That's it! Your extension is now ready to provide high-quality
            translations.
          </p>

          <p className="token-management-setting-card__help-section-footer">
            📚 Need more help? View the{" "}
            <a
              href="https://support.deepl.com/hc/en-us/articles/360020695820-API-key-for-DeepL-API"
              target="_blank"
              rel="noopener noreferrer"
              className="token-management-setting-card__help-section-link"
            >
              official DeepL guide
            </a>
          </p>

          <p className="token-management-setting-card__help-section-footer">
            💡 <strong>Pro tip:</strong> Since DeepL Pro uses a pay-as-you-go
            model, it's recommended to use multiple DeepL API Free keys first.
            You can add up to 5 keys to this extension for extended usage before
            considering the Pro tier!
            <br />
            For example, in 2025, 500,000 characters/month limit in DeepL Free will cost
            you 15 euro in DeepL Pro subscription.
            <br />
            Read more about DeepL pricing{" "}
            <a
              href="https://www.deepl.com/pro#developer"
              target="_blank"
              rel="noopener noreferrer"
              className="token-management-setting-card__help-section-link"
            >
              in official DeepL developer page.
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

function PersonalSettingsSection() {
  const [targetLanguage, setTargetLanguage] = useState("EN-US");
  const [translationProvider, setTranslationProvider] = useState("google");
  const [providerApiKey, setProviderApiKey] = useState("");

  useEffect(() => {
    ChromeStorageSyncHandler.getTargetLanguage()
      .then((storedTargetLanguage) => {
        setTargetLanguage(storedTargetLanguage);
      })
      .catch((error) => {
        console.error(
          "YleDualSubExtension: Error loading target language from Chrome storage:",
          error
        );
      });

    // Load translation provider settings
    chrome.storage.sync.get(['translationProvider', 'providerApiKey'])
      .then((result) => {
        if (result.translationProvider) {
          setTranslationProvider(result.translationProvider);
        }
        if (result.providerApiKey) {
          setProviderApiKey(result.providerApiKey);
        }
      })
      .catch((error) => {
        console.error(
          "YleDualSubExtension: Error loading provider settings:",
          error
        );
      });
  }, []);

  function handleTargetLanguageChange(event) {
    const newTargetLanguage = event.target.value;

    if (newTargetLanguage === targetLanguage) {
      return;
    }

    try {
      ChromeStorageSyncHandler.setTargetLanguage(newTargetLanguage);
      setTargetLanguage(newTargetLanguage);
    } catch (error) {
      console.error(
        "YleDualSubExtension: Error saving target language to Chrome storage:",
        error
      );
      alert("Failed to save target language. Please try again.");
      return;
    }
  }

  function handleProviderChange(event) {
    const newProvider = event.target.value;
    setTranslationProvider(newProvider);
    
    chrome.storage.sync.set({ translationProvider: newProvider })
      .catch((error) => {
        console.error("YleDualSubExtension: Error saving provider:", error);
        alert("Failed to save translation provider. Please try again.");
      });
  }

  function handleApiKeyChange(event) {
    const newApiKey = event.target.value;
    setProviderApiKey(newApiKey);
  }

  function handleApiKeyBlur() {
    chrome.storage.sync.set({ providerApiKey: providerApiKey })
      .catch((error) => {
        console.error("YleDualSubExtension: Error saving API key:", error);
        alert("Failed to save API key. Please try again.");
      });
  }

  const providerNeedsApiKey = translationProvider !== 'google';

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label className="add-token-form__input-label">
            Translation Provider
          </label>
          <select
            value={translationProvider}
            onChange={handleProviderChange}
            className="language-select-dropdown"
          >
            <option value="google">Google Translate (Free, No API key needed)</option>
            <option value="deepl">DeepL (Requires API key)</option>
            <option value="claude">Claude (Anthropic) (Requires API key)</option>
            <option value="gemini">Gemini (Google AI) (Requires API key)</option>
            <option value="grok">Grok (xAI) (Requires API key)</option>
          </select>
          <p style={{ fontSize: "14px", color: "#666", margin: "8px 0 0 0" }}>
            <strong>Note:</strong> Google Translate is free and works without any setup. 
            Other providers offer better quality but require API keys.
          </p>
        </div>

        {providerNeedsApiKey && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label className="add-token-form__input-label">
              API Key for {translationProvider.charAt(0).toUpperCase() + translationProvider.slice(1)}
            </label>
            <input
              type="password"
              value={providerApiKey}
              onChange={handleApiKeyChange}
              onBlur={handleApiKeyBlur}
              className="add-token-form__input-field"
              placeholder="Enter your API key here"
            />
            <p style={{ fontSize: "14px", color: "#666", margin: "8px 0 0 0" }}>
              {translationProvider === 'deepl' && "Get your DeepL API key from the 'Translation Keys Management' section above, or visit deepl.com/pro-api"}
              {translationProvider === 'claude' && "Get your Claude API key from console.anthropic.com"}
              {translationProvider === 'gemini' && "Get your Gemini API key from aistudio.google.com"}
              {translationProvider === 'grok' && "Get your Grok API key from x.ai"}
            </p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label className="add-token-form__input-label">
            Target Language for Translation
          </label>
          <select
            value={targetLanguage}
            onChange={handleTargetLanguageChange}
            className="language-select-dropdown"
          >
          <option value="EN-US">English (US)</option>
          <option value="EN-GB">English (UK)</option>
          <option value="VI">Vietnamese</option>
          <option value="AR">Arabic</option>
          <option value="BG">Bulgarian</option>
          <option value="CS">Czech</option>
          <option value="DA">Danish</option>
          <option value="DE">German</option>
          <option value="EL">Greek</option>
          <option value="ES">Spanish</option>
          <option value="ES-419">Spanish (Latin American)</option>
          <option value="ET">Estonian</option>
          <option value="FI">Finnish</option>
          <option value="FR">French</option>
          <option value="HU">Hungarian</option>
          <option value="ID">Indonesian</option>
          <option value="IT">Italian</option>
          <option value="JA">Japanese</option>
          <option value="KO">Korean</option>
          <option value="LT">Lithuanian</option>
          <option value="LV">Latvian</option>
          <option value="NB">Norwegian (Bokmål)</option>
          <option value="NL">Dutch</option>
          <option value="PL">Polish</option>
          <option value="PT-BR">Portuguese (Brazilian)</option>
          <option value="PT-PT">Portuguese (European)</option>
          <option value="RO">Romanian</option>
          <option value="RU">Russian</option>
          <option value="SK">Slovak</option>
          <option value="SL">Slovenian</option>
          <option value="SV">Swedish</option>
          <option value="TR">Turkish</option>
          <option value="UK">Ukrainian</option>
          <option value="ZH-HANS">Chinese (Simplified)</option>
          <option value="ZH-HANT">Chinese (Traditional)</option>
        </select>
        <p style={{ fontSize: "14px", color: "#666", margin: "8px 0 0 0" }}>
          <strong>Note:</strong> When you change the target language, you'll
          need to reload the YLE Areena page for the change to take effect.
        </p>
      </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <label className="add-token-form__input-label">
            Cache Management
          </label>
          <button
            onClick={async () => {
              try {
                const response = await chrome.runtime.sendMessage({ action: 'clearWordCache' });
                if (response && response.success) {
                  alert(`Cleared ${response.count} cached word translations. Old/bad translations will be re-fetched.`);
                } else {
                  alert('Failed to clear cache: ' + (response?.error || 'Unknown error'));
                }
              } catch (error) {
                alert('Error clearing cache: ' + error.message);
              }
            }}
            style={{
              padding: "10px 16px",
              background: "rgba(239, 68, 68, 0.2)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "6px",
              color: "#f87171",
              cursor: "pointer",
              fontSize: "14px",
              width: "fit-content"
            }}
          >
            Clear Word Translation Cache
          </button>
          <p style={{ fontSize: "14px", color: "#666", margin: "8px 0 0 0" }}>
            Use this if word translations are showing incorrect/outdated results.
            Cached translations will be re-fetched from Wiktionary or AI.
          </p>
        </div>
    </div>
  </div>
  );
}

function PersonalSettingsAccordion() {
  const [accordionOpen, setAccordionOpen] = useState(false);

  return (
    <div className="setting-card">
      <div
        className={`setting-card__accordion ${accordionOpen ? "active" : ""}`}
      >
        <button
          className="setting-card__accordion-header"
          onClick={() => setAccordionOpen(!accordionOpen)}
        >
          <span>Personal Settings</span>
          <span className="setting-card__accordion-icon">&#9660;</span>
        </button>
        <div className="setting-card__accordion-content">
          <div className="setting-card__accordion-content-inner">
            <p className="setting-card__title">
              Customize your subtitle translation preferences.
            </p>

            <p className="setting-card__description">
              Choose which language you want Finnish subtitles to be translated
              to.
              <br />
              <br />
              💡 Supported languages: English (US), English (UK), and Vietnamese
              and more
            </p>

            <PersonalSettingsSection />
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenManagementAccordion() {
  const [accordionOpen, setAccordionOpen] = useState(false);

  return (
    <div className="setting-card">
      <div
        className={`setting-card__accordion ${accordionOpen ? "active" : ""}`}
      >
        <button
          className="setting-card__accordion-header"
          onClick={() => setAccordionOpen(!accordionOpen)}
        >
          <span>Translation Keys Management</span>
          <span className="setting-card__accordion-icon">&#9660;</span>
        </button>
        <div className="setting-card__accordion-content">
          <div className="setting-card__accordion-content-inner">
            <p className="setting-card__title">
              Manage your DeepL translation keys to enable translation service.
            </p>

            <p className="setting-card__description">
              This extension uses{" "}
              <a
                href="https://www.deepl.com/pro-api"
                target="_blank"
                rel="noopener noreferrer"
              >
                DeepL, the best translation service for Finnish
              </a>{" "}
              to translate subtitles.
              <br />
              <br />
              💡 You can add up to 5 translation keys for extended usage!
            </p>

            <TokenManagementHelpSection />

            <TokenManagementSection />
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          overflowX: "hidden",
        }}
      >
        <Header />

        <TokenManagementAccordion />

        <PersonalSettingsAccordion />
      </div>
    </>
  );
}

export default App;
