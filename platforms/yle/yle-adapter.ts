/**
 * YLE Areena Platform Adapter
 *
 * Platform-specific implementation for YLE Areena (areena.yle.fi)
 * Handles DOM selectors, control bar integration, and subtitle detection specific to YLE.
 */

var YLEAdapter = {
  name: 'yle',
  sourceLanguage: null, // Dynamic - detected from subtitles
  _detectedLanguage: null,

  // DOM Selectors specific to YLE Areena
  SELECTORS: {
    video: 'video',
    playerUI: '[class*="PlayerUI__UI"]',
    bottomControlBar: '[class^="BottomControlBar__LeftControls"]',
    subtitlesWrapper: '[data-testid="subtitles-wrapper"]',
    videoTitle: '[class*="VideoTitle__Titles"]',
    topControlBar: '[class*="TopControlBar__ControlBar"]',
    timeline: '[class*="Timeline__TimelineContainer"]',
    rightControls: '[class*="BottomControlBar__RightControls"]',
    volume: '[class*="Volume__"]'
  },

  /**
   * Get mount configuration for the unified control panel
   * @returns {Object}
   */
  getControlPanelMountConfig() {
    return {
      selector: '[class^="BottomControlBar__LeftControls"]',
      insertMethod: 'append',
      style: 'integrated',
      hideOnInactive: true
    };
  },

  /**
   * Get keyboard configuration for the unified control panel
   * @returns {Object}
   */
  getKeyboardConfig() {
    return {
      useCapture: false,
      interceptSpace: false, // Let YLE handle space
      interceptBrackets: true
    };
  },

  /**
   * Check if this adapter should be used for the current page
   * @returns {boolean}
   */
  isMatch() {
    return window.location.hostname === 'areena.yle.fi';
  },

  /**
   * Check if we're on a video page
   * @returns {boolean}
   */
  isVideoPage() {
    // YLE video pages have videos in the player
    return !!document.querySelector(this.SELECTORS.video);
  },

  /**
   * Get the video element
   * @returns {HTMLVideoElement|null}
   */
  getVideoElement() {
    return document.querySelector(this.SELECTORS.video) as HTMLVideoElement | null;
  },

  /**
   * Get the player UI container
   * @returns {HTMLElement|null}
   */
  getPlayerUI() {
    return document.querySelector(this.SELECTORS.playerUI) as HTMLElement | null;
  },

  /**
   * Get the subtitle wrapper element
   * @returns {HTMLElement|null}
   */
  getSubtitleWrapper() {
    const primary = document.querySelector(this.SELECTORS.subtitlesWrapper) as HTMLElement | null;
    if (primary) return primary;

    const playerUI = document.querySelector(this.SELECTORS.playerUI) as HTMLElement | null;
    const scope = playerUI || document;
    return (scope.querySelector('[data-testid*="subtitles"]') ||
            scope.querySelector('[data-testid*="subtitle"]') ||
            scope.querySelector('[aria-live="polite"]') ||
            scope.querySelector('[role="status"]') ||
            scope.querySelector('[class*="Subtitles"]') ||
            scope.querySelector('[class*="Subtitle"]')) as HTMLElement | null;
  },

  /**
   * Get the control bar container where we insert our controls
   * @returns {Promise<HTMLElement|null>}
   */
  async getControlBarContainer() {
    const maxAttempts = 8;
    const delay = 150;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const container = document.querySelector(this.SELECTORS.bottomControlBar) as HTMLElement | null;
      if (container) {
        return container;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
  },

  /**
   * Get the video title for caching purposes
   * @returns {Promise<string|null>}
   */
  async getVideoTitle() {
    const maxAttempts = 8;
    const delay = 150;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const titleElement = document.querySelector(this.SELECTORS.videoTitle);
      if (titleElement) {
        const texts = (Array.from(titleElement.querySelectorAll('span')) as HTMLElement[])
          .map(span => (span.textContent || '').trim())
          .filter(text => text.length > 0);
        return texts.join(' | ');
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
  },

  /**
   * Check if a mutation is related to subtitle changes
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  isSubtitleMutation(mutation) {
    try {
      const target = mutation?.target as HTMLElement | null;
      if (target?.dataset?.['testid'] === 'subtitles-wrapper') {
        return true;
      }
      const wrapper = this.getSubtitleWrapper();
      return !!(wrapper && target === wrapper);
    } catch (error) {
      return false;
    }
  },

  /**
   * Check if a mutation indicates a video element appeared
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  isVideoAppearMutation(mutation) {
    if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
      return false;
    }

    const nodes = Array.from(mutation.addedNodes) as Node[];
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = node as HTMLElement;

      if (element.tagName === 'VIDEO' || element.querySelector?.('video')) {
        return true;
      }
    }

    return false;
  },

  /**
   * Focus the video player for keyboard controls
   */
  focusPlayer() {
    const playerUI = this.getPlayerUI();

    if (playerUI) {
      playerUI.setAttribute('tabindex', '0');
      playerUI.focus();

      if (document.activeElement === playerUI) {
        return;
      }
    }

    // Try clicking on the player area
    const video = this.getVideoElement();
    if (video && playerUI) {
      const rect = video.getBoundingClientRect();
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom - 5
      });
      playerUI.dispatchEvent(clickEvent);
    }
  },

  /**
   * Show YLE player controls (add active class)
   */
  showControls() {
    const playerUI = this.getPlayerUI();
    if (playerUI) {
      playerUI.classList.add('yle-mouse-active');
    }
    document.body.classList.add('yle-mouse-active');
  },

  /**
   * Hide YLE player controls (remove active class)
   */
  hideControls() {
    const playerUI = this.getPlayerUI();
    if (playerUI) {
      playerUI.classList.remove('yle-mouse-active');
    }
    document.body.classList.remove('yle-mouse-active');
  },

  /**
   * Get the control bar HTML specific to YLE styling
   * @param {Object} options
   * @returns {string}
   */
  getControlBarHTML(options: { dualSubEnabled?: boolean; autoPauseEnabled?: boolean; playbackSpeed?: number } = {}) {
    const {
      dualSubEnabled = false,
      autoPauseEnabled = false,
      playbackSpeed = 1
    } = options;

    return `
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
    `;
  },

  /**
   * Create the subtitle display wrapper
   * @param {HTMLElement} originalWrapper
   * @returns {HTMLElement}
   */
  createSubtitleDisplayWrapper(originalWrapper) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.setAttribute('class', originalWrapper.className);
    wrapper.setAttribute('id', 'displayed-subtitles-wrapper');
    return wrapper;
  },

  /**
   * Position the subtitle display wrapper after the original
   * @param {HTMLElement} displayWrapper
   * @param {HTMLElement} originalWrapper
   */
  positionSubtitleWrapper(displayWrapper, originalWrapper) {
    originalWrapper.parentNode.insertBefore(displayWrapper, originalWrapper.nextSibling);
  },

  /**
   * Set the detected source language from subtitle analysis
   * @param {string} langCode - Detected language code (e.g., 'fi', 'sv')
   */
  setDetectedLanguage(langCode) {
    this._detectedLanguage = langCode;
    this.sourceLanguage = langCode;
    console.info('DualSubExtension: YLE source language detected:', langCode);

    // Dispatch event for other modules to react
    const event = new CustomEvent('yleSourceLanguageDetected', {
      bubbles: true,
      detail: { language: langCode }
    });
    document.dispatchEvent(event);
  },

  /**
   * Get the current source language (detected or default)
   * @returns {string|null} - Source language code or null if not detected
   */
  getSourceLanguage() {
    return this._detectedLanguage || this.sourceLanguage;
  },

  /**
   * Reset detected language (e.g., on navigation)
   */
  resetDetectedLanguage() {
    this._detectedLanguage = null;
    this.sourceLanguage = null;
  }
};

// Export for use in content script
if (typeof window !== 'undefined') {
  window.YLEAdapter = YLEAdapter;
}
