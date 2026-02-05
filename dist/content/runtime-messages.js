// ==================================
// RUNTIME MESSAGE HANDLERS
// ==================================
// Listen for messages from popup (extension toggle)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'extensionToggled') {
        extensionEnabled = message.enabled;
        console.info('DualSubExtension: Received extensionToggled from popup:', message.enabled);
        // Update control integration if available
        if (typeof ControlIntegration !== 'undefined') {
            ControlIntegration._handleExtensionToggle(message.enabled);
        }
        sendResponse({ success: true });
    }
    if (message.action === 'clearSubtitleCache') {
        const count = sharedTranslationMap.size + sharedTranslationErrorMap.size;
        sharedTranslationMap.clear();
        sharedTranslationErrorMap.clear();
        console.info('DualSubExtension: Cleared subtitle translation cache:', count, 'entries');
        sendResponse({ success: true, count });
    }
    if (message.action === 'getSubtitleCacheCount') {
        const count = sharedTranslationMap.size + sharedTranslationErrorMap.size;
        sendResponse({ success: true, count });
    }
    if (message.action === 'getWordCacheCount') {
        // Count entries in IndexedDB WordTranslations store
        (async () => {
            try {
                if (!globalDatabaseInstance) {
                    globalDatabaseInstance = await openDatabase();
                }
                const transaction = globalDatabaseInstance.transaction(['WordTranslations'], 'readonly');
                const store = transaction.objectStore('WordTranslations');
                const countRequest = store.count();
                countRequest.onsuccess = () => {
                    sendResponse({ success: true, count: countRequest.result });
                };
                countRequest.onerror = () => {
                    sendResponse({ success: true, count: 0 });
                };
            }
            catch (e) {
                console.error('DualSubExtension: Error counting word cache:', e);
                sendResponse({ success: true, count: 0 });
            }
        })();
        return true; // Keep channel open for async response
    }
    if (message.action === 'clearWordCache') {
        // Clear entries from IndexedDB WordTranslations store
        (async () => {
            try {
                if (!globalDatabaseInstance) {
                    globalDatabaseInstance = await openDatabase();
                }
                const transaction = globalDatabaseInstance.transaction(['WordTranslations'], 'readwrite');
                const store = transaction.objectStore('WordTranslations');
                const countRequest = store.count();
                countRequest.onsuccess = () => {
                    const count = countRequest.result;
                    const clearRequest = store.clear();
                    clearRequest.onsuccess = () => {
                        // Also clear in-memory cache
                        wordTranslationCache.clear();
                        console.info('DualSubExtension: Cleared word translation cache:', count, 'entries');
                        sendResponse({ success: true, count });
                    };
                    clearRequest.onerror = () => {
                        sendResponse({ success: false, count: 0 });
                    };
                };
                countRequest.onerror = () => {
                    sendResponse({ success: false, count: 0 });
                };
            }
            catch (e) {
                console.error('DualSubExtension: Error clearing word cache:', e);
                sendResponse({ success: false, count: 0 });
            }
        })();
        return true; // Keep channel open for async response
    }
    return true; // Keep channel open for async response
});
//# sourceMappingURL=runtime-messages.js.map