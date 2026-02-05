/**
 * Control Actions Module
 *
 * Action handlers for the YLE Areena control panel.
 */

const ControlActions = {
  /**
   * Skip state for preventing auto-pause during navigation
   */
  _isSkipping: false,

  /**
   * Repeat state for tracking repeat mode
   */
  _repeatStopTime: null,
  _repeatCheckInterval: null,

  /**
   * Get the current video element
   * @returns {HTMLVideoElement|null}
   */
  getVideoElement() {
    return document.querySelector('video');
  },

  /**
   * Toggle play/pause on the video
   * @returns {boolean} - New paused state
   */
  togglePlayPause() {
    const video = this.getVideoElement();
    if (!video) return true;

    if (video.paused) {
      video.play();
      return false;
    } else {
      video.pause();
      return true;
    }
  },

  /**
   * Skip to the previous subtitle
   * @param {Array<{time: number, text: string}>} subtitleTimestamps - Array of subtitle timestamps
   */
  skipToPreviousSubtitle(subtitleTimestamps) {
    const video = this.getVideoElement();
    if (!video) return;

    this._isSkipping = true;
    const currentTime = video.currentTime;

    // Find the previous subtitle timestamp before current time
    // We look for subtitles at least 1 second before current position
    const previousSubtitles = subtitleTimestamps.filter(entry => entry.time < currentTime - 1);

    if (previousSubtitles.length > 0) {
      const previousSubtitle = previousSubtitles[previousSubtitles.length - 1];
      video.currentTime = previousSubtitle.time;
    } else {
      // No previous subtitle found, skip back 5 seconds as fallback
      video.currentTime = Math.max(0, currentTime - 5);
    }

    // Re-enable auto-pause after a short delay to let the new subtitle appear
    setTimeout(() => {
      this._isSkipping = false;
    }, 800);
  },

  /**
   * Skip to the next subtitle
   * @param {Array<{time: number, text: string}>} subtitleTimestamps - Array of subtitle timestamps
   */
  skipToNextSubtitle(subtitleTimestamps) {
    const video = this.getVideoElement();
    if (!video) return;

    this._isSkipping = true;
    const currentTime = video.currentTime;

    // Find the next subtitle timestamp after current time
    const nextSubtitle = subtitleTimestamps.find(entry => entry.time > currentTime + 0.5);

    if (nextSubtitle) {
      video.currentTime = nextSubtitle.time;
    } else {
      // No next subtitle found, skip forward 5 seconds as fallback
      video.currentTime = currentTime + 5;
    }

    // Re-enable auto-pause after a short delay to let the new subtitle appear
    setTimeout(() => {
      this._isSkipping = false;
    }, 800);
  },

  /**
   * Repeat the current subtitle from start to current position
   * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles - Array of subtitles with timing
   * @param {Function} onRepeatComplete - Callback when repeat finishes
   */
  repeatCurrentSubtitle(subtitles, onRepeatComplete) {
    const video = this.getVideoElement();
    if (!video) {
      console.warn('DualSubExtension: Repeat - no video element found');
      if (onRepeatComplete) onRepeatComplete(); // Clear repeat flag
      return;
    }
    if (subtitles.length === 0) {
      console.warn('DualSubExtension: Repeat - no subtitles available, count:', subtitles.length);
      if (onRepeatComplete) onRepeatComplete(); // Clear repeat flag
      return;
    }

    const currentTime = video.currentTime;
    console.info('DualSubExtension: Repeat triggered at time:', currentTime.toFixed(2), 'with', subtitles.length, 'subtitles');

    // Find current subtitle (the one we're in or the most recent one)
    let currentSubIndex = -1;
    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      if (currentTime >= sub.startTime && currentTime <= sub.endTime) {
        currentSubIndex = i;
        break;
      } else if (currentTime > sub.endTime) {
        currentSubIndex = i; // Keep track of last passed subtitle
      }
    }

    if (currentSubIndex === -1) {
      // No subtitle found, go to first one
      console.info('DualSubExtension: No current subtitle found, going to first');
      if (subtitles.length > 0) {
        video.currentTime = subtitles[0].startTime;
        video.play();
      }
      if (onRepeatComplete) onRepeatComplete(); // Clear repeat flag
      return;
    }

    const currentSub = subtitles[currentSubIndex];
    const threshold = 0.5; // If within 0.5 seconds of start, go to previous

    let targetStartTime;
    if (currentTime - currentSub.startTime < threshold && currentSubIndex > 0) {
      // Already at beginning, go to previous subtitle
      targetStartTime = subtitles[currentSubIndex - 1].startTime;
      console.info('DualSubExtension: At beginning of subtitle, going to previous');
    } else {
      // Go to beginning of current subtitle
      targetStartTime = currentSub.startTime;
    }

    // Clear any existing repeat monitor
    if (this._repeatCheckInterval) {
      clearInterval(this._repeatCheckInterval);
      this._repeatCheckInterval = null;
    }

    // Store where to stop (current position before jumping back)
    this._repeatStopTime = currentTime;
    this._repeatStartedPlaying = false;

    // Jump to start
    video.currentTime = targetStartTime;

    console.info('DualSubExtension: Repeating from', targetStartTime.toFixed(2), 'to', this._repeatStopTime.toFixed(2));

    // Start playing and wait for it to actually start
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        this._repeatStartedPlaying = true;
        this._startRepeatMonitor(video, onRepeatComplete);
      }).catch(err => {
        console.warn('DualSubExtension: Play failed during repeat:', err);
        // Still try to monitor in case play works later
        this._repeatStartedPlaying = true;
        this._startRepeatMonitor(video, onRepeatComplete);
      });
    } else {
      // Older browsers don't return a promise
      this._repeatStartedPlaying = true;
      this._startRepeatMonitor(video, onRepeatComplete);
    }
  },

  /**
   * Start the repeat monitor interval
   * @private
   */
  _startRepeatMonitor(video, onRepeatComplete) {
    // Small delay to ensure play has started
    setTimeout(() => {
      this._repeatCheckInterval = setInterval(() => {
        // Check if we've reached the stop time
        if (video.currentTime >= this._repeatStopTime - 0.1) {
          video.pause();
          clearInterval(this._repeatCheckInterval);
          this._repeatCheckInterval = null;
          const stoppedAt = video.currentTime;
          this._repeatStopTime = null;
          this._repeatStartedPlaying = false;
          console.info('DualSubExtension: Repeat finished, paused at', stoppedAt.toFixed(2));
          if (onRepeatComplete) onRepeatComplete();
          return;
        }

        // Clear if user manually seeked far away (but NOT if just paused - they might resume)
        if (this._repeatStopTime !== null && Math.abs(video.currentTime - this._repeatStopTime) > 30) {
          console.info('DualSubExtension: Repeat cancelled - user seeked away');
          clearInterval(this._repeatCheckInterval);
          this._repeatCheckInterval = null;
          this._repeatStopTime = null;
          this._repeatStartedPlaying = false;
          // Still call callback to clear the repeat flag
          if (onRepeatComplete) onRepeatComplete();
        }
      }, 100);
    }, 200); // 200ms delay to let play() actually start
  },

  /**
   * Set playback speed
   * @param {number} speed - Playback speed (0.5 to 2.0)
   */
  setPlaybackSpeed(speed) {
    const video = this.getVideoElement();
    if (!video) return;

    video.playbackRate = speed;
    console.info('DualSubExtension: Playback speed set to', speed + 'x');
  },

  /**
   * Get current playback speed
   * @returns {number}
   */
  getPlaybackSpeed() {
    const video = this.getVideoElement();
    return video ? video.playbackRate : 1;
  },

  /**
   * Adjust playback speed by increment
   * @param {number} increment - Amount to change speed (e.g., 0.25 or -0.25)
   * @returns {number} - New playback speed
   */
  adjustPlaybackSpeed(increment) {
    const video = this.getVideoElement();
    if (!video) return 1;

    let newSpeed = Math.round((video.playbackRate + increment) * 100) / 100;
    // Clamp between 0.5 and 2.0
    newSpeed = Math.max(0.5, Math.min(2.0, newSpeed));
    video.playbackRate = newSpeed;

    console.info('DualSubExtension: Playback speed adjusted to', newSpeed + 'x');
    return newSpeed;
  },

  /**
   * Check if currently skipping (for auto-pause prevention)
   * @returns {boolean}
   */
  isSkipping() {
    return this._isSkipping;
  },

  /**
   * Focus the YLE video player element
   */
  focusPlayer() {
    const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
    if (playerUI) {
      playerUI.setAttribute('tabindex', '0');
      playerUI.focus();
    }
  },

  /**
   * Open extension settings page
   */
  openSettings() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      if (typeof safeSendMessage === 'function') {
        safeSendMessage({ action: 'openOptionsPage' })
          .then((response) => {
            if (response === null && typeof showExtensionInvalidatedToast === 'function') {
              const shouldRefresh = typeof confirm === 'function'
                ? confirm('Extension updated. Refresh this page now to open settings?')
                : false;
              if (shouldRefresh) {
                location.reload();
                return;
              }
              showExtensionInvalidatedToast();
            }
          })
          .catch(err => {
            console.warn('DualSubExtension: Failed to open options page:', err);
          });
      } else {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' });
      }
    }
  },

  /**
   * Save preference to Chrome storage
   * @param {string} key - Storage key
   * @param {*} value - Value to save
   */
  savePreference(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.set({ [key]: value }).catch(err => {
        console.warn('DualSubExtension: Error saving preference:', err);
      });
    }
  },

  /**
   * Load preference from Chrome storage
   * @param {string} key - Storage key
   * @param {*} defaultValue - Default value if not found
   * @returns {Promise<*>}
   */
  async loadPreference(key, defaultValue) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const result = await chrome.storage.sync.get(key);
        return result[key] !== undefined ? result[key] : defaultValue;
      } catch (err) {
        console.warn('DualSubExtension: Error loading preference:', err);
        return defaultValue;
      }
    }
    return defaultValue;
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ControlActions = ControlActions;
}
