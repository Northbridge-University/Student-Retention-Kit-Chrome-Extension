/**
 * Tests for the submission-highlight batching/reconcile helpers
 * (src/utils/highlight-batching.js).
 *
 * These verify:
 * - Target sheet resolution (Campus mode, MM-DD-YYYY placeholders)
 * - Grouping entries by resolved sheet for bulk payloads
 * - Selection of unconfirmed highlights for automatic re-send
 *
 * Like the other suites, the pure functions are mirrored here because the
 * source modules are ES modules (the jest setup has no ESM transform).
 * Keep these in sync with src/utils/highlight-batching.js.
 */

// ============================================
// Constants mirrored from src/constants/index.js
// ============================================

const HIGHLIGHT_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    ERROR: 'error'
};

// ============================================
// Pure functions mirrored from src/utils/highlight-batching.js
// ============================================

function resolveTargetSheetName(targetSheetSetting, entry, now = new Date()) {
    const setting = targetSheetSetting || 'LDA MM-DD-YYYY';
    const month = String(now.getMonth() + 1);
    const day = String(now.getDate());
    const year = now.getFullYear();

    if (setting === 'Campus') {
        return (entry && entry.campus) || `LDA ${month}-${day}-${year}`;
    }
    return setting.replace(/MM/g, month).replace(/DD/g, day).replace(/YYYY/g, year);
}

function groupEntriesBySheet(entries, targetSheetSetting, now = new Date()) {
    const groups = new Map();
    for (const entry of entries) {
        const sheet = resolveTargetSheetName(targetSheetSetting, entry, now);
        if (!groups.has(sheet)) groups.set(sheet, []);
        groups.get(sheet).push(entry);
    }
    return groups;
}

function selectEntriesForHighlightRetry(entries, { now, maxAttempts, minAgeMs }) {
    return (entries || []).filter(entry => {
        if (!entry || !entry.syStudentId) return false;
        if (entry.highlightStatus !== HIGHLIGHT_STATUS.PENDING) return false;
        if ((entry.highlightAttempts || 0) >= maxAttempts) return false;
        if (entry.lastHighlightSentAt && now - entry.lastHighlightSentAt < minAgeMs) return false;
        return true;
    });
}

// ============================================
// Tests
// ============================================

describe('resolveTargetSheetName', () => {
    const june10 = new Date(2026, 5, 10); // June 10, 2026

    test('replaces MM-DD-YYYY placeholders with non-padded date', () => {
        expect(resolveTargetSheetName('LDA MM-DD-YYYY', {}, june10)).toBe('LDA 6-10-2026');
    });

    test('defaults to LDA MM-DD-YYYY when setting is empty', () => {
        expect(resolveTargetSheetName(undefined, {}, june10)).toBe('LDA 6-10-2026');
        expect(resolveTargetSheetName('', {}, june10)).toBe('LDA 6-10-2026');
    });

    test('Campus mode uses the entry campus', () => {
        expect(resolveTargetSheetName('Campus', { campus: 'North Campus' }, june10)).toBe('North Campus');
    });

    test('Campus mode falls back to date sheet when entry has no campus', () => {
        expect(resolveTargetSheetName('Campus', {}, june10)).toBe('LDA 6-10-2026');
        expect(resolveTargetSheetName('Campus', null, june10)).toBe('LDA 6-10-2026');
    });

    test('passes through fixed sheet names unchanged', () => {
        expect(resolveTargetSheetName('Master List', {}, june10)).toBe('Master List');
    });
});

describe('groupEntriesBySheet', () => {
    const june10 = new Date(2026, 5, 10);

    test('groups all entries under one sheet in date mode', () => {
        const entries = [{ syStudentId: '1' }, { syStudentId: '2' }];
        const groups = groupEntriesBySheet(entries, 'LDA MM-DD-YYYY', june10);
        expect(groups.size).toBe(1);
        expect(groups.get('LDA 6-10-2026')).toHaveLength(2);
    });

    test('splits entries per campus in Campus mode', () => {
        const entries = [
            { syStudentId: '1', campus: 'North' },
            { syStudentId: '2', campus: 'South' },
            { syStudentId: '3', campus: 'North' },
            { syStudentId: '4' } // no campus -> date fallback
        ];
        const groups = groupEntriesBySheet(entries, 'Campus', june10);
        expect(groups.size).toBe(3);
        expect(groups.get('North')).toHaveLength(2);
        expect(groups.get('South')).toHaveLength(1);
        expect(groups.get('LDA 6-10-2026')).toHaveLength(1);
    });
});

describe('selectEntriesForHighlightRetry', () => {
    const NOW = 1_000_000_000;
    const opts = { now: NOW, maxAttempts: 3, minAgeMs: 25_000 };

    const pending = (overrides = {}) => ({
        syStudentId: '123',
        highlightStatus: HIGHLIGHT_STATUS.PENDING,
        highlightAttempts: 1,
        lastHighlightSentAt: NOW - 30_000,
        ...overrides
    });

    test('selects a stale pending entry', () => {
        expect(selectEntriesForHighlightRetry([pending()], opts)).toHaveLength(1);
    });

    test('skips confirmed and errored entries', () => {
        const entries = [
            pending({ highlightStatus: HIGHLIGHT_STATUS.CONFIRMED }),
            pending({ highlightStatus: HIGHLIGHT_STATUS.ERROR })
        ];
        expect(selectEntriesForHighlightRetry(entries, opts)).toHaveLength(0);
    });

    test('skips entries that reached the attempt cap', () => {
        expect(selectEntriesForHighlightRetry([pending({ highlightAttempts: 3 })], opts)).toHaveLength(0);
        expect(selectEntriesForHighlightRetry([pending({ highlightAttempts: 5 })], opts)).toHaveLength(0);
    });

    test('skips entries sent too recently', () => {
        expect(selectEntriesForHighlightRetry([pending({ lastHighlightSentAt: NOW - 1000 })], opts)).toHaveLength(0);
    });

    test('selects entries never sent at all, regardless of age', () => {
        const neverSent = pending({ highlightAttempts: 0 });
        delete neverSent.lastHighlightSentAt;
        expect(selectEntriesForHighlightRetry([neverSent], opts)).toHaveLength(1);
    });

    test('skips entries without a syStudentId', () => {
        const noId = pending();
        delete noId.syStudentId;
        expect(selectEntriesForHighlightRetry([noId], opts)).toHaveLength(0);
    });

    test('treats missing highlightAttempts as zero', () => {
        const entry = pending();
        delete entry.highlightAttempts;
        expect(selectEntriesForHighlightRetry([entry], opts)).toHaveLength(1);
    });

    test('handles null/empty input', () => {
        expect(selectEntriesForHighlightRetry(null, opts)).toEqual([]);
        expect(selectEntriesForHighlightRetry([], opts)).toEqual([]);
    });

    test('full lifecycle: entry stops qualifying after confirmation', () => {
        const entry = pending();
        expect(selectEntriesForHighlightRetry([entry], opts)).toHaveLength(1);

        // Simulate a re-send marking the attempt...
        entry.highlightAttempts = 2;
        entry.lastHighlightSentAt = NOW;
        expect(selectEntriesForHighlightRetry([entry], { ...opts, now: NOW + 1000 })).toHaveLength(0);

        // ...then a confirmation arriving
        entry.highlightStatus = HIGHLIGHT_STATUS.CONFIRMED;
        expect(selectEntriesForHighlightRetry([entry], { ...opts, now: NOW + 60_000 })).toHaveLength(0);
    });
});
