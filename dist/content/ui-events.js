// ==================================
// UI EVENTS + FOCUS/MOUSE HANDLING
// ==================================
// ==================================
// MOUSE ACTIVITY TRACKING
// Show YLE controls on mouse movement, hide after inactivity
// Extension controls stay visible always (handled by CSS)
// ==================================
let mouseActivityTimer = null;
const MOUSE_HIDE_DELAY = 2500; // Hide after 2.5 seconds of inactivity
function showYleControls() {
    const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
    if (playerUI) {
        playerUI.classList.add('yle-mouse-active');
    }
    document.body.classList.add('yle-mouse-active');
}
function hideYleControls() {
    const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
    if (playerUI) {
        playerUI.classList.remove('yle-mouse-active');
    }
    document.body.classList.remove('yle-mouse-active');
}
function onMouseActivity() {
    showYleControls();
    if (mouseActivityTimer) {
        clearTimeout(mouseActivityTimer);
    }
    mouseActivityTimer = setTimeout(hideYleControls, MOUSE_HIDE_DELAY);
}
// Track mouse movement
document.addEventListener('mousemove', onMouseActivity, { passive: true });
document.addEventListener('touchstart', onMouseActivity, { passive: true });
// Start with controls hidden
setTimeout(hideYleControls, 1000);
/**
 * Focus the video/player to enable keyboard controls
 */
function focusVideo() {
    // Don't focus if a word tooltip is active (user is looking up a word)
    if (activeTooltip) {
        return;
    }
    // Find the player UI element that likely handles keyboard events
    const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
    if (playerUI) {
        // Make it focusable and focus it
        playerUI.setAttribute('tabindex', '0');
        playerUI.focus();
        // If focus successful, we're done
        if (document.activeElement === playerUI) {
            return;
        }
    }
    // Try clicking on the player area to trigger native focus
    // We'll click on an area that doesn't toggle play/pause (like the bottom area)
    const video = document.querySelector('video');
    if (video) {
        const rect = video.getBoundingClientRect();
        // Create a click at the bottom edge of the video (near controls, won't toggle play)
        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom - 5
        });
        // Dispatch on the player UI, not the video (to avoid play/pause toggle)
        if (playerUI) {
            playerUI.dispatchEvent(clickEvent);
        }
    }
}
// Focus video after clicking on any control bar element (extension or YLE)
document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target)
        return;
    // Don't focus video when interacting with dropdowns/selects - wait for change event
    if (target.tagName === 'SELECT' || target.tagName === 'OPTION' || target.closest('select')) {
        return;
    }
    // Don't focus video when clicking on words in subtitles (for tooltip)
    if (target.closest('.word-item') || target.closest('#displayed-subtitles-wrapper')) {
        return;
    }
    // Don't focus video when clicking on the tooltip itself
    if (target.closest('.word-tooltip')) {
        return;
    }
    // Don't focus video when clicking on YLE settings buttons or menus
    // These need to maintain focus for the menu/submenu to stay open
    if (target.closest('[class*="SettingsButton"]') ||
        target.closest('[class*="Settings__"]') ||
        target.closest('[class*="TopLevelSettings"]') ||
        target.closest('[aria-label*="Tekstitykset"]') ||
        target.closest('[aria-label*="Asetukset"]') ||
        target.closest('[aria-label*="Ääni"]')) {
        return;
    }
    // Don't focus video when clicking on our extension's UI elements
    // The synthetic click in focusVideo can trigger YLE to close the video player
    // Check for the entire control panel and all dsc-prefixed elements
    if (target.closest('.dsc-panel') ||
        target.closest('.dsc-btn') ||
        target.closest('.dsc-group') ||
        target.closest('.dsc-audio-modal') ||
        target.closest('#dsc-download-audio-btn') ||
        target.closest('#dsc-yle-waiting-modal') ||
        target.closest('#dsc-yle-recording-ui') ||
        target.closest('.dsc-audio-progress') ||
        target.closest('.dsc-audio-toast') ||
        target.closest('[id^="dsc-yle-"]') ||
        target.closest('[id^="dsc-audio-"]') ||
        target.closest('[id^="dsc-export-"]') ||
        target.closest('[class*="dsc-"]')) {
        return;
    }
    // Also check if target itself has dsc- prefix (for buttons inside modals or SVG icons)
    if (target.id && target.id.startsWith('dsc-')) {
        return;
    }
    // Check if target or any parent has a class starting with dsc-
    let el = target;
    while (el && el !== document.body) {
        if (el.className && typeof el.className === 'string' && el.className.split(' ').some(c => c.startsWith('dsc-'))) {
            return;
        }
        el = el.parentElement;
    }
    // Check if click was on control bar area
    const isControlBarClick = target.closest('[class*="BottomControlBar"]') ||
        target.closest('[class*="TopControlBar"]') ||
        target.closest('.dual-sub-extension-section') ||
        target.closest('[class*="Timeline"]');
    if (isControlBarClick) {
        // Small delay to let the control action complete first
        setTimeout(focusVideo, 100);
    }
}, true);
// ==================================
// UI EVENT LISTENERS
// ==================================
function getOriginalSubtitlesWrapper() {
    if (typeof getNativeSubtitlesWrapper === 'function') {
        return getNativeSubtitlesWrapper();
    }
    return document.querySelector('[data-testid="subtitles-wrapper"]');
}
document.addEventListener("change", (e) => {
    /**
     * Listen for user interaction events in YLE Areena page,
     * for example: dual sub switch change event
     * @param {Event} e
     */
    const target = e.target;
    if (!target)
        return;
    if (target.id === "dual-sub-switch") {
        dualSubEnabled = target.checked;
        console.log("DualSubExtension: Dual sub switch changed to:", dualSubEnabled);
        // Focus video to enable keyboard controls
        focusVideo();
        // Save preference to chrome storage
        chrome.storage.sync.set({ dualSubEnabled }).then(async () => {
            console.log("DualSubExtension: Saved dualSubEnabled to storage:", dualSubEnabled);
            // Verify the save worked by reading it back
            const verify = await chrome.storage.sync.get("dualSubEnabled");
            console.log("DualSubExtension: Verified storage value:", verify);
        }).catch(err => {
            console.error("DualSubExtension: Error saving dualSubEnabled:", err);
        });
        // YLE dual sub toggle logic
        if (target.checked) {
            const originalSubtitlesWrapper = getOriginalSubtitlesWrapper();
            if (!originalSubtitlesWrapper) {
                console.error("DualSubExtension: This should not happen: " +
                    "When the video is loaded the subtitles wrapper should be there");
                target.checked = false;
                dualSubEnabled = false;
                return;
            }
            originalSubtitlesWrapper.style.display = "none";
            const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper);
            displayedSubtitlesWrapper.innerHTML = "";
            displayedSubtitlesWrapper.style.display = "flex";
            const originalSubtitlesWrapperSpans = originalSubtitlesWrapper.querySelectorAll('span');
            if (originalSubtitlesWrapperSpans) {
                addContentToDisplayedSubtitlesWrapper(displayedSubtitlesWrapper, originalSubtitlesWrapperSpans);
            }
            translationQueue.processQueue().then(() => { }).catch((error) => {
                console.error("DualSubExtension: Error processing translation queue after enabling dual subtitles:", error);
            });
        }
        else {
            // When dual sub is disabled, keep showing clickable original text
            // Just remove the translation spans, don't hide the wrapper
            const displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
            if (displayedSubtitlesWrapper) {
                // Remove only translation spans, keep original clickable text
                const translationSpans = displayedSubtitlesWrapper.querySelectorAll('.translated-text-span');
                translationSpans.forEach(span => span.remove());
            }
            // Keep original YLE subtitles hidden - we show our clickable version instead
        }
    }
});
// SECTION: UNIFIED CONTROL PANEL EVENT LISTENERS
// ==================================
/* global ControlIntegration, ControlPanel, ControlActions, ControlKeyboard */
// Listen for unified control panel events
document.addEventListener('dscDualSubToggle', (e) => {
    const { enabled } = e.detail;
    dualSubEnabled = enabled;
    // Handle dual sub toggle logic for YLE
    if (enabled) {
        const originalSubtitlesWrapper = getOriginalSubtitlesWrapper();
        if (originalSubtitlesWrapper) {
            originalSubtitlesWrapper.style.display = 'none';
            const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper);
            displayedSubtitlesWrapper.innerHTML = '';
            displayedSubtitlesWrapper.style.display = 'flex';
            const originalSubtitlesWrapperSpans = originalSubtitlesWrapper.querySelectorAll('span');
            if (originalSubtitlesWrapperSpans) {
                addContentToDisplayedSubtitlesWrapper(displayedSubtitlesWrapper, originalSubtitlesWrapperSpans);
            }
            translationQueue.processQueue().catch(console.error);
        }
    }
    else {
        // When dual sub is disabled, keep showing clickable original text
        // Just remove the translation spans, don't hide the wrapper
        const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
        if (displayedSubtitlesWrapper) {
            // Remove only translation spans, keep original clickable text
            const translationSpans = displayedSubtitlesWrapper.querySelectorAll('.translated-text-span');
            translationSpans.forEach(span => span.remove());
        }
        // Keep original YLE subtitles hidden - we show our clickable version instead
    }
    // Also update legacy switch if it exists (for backwards compatibility)
    const dualSubSwitch = document.getElementById('dual-sub-switch');
    if (dualSubSwitch && dualSubSwitch.checked !== enabled) {
        dualSubSwitch.checked = enabled;
    }
});
document.addEventListener('dscAutoPauseToggle', (e) => {
    const { enabled } = e.detail;
    autoPauseEnabled = enabled;
    lastSubtitleText = ''; // Reset to allow next subtitle to trigger pause
});
document.addEventListener('dscSpeedChange', (e) => {
    const { speed } = e.detail;
    playbackSpeed = speed;
});
document.addEventListener('dscSourceLangChange', (e) => {
    const { language } = e.detail;
    // Clear translations when language changes
    sharedTranslationMap.clear();
    sharedTranslationErrorMap.clear();
});
// Handle repeat subtitle start - disable auto-pause during repeat
document.addEventListener('dscRepeatSubtitle', () => {
    console.info('DualSubExtension: Repeat started, disabling auto-pause temporarily');
    isRepeatingSubtitle = true;
});
// Handle repeat subtitle complete - re-enable auto-pause
document.addEventListener('dscRepeatComplete', () => {
    console.info('DualSubExtension: Repeat completed, re-enabling auto-pause');
    isRepeatingSubtitle = false;
});
// Handle extension toggle from control panel
// Simplified: no auto-sync, user controls everything
document.addEventListener('dscExtensionToggle', (e) => {
    const { enabled } = e.detail;
    extensionEnabled = enabled;
    console.info('DualSubExtension: Extension toggled:', enabled);
    // When extension is disabled, restore native YLE behavior
    if (!enabled) {
        // Hide extension's subtitle overlay
        const extensionOverlay = document.getElementById('dual-sub-overlay');
        if (extensionOverlay) {
            extensionOverlay.style.display = 'none';
        }
        const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
        if (displayedSubtitlesWrapper) {
            displayedSubtitlesWrapper.style.display = 'none';
        }
        // Show the original YLE subtitle wrapper
        const originalWrapper = getOriginalSubtitlesWrapper();
        if (originalWrapper) {
            originalWrapper.style.visibility = 'visible';
            originalWrapper.style.opacity = '1';
        }
    }
    else {
        // When extension is enabled, show our overlay and hide native captions
        const extensionOverlay = document.getElementById('dual-sub-overlay');
        if (extensionOverlay) {
            // Restore flex display explicitly to maintain positioning
            extensionOverlay.style.display = 'flex';
        }
        const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
        if (displayedSubtitlesWrapper) {
            displayedSubtitlesWrapper.style.display = 'flex';
        }
        // Hide native YLE captions when extension is enabled
        const originalWrapper = getOriginalSubtitlesWrapper();
        if (originalWrapper) {
            originalWrapper.style.visibility = 'hidden';
        }
    }
});
// Handle source language change from control integration
// Simplified: no auto-sync, just update detectedSourceLanguage
document.addEventListener('dscSourceLanguageChanged', (e) => {
    const { sourceLanguage, targetLanguage } = e.detail;
    // Only update detectedSourceLanguage if new value is not null
    if (sourceLanguage !== null) {
        detectedSourceLanguage = sourceLanguage;
    }
    console.info('DualSubExtension: Source language changed:', sourceLanguage, 'Target:', targetLanguage);
});
// Handle captions state change (CC button toggle)
// Simplified: no auto-sync, just log the change
document.addEventListener('dscCaptionsStateChanged', (e) => {
    const { captionsEnabled, extensionEnabled: newExtensionEnabled, dualSubEnabled: newDualSubEnabled } = e.detail;
    console.info('DualSubExtension: Captions state changed:', captionsEnabled, 'Extension:', newExtensionEnabled, 'DualSub:', newDualSubEnabled);
});
// Listen for source language detection from YLE adapter
document.addEventListener('yleSourceLanguageDetected', (e) => {
    const { language } = e.detail;
    detectedSourceLanguage = language;
    if (typeof ControlIntegration !== 'undefined') {
        ControlIntegration.setSourceLanguage(language);
    }
    console.info('DualSubExtension: YLE source language detected:', language);
});
// Handle YLE native captions toggle (when user disables subtitles via YLE menu)
document.addEventListener('yleNativeCaptionsToggled', (e) => {
    const { enabled } = e.detail;
    console.info('DualSubExtension: Native YLE captions toggled:', enabled);
    // Update ControlIntegration captionsEnabled state (CC is master switch)
    if (typeof ControlIntegration !== 'undefined') {
        ControlIntegration.setCaptionsEnabled(enabled);
    }
    if (!enabled) {
        // User disabled native captions - hide our subtitles too
        const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
        if (displayedSubtitlesWrapper) {
            displayedSubtitlesWrapper.style.display = 'none';
        }
        // Update activation reason to reflect no subtitles state
        if (typeof ControlIntegration !== 'undefined') {
            ControlIntegration.setSourceLanguage(null, { force: true }); // CC OFF - force reset
        }
    }
    else {
        // User enabled native captions - show our subtitles if extension is enabled
        if (extensionEnabled) {
            const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
            if (displayedSubtitlesWrapper) {
                displayedSubtitlesWrapper.style.display = 'flex';
            }
            // Try to detect the source language from the subtitle content
            // YLE will dispatch 'yleSourceLanguageDetected' separately if needed
        }
    }
});
//# sourceMappingURL=ui-events.js.map