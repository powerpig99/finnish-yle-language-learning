/**
 * Database function tests using fake-indexeddb
 *
 * To run these tests:
 * 1. Install dependencies: npm install --save-dev fake-indexeddb jest
 * 2. Run tests: npm test
 */

// Require fake IndexedDB (provides a complete IndexedDB implementation for testing)
require('fake-indexeddb/auto');

// Require database functions to test
// database.js uses conditional exports: CommonJS in Node.js, global functions in browser
const {
    openDatabase,
    saveSubtitle,
    saveSubtitlesBatch,
    loadSubtitlesByMovieName,
    clearSubtitlesByMovieName,
    getMovieMetadata,
    upsertMovieMetadata,
    getAllMovieMetadata,
    deleteMovieMetadata,
    cleanupOldMovieData
} = require('../../database.js');

// Helper function to delete database
function deleteDB(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
            console.warn('Database deletion blocked');
            resolve();
        };
    });
}

describe('Database Functions', () => {
    let db;

    beforeEach(async () => {
        // Open a fresh database before each test
        db = await openDatabase();
    });

    afterEach(async () => {
        // Clean up after each test
        if (db) {
            db.close();
        }
        // Delete the database to ensure clean state
        await deleteDB('YleDualSubCache');
    });

    describe('openDatabase', () => {
        test('should open database successfully', async () => {
            expect(db).toBeDefined();
            expect(db.name).toBe('YleDualSubCache');
            expect(db.version).toBe(3);
        });

        test('should have correct object stores', () => {
            expect(db.objectStoreNames.contains('SubtitlesCache')).toBe(true);
            expect(db.objectStoreNames.contains('MovieMetadata')).toBe(true);
        });
    });

    describe('saveSubtitle and loadSubtitlesByMovieName', () => {
        test('should save and load a single subtitle', async () => {
            // Arrange
            const movieName = 'Test Movie';
            const targetLanguage = 'EN-US';
            const originalText = 'hei maailma';
            const translatedText = 'hello world';

            // Act
            await saveSubtitle(db, movieName, targetLanguage, originalText, translatedText);
            const results = await loadSubtitlesByMovieName(db, movieName, targetLanguage);

            // Assert
            expect(results).toHaveLength(1);
            expect(results[0].movieName).toBe(movieName);
            expect(results[0].originalLanguage).toBe('FI');
            expect(results[0].targetLanguage).toBe(targetLanguage);
            expect(results[0].originalText).toBe(originalText);
            expect(results[0].translatedText).toBe(translatedText);
        });

        test('should save multiple subtitles for same movie', async () => {
            // Arrange
            const movieName = 'Test Movie';
            const targetLanguage = 'EN-US';

            // Act
            await saveSubtitle(db, movieName, targetLanguage, 'hei', 'hello');
            await saveSubtitle(db, movieName, targetLanguage, 'kiitos', 'thanks');
            await saveSubtitle(db, movieName, targetLanguage, 'näkemiin', 'goodbye');

            const results = await loadSubtitlesByMovieName(db, movieName, targetLanguage);

            // Assert
            expect(results).toHaveLength(3);
        });

        test('should return empty array for non-existent movie', async () => {
            // Act
            const results = await loadSubtitlesByMovieName(db, 'Non-existent Movie', 'EN-US');

            // Assert
            expect(results).toHaveLength(0);
        });

        test('should handle different target languages separately', async () => {
            // Arrange
            const movieName = 'Test Movie';
            await saveSubtitle(db, movieName, 'EN-US', 'hei', 'hello');
            await saveSubtitle(db, movieName, 'VI', 'hei', 'xin chào');

            // Act
            const englishResults = await loadSubtitlesByMovieName(db, movieName, 'EN-US');
            const vietnameseResults = await loadSubtitlesByMovieName(db, movieName, 'VI');

            // Assert
            expect(englishResults).toHaveLength(1);
            expect(englishResults[0].translatedText).toBe('hello');
            expect(vietnameseResults).toHaveLength(1);
            expect(vietnameseResults[0].translatedText).toBe('xin chào');
        });

        test('should update existing subtitle when saving with same key', async () => {
            // Arrange
            const movieName = 'Test Movie';
            const targetLanguage = 'EN-US';
            const originalText = 'hei';

            // Act - Save twice with different translations
            await saveSubtitle(db, movieName, targetLanguage, originalText, 'hello');
            await saveSubtitle(db, movieName, targetLanguage, originalText, 'hi');

            const results = await loadSubtitlesByMovieName(db, movieName, targetLanguage);

            // Assert - Should have only one record with updated translation
            expect(results).toHaveLength(1);
            expect(results[0].translatedText).toBe('hi');
        });
    });

    describe('saveSubtitlesBatch', () => {
        test('should save multiple subtitles in a batch', async () => {
            // Arrange
            const subtitles = [
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'hei',
                    translatedText: 'hello'
                },
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'kiitos',
                    translatedText: 'thanks'
                },
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'näkemiin',
                    translatedText: 'goodbye'
                }
            ];

            // Act
            const savedCount = await saveSubtitlesBatch(db, subtitles);
            const results = await loadSubtitlesByMovieName(db, 'Movie 1', 'EN-US');

            // Assert
            expect(savedCount).toBe(3);
            expect(results).toHaveLength(3);
        });

        test('should handle empty array', async () => {
            // Act
            const savedCount = await saveSubtitlesBatch(db, []);

            // Assert
            expect(savedCount).toBe(0);
        });

        test('should save subtitles for different movies', async () => {
            // Arrange
            const subtitles = [
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'hei',
                    translatedText: 'hello'
                },
                {
                    movieName: 'Movie 2',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'hei',
                    translatedText: 'hello'
                }
            ];

            // Act
            const savedCount = await saveSubtitlesBatch(db, subtitles);
            const movie1Results = await loadSubtitlesByMovieName(db, 'Movie 1', 'EN-US');
            const movie2Results = await loadSubtitlesByMovieName(db, 'Movie 2', 'EN-US');

            // Assert
            expect(savedCount).toBe(2);
            expect(movie1Results).toHaveLength(1);
            expect(movie2Results).toHaveLength(1);
        });
    });

    describe('clearSubtitlesByMovieName', () => {
        test('should delete all subtitles for a movie across all languages', async () => {
            // Arrange
            const movieName = 'Test Movie';
            await saveSubtitle(db, movieName, 'EN-US', 'hei', 'hello');
            await saveSubtitle(db, movieName, 'VI', 'hei', 'xin chào');
            await saveSubtitle(db, movieName, 'EN-US', 'kiitos', 'thanks');

            // Act
            const deletedCount = await clearSubtitlesByMovieName(db, movieName);
            const englishResults = await loadSubtitlesByMovieName(db, movieName, 'EN-US');
            const vietnameseResults = await loadSubtitlesByMovieName(db, movieName, 'VI');

            // Assert
            expect(deletedCount).toBe(3);
            expect(englishResults).toHaveLength(0);
            expect(vietnameseResults).toHaveLength(0);
        });

        test('should not affect other movies', async () => {
            // Arrange
            await saveSubtitle(db, 'Movie 1', 'EN-US', 'hei', 'hello');
            await saveSubtitle(db, 'Movie 2', 'EN-US', 'hei', 'hello');

            // Act
            await clearSubtitlesByMovieName(db, 'Movie 1');
            const movie1Results = await loadSubtitlesByMovieName(db, 'Movie 1', 'EN-US');
            const movie2Results = await loadSubtitlesByMovieName(db, 'Movie 2', 'EN-US');

            // Assert
            expect(movie1Results).toHaveLength(0);
            expect(movie2Results).toHaveLength(1);
        });

        test('should return 0 when deleting non-existent movie', async () => {
            // Act
            const deletedCount = await clearSubtitlesByMovieName(db, 'Non-existent Movie');

            // Assert
            expect(deletedCount).toBe(0);
        });
    });

    describe('Movie Metadata Functions', () => {
        describe('upsertMovieMetadata and getMovieMetadata', () => {
            test('should save and retrieve movie metadata', async () => {
                // Arrange
                const movieName = 'Test Movie';
                const lastAccessedDays = 19000;

                // Act
                await upsertMovieMetadata(db, movieName, lastAccessedDays);
                const metadata = await getMovieMetadata(db, movieName);

                // Assert
                expect(metadata).not.toBeNull();
                expect(metadata.movieName).toBe(movieName);
                expect(metadata.lastAccessedDays).toBe(lastAccessedDays);
            });

            test('should update existing metadata', async () => {
                // Arrange
                const movieName = 'Test Movie';

                // Act - Save twice with different values
                await upsertMovieMetadata(db, movieName, 19000);
                await upsertMovieMetadata(db, movieName, 19100);
                const metadata = await getMovieMetadata(db, movieName);

                // Assert - Should have updated value
                expect(metadata.lastAccessedDays).toBe(19100);
            });

            test('should return null for non-existent movie', async () => {
                // Act
                const metadata = await getMovieMetadata(db, 'Non-existent Movie');

                // Assert
                expect(metadata).toBeNull();
            });
        });

        describe('getAllMovieMetadata', () => {
            test('should retrieve all movie metadata', async () => {
                // Arrange
                await upsertMovieMetadata(db, 'Movie 1', 19000);
                await upsertMovieMetadata(db, 'Movie 2', 19100);
                await upsertMovieMetadata(db, 'Movie 3', 19200);

                // Act
                const allMetadata = await getAllMovieMetadata(db);

                // Assert
                expect(allMetadata).toHaveLength(3);
            });

            test('should return empty array when no metadata exists', async () => {
                // Act
                const allMetadata = await getAllMovieMetadata(db);

                // Assert
                expect(allMetadata).toHaveLength(0);
            });
        });

        describe('deleteMovieMetadata', () => {
            test('should delete movie metadata', async () => {
                // Arrange
                await upsertMovieMetadata(db, 'Test Movie', 19000);

                // Act
                await deleteMovieMetadata(db, 'Test Movie');
                const metadata = await getMovieMetadata(db, 'Test Movie');

                // Assert
                expect(metadata).toBeNull();
            });

            test('should not throw error when deleting non-existent metadata', async () => {
                // Act & Assert - Should not throw
                await expect(
                    deleteMovieMetadata(db, 'Non-existent Movie')
                ).resolves.not.toThrow();
            });
        });
    });

    describe('cleanupOldMovieData', () => {
        test('should cleanup old movies based on access time', async () => {
            // Arrange
            const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
            const oldMovieName = 'Old Movie';
            const recentMovieName = 'Recent Movie';

            // Create old movie (40 days ago)
            await upsertMovieMetadata(db, oldMovieName, nowDays - 40);
            await saveSubtitle(db, oldMovieName, 'EN-US', 'hei', 'hello');

            // Create recent movie (10 days ago)
            await upsertMovieMetadata(db, recentMovieName, nowDays - 10);
            await saveSubtitle(db, recentMovieName, 'EN-US', 'hei', 'hello');

            // Act - Clean up movies older than 30 days
            const cleanedCount = await cleanupOldMovieData(db, 30);

            const oldMovieMetadata = await getMovieMetadata(db, oldMovieName);
            const recentMovieMetadata = await getMovieMetadata(db, recentMovieName);
            const oldMovieSubtitles = await loadSubtitlesByMovieName(db, oldMovieName, 'EN-US');
            const recentMovieSubtitles = await loadSubtitlesByMovieName(db, recentMovieName, 'EN-US');

            // Assert
            expect(cleanedCount).toBe(1);
            expect(oldMovieMetadata).toBeNull();
            expect(recentMovieMetadata).not.toBeNull();
            expect(oldMovieSubtitles).toHaveLength(0);
            expect(recentMovieSubtitles).toHaveLength(1);
        });

        test('should handle custom maxAgeDays parameter', async () => {
            // Arrange
            const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
            await upsertMovieMetadata(db, 'Movie 1', nowDays - 5);
            await upsertMovieMetadata(db, 'Movie 2', nowDays - 15);

            // Act - Clean up movies older than 10 days
            const cleanedCount = await cleanupOldMovieData(db, 10);

            // Assert
            expect(cleanedCount).toBe(1);
        });

        test('should return 0 when no old movies exist', async () => {
            // Arrange
            const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
            await upsertMovieMetadata(db, 'Recent Movie', nowDays);

            // Act
            const cleanedCount = await cleanupOldMovieData(db, 30);

            // Assert
            expect(cleanedCount).toBe(0);
        });
    });
});
