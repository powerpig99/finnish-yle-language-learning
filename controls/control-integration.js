/**
 * Control Integration Module
 *
 * Bridges the unified ControlPanel with the existing contentscript.js functionality.
 * Provides a clean interface for initializing and managing the control panel on each platform.
 */

/* global ControlPanel, ControlActions, ControlKeyboard, AudioFilters, AudioRecorder, AudioEncoder, AudioDownloadUI */

/**
 * Integration manager for the unified control panel
 */
const ControlIntegration = {
  /** @type {ControlPanel|null} */
  _panel: null,

  /** @type {string} */
  _platform: null,

  /** @type {Object} */
  _state: {
    dualSubEnabled: false,
    autoPauseEnabled: false,
    playbackSpeed: 1.0,
    sourceLanguage: 'en'
  },

  /** @type {Array<{time: number, text: string}>} */
  _subtitleTimestamps: [],

  /** @type {Array<{startTime: number, endTime: number, text: string}>} */
  _subtitles: [],

  /**
   * Initialize the control integration for a platform
   * @param {string} platform - 'yle' | 'youtube' | 'html5'
   * @param {Object} options - Initial options
   * @returns {Promise<ControlPanel|null>}
   */
  async init(platform, options = {}) {
    this._platform = platform;

    // Load preferences from storage
    await this._loadPreferences();

    // Override with provided options
    Object.assign(this._state, options);

    // Create the control panel
    this._panel = new ControlPanel({
      platform: platform,
      initialState: {
        dualSubEnabled: this._state.dualSubEnabled,
        autoPauseEnabled: this._state.autoPauseEnabled,
        playbackSpeed: this._state.playbackSpeed,
        sourceLanguage: this._state.sourceLanguage,
        availableLanguages: options.availableLanguages || []
      },
      callbacks: {
        onDualSubToggle: this._handleDualSubToggle.bind(this),
        onAutoPauseToggle: this._handleAutoPauseToggle.bind(this),
        onPrevSubtitle: this._handlePrevSubtitle.bind(this),
        onNextSubtitle: this._handleNextSubtitle.bind(this),
        onRepeatSubtitle: this._handleRepeatSubtitle.bind(this),
        onSpeedChange: this._handleSpeedChange.bind(this),
        onSourceLangChange: this._handleSourceLangChange.bind(this),
        onSettingsClick: this._handleSettingsClick.bind(this),
        onPlayPause: this._handlePlayPause.bind(this),
        onDownloadAudio: this._handleDownloadAudio.bind(this)
      }
    });

    // Mount the panel
    const element = await this._panel.mount();

    if (element) {
      console.info('DualSubExtension: ControlIntegration initialized for platform:', platform);
    }

    return this._panel;
  },


  /**
   * Cleanup and unmount the control panel
   */
  cleanup() {
    if (this._panel) {
      this._panel.unmount();
      this._panel = null;
    }
    this._subtitleTimestamps = [];
    this._subtitles = [];
  },

  /**
   * Update the panel state
   * @param {Object} state - Partial state to update
   */
  updateState(state) {
    Object.assign(this._state, state);
    if (this._panel) {
      this._panel.updateState(state);
    }
  },

  /**
   * Set subtitle timestamps for navigation
   * @param {Array<{time: number, text: string}>} timestamps
   */
  setSubtitleTimestamps(timestamps) {
    this._subtitleTimestamps = timestamps;
  },

  /**
   * Set full subtitles with timing for repeat functionality
   * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles
   */
  setSubtitles(subtitles) {
    console.info('DualSubExtension: ControlIntegration.setSubtitles called with', subtitles?.length, 'subtitles');
    this._subtitles = subtitles;
    // Also update timestamps
    this._subtitleTimestamps = subtitles.map(sub => ({
      time: sub.startTime,
      text: sub.text
    }));
  },

  /**
   * Get current state
   * @returns {Object}
   */
  getState() {
    return { ...this._state };
  },

  /**
   * Check if panel is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this._panel !== null && this._panel.isMounted();
  },

  /**
   * Load preferences from Chrome storage
   * @private
   */
  async _loadPreferences() {
    try {
      const result = await chrome.storage.sync.get([
        'dualSubEnabled',
        'autoPauseEnabled',
        'playbackSpeed',
        'ytSourceLanguage'
      ]);

      if (typeof result.dualSubEnabled === 'boolean') {
        this._state.dualSubEnabled = result.dualSubEnabled;
      }
      if (typeof result.autoPauseEnabled === 'boolean') {
        this._state.autoPauseEnabled = result.autoPauseEnabled;
      }
      if (typeof result.playbackSpeed === 'number') {
        this._state.playbackSpeed = result.playbackSpeed;
      }
      if (result.ytSourceLanguage) {
        this._state.sourceLanguage = result.ytSourceLanguage;
      }
    } catch (e) {
      console.warn('DualSubExtension: Error loading preferences:', e);
    }
  },

  /**
   * Handle dual sub toggle
   * @param {boolean} enabled
   * @private
   */
  _handleDualSubToggle(enabled) {
    this._state.dualSubEnabled = enabled;

    // Save preference
    chrome.storage.sync.set({ dualSubEnabled: enabled });

    // Dispatch event for contentscript.js to handle platform-specific logic
    const event = new CustomEvent('dscDualSubToggle', {
      detail: { enabled, platform: this._platform }
    });
    document.dispatchEvent(event);

    console.info('DualSubExtension: Dual sub toggled:', enabled);
  },

  /**
   * Handle auto-pause toggle
   * @param {boolean} enabled
   * @private
   */
  _handleAutoPauseToggle(enabled) {
    this._state.autoPauseEnabled = enabled;

    // Save preference
    chrome.storage.sync.set({ autoPauseEnabled: enabled });

    // Dispatch event for contentscript.js
    const event = new CustomEvent('dscAutoPauseToggle', {
      detail: { enabled, platform: this._platform }
    });
    document.dispatchEvent(event);

    console.info('DualSubExtension: Auto-pause toggled:', enabled);
  },

  /**
   * Handle previous subtitle
   * @private
   */
  _handlePrevSubtitle() {
    ControlActions.skipToPreviousSubtitle(this._subtitleTimestamps, this._platform);

    // Dispatch event for contentscript.js
    const event = new CustomEvent('dscPrevSubtitle', {
      detail: { platform: this._platform }
    });
    document.dispatchEvent(event);
  },

  /**
   * Handle next subtitle
   * @private
   */
  _handleNextSubtitle() {
    ControlActions.skipToNextSubtitle(this._subtitleTimestamps, this._platform);

    // Dispatch event for contentscript.js
    const event = new CustomEvent('dscNextSubtitle', {
      detail: { platform: this._platform }
    });
    document.dispatchEvent(event);
  },

  /**
   * Handle repeat subtitle
   * @private
   */
  _handleRepeatSubtitle() {
    // Dispatch start event BEFORE calling repeat (to disable auto-pause)
    const startEvent = new CustomEvent('dscRepeatSubtitle', {
      detail: { platform: this._platform, phase: 'start' }
    });
    document.dispatchEvent(startEvent);

    ControlActions.repeatCurrentSubtitle(this._subtitles, this._platform, () => {
      console.info('DualSubExtension: Repeat completed');
      // Dispatch end event when repeat completes
      const endEvent = new CustomEvent('dscRepeatComplete', {
        detail: { platform: this._platform }
      });
      document.dispatchEvent(endEvent);
    });
  },

  /**
   * Handle speed change
   * @param {number} speed
   * @private
   */
  _handleSpeedChange(speed) {
    this._state.playbackSpeed = speed;

    // Apply speed directly
    ControlActions.setPlaybackSpeed(speed, this._platform);

    // Save preference
    chrome.storage.sync.set({ playbackSpeed: speed });

    // Dispatch event for contentscript.js
    const event = new CustomEvent('dscSpeedChange', {
      detail: { speed, platform: this._platform }
    });
    document.dispatchEvent(event);
  },

  /**
   * Handle source language change
   * @param {string} lang
   * @private
   */
  _handleSourceLangChange(lang) {
    this._state.sourceLanguage = lang;

    // Save preference (YouTube-specific)
    chrome.storage.sync.set({ ytSourceLanguage: lang });

    // Dispatch event for contentscript.js
    const event = new CustomEvent('dscSourceLangChange', {
      detail: { language: lang, platform: this._platform }
    });
    document.dispatchEvent(event);

    console.info('DualSubExtension: Source language changed:', lang);
  },

  /**
   * Handle settings click
   * @private
   */
  _handleSettingsClick() {
    ControlActions.openSettings();
  },

  /**
   * Handle play/pause
   * @private
   */
  _handlePlayPause() {
    const isPaused = ControlActions.togglePlayPause(this._platform);

    // Dispatch event for contentscript.js
    const event = new CustomEvent('dscPlayPause', {
      detail: { isPaused, platform: this._platform }
    });
    document.dispatchEvent(event);
  },

  /**
   * Handle audio download button click
   * @private
   */
  async _handleDownloadAudio() {
    console.info('DualSubExtension: _handleDownloadAudio called, platform:', this._platform, 'subtitles:', this._subtitles?.length, 'isInit:', this.isInitialized());

    if (!this._platform) {
      console.error('DualSubExtension: _handleDownloadAudio called but platform is not set!');
    }

    // YLE uses DRM protection - offer screen recording instead
    if (this._platform === 'yle') {
      // Check if already recording - if so, stop it (toggle behavior)
      if (typeof ScreenRecorder !== 'undefined' && ScreenRecorder.isRecording()) {
        console.info('DualSubExtension: Stopping YLE screen recording');
        ScreenRecorder.stopRecording();
        return;
      }

      // On YLE, showing any modal closes the video overlay
      // So we skip the confirmation and go directly to screen recording
      const video = ControlActions.getVideoElement(this._platform);
      if (!video) {
        console.error('DualSubExtension: No video found');
        return;
      }

      // Get speech segments if available
      let speechSegments = null;
      if (this._subtitles && this._subtitles.length > 0) {
        speechSegments = AudioFilters.filterSpeechSegments(this._subtitles);
      }

      // Start recording directly without modal
      await this._startYLERecording(video, speechSegments);
      return;
    }

    const video = ControlActions.getVideoElement(this._platform);

    if (!video) {
      AudioDownloadUI.showError('No video found on this page');
      return;
    }

    // Check if subtitles are loaded - try to sync from global fullSubtitles if empty
    // NOTE: Only use fullSubtitles here - it's the platform-agnostic array that ALL platforms populate
    // Do NOT add platform-specific variables (like ytCurrentSubtitles) to this unified module
    if (!this._subtitles || this._subtitles.length === 0) {
      // Fallback: try to sync from global fullSubtitles array (handles timing issues)
      if (typeof fullSubtitles !== 'undefined' && fullSubtitles.length > 0) {
        console.info('DualSubExtension: Syncing subtitles from global fullSubtitles array for download');
        this.setSubtitles(fullSubtitles);
      }

      // Check again after fallback sync
      if (!this._subtitles || this._subtitles.length === 0) {
        AudioDownloadUI.showError('Please wait for subtitles to load before downloading audio');
        return;
      }
    }

    // Check browser support
    const support = AudioRecorder.checkSupport();
    if (!support.supported) {
      AudioDownloadUI.showError(`Browser not supported: ${support.reason}`);
      return;
    }

    // Check if lamejs is available
    if (!AudioEncoder.isAvailable()) {
      AudioDownloadUI.showError('MP3 encoder not loaded. Please reload the page and try again.');
      return;
    }

    // Filter to speech segments only
    const speechSegments = AudioFilters.filterSpeechSegments(this._subtitles);

    if (speechSegments.length === 0) {
      AudioDownloadUI.showError('No speech segments found in subtitles');
      return;
    }

    // Quick check: Try to see if audio capture will work
    // This prevents the user from waiting only to get an error
    const canCapture = await this._testAudioCapture(video);
    if (!canCapture.success) {
      AudioDownloadUI.showError(
        'Cannot capture audio from this video. ' +
        (canCapture.reason || 'This may be due to DRM protection or streaming restrictions.') +
        ' Try using screen recording software instead.'
      );
      return;
    }

    // Merge adjacent segments to reduce seek operations
    const mergedSegments = AudioFilters.mergeAdjacentSegments(speechSegments, 0.3);

    // Get filtering summary
    const summary = AudioFilters.getFilteringSummary(this._subtitles);

    // Calculate estimated file size
    const estimatedSize = AudioEncoder.estimateFileSize(summary.speechDuration, 128);

    // Show confirmation dialog
    AudioDownloadUI.showConfirmation(
      {
        totalDuration: video.duration,
        speechDuration: summary.speechDuration,
        segmentCount: mergedSegments.length,
        removedCount: summary.nonVerbalSegments,
        removedTypes: summary.nonVerbalTypes,
        estimatedSize: estimatedSize
      },
      // onConfirm
      async () => {
        await this._startAudioRecording(video, mergedSegments);
      },
      // onCancel
      () => {
        console.info('DualSubExtension: Audio download cancelled by user');
      }
    );
  },

  /**
   * Start the audio recording process
   * @param {HTMLVideoElement} video
   * @param {Array} segments
   * @private
   */
  async _startAudioRecording(video, segments) {
    let audioBuffer = null;

    try {
      // Record audio from video (continuous playback approach)
      audioBuffer = await AudioRecorder.recordFilteredAudio(video, segments, {
        onProgress: (currentTime, totalTime, percent, phase) => {
          AudioDownloadUI.showProgress(
            currentTime,
            totalTime,
            percent,
            phase,
            () => {
              AudioRecorder.cancel();
            }
          );
        },
        onStatusChange: (status) => {
          console.info('DualSubExtension:', status);
        },
        onError: (error) => {
          console.error('DualSubExtension: Recording error:', error);
        }
      });

      if (!audioBuffer) {
        throw new Error('No audio was recorded');
      }

      // Show encoding progress
      AudioDownloadUI.showEncodingProgress(0);

      // Encode to MP3
      const mp3Blob = await AudioEncoder.encodeToMP3(audioBuffer, { bitRate: 128 }, (progress) => {
        AudioDownloadUI.showEncodingProgress(progress * 100);
      });

      // Generate filename
      const filename = this._generateFilename();

      // Download the file
      this._downloadBlob(mp3Blob, filename);

      // Show success
      AudioDownloadUI.showSuccess(filename, () => {
        console.info('DualSubExtension: Audio download completed:', filename);
      });

    } catch (error) {
      console.error('DualSubExtension: Audio download failed:', error);

      if (error.message === 'Recording cancelled by user') {
        AudioDownloadUI.hideProgressBar();
      } else {
        // Provide helpful error message based on error type
        let errorMessage = error.message || 'Failed to download audio';

        if (errorMessage.includes('DRM') || errorMessage.includes('cross-origin') ||
            errorMessage.includes('MediaElementSource') || errorMessage.includes('CORS')) {
          errorMessage = 'Cannot capture audio from this video. ' +
            'This is likely due to DRM protection or streaming restrictions. ' +
            'Try using screen recording software instead.';
        }

        AudioDownloadUI.showError(errorMessage);
      }
    } finally {
      // Clean up audio recorder resources
      AudioRecorder.cleanup();
    }
  },

  /**
   * Handle YLE screen recording (for DRM-protected content)
   * @private
   */
  async _handleYLEScreenRecording() {
    // Check if ScreenRecorder is available
    if (typeof ScreenRecorder === 'undefined') {
      AudioDownloadUI.showError('Screen recording feature is not available. Please reload the page.');
      return;
    }

    const video = ControlActions.getVideoElement(this._platform);
    if (!video) {
      AudioDownloadUI.showError('No video found on this page');
      return;
    }

    // Check browser support
    const support = ScreenRecorder.checkSupport();
    if (!support.supported) {
      AudioDownloadUI.showError(`Screen recording not supported: ${support.reason}`);
      return;
    }

    // Get speech segments info if available
    let speechInfo = null;
    if (this._subtitles && this._subtitles.length > 0) {
      const speechSegments = AudioFilters.filterSpeechSegments(this._subtitles);
      const summary = AudioFilters.getFilteringSummary(this._subtitles);
      speechInfo = {
        speechSegments,
        speechDuration: summary.speechDuration,
        segmentCount: speechSegments.length,
        removedCount: summary.removedCount,
        removedTypes: summary.removedTypes
      };
    }

    // Show YLE-specific confirmation dialog
    this._showYLERecordingConfirmation(video, speechInfo);
  },

  /**
   * Show confirmation dialog for YLE screen recording
   * @param {HTMLVideoElement} video
   * @param {Object} speechInfo - Speech segment info (optional)
   * @private
   */
  _showYLERecordingConfirmation(video, speechInfo) {
    AudioDownloadUI.hideModal();
    AudioDownloadUI.hideProgressBar();

    const totalDuration = video.duration || 0;
    const speechDuration = speechInfo?.speechDuration || totalDuration;
    const estimatedVideoSize = Math.round((totalDuration * 2.5 * 1024) / 8 / 1024); // ~2.5 Mbps video
    const estimatedAudioSize = AudioEncoder.estimateFileSize(speechDuration, 128);

    const modal = document.createElement('div');
    modal.className = 'dsc-audio-modal';
    modal.innerHTML = `
      <div class="dsc-audio-modal__overlay"></div>
      <div class="dsc-audio-modal__content">
        <div class="dsc-audio-modal__header">
          <h3 class="dsc-audio-modal__title">Record from YLE Areena</h3>
        </div>
        <div class="dsc-audio-modal__body">
          <div class="dsc-audio-modal__notice" style="margin-bottom: 16px;">
            <p><strong>YLE uses DRM protection</strong> which prevents direct audio capture.</p>
            <p>Instead, we'll use <strong>screen recording</strong> to capture the video with audio.</p>
          </div>
          <div class="dsc-audio-modal__info">
            <div class="dsc-audio-modal__row">
              <span class="dsc-audio-modal__label">Video duration:</span>
              <span class="dsc-audio-modal__value">${AudioFilters.formatDuration(totalDuration)}</span>
            </div>
            ${speechInfo ? `
            <div class="dsc-audio-modal__row dsc-audio-modal__row--highlight">
              <span class="dsc-audio-modal__label">Speech only:</span>
              <span class="dsc-audio-modal__value">${AudioFilters.formatDuration(speechInfo.speechDuration)} (${speechInfo.segmentCount} segments)</span>
            </div>
            ` : ''}
            <div class="dsc-audio-modal__row">
              <span class="dsc-audio-modal__label">Recording output:</span>
              <span class="dsc-audio-modal__value">Video (~${estimatedVideoSize} MB) or MP3 (~${estimatedAudioSize})</span>
            </div>
          </div>
          <div class="dsc-audio-modal__notice" style="margin-top: 16px;">
            <p><strong>How it works:</strong></p>
            <ol style="margin: 8px 0; padding-left: 20px; font-size: 13px;">
              <li>Click "Start Recording" below</li>
              <li>In the popup, select this tab and check "Share tab audio"</li>
              <li>Play the video from where you want to start</li>
              <li>When done, click "Stop Recording"</li>
            </ol>
          </div>
        </div>
        <div class="dsc-audio-modal__footer">
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--secondary" id="dsc-yle-cancel">
            Cancel
          </button>
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--primary" id="dsc-yle-record">
            Start Recording
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    const confirmBtn = modal.querySelector('#dsc-yle-record');
    const cancelBtn = modal.querySelector('#dsc-yle-cancel');
    const overlay = modal.querySelector('.dsc-audio-modal__overlay');

    const closeModal = () => {
      modal.remove();
    };

    const handleConfirm = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeModal();
      await this._startYLERecording(video, speechInfo?.speechSegments);
    };

    const handleCancel = (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeModal();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleCancel);

    setTimeout(() => confirmBtn.focus(), 100);
  },

  /**
   * Start YLE screen recording
   * @param {HTMLVideoElement} video
   * @param {Array} speechSegments - Optional speech segments for extraction
   * @private
   */
  async _startYLERecording(video, speechSegments) {
    // NOTE: On YLE, we cannot show any modal as it closes the video overlay
    // The browser's native screen share dialog will appear instead
    console.info('DualSubExtension: Starting YLE screen recording (no modal to avoid closing video)');

    // Track when recording starts in the video timeline
    const recordingStartTime = video.currentTime;
    console.info('DualSubExtension: Recording started at video time:', recordingStartTime);

    try {
      await ScreenRecorder.startRecording({
        expectedDuration: video.duration,
        onProgress: (currentTime, totalTime, percent, phase) => {
          // Only show progress UI once recording has started
          // By this point the browser's native dialog has been handled
          this._showYLERecordingProgress(currentTime, totalTime, percent, phase, speechSegments);
        },
        onStatusChange: (status) => {
          console.info('DualSubExtension: Screen recording status:', status);
        },
        onComplete: async (blob) => {
          const recordingEndTime = video.currentTime;
          console.info('DualSubExtension: Recording complete, blob size:', blob.size, 'bytes');
          console.info('DualSubExtension: Recorded video time range:', recordingStartTime, 'to', recordingEndTime);

          // Show processing status
          this._showYLEProcessingStatus('Extracting speech audio...');

          // Get speech segments adjusted for recording time
          let speechSegments = null;
          if (this._subtitles && this._subtitles.length > 0) {
            const allSegments = AudioFilters.filterSpeechSegments(this._subtitles);
            speechSegments = allSegments
              .filter(seg => seg.startTime >= recordingStartTime && seg.startTime < recordingEndTime)
              .map(seg => ({
                ...seg,
                startTime: seg.startTime - recordingStartTime,
                endTime: Math.min(seg.endTime, recordingEndTime) - recordingStartTime
              }));
            console.info('DualSubExtension: Found', speechSegments.length, 'speech segments');
          }

          // Automatically extract speech-only MP3 (no modal)
          try {
            await ScreenRecorder.extractSpeechAudio(blob, speechSegments, {
              onProgress: (currentTime, totalTime, percent, phase) => {
                const status = phase === 'encoding' ? 'Encoding MP3...' : 'Extracting speech...';
                this._showYLEProcessingStatus(`${status} ${Math.round(percent)}%`);
              },
              onComplete: async (mp3Blob) => {
                this._hideYLERecordingUI();
                console.info('DualSubExtension: Speech MP3 ready, size:', mp3Blob.size);
                const filename = this._generateFilename();
                await this._downloadBlob(mp3Blob, filename);
                console.info('DualSubExtension: Download initiated:', filename);
              },
              onError: (error) => {
                this._hideYLERecordingUI();
                console.error('DualSubExtension: Extraction failed:', error);
              }
            });
          } catch (error) {
            this._hideYLERecordingUI();
            console.error('DualSubExtension: Extraction error:', error);
          }
        },
        onError: (error) => {
          this._hideYLERecordingUI();
          if (!error.message.includes('cancelled') && !error.message.includes('denied')) {
            // Only show error after recording attempt (video may already be closed)
            console.error('DualSubExtension: Screen recording error:', error.message);
            AudioDownloadUI.showError(error.message);
          }
        }
      });

    } catch (error) {
      this._hideYLERecordingUI();
      if (!error.message.includes('cancelled') && !error.message.includes('denied')) {
        console.error('DualSubExtension: Screen recording error:', error.message);
        AudioDownloadUI.showError(error.message);
      }
    }
  },

  /**
   * Show modal while waiting for screen share permission
   * @returns {HTMLElement} The modal element
   * @private
   */
  _showWaitingForPermissionModal() {
    const modal = document.createElement('div');
    modal.className = 'dsc-audio-modal';
    modal.id = 'dsc-yle-waiting-modal';
    modal.innerHTML = `
      <div class="dsc-audio-modal__overlay"></div>
      <div class="dsc-audio-modal__content" style="max-width: 350px;">
        <div class="dsc-audio-modal__header">
          <h3 class="dsc-audio-modal__title">Waiting for Permission</h3>
        </div>
        <div class="dsc-audio-modal__body" style="text-align: center;">
          <div style="font-size: 32px; margin-bottom: 16px;">🎬</div>
          <p>Please select this tab in the browser dialog and enable "Share tab audio".</p>
          <p style="margin-top: 12px; font-size: 13px; color: #888;">If you don't see a dialog, check if it's blocked by your browser.</p>
        </div>
        <div class="dsc-audio-modal__footer">
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--secondary" id="dsc-yle-cancel-waiting" style="width: 100%;">
            Cancel
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Cancel handler
    modal.querySelector('#dsc-yle-cancel-waiting').addEventListener('click', () => {
      ScreenRecorder.cancel();
      modal.remove();
    });

    modal.querySelector('.dsc-audio-modal__overlay').addEventListener('click', () => {
      ScreenRecorder.cancel();
      modal.remove();
    });

    return modal;
  },

  /**
   * Show recording progress with stop button
   * @private
   */
  _showYLERecordingProgress(currentTime, totalTime, percent, phase, speechSegments) {
    // Create or update the recording UI
    let recordingUI = document.getElementById('dsc-yle-recording-ui');

    if (!recordingUI) {
      recordingUI = document.createElement('div');
      recordingUI.id = 'dsc-yle-recording-ui';
      recordingUI.className = 'dsc-audio-progress';
      recordingUI.innerHTML = `
        <div class="dsc-audio-progress__content">
          <div class="dsc-audio-progress__header">
            <span class="dsc-audio-progress__title">🔴 Recording Screen</span>
            <button class="dsc-audio-progress__close" id="dsc-yle-stop-recording" title="Stop Recording">⬛</button>
          </div>
          <div class="dsc-audio-progress__bar-container">
            <div class="dsc-audio-progress__bar" style="width: 0%"></div>
          </div>
          <div class="dsc-audio-progress__info">
            <span class="dsc-audio-progress__time">0:00</span>
            <span class="dsc-audio-progress__percent">Recording...</span>
          </div>
        </div>
      `;
      document.body.appendChild(recordingUI);

      // Stop button handler
      recordingUI.querySelector('#dsc-yle-stop-recording').addEventListener('click', () => {
        ScreenRecorder.stopRecording();
      });
    }

    // Update progress
    const progressBar = recordingUI.querySelector('.dsc-audio-progress__bar');
    const timeText = recordingUI.querySelector('.dsc-audio-progress__time');
    const percentText = recordingUI.querySelector('.dsc-audio-progress__percent');

    if (progressBar && totalTime > 0) {
      progressBar.style.width = `${Math.min(percent, 100)}%`;
    }

    if (timeText) {
      const mins = Math.floor(currentTime / 60);
      const secs = Math.floor(currentTime % 60);
      timeText.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    if (percentText) {
      percentText.textContent = 'Recording...';
    }
  },

  /**
   * Hide YLE recording UI
   * @private
   */
  _hideYLERecordingUI() {
    const waitingModal = document.getElementById('dsc-yle-waiting-modal');
    if (waitingModal) waitingModal.remove();

    const recordingUI = document.getElementById('dsc-yle-recording-ui');
    if (recordingUI) recordingUI.remove();

    const processingUI = document.getElementById('dsc-yle-processing-ui');
    if (processingUI) processingUI.remove();

    AudioDownloadUI.hideProgressBar();
    AudioDownloadUI.hideModal();
  },

  /**
   * Show processing status (extracting/encoding)
   * @param {string} status - Status message to display
   * @private
   */
  _showYLEProcessingStatus(status) {
    let processingUI = document.getElementById('dsc-yle-processing-ui');

    if (!processingUI) {
      processingUI = document.createElement('div');
      processingUI.id = 'dsc-yle-processing-ui';
      processingUI.className = 'dsc-audio-progress';
      processingUI.innerHTML = `
        <div class="dsc-audio-progress__content">
          <div class="dsc-audio-progress__header">
            <span class="dsc-audio-progress__title">⏳ Processing</span>
          </div>
          <div class="dsc-audio-progress__info" style="justify-content: center;">
            <span class="dsc-audio-progress__status">Processing...</span>
          </div>
        </div>
      `;
      document.body.appendChild(processingUI);
    }

    const statusText = processingUI.querySelector('.dsc-audio-progress__status');
    if (statusText) {
      statusText.textContent = status;
    }
  },

  /**
   * Show export options after recording (DEPRECATED - kept for reference)
   * @param {Blob} videoBlob
   * @param {Array} speechSegments - Adjusted speech segments (timestamps relative to recording start)
   * @param {number} recordingDuration - Duration of the recording in seconds
   * @private
   */
  _showYLEExportOptions(videoBlob, speechSegments, recordingDuration) {
    const modal = document.createElement('div');
    modal.className = 'dsc-audio-modal';

    const videoSize = (videoBlob.size / (1024 * 1024)).toFixed(1);
    const hasSpeechSegments = speechSegments && speechSegments.length > 0;
    const durationStr = recordingDuration ? `${Math.round(recordingDuration)}s` : '';
    console.info('DualSubExtension: Export options - videoSize:', videoSize, 'MB, speechSegments:', speechSegments?.length || 0, 'duration:', durationStr);

    modal.innerHTML = `
      <div class="dsc-audio-modal__overlay"></div>
      <div class="dsc-audio-modal__content">
        <div class="dsc-audio-modal__header">
          <h3 class="dsc-audio-modal__title">Recording Complete</h3>
        </div>
        <div class="dsc-audio-modal__body">
          <div class="dsc-audio-modal__info">
            <div class="dsc-audio-modal__row">
              <span class="dsc-audio-modal__label">Recorded:</span>
              <span class="dsc-audio-modal__value">${videoSize} MB video${durationStr ? ` (${durationStr})` : ''}</span>
            </div>
            ${hasSpeechSegments ? `
            <div class="dsc-audio-modal__row">
              <span class="dsc-audio-modal__label">Speech segments:</span>
              <span class="dsc-audio-modal__value">${speechSegments.length} (non-verbal filtered)</span>
            </div>
            ` : ''}
          </div>
          <div class="dsc-audio-modal__notice" style="margin-top: 16px;">
            <p>Choose export format:</p>
          </div>
        </div>
        <div class="dsc-audio-modal__footer" style="flex-direction: column; gap: 8px;">
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--primary" id="dsc-export-video" style="width: 100%;">
            Download Video (WebM)
          </button>
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--primary" id="dsc-export-mp3-full" style="width: 100%;">
            Extract Full Audio (MP3)
          </button>
          ${hasSpeechSegments ? `
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--primary" id="dsc-export-mp3-speech" style="width: 100%;">
            Extract Speech Only (MP3)
          </button>
          ` : ''}
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--secondary" id="dsc-export-close" style="width: 100%; margin-top: 8px;">
            Done
          </button>
          <p id="dsc-export-status" style="margin: 8px 0 0 0; text-align: center; font-size: 12px; color: #27ae60; display: none;"></p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    // Prevent clicks from propagating to YLE player (which might close video)
    modal.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Helper to show status in modal
    const showStatus = (message, isError = false) => {
      const statusEl = modal.querySelector('#dsc-export-status');
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.display = 'block';
        statusEl.style.color = isError ? '#e74c3c' : '#27ae60';
      }
    };

    // Helper to disable/enable buttons during processing
    const setButtonsEnabled = (enabled) => {
      modal.querySelectorAll('button').forEach(btn => {
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.5';
      });
    };

    // Video download
    modal.querySelector('#dsc-export-video').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      console.info('DualSubExtension: Downloading video, blob size:', videoBlob.size);
      const filename = this._generateFilename().replace('.mp3', '.webm');
      this._downloadBlob(videoBlob, filename);
      showStatus(`Downloaded: ${filename}`);
    });

    // Full MP3 extraction (no filtering)
    modal.querySelector('#dsc-export-mp3-full').addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      console.info('DualSubExtension: Extracting full audio as MP3 from video blob, size:', videoBlob.size);

      setButtonsEnabled(false);
      showStatus('Extracting full audio...');

      try {
        await ScreenRecorder.extractSpeechAudio(videoBlob, null, {
          onProgress: (currentTime, totalTime, percent, phase) => {
            showStatus(`${phase === 'encoding' ? 'Encoding' : 'Extracting'}... ${Math.round(percent)}%`);
          },
          onComplete: (mp3Blob) => {
            console.info('DualSubExtension: Full MP3 extraction complete, size:', mp3Blob.size);
            const filename = this._generateFilename();
            this._downloadBlob(mp3Blob, filename);
            setButtonsEnabled(true);
            showStatus(`Downloaded: ${filename}`);
          },
          onError: (error) => {
            setButtonsEnabled(true);
            showStatus('Failed: ' + error.message, true);
          }
        });
      } catch (error) {
        setButtonsEnabled(true);
        showStatus('Failed: ' + error.message, true);
      }
    });

    // Speech-only MP3 extraction (with filler removal)
    if (hasSpeechSegments) {
      modal.querySelector('#dsc-export-mp3-speech').addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.info('DualSubExtension: Extracting speech-only MP3, segments:', speechSegments.length);

        setButtonsEnabled(false);
        showStatus('Extracting speech (removing non-verbal)...');

        try {
          await ScreenRecorder.extractSpeechAudio(videoBlob, speechSegments, {
            onProgress: (currentTime, totalTime, percent, phase) => {
              showStatus(`${phase === 'encoding' ? 'Encoding' : 'Extracting speech'}... ${Math.round(percent)}%`);
            },
            onComplete: (mp3Blob) => {
              console.info('DualSubExtension: Speech-only MP3 extraction complete, size:', mp3Blob.size);
              const filename = this._generateFilename().replace('.mp3', '_speech.mp3');
              this._downloadBlob(mp3Blob, filename);
              setButtonsEnabled(true);
              showStatus(`Downloaded: ${filename}`);
            },
            onError: (error) => {
              setButtonsEnabled(true);
              showStatus('Failed: ' + error.message, true);
            }
          });
        } catch (error) {
          setButtonsEnabled(true);
          showStatus('Failed: ' + error.message, true);
        }
      });
    }

    // Done button - closes modal
    modal.querySelector('#dsc-export-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeModal();
    });

    // Clicking overlay does nothing (must use buttons)
    modal.querySelector('.dsc-audio-modal__overlay').addEventListener('click', (e) => {
      e.stopPropagation();
      // Don't close - user must click a button
    });
  },

  /**
   * Generate filename for the audio download
   * @returns {string}
   * @private
   */
  _generateFilename() {
    // Try to get video title from page
    let title = 'audio';

    // Try different sources for title
    const titleSources = [
      () => document.querySelector('title')?.textContent,
      () => document.querySelector('h1')?.textContent,
      () => document.querySelector('[class*="title"]')?.textContent,
      () => document.querySelector('.ytp-title-link')?.textContent
    ];

    for (const getTitle of titleSources) {
      try {
        const t = getTitle();
        if (t && t.trim()) {
          title = t.trim();
          break;
        }
      } catch (e) {
        // Continue to next source
      }
    }

    // Clean filename
    title = title
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
      .replace(/\s+/g, '_')          // Replace spaces with underscores
      .substring(0, 50);             // Limit length

    return `${title}_speech.mp3`;
  },

  /**
   * Test if audio capture is likely to work for this video
   * Does basic checks without actually trying to capture (which can break some players)
   * @param {HTMLVideoElement} video
   * @returns {Promise<{success: boolean, reason?: string}>}
   * @private
   */
  async _testAudioCapture(video) {
    // Check 1: Does the video have audio?
    // Note: videoWidth check is a proxy - if video has no dimensions, it might not be loaded
    if (!video.videoWidth && !video.videoHeight && video.readyState < 2) {
      return {
        success: false,
        reason: 'Video is not fully loaded yet. Please wait and try again.'
      };
    }

    // Check 2: Is the video in an error state?
    if (video.error) {
      return {
        success: false,
        reason: 'Video is in an error state.'
      };
    }

    // Check 3: Basic API availability
    const hasWebAudio = !!(window.AudioContext || window.webkitAudioContext);
    const hasMediaRecorder = !!window.MediaRecorder;

    if (!hasWebAudio || !hasMediaRecorder) {
      return {
        success: false,
        reason: 'Your browser does not support the required audio APIs.'
      };
    }

    // Check 4: Check if captureStream exists (but don't call it - that can break players)
    const hasCaptureStream = typeof video.captureStream === 'function' ||
                             typeof video.mozCaptureStream === 'function';

    // If captureStream doesn't exist, we'll rely on createMediaElementSource
    // which should work for most cases
    if (!hasCaptureStream) {
      console.info('captureStream not available, will use createMediaElementSource');
    }

    // We can't truly test without potentially breaking the video,
    // so we allow the attempt and handle errors during actual recording
    return { success: true };
  },

  /**
   * Download a blob as a file
   * @param {Blob} blob
   * @param {string} filename
   * @private
   */
  async _downloadBlob(blob, filename) {
    console.info('DualSubExtension: Downloading blob via background script, size:', blob.size, 'filename:', filename);

    try {
      // Convert blob to data URL for background script
      const dataUrl = await this._blobToDataUrl(blob);

      // Send to background script to download via chrome.downloads API
      // This avoids any focus events on the page
      const response = await chrome.runtime.sendMessage({
        action: 'downloadBlob',
        data: { dataUrl, filename }
      });

      if (response && response.success) {
        console.info('DualSubExtension: Download initiated successfully');
      } else {
        // Fallback to direct download if background script fails
        console.warn('DualSubExtension: Background download failed, using fallback:', response?.error);
        this._downloadBlobFallback(blob, filename);
      }
    } catch (error) {
      console.error('DualSubExtension: Download error, using fallback:', error);
      this._downloadBlobFallback(blob, filename);
    }
  },

  /**
   * Convert blob to data URL
   * @param {Blob} blob
   * @returns {Promise<string>}
   * @private
   */
  _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Fallback download method using anchor element
   * @param {Blob} blob
   * @param {string} filename
   * @private
   */
  _downloadBlobFallback(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  },

  /**
   * Check if currently skipping (for auto-pause prevention)
   * @returns {boolean}
   */
  isSkipping() {
    return ControlActions.isSkipping();
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ControlIntegration = ControlIntegration;
}
