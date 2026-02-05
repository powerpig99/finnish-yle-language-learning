// ==================================
// TRANSLATION API
// ==================================
/**
 * Fetch batch translation with context from background script
 * @param {Array<string>} texts - Texts to translate
 * @returns {Promise<[true, Array<string>]|[false, string]>}
 */
async function fetchBatchTranslation(texts) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await safeSendMessage({
                action: 'fetchBatchTranslation',
                data: { texts, targetLanguage, isContextual: true }
            });
            if (response === null) {
                // Extension context invalidated - service worker might have been terminated
                // Wait and retry as it should restart
                if (attempt < MAX_RETRIES - 1) {
                    console.warn(`YleDualSubExtension: Service worker not responding, retrying in ${RETRY_DELAY}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await sleep(RETRY_DELAY);
                    continue;
                }
                return [false, 'Extension context invalidated'];
            }
            return response;
        }
        catch (error) {
            const errorMsg = error.message || String(error);
            // Check for service worker termination errors - retry these
            const isServiceWorkerError = errorMsg.includes('message channel closed') ||
                errorMsg.includes('Extension context invalidated') ||
                errorMsg.includes('Receiving end does not exist');
            if (isServiceWorkerError && attempt < MAX_RETRIES - 1) {
                console.warn(`YleDualSubExtension: Service worker error, retrying in ${RETRY_DELAY}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`, errorMsg);
                await sleep(RETRY_DELAY);
                continue;
            }
            console.error("YleDualSubExtension: Error sending batch translation request:", error);
            return [false, errorMsg];
        }
    }
    return [false, 'Translation failed after retries'];
}
/**
 *
 * @param {Array<string>} rawSubtitleFinnishTexts - Finnish text to translate
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.

 */
async function fetchTranslation(rawSubtitleFinnishTexts) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            /**
             * @type {[true, Array<string>] | [false, string] | null}
             */
            const response = await safeSendMessage({
                action: 'fetchTranslation',
                data: { rawSubtitleFinnishTexts, targetLanguage }
            });
            if (response === null) {
                // Extension context invalidated - service worker might have been terminated
                if (attempt < MAX_RETRIES - 1) {
                    console.warn(`YleDualSubExtension: Service worker not responding, retrying in ${RETRY_DELAY}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await sleep(RETRY_DELAY);
                    continue;
                }
                return [false, 'Extension context invalidated'];
            }
            return response;
        }
        catch (error) {
            const errorMsg = error.message || String(error);
            // Check for service worker termination errors - retry these
            const isServiceWorkerError = errorMsg.includes('message channel closed') ||
                errorMsg.includes('Extension context invalidated') ||
                errorMsg.includes('Receiving end does not exist');
            if (isServiceWorkerError && attempt < MAX_RETRIES - 1) {
                console.warn(`YleDualSubExtension: Service worker error, retrying in ${RETRY_DELAY}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`, errorMsg);
                await sleep(RETRY_DELAY);
                continue;
            }
            console.error("YleDualSubExtension: Error sending message to background for translation:", error);
            return [false, errorMsg];
        }
    }
    return [false, 'Translation failed after retries'];
}
//# sourceMappingURL=translation-api.js.map