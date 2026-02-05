// Global type declarations for browser extension

// Chrome extension APIs
/// <reference types="chrome"/>

// Extend EventTarget to be more lenient with properties
interface EventTarget {
    id?: string;
    checked?: boolean;
    value?: string;
    result?: any;
    className?: string;
    parentElement?: HTMLElement | null;
    tagName?: string;
    textContent?: string | null;
    innerText?: string;
    closest?: (selectors: string) => Element | null;
    focus?: () => void;
}

// Extend Node to include common DOM properties
interface Node {
    dataset?: DOMStringMap;
    style?: CSSStyleDeclaration;
    querySelectorAll?: (selector: string) => NodeListOf<Element>;
    querySelector?: (selector: string) => Element | null;
    textContent?: string | null;
}

// Extend Element to include style property
interface Element {
    style?: CSSStyleDeclaration;
}

// Extend HTMLElement to include common form properties
interface HTMLElement {
    disabled?: boolean;
    checked?: boolean;
}

interface Document {
    webkitFullscreenElement?: Element | null;
}

interface Window {
    _targetLanguage?: string;
    fullSubtitles?: any[];
    clearWordCache?: () => Promise<void>;
    YLEAdapter?: YLEAdapter;
}

// Service Worker globals
declare function importScripts(...urls: string[]): void;

// Utility functions from utils.js
declare function loadSelectedTokenFromChromeStorageSync(): Promise<{key: string, isPro: boolean} | null>;
declare function loadTargetLanguageFromChromeStorageSync(): Promise<string>;
declare function isSameLanguage(lang1: string, lang2: string): boolean;
declare function getWiktionaryLang(targetLang: string): string;
declare function normalizeLanguageCode(langCode: string): string;
declare function safeSendMessage(message: any): Promise<any>;
declare function isExtensionContextValid(): boolean;
declare function showExtensionInvalidatedToast(): void;
declare function getNativeSubtitlesWrapper(): HTMLElement | null;

// Database functions from database.js
declare function openDatabase(): Promise<IDBDatabase>;
declare function saveSubtitle(
    db: IDBDatabase,
    movieName: string,
    targetLanguage: string,
    originalText: string,
    translatedText: string
): Promise<void>;
declare function saveSubtitlesBatch(
    db: IDBDatabase,
    subtitles: SubtitleRecord[]
): Promise<number>;
declare function loadSubtitlesByMovieName(
    db: IDBDatabase,
    movieName: string,
    targetLanguage: string
): Promise<SubtitleRecord[]>;
declare function clearSubtitlesByMovieName(
    db: IDBDatabase,
    movieName: string
): Promise<number>;
declare function getMovieMetadata(
    db: IDBDatabase,
    movieName: string
): Promise<MovieMetadata | null>;
declare function upsertMovieMetadata(
    db: IDBDatabase,
    movieName: string,
    lastAccessedDays: number
): Promise<void>;
declare function getAllMovieMetadata(
    db: IDBDatabase
): Promise<MovieMetadata[]>;
declare function deleteMovieMetadata(
    db: IDBDatabase,
    movieName: string
): Promise<void>;
declare function cleanupOldMovieData(
    db: IDBDatabase,
    maxAgeDays?: number
): Promise<number>;
declare function getWordTranslation(
    db: IDBDatabase,
    word: string,
    targetLanguage: string
): Promise<{ translation: string; source: string } | null>;
declare function saveWordTranslation(
    db: IDBDatabase,
    word: string,
    targetLanguage: string,
    translation: string,
    source?: string
): Promise<void>;
declare function cleanupOldWordTranslations(
    db: IDBDatabase,
    maxAgeDays?: number
): Promise<number>;
declare function clearAllWordTranslations(
    db: IDBDatabase
): Promise<number>;

// Types from database.js
interface SubtitleRecord {
    movieName: string;
    originalLanguage: string;
    targetLanguage: string;
    originalText: string;
    translatedText: string;
}

interface MovieMetadata {
    movieName: string;
    lastAccessedDays: number;
}

// Types for DeepL
interface DeepLTokenInfoInStorage {
    key: string;
    type: string;
    characterCount: string;
    characterLimit: string;
    lastUsageCheckedAt: string;
    selected: boolean;
}

// Platform adapter globals
interface YLEAdapter {
    name: string;
    sourceLanguage: string | null;
    _detectedLanguage: string | null;
    SELECTORS: Record<string, string>;
    getControlPanelMountConfig: () => unknown;
    getKeyboardConfig: () => unknown;
    isMatch: () => boolean;
    isVideoPage: () => boolean;
    getVideoElement: () => HTMLVideoElement | null;
    getPlayerUI: () => HTMLElement | null;
    getSubtitleWrapper: () => HTMLElement | null;
    getControlBarContainer: () => Promise<HTMLElement | null>;
    getVideoTitle: () => Promise<string | null>;
    isSubtitleMutation: (mutation: MutationRecord) => boolean;
    isVideoAppearMutation: (mutation: MutationRecord) => boolean;
    focusPlayer: () => void;
    showControls: () => void;
    hideControls: () => void;
}
declare var YLEAdapter: YLEAdapter;

// Control panel globals (from controls/*)
declare const ControlIntegration: {
    init: (options?: any) => Promise<any>;
    isInitialized: () => boolean;
    getState: () => any;
    setState?: (state: any) => void;
    updateState?: (state: any) => void;
    setSubtitles?: (subtitles: any[]) => void;
    setSubtitleTimestamps?: (timestamps: any[]) => void;
    setTargetLanguage?: (language: string) => void;
    setSourceLanguage?: (language: string | null, options?: any) => void;
    setCaptionsEnabled?: (enabled: boolean) => void;
    _handleExtensionToggle?: (enabled: boolean) => void;
};
declare const ControlPanel: any;
declare const ControlActions: any;
declare const ControlKeyboard: any;
