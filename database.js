/**
 * @typedef {Object} SubtitleRecord
 * @property {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @property {string} originalLanguage - The original language code (e.g., "FI") (for now, this will be always "FI")
 * @property {string} targetLanguage - The target language code (e.g., "EN-US", "VI")
 * @property {string} originalText - The Finnish subtitle text (normalized)
 * @property {string} translatedText - The translated text in target language
 */

/**
 * @typedef {Object} MovieMetadata
 * @property {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @property {number} lastAccessedDays - Last accessed time in days since Unix epoch
 */

/**
 * @typedef {Object} WordTranslation
 * @property {string} word - The original word (normalized, lowercase)
 * @property {string} originalLanguage - The original language code (e.g., "FI")
 * @property {string} targetLanguage - The target language code (e.g., "EN-US")
 * @property {string} translation - The translated word
 * @property {number} lastAccessedDays - Last accessed time in days since Unix epoch
 */

const DATABASE = "YleDualSubCache"
const WORD_TRANSLATION_OBJECT_STORE = "WordTranslations"
const SUBTITLE_CACHE_OBJECT_STORE = "SubtitlesCache"
const DEPRECATED_ENGLISH_SUBTITLE_CACHE_OBJECT_STORE = "EnglishSubtitlesCache"
const MOVIE_METADATA_OBJECT_STORE = "MovieMetadata"

/**
 * Open or create the IndexedDB database for subtitle caching
 * @returns {Promise<IDBDatabase>} The opened database instance
 */
async function openDatabase() {
    return new Promise((resolve, reject) => {

        const DBOpenRequest = indexedDB.open(DATABASE, 3);

        // Handle errors
        DBOpenRequest.onerror = (_event) => {
            console.error("YleDualSubExtension: openDatabase: Database error:", DBOpenRequest.error);
            reject(DBOpenRequest.error);
        }

        // Handle success
        DBOpenRequest.onsuccess = (_event) => {
            const db = DBOpenRequest.result;
            resolve(db);
        };

        // Handle database upgrade (first time or version change)
        DBOpenRequest.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.info(`YleDualSubExtension: Database upgrade triggered, ensuring all object stores exist...`);

            // Create movie metadata store if it doesn't exist
            if (!db.objectStoreNames.contains(MOVIE_METADATA_OBJECT_STORE)) {
                console.info(`YleDualSubExtension: Creating ${MOVIE_METADATA_OBJECT_STORE} object store...`);
                db.createObjectStore(MOVIE_METADATA_OBJECT_STORE, {
                    keyPath: 'movieName',
                });
            }

            // Create subtitle cache store if it doesn't exist
            if (!db.objectStoreNames.contains(SUBTITLE_CACHE_OBJECT_STORE)) {
                console.info(`YleDualSubExtension: Creating ${SUBTITLE_CACHE_OBJECT_STORE} object store...`);
                const subtitlesObjectStore = db.createObjectStore(SUBTITLE_CACHE_OBJECT_STORE, {
                    keyPath: ['movieName', 'originalLanguage', 'targetLanguage', 'originalText'],
                });
                subtitlesObjectStore.createIndex('movieSubtitlesByLanguage', ['movieName', 'originalLanguage', 'targetLanguage'], { unique: false });
            }

            // Delete deprecated old subtitle cache if it exists
            if (db.objectStoreNames.contains(DEPRECATED_ENGLISH_SUBTITLE_CACHE_OBJECT_STORE)) {
                console.info(`YleDualSubExtension: Deleting deprecated ${DEPRECATED_ENGLISH_SUBTITLE_CACHE_OBJECT_STORE} object store...`);
                db.deleteObjectStore(DEPRECATED_ENGLISH_SUBTITLE_CACHE_OBJECT_STORE);
            }

            // Create word translations store if it doesn't exist (version 3)
            if (!db.objectStoreNames.contains(WORD_TRANSLATION_OBJECT_STORE)) {
                console.info(`YleDualSubExtension: Creating ${WORD_TRANSLATION_OBJECT_STORE} object store...`);
                const wordTranslationsStore = db.createObjectStore(WORD_TRANSLATION_OBJECT_STORE, {
                    keyPath: ['word', 'originalLanguage', 'targetLanguage'],
                });
                wordTranslationsStore.createIndex('byLastAccessed', 'lastAccessedDays', { unique: false });
            }
        };
    })
}

/**
 * Load all subtitles for a given movie and target language from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @param {string} targetLanguage - Target language (e.g., "EN-US", "VI")
 * @returns {Promise<Array<SubtitleRecord>>}
 */
async function loadSubtitlesByMovieName(db, movieName, targetLanguage) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readonly');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);
            const index = objectStore.index('movieSubtitlesByLanguage');

            const DBGetAllRequest = index.getAll([movieName, "FI", targetLanguage]);

            DBGetAllRequest.onsuccess = (_event) => {
                /**
                 * @type {Array<SubtitleRecord>}
                 */
                const subtitleRecords = DBGetAllRequest.result;
                resolve(subtitleRecords);
            };

            DBGetAllRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: loadSubtitlesByMovieName: Error loading subtitles:", DBGetAllRequest.error);
                reject(DBGetAllRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: loadSubtitlesByMovieName: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Save a subtitle translation to IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @param {string} targetLanguage - Target language (e.g., "EN-US", "VI")
 * @param {string} originalText - The Finnish subtitle text (normalized)
 * @param {string} translatedText - The translated text in target language
 * @returns {Promise<void>}
 */
async function saveSubtitle(db, movieName, targetLanguage, originalText, translatedText) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);

            /**
             * @type {SubtitleRecord}
             */
            const subtitle = {
                movieName,
                originalLanguage: "FI",
                targetLanguage,
                originalText,
                translatedText
            };

            const DBSaveSubtitlesRequest = objectStore.put(subtitle);

            DBSaveSubtitlesRequest.onsuccess = (_event) => {
                resolve();
            };

            DBSaveSubtitlesRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: saveSubtitle: Error saving subtitle:", DBSaveSubtitlesRequest.error);
                reject(DBSaveSubtitlesRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: saveSubtitle: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Save multiple subtitle translations to IndexedDB in a single transaction
 * @param {IDBDatabase} db - Opening database instance
 * @param {Array<SubtitleRecord>} subtitles - Array of subtitle objects to save (must include targetLanguage)
 * @returns {Promise<number>} Number of subtitles saved
 */
async function saveSubtitlesBatch(db, subtitles) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);

            let savedCount = 0;
            let errorOccurred = false;

            // Handle transaction completion
            transaction.oncomplete = () => {
                if (errorOccurred) {
                    reject(new Error("One or more errors occurred during batch subtitle save."));
                }
                resolve(savedCount);
            };

            transaction.onerror = (_event) => {
                console.error("YleDualSubExtension: saveSubtitlesBatch: Transaction error:", transaction.error);
                errorOccurred = true;
                reject(transaction.error);
            };

            transaction.onabort = (_event) => {
                console.error("YleDualSubExtension: saveSubtitlesBatch: Transaction aborted:", transaction.error);
                errorOccurred = true;
                reject(transaction.error);
            }

            // Add all subtitles to the transaction
            for (const subtitle of subtitles) {
                const DBSaveRequest = objectStore.put(subtitle);

                // eslint-disable-next-line no-loop-func
                DBSaveRequest.onsuccess = (_event) => {
                    savedCount++;
                };

                // eslint-disable-next-line no-loop-func
                DBSaveRequest.onerror = (_event) => {
                    console.error("YleDualSubExtension: saveSubtitlesBatch: Error saving subtitle:", DBSaveRequest.error);
                    errorOccurred = true;
                };
            }

        } catch (error) {
            console.error("YleDualSubExtension: saveSubtitlesBatch: Error in batch save:", error);
            reject(error);
        }
    });
}

/**
 * Delete all subtitles for a given movie from IndexedDB (across all languages)
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @returns {Promise<number>} Number of subtitles deleted
 */
async function clearSubtitlesByMovieName(db, movieName) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);

            let deletedCount = 0;
            // Use keyPath range to delete all entries for this movie (all languages)
            const range = IDBKeyRange.bound(
                [movieName, "", "", ""],
                [movieName, "\uffff", "\uffff", "\uffff"]
            );

            const DBDeleteCursorRequest = objectStore.openCursor(range);

            transaction.oncomplete = () => {
                resolve(deletedCount);
            }

            transaction.onerror = (_event) => {
                console.error("YleDualSubExtension: clearSubtitlesByMovieName: Error during subtitle deletion transaction:", transaction.error);
                reject(transaction.error);
            }

            transaction.onabort = (_event) => {
                console.error("YleDualSubExtension: clearSubtitlesByMovieName: Subtitle deletion transaction aborted:", transaction.error);
                reject(transaction.error);
            }

            DBDeleteCursorRequest.onsuccess = (_event) => {
                const cursor = DBDeleteCursorRequest.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                }
            };

            DBDeleteCursorRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: clearSubtitlesByMovieName: Error clearing subtitles:", DBDeleteCursorRequest.error);
                reject(DBDeleteCursorRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: clearSubtitlesByMovieName: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Get movie metadata from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @returns {Promise<MovieMetadata|null>} The movie metadata or null if not found
 */
async function getMovieMetadata(db, movieName) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readonly');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const DBGetMovieMetadataRequest = objectStore.get(movieName);

            DBGetMovieMetadataRequest.onsuccess = (_event) => {
                const metadata = DBGetMovieMetadataRequest.result;
                if (metadata) {
                    resolve(metadata);
                } else {
                    resolve(null);
                }
            };

            DBGetMovieMetadataRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: getMovieMetadata: Error getting movie metadata:", DBGetMovieMetadataRequest.error);
                reject(DBGetMovieMetadataRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: getMovieMetadata: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Save or update movie metadata to IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @param {number} lastAccessedDays - Last accessed time in days since Unix epoch
 * @returns {Promise<void>}
 */
async function upsertMovieMetadata(db, movieName, lastAccessedDays) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const metadata = {
                movieName,
                lastAccessedDays
            };

            const DBUpsertMovieMetadataRequest = objectStore.put(metadata);

            DBUpsertMovieMetadataRequest.onsuccess = (_event) => {
                resolve();
            };

            DBUpsertMovieMetadataRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: upsertMovieMetadata: Error saving movie metadata:", DBUpsertMovieMetadataRequest.error);
                reject(DBUpsertMovieMetadataRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: upsertMovieMetadata: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Get all movie metadata records from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @returns {Promise<Array<MovieMetadata>>} Array of all movie metadata records
 */
async function getAllMovieMetadata(db) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readonly');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const DBGetAllMovieMetadatas = objectStore.getAll();

            DBGetAllMovieMetadatas.onsuccess = (_event) => {
                const metadataRecords = DBGetAllMovieMetadatas.result;
                resolve(metadataRecords);
            };

            DBGetAllMovieMetadatas.onerror = (_event) => {
                console.error("YleDualSubExtension: getAllMovieMetadata: Error getting all movie metadata:", DBGetAllMovieMetadatas.error);
                reject(DBGetAllMovieMetadatas.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: getAllMovieMetadata: Error retrieving all movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Delete movie metadata from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @returns {Promise<void>}
 */
async function deleteMovieMetadata(db, movieName) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const DBDeleteMovieMetadataRequest = objectStore.delete(movieName);

            DBDeleteMovieMetadataRequest.onsuccess = (_event) => {
                resolve();
            };

            DBDeleteMovieMetadataRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: deleteMovieMetadata: Error deleting movie metadata:", DBDeleteMovieMetadataRequest.error);
                reject(DBDeleteMovieMetadataRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: deleteMovieMetadata: Error deleting movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Clean up old movie data that hasn't been accessed recently
 * @param {IDBDatabase} db - Opening database instance
 * @param {number} maxAgeDays - Maximum age in days (movies older than this will be deleted).
 * Default is 30 days
 * @returns {Promise<number>} Number of movies cleaned up
 */
async function cleanupOldMovieData(db, maxAgeDays = 30) {
    const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    const cutoffDays = nowDays - maxAgeDays;

    console.info(`YleDualSubExtension: cleanupOldMovieData: Starting cleanup of movies not accessed since day ${cutoffDays} (${maxAgeDays} days ago)`);

    // Get all movie metadata
    const allMetadata = await getAllMovieMetadata(db);

    // Filter for old movies
    const oldMovieMetadatas = allMetadata.filter(metadata =>
        metadata.lastAccessedDays < cutoffDays
    );

    console.info(`YleDualSubExtension: cleanupOldMovieData: Found ${oldMovieMetadatas.length} movies to clean up`);

    // Delete each old movie's data
    let cleanedCount = 0;
    for (const metadata of oldMovieMetadatas) {
        try {
            // Delete all subtitles for this movie
            await clearSubtitlesByMovieName(db, metadata.movieName);

            // Delete the metadata record
            await deleteMovieMetadata(db, metadata.movieName);

            cleanedCount++;
            console.info(`YleDualSubExtension: cleanupOldMovieData: Cleaned up movie: ${metadata.movieName}`);
        } catch (error) {
            console.warn(`YleDualSubExtension: cleanupOldMovieData: Failed to clean up movie ${metadata.movieName}:`, error);
        }
    }
    return cleanedCount;

}

/**
 * Get a word translation from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} word - The word to look up (will be normalized)
 * @param {string} targetLanguage - Target language (e.g., "EN-US")
 * @returns {Promise<WordTranslation|null>} The word translation or null if not found
 */
async function getWordTranslation(db, word, targetLanguage) {
    const normalizedWord = word.toLowerCase().trim();
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([WORD_TRANSLATION_OBJECT_STORE], 'readonly');
            const objectStore = transaction.objectStore(WORD_TRANSLATION_OBJECT_STORE);

            const DBGetRequest = objectStore.get([normalizedWord, "FI", targetLanguage]);

            DBGetRequest.onsuccess = (_event) => {
                const result = DBGetRequest.result;
                if (result) {
                    resolve(result);
                } else {
                    resolve(null);
                }
            };

            DBGetRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: getWordTranslation: Error getting word translation:", DBGetRequest.error);
                reject(DBGetRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: getWordTranslation: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Save a word translation to IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} word - The original word
 * @param {string} targetLanguage - Target language (e.g., "EN-US")
 * @param {string} translation - The translated word
 * @returns {Promise<void>}
 */
async function saveWordTranslation(db, word, targetLanguage, translation) {
    const normalizedWord = word.toLowerCase().trim();
    const lastAccessedDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));

    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([WORD_TRANSLATION_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(WORD_TRANSLATION_OBJECT_STORE);

            /** @type {WordTranslation} */
            const wordTranslation = {
                word: normalizedWord,
                originalLanguage: "FI",
                targetLanguage,
                translation,
                lastAccessedDays
            };

            const DBSaveRequest = objectStore.put(wordTranslation);

            DBSaveRequest.onsuccess = (_event) => {
                resolve();
            };

            DBSaveRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: saveWordTranslation: Error saving word translation:", DBSaveRequest.error);
                reject(DBSaveRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: saveWordTranslation: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Clean up old word translations that haven't been accessed recently
 * @param {IDBDatabase} db - Opening database instance
 * @param {number} maxAgeDays - Maximum age in days (default: 60 days)
 * @returns {Promise<number>} Number of word translations cleaned up
 */
async function cleanupOldWordTranslations(db, maxAgeDays = 60) {
    const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    const cutoffDays = nowDays - maxAgeDays;

    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([WORD_TRANSLATION_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(WORD_TRANSLATION_OBJECT_STORE);
            const index = objectStore.index('byLastAccessed');

            const range = IDBKeyRange.upperBound(cutoffDays);
            const DBDeleteCursorRequest = index.openCursor(range);

            let deletedCount = 0;

            transaction.oncomplete = () => {
                resolve(deletedCount);
            };

            transaction.onerror = (_event) => {
                console.error("YleDualSubExtension: cleanupOldWordTranslations: Transaction error:", transaction.error);
                reject(transaction.error);
            };

            DBDeleteCursorRequest.onsuccess = (_event) => {
                const cursor = DBDeleteCursorRequest.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                }
            };

            DBDeleteCursorRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: cleanupOldWordTranslations: Error:", DBDeleteCursorRequest.error);
                reject(DBDeleteCursorRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: cleanupOldWordTranslations: Error in transaction:", error);
            reject(error);
        }
    });
}

/**
 * Clear ALL word translations from the cache
 * Use this to reset bad/outdated cached translations
 * @param {IDBDatabase} db - Opening database instance
 * @returns {Promise<number>} Number of word translations cleared
 */
async function clearAllWordTranslations(db) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([WORD_TRANSLATION_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(WORD_TRANSLATION_OBJECT_STORE);

            const countRequest = objectStore.count();
            countRequest.onsuccess = () => {
                const count = countRequest.result;
                const clearRequest = objectStore.clear();

                clearRequest.onsuccess = () => {
                    console.info(`YleDualSubExtension: Cleared ${count} word translations from cache`);
                    resolve(count);
                };

                clearRequest.onerror = (_event) => {
                    console.error("YleDualSubExtension: clearAllWordTranslations: Error:", clearRequest.error);
                    reject(clearRequest.error);
                };
            };

            countRequest.onerror = (_event) => {
                reject(countRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: clearAllWordTranslations: Error in transaction:", error);
            reject(error);
        }
    });
}

// Conditional export for testing
// Check for module.exports first (CommonJS/Node.js environment)
// @ts-ignore - module may not be defined in browser
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    // Node.js/Jest environment (even with JSDOM)
    module.exports = {
        openDatabase,
        saveSubtitle,
        saveSubtitlesBatch,
        loadSubtitlesByMovieName,
        clearSubtitlesByMovieName,
        getMovieMetadata,
        upsertMovieMetadata,
        getAllMovieMetadata,
        deleteMovieMetadata,
        cleanupOldMovieData,
        getWordTranslation,
        saveWordTranslation,
        cleanupOldWordTranslations,
        clearAllWordTranslations
    };
}
// In browser extension (content script), functions are automatically global