// ==================================
// SUBTITLE DOM + MUTATION OBSERVERS
// ==================================

const SUBTITLE_WRAPPER_SELECTORS = [
  '[data-testid="subtitles-wrapper"]',
  '[data-testid*="subtitles"]',
  '[data-testid*="subtitle"]',
  '[aria-live="polite"]',
  '[role="status"]',
  '[class*="Subtitles"]',
  '[class*="Subtitle"]'
];

let cachedNativeSubtitlesWrapper: HTMLElement | null = null;

function isLikelySubtitleWrapper(element: HTMLElement | null) {
  if (!element) return false;
  if (element.id === "displayed-subtitles-wrapper") return false;
  if (element.closest?.('.dual-sub-extension-section')) return false;
  if (element.closest?.('#dual-sub-overlay')) return false;

  const testId = element.getAttribute('data-testid') || '';
  const ariaLive = element.getAttribute('aria-live') || '';
  const role = element.getAttribute('role') || '';

  if (testId.toLowerCase().includes('subtitle')) return true;
  if (ariaLive === 'polite') return true;
  if (role === 'status') return true;

  const spans = element.querySelectorAll('span');
  return spans.length > 0;
}

function findNativeSubtitlesWrapper() {
  const playerUI = document.querySelector('[class*="PlayerUI__UI"]') as HTMLElement | null;
  const scope = playerUI || document;

  for (const selector of SUBTITLE_WRAPPER_SELECTORS) {
    const candidates = Array.from(scope.querySelectorAll(selector)) as HTMLElement[];
    for (const candidate of candidates) {
      if (isLikelySubtitleWrapper(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getNativeSubtitlesWrapper() {
  if (cachedNativeSubtitlesWrapper && document.contains(cachedNativeSubtitlesWrapper)) {
    return cachedNativeSubtitlesWrapper;
  }
  cachedNativeSubtitlesWrapper = findNativeSubtitlesWrapper();
  return cachedNativeSubtitlesWrapper;
}

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
function copySubtitlesWrapper(className: string) {
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
function createSubtitleSpan(text: string, className: string) {
  const span = document.createElement("span");
  span.setAttribute("class", className);
  span.textContent = text;
  return span;
}

/**
 * Check if a mutation is related to subtitles wrapper 
 * @param {MutationRecord} mutation
 * @returns {boolean} - true if the mutation is related to subtitles wrapper
 */
function isMutationRelatedToSubtitlesWrapper(mutation: MutationRecord) {
  try {
    const target = mutation?.target as HTMLElement | null;
    const wrapper = getNativeSubtitlesWrapper();
    if (wrapper && target === wrapper) {
      return true;
    }
    return target?.dataset?.["testid"] === "subtitles-wrapper";
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
function createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper: HTMLElement) {
  let displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper") as HTMLElement | null;
  if (!displayedSubtitlesWrapper) {
    displayedSubtitlesWrapper = copySubtitlesWrapper(
      originalSubtitlesWrapper.className,
    );
    originalSubtitlesWrapper.parentNode?.insertBefore(
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
  displayedSubtitlesWrapper: HTMLElement,
  originalSubtitlesWrapperSpans: NodeListOf<HTMLSpanElement>,
) {
  if (!originalSubtitlesWrapperSpans || originalSubtitlesWrapperSpans.length === 0) {
    return;
  }
  const spanClassName = originalSubtitlesWrapperSpans[0].className;

  const finnishText = Array.from(originalSubtitlesWrapperSpans).map(
    (span: HTMLSpanElement) => span.innerText
  ).join(" ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!finnishText || finnishText.length === 0) {
    return;
  }

  // Create Finnish span with clickable words for popup dictionary
  // ALWAYS shown so users can click words to look up translations
  const finnishSpan = createSubtitleSpanWithClickableWords(finnishText, spanClassName);
  displayedSubtitlesWrapper.appendChild(finnishSpan);

  // Only add translation line when dualSubEnabled is true AND translation is needed
  // Skip translation if source and target languages are the same
  if (dualSubEnabled && shouldTranslate()) {
    const translationKey = toTranslationKey(finnishText);
    let targetLanguageText =
      sharedTranslationMap.get(translationKey) ||
      sharedTranslationErrorMap.get(translationKey);

    // Generate unique ID for this translation span
    const spanId = `translation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // If no translation yet, show "Translating..." and set up a retry mechanism
    if (!targetLanguageText) {
      targetLanguageText = "Translating...";

      // Queue this displayed text for translation since it wasn't found in cache
      // This handles cases where VTT text differs from displayed text (YLE combines cues)
      translationQueue.addToQueue(finnishText);
      translationQueue.processQueue();

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
    displayedSubtitlesWrapper.appendChild(targetLanguageSpan);
  }

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
// Track last displayed subtitle to avoid unnecessary re-renders
let lastDisplayedSubtitleText = "";
// Track whether YLE subtitles were previously disabled (to detect re-enable)
let yleSubtitlesWereDisabled = false;

function handleSubtitlesWrapperMutation(mutation: MutationRecord) {
  const originalSubtitlesWrapper = mutation.target as HTMLElement;
  originalSubtitlesWrapper.style.display = "none";

  const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(
    originalSubtitlesWrapper
  );

  if (mutation.addedNodes.length > 0) {
    const finnishTextSpans = (mutation.target as HTMLElement).querySelectorAll("span") as NodeListOf<HTMLSpanElement>;

    // Get the current Finnish text
    const currentFinnishText = Array.from(finnishTextSpans)
      .map((span: HTMLSpanElement) => span.innerText)
      .join(" ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Skip re-render if the text hasn't changed (prevents flicker when controls appear/disappear)
    if (currentFinnishText === lastDisplayedSubtitleText && displayedSubtitlesWrapper.innerHTML !== "") {
      return;
    }

    // If subtitles were previously disabled and now have content, they've been re-enabled
    if (yleSubtitlesWereDisabled && currentFinnishText.length > 0) {
      console.info('DualSubExtension: YLE subtitles appear to be re-enabled');
      yleSubtitlesWereDisabled = false;

      // Dispatch event for other modules to react
      const event = new CustomEvent('yleNativeCaptionsToggled', {
        bubbles: true,
        detail: { enabled: true }
      });
      document.dispatchEvent(event);
    }

    lastDisplayedSubtitleText = currentFinnishText;
    displayedSubtitlesWrapper.innerHTML = "";

    addContentToDisplayedSubtitlesWrapper(
      displayedSubtitlesWrapper,
      finnishTextSpans as NodeListOf<HTMLSpanElement>,
    );

    // Record subtitle timestamp for skip feature
    const videoElement = document.querySelector('video') as HTMLVideoElement | null;
    if (videoElement && finnishTextSpans.length > 0) {
      const subtitleText = Array.from(finnishTextSpans).map(span => span.textContent || '').join(' ').trim();
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
  } else {
    // No added nodes - subtitles might have been cleared
    // Check if the original wrapper is now empty
    const finnishTextSpans = (mutation.target as HTMLElement).querySelectorAll("span") as NodeListOf<HTMLSpanElement>;
    if (finnishTextSpans.length === 0) {
      displayedSubtitlesWrapper.innerHTML = "";
      lastDisplayedSubtitleText = "";

      // Check if this is a subtitle disable (removed nodes but no new ones)
      if (mutation.removedNodes.length > 0) {
        console.info('DualSubExtension: YLE subtitles appear to be disabled (wrapper emptied)');
        yleSubtitlesWereDisabled = true;

        // Dispatch event for other modules to react
        const event = new CustomEvent('yleNativeCaptionsToggled', {
          bubbles: true,
          detail: { enabled: false }
        });
        document.dispatchEvent(event);
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
function isVideoElementAppearMutation(mutation: MutationRecord) {
  if (checkVideoAppearMutationDebounceFlag) {
    return false;
  }
  try {
    // Must be a childList mutation with added nodes
    if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
      return false;
    }

    // Check each added node
    const nodes = Array.from(mutation.addedNodes) as Node[];
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = node as HTMLElement;

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

// YLE MutationObserver for subtitle handling
// Track subtitles wrapper visibility for CC ON/OFF detection
let yleWrapperStyleObserver: MutationObserver | null = null;
let yleWrapperWasVisible = false;

/**
 * Set up a style observer on the subtitles wrapper to detect CC ON/OFF
 * YLE hides the wrapper with display:none when CC is turned off
 */
function setupYleWrapperStyleObserver(wrapper: HTMLElement) {
  if (yleWrapperStyleObserver) {
    yleWrapperStyleObserver.disconnect();
  }

  // Initialize visibility state
  yleWrapperWasVisible = getComputedStyle(wrapper).display !== 'none';
  console.info('DualSubExtension: YLE wrapper style observer initialized, visible:', yleWrapperWasVisible);

  yleWrapperStyleObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'style') {
        const isVisible = getComputedStyle(wrapper).display !== 'none';

        if (yleWrapperWasVisible && !isVisible) {
          // CC turned OFF
          console.info('DualSubExtension: YLE CC turned OFF (wrapper hidden)');
          yleWrapperWasVisible = false;
          document.dispatchEvent(new CustomEvent('yleNativeCaptionsToggled', {
            bubbles: true,
            detail: { enabled: false }
          }));
        } else if (!yleWrapperWasVisible && isVisible) {
          // CC turned ON
          console.info('DualSubExtension: YLE CC turned ON (wrapper shown)');
          yleWrapperWasVisible = true;
          document.dispatchEvent(new CustomEvent('yleNativeCaptionsToggled', {
            bubbles: true,
            detail: { enabled: true }
          }));
        }
      }
    }
  });

  yleWrapperStyleObserver.observe(wrapper, {
    attributes: true,
    attributeFilter: ['style']
  });
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      if (isMutationRelatedToSubtitlesWrapper(mutation)) {
        // ALWAYS process subtitle mutations to show clickable original text
        // Translation line visibility is controlled inside the handler
        handleSubtitlesWrapperMutation(mutation);

        // Set up style observer on wrapper if not already done
        const wrapper = getNativeSubtitlesWrapper();
        if (wrapper && !yleWrapperStyleObserver) {
          setupYleWrapperStyleObserver(wrapper);
        }
        return;
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
