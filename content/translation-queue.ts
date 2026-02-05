// ==================================
// TRANSLATION QUEUE
// ==================================

class TranslationQueue {
  /* Queue to manage translation requests to avoid hitting rate limits */

  BATCH_MAXIMUM_SIZE = 7;
  queue: string[];
  isProcessing: boolean;

  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * @param {string} rawSubtitleFinnishText - Finnish text to translate
   * @returns {void}
   */
  addToQueue(rawSubtitleFinnishText: string) {
    this.queue.push(rawSubtitleFinnishText);
  }

  /**
   * Process the translation queue in batches
   * By sending to background.js to handle translation and store results in
   * sharedTranslationMap or sharedTranslationErrorMap
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) { return; }

    while (this.queue.length > 0 && dualSubEnabled) {
      this.isProcessing = true;

      /** @type {Array<string>} */
      const toProcessItems: string[] = [];
      for (let i = 0; i < Math.min(this.queue.length, this.BATCH_MAXIMUM_SIZE); i++) {
        const item = this.queue.shift();
        if (item) {
          toProcessItems.push(item);
        }
      }

      try {
        console.log("YleDualSubExtension: Sending translation request for", toProcessItems.length, "items");
        const [isSucceeded, translationResponse] = await fetchTranslation(toProcessItems);
        console.log("YleDualSubExtension: Translation response - success:", isSucceeded, "response:", typeof translationResponse);

        if (isSucceeded) {
          const translatedTexts = translationResponse;
          /**
           * @type {Array<SubtitleRecord>}
           */
          const toCacheSubtitleRecords: SubtitleRecord[] = [];
          for (let i = 0; i < toProcessItems.length; i++) {
            const translatedText = translatedTexts[i];
            const rawSubtitleFinnishText = toProcessItems[i];
            const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);

            // Skip failed translations (null) - they will be retried next time
            if (translatedText === null || translatedText === undefined) {
              console.info(`YleDualSubExtension: JIT translation failed for "${rawSubtitleFinnishText.substring(0, 30)}..." - will retry later`);
              continue;
            }

            const sharedTranslationMapValue = translatedText.trim().replace(/\n/g, ' ');
            sharedTranslationMap.set(
              sharedTranslationMapKey,
              sharedTranslationMapValue,
            );
            if (currentMovieName) {
              toCacheSubtitleRecords.push({
                "movieName": currentMovieName,
                "originalLanguage": "FI",
                targetLanguage,
                "originalText": sharedTranslationMapKey,
                "translatedText": sharedTranslationMapValue,
              });
            }
          }
          if (globalDatabaseInstance) {
            saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords)
              .then(() => { })
              .catch((error) => {
                console.error("YleDualSubExtension: Error saving subtitles batch to cache:", error);
              });
          }
        }
        else {
          const translationErrorMessage = translationResponse;
          console.error("YleDualSubExtension: JIT translation error:", translationErrorMessage);
          // Don't cache failed translations - they will be retried on next subtitle display
          console.info(`YleDualSubExtension: ${toProcessItems.length} JIT translations failed - will retry later`);
        }

      } catch (error) {
        console.error("YleDualSubExtension: System error when translating text:", error);
        // Don't cache failed translations - they will be retried on next subtitle display
        console.info(`YleDualSubExtension: ${toProcessItems.length} JIT translations failed due to error - will retry later`);
      }
    }

    this.isProcessing = false;
  }
}

const translationQueue = new TranslationQueue();

// Batch translation state
let isBatchTranslating = false;
let batchTranslationProgress = { current: 0, total: 0 };

/**
 * Handle batch translation of all subtitles with context
 * @param {Array<{text: string, startTime: number, endTime: number}>} subtitles - All subtitles with timing
 * @returns {Promise<void>}
 */
async function handleBatchTranslation(subtitles: Array<{ text: string; startTime: number; endTime: number }>) {
  // Set flag IMMEDIATELY to block individual event processing
  if (isBatchTranslating) {
    console.info("YleDualSubExtension: Batch translation already in progress, skipping...");
    return;
  }
  isBatchTranslating = true;

  console.info(`YleDualSubExtension: Received ${subtitles.length} total subtitles for batch translation`);

  // Pre-populate ALL subtitle timestamps for skip feature FIRST (before any early returns)
  // Also accumulate full subtitles for repeat feature
  for (const sub of subtitles) {
    if (sub.startTime !== undefined) {
      const existingTimestamp = subtitleTimestamps.find(ts => Math.abs(ts.time - sub.startTime) < 0.5);
      if (!existingTimestamp) {
        subtitleTimestamps.push({ time: sub.startTime, text: sub.text });
      }
      // Accumulate full subtitle data for repeat feature (with startTime and endTime)
      if (sub.endTime !== undefined) {
        const existingFullSub = fullSubtitles.find(fs => Math.abs(fs.startTime - sub.startTime) < 0.5);
        if (!existingFullSub) {
          fullSubtitles.push({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text });
        }
      }
    }
  }
  subtitleTimestamps.sort((a, b) => a.time - b.time);
  fullSubtitles.sort((a, b) => a.startTime - b.startTime);
  console.info(`YleDualSubExtension: Pre-populated ${subtitleTimestamps.length} timestamps and ${fullSubtitles.length} full subtitles`);

  // Sync ACCUMULATED subtitles with ControlIntegration for skip/repeat functionality
  // Note: Call setSubtitles even if panel isn't mounted yet - it just stores the data
  if (typeof ControlIntegration !== 'undefined') {
    ControlIntegration.setSubtitles(fullSubtitles);
    console.info('YleDualSubExtension: Synced', fullSubtitles.length, 'accumulated subtitles with ControlIntegration');
  }

  // Filter out subtitles that are already translated (from cache)
  const untranslatedSubtitles = subtitles.filter(sub => {
    const key = toTranslationKey(sub.text);
    return !sharedTranslationMap.has(key) && !sharedTranslationErrorMap.has(key);
  });

  if (untranslatedSubtitles.length === 0) {
    console.info("YleDualSubExtension: All subtitles already cached, no batch translation needed");
    isBatchTranslating = false;
    return;
  }

  console.info(`YleDualSubExtension: Starting batch translation of ${untranslatedSubtitles.length} untranslated subtitles (${subtitles.length - untranslatedSubtitles.length} already cached)`);
  batchTranslationProgress = { current: 0, total: untranslatedSubtitles.length };

  showBatchTranslationIndicator();

  // Process in chunks of 10 for better reliability with Google Translate
  const CHUNK_SIZE = 10;
  const chunks = [];
  for (let i = 0; i < untranslatedSubtitles.length; i += CHUNK_SIZE) {
    chunks.push(untranslatedSubtitles.slice(i, i + CHUNK_SIZE));
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const texts = chunk.map(sub => sub.text);

    // Add delay between chunks to avoid rate limiting
    if (chunkIndex > 0) {
      await sleep(500);
    }

    try {
      const [isSucceeded, translationResponse] = await fetchBatchTranslation(texts);

      if (isSucceeded) {
        const translatedTexts = translationResponse;
        const toCacheSubtitleRecords: SubtitleRecord[] = [];

        for (let i = 0; i < texts.length; i++) {
          const translatedText = translatedTexts[i];
          const rawSubtitleFinnishText = texts[i];
          const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);

          // Skip failed translations (null) - they will be retried next time
          if (translatedText === null || translatedText === undefined) {
            console.info(`YleDualSubExtension: Translation failed for "${rawSubtitleFinnishText.substring(0, 30)}..." - will retry later`);
            continue;
          }

          const sharedTranslationMapValue = translatedText.trim().replace(/\n/g, ' ');

          sharedTranslationMap.set(sharedTranslationMapKey, sharedTranslationMapValue);

          // Also populate subtitle timestamps for skip feature
          const subtitleData = chunk[i];
          if (subtitleData && subtitleData.startTime !== undefined) {
            const existingTimestamp = subtitleTimestamps.find(
              ts => Math.abs(ts.time - subtitleData.startTime) < 0.5
            );
            if (!existingTimestamp) {
              subtitleTimestamps.push({ time: subtitleData.startTime, text: rawSubtitleFinnishText });
            }
          }

          if (currentMovieName) {
            toCacheSubtitleRecords.push({
              movieName: currentMovieName,
              originalLanguage: "FI",
              targetLanguage,
              originalText: sharedTranslationMapKey,
              translatedText: sharedTranslationMapValue,
            });
          }
        }

        // Save to cache
        if (globalDatabaseInstance && toCacheSubtitleRecords.length > 0) {
          saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords).catch((error) => {
            console.error("YleDualSubExtension: Error saving batch to cache:", error);
          });
        }
      } else {
        console.error("YleDualSubExtension: Batch translation error:", translationResponse);
        // Don't cache failed translations - they will be retried on next subtitle display
        console.info(`YleDualSubExtension: ${texts.length} translations failed - will retry later`);
      }
    } catch (error) {
      console.error("YleDualSubExtension: Error in batch translation chunk:", error);
      // Don't cache failed translations - they will be retried on next subtitle display
      console.info(`YleDualSubExtension: ${texts.length} translations failed due to error - will retry later`);
    }

    batchTranslationProgress.current += chunk.length;
    updateBatchTranslationIndicator();
  }

  // Sort subtitle timestamps after batch population
  subtitleTimestamps.sort((a, b) => a.time - b.time);

  isBatchTranslating = false;
  hideBatchTranslationIndicator();
  console.info("YleDualSubExtension: Batch translation completed");
}
