/**
 * Tests for storage utility functions
 *
 * These tests verify that the storage utilities correctly handle:
 * - Nested path storage (e.g., 'settings.excelAddIn.highlight.rowColor')
 * - Flat key storage (e.g., 'masterEntries')
 * - Default value fallbacks
 */

// Since the actual storage.js uses ES modules with Chrome APIs,
// we test the core logic by reimplementing the pure functions here.
// This is a common pattern for testing Chrome extensions.

// ============================================
// Pure functions extracted for testing
// ============================================

function isNestedPath(key) {
    return key && key.includes('.');
}

function getRootKey(path) {
    return path.split('.')[0];
}

function getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
}

function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === undefined || current[part] === null) {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

// ============================================
// Tests
// ============================================

describe('isNestedPath', () => {
    test('returns true for paths with dots', () => {
        expect(isNestedPath('settings.excelAddIn.highlight')).toBe(true);
        expect(isNestedPath('a.b')).toBe(true);
        expect(isNestedPath('one.two.three.four')).toBe(true);
    });

    test('returns false for flat keys', () => {
        expect(isNestedPath('masterEntries')).toBe(false);
        expect(isNestedPath('foundEntries')).toBe(false);
    });

    test('returns falsy for null/undefined/empty', () => {
        // These all return falsy values (null, undefined, or false)
        expect(isNestedPath(null)).toBeFalsy();
        expect(isNestedPath(undefined)).toBeFalsy();
        expect(isNestedPath('')).toBeFalsy();
    });
});

describe('getRootKey', () => {
    test('extracts root from nested path', () => {
        expect(getRootKey('settings.excelAddIn.highlight')).toBe('settings');
        expect(getRootKey('state.extensionState')).toBe('state');
    });

    test('returns entire string for flat keys', () => {
        expect(getRootKey('masterEntries')).toBe('masterEntries');
    });
});

describe('getNestedValue', () => {
    const testObj = {
        settings: {
            excelAddIn: {
                highlight: {
                    rowColor: '#92d050',
                    enabled: true
                }
            },
            canvas: {
                embedInCanvas: true
            }
        },
        flatValue: 'hello'
    };

    test('retrieves deeply nested values', () => {
        expect(getNestedValue(testObj, 'settings.excelAddIn.highlight.rowColor')).toBe('#92d050');
        expect(getNestedValue(testObj, 'settings.excelAddIn.highlight.enabled')).toBe(true);
        expect(getNestedValue(testObj, 'settings.canvas.embedInCanvas')).toBe(true);
    });

    test('retrieves single-level values', () => {
        expect(getNestedValue(testObj, 'flatValue')).toBe('hello');
    });

    test('returns undefined for non-existent paths', () => {
        expect(getNestedValue(testObj, 'settings.doesNotExist')).toBeUndefined();
        expect(getNestedValue(testObj, 'settings.excelAddIn.highlight.missing')).toBeUndefined();
        expect(getNestedValue(testObj, 'completely.fake.path')).toBeUndefined();
    });

    test('handles null/undefined objects gracefully', () => {
        expect(getNestedValue(null, 'any.path')).toBeUndefined();
        expect(getNestedValue(undefined, 'any.path')).toBeUndefined();
    });

    test('handles null/undefined paths gracefully', () => {
        expect(getNestedValue(testObj, null)).toBeUndefined();
        expect(getNestedValue(testObj, undefined)).toBeUndefined();
    });

    test('handles intermediate null values', () => {
        const objWithNull = { a: { b: null } };
        expect(getNestedValue(objWithNull, 'a.b.c')).toBeUndefined();
    });
});

describe('setNestedValue', () => {
    test('sets deeply nested values', () => {
        const obj = {};
        setNestedValue(obj, 'settings.excelAddIn.highlight.rowColor', '#ff0000');

        expect(obj.settings.excelAddIn.highlight.rowColor).toBe('#ff0000');
    });

    test('creates intermediate objects as needed', () => {
        const obj = {};
        setNestedValue(obj, 'a.b.c.d', 'value');

        expect(obj).toEqual({
            a: {
                b: {
                    c: {
                        d: 'value'
                    }
                }
            }
        });
    });

    test('preserves existing sibling values', () => {
        const obj = {
            settings: {
                existing: 'keep me'
            }
        };
        setNestedValue(obj, 'settings.newKey', 'new value');

        expect(obj.settings.existing).toBe('keep me');
        expect(obj.settings.newKey).toBe('new value');
    });

    test('overwrites existing values', () => {
        const obj = {
            settings: {
                color: 'blue'
            }
        };
        setNestedValue(obj, 'settings.color', 'red');

        expect(obj.settings.color).toBe('red');
    });

    test('handles single-level paths', () => {
        const obj = {};
        setNestedValue(obj, 'key', 'value');

        expect(obj.key).toBe('value');
    });
});

describe('Chrome Storage Integration', () => {
    // These tests use the mocked Chrome APIs from setup.js

    beforeEach(() => {
        global.resetChromeMocks();
    });

    test('chrome.storage.local.set stores data', async () => {
        await chrome.storage.local.set({ testKey: 'testValue' });

        expect(chrome.storage.local.set).toHaveBeenCalledWith({ testKey: 'testValue' });
    });

    test('chrome.storage.local.get retrieves stored data', async () => {
        // Pre-populate mock storage
        global.setMockStorageData({ myKey: 'myValue' });

        const result = await chrome.storage.local.get(['myKey']);

        expect(result.myKey).toBe('myValue');
    });

    test('chrome.storage.local.get returns undefined for missing keys', async () => {
        const result = await chrome.storage.local.get(['nonExistentKey']);

        expect(result.nonExistentKey).toBeUndefined();
    });

    test('chrome.storage.local.remove deletes data', async () => {
        global.setMockStorageData({ toDelete: 'value', toKeep: 'value2' });

        await chrome.storage.local.remove(['toDelete']);
        const result = await chrome.storage.local.get(['toDelete', 'toKeep']);

        expect(result.toDelete).toBeUndefined();
        expect(result.toKeep).toBe('value2');
    });
});

// ============================================
// Last Updated indicator sync
// ============================================

/**
 * Resolves the new "Last Updated" value from a storage onChanged event.
 * The timestamp lives in the nested `timestamps` object (written by the
 * side panel and the Office add-in connector); the flat `lastUpdated` key
 * is checked as a fallback for older writers.
 * Mirrors the listener logic in sidepanel.js.
 */
function resolveLastUpdatedFromStorageChanges(changes) {
    return changes.timestamps?.newValue?.lastUpdated
        ?? changes.lastUpdated?.newValue
        ?? null;
}

/**
 * Merges a master list update's timestamps into the nested timestamps
 * object without dropping unrelated fields.
 * Mirrors the Office add-in write in excelConnector.js.
 */
function mergeMasterListTimestamps(existingTimestamps, lastUpdated, sourceTimestamp) {
    const timestamps = existingTimestamps || {};
    timestamps.lastUpdated = lastUpdated;
    timestamps.masterListSourceTimestamp = sourceTimestamp;
    return timestamps;
}

describe('resolveLastUpdatedFromStorageChanges', () => {
    test('reads the timestamp from a nested timestamps change (Office add-in push)', () => {
        const changes = {
            masterEntries: { newValue: [{ name: 'Student A' }] },
            timestamps: { newValue: { lastUpdated: '6/10/2026, 09:30 AM' } }
        };
        expect(resolveLastUpdatedFromStorageChanges(changes)).toBe('6/10/2026, 09:30 AM');
    });

    test('falls back to the legacy flat lastUpdated key', () => {
        const changes = { lastUpdated: { newValue: '6/10/2026, 10:00 AM' } };
        expect(resolveLastUpdatedFromStorageChanges(changes)).toBe('6/10/2026, 10:00 AM');
    });

    test('prefers the nested timestamp over the flat key', () => {
        const changes = {
            timestamps: { newValue: { lastUpdated: 'nested-value' } },
            lastUpdated: { newValue: 'flat-value' }
        };
        expect(resolveLastUpdatedFromStorageChanges(changes)).toBe('nested-value');
    });

    test('returns null when the change is unrelated to the timestamp', () => {
        expect(resolveLastUpdatedFromStorageChanges({ foundEntries: { newValue: [] } })).toBeNull();
        expect(resolveLastUpdatedFromStorageChanges({})).toBeNull();
    });

    test('falls back to the flat key when a timestamps change lacks lastUpdated', () => {
        const changes = {
            timestamps: { newValue: { lastCallTimestamp: 123 } },
            lastUpdated: { newValue: 'flat-value' }
        };
        expect(resolveLastUpdatedFromStorageChanges(changes)).toBe('flat-value');
    });
});

describe('mergeMasterListTimestamps', () => {
    test('sets lastUpdated and masterListSourceTimestamp', () => {
        const merged = mergeMasterListTimestamps({}, '6/10/2026, 09:30 AM', 1718000000000);
        expect(merged.lastUpdated).toBe('6/10/2026, 09:30 AM');
        expect(merged.masterListSourceTimestamp).toBe(1718000000000);
    });

    test('preserves unrelated timestamp fields (snooze, last call)', () => {
        const existing = { dailyUpdateSnoozedDate: '6/9/2026', lastCallTimestamp: 42 };
        const merged = mergeMasterListTimestamps(existing, 'new-time', 1);
        expect(merged.dailyUpdateSnoozedDate).toBe('6/9/2026');
        expect(merged.lastCallTimestamp).toBe(42);
        expect(merged.lastUpdated).toBe('new-time');
    });

    test('handles a missing timestamps object', () => {
        const merged = mergeMasterListTimestamps(undefined, 'first-time', 2);
        expect(merged).toEqual({ lastUpdated: 'first-time', masterListSourceTimestamp: 2 });
    });
});
