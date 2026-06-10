// Pure helpers for the submission-highlight pipeline in background.js.
// No chrome.* usage here so these can be unit tested directly.

import { HIGHLIGHT_STATUS } from '../constants/index.js';

/**
 * Resolves the worksheet name a highlight should target.
 *
 * - 'Campus' mode uses the student's campus, falling back to the date-based
 *   default when the entry has no campus.
 * - Otherwise MM/DD/YYYY placeholders in the setting are replaced with the
 *   current date (non-padded, matching the add-in's LDA sheet naming).
 *
 * @param {string} targetSheetSetting - The HIGHLIGHT_TARGET_SHEET setting value
 * @param {Object} entry - Found-submission entry ({ campus, ... })
 * @param {Date} [now] - Injection point for tests
 * @returns {string} Resolved sheet name
 */
export function resolveTargetSheetName(targetSheetSetting, entry, now = new Date()) {
    const setting = targetSheetSetting || 'LDA MM-DD-YYYY';
    const month = String(now.getMonth() + 1);
    const day = String(now.getDate());
    const year = now.getFullYear();

    if (setting === 'Campus') {
        return (entry && entry.campus) || `LDA ${month}-${day}-${year}`;
    }
    return setting.replace(/MM/g, month).replace(/DD/g, day).replace(/YYYY/g, year);
}

/**
 * Groups found-submission entries by their resolved target sheet. The
 * add-in's bulk highlight payload operates on a single sheet, so one
 * payload is sent per group.
 *
 * @param {Array<Object>} entries - Entries that already have a syStudentId
 * @param {string} targetSheetSetting - The HIGHLIGHT_TARGET_SHEET setting value
 * @param {Date} [now] - Injection point for tests
 * @returns {Map<string, Array<Object>>} sheet name -> entries
 */
export function groupEntriesBySheet(entries, targetSheetSetting, now = new Date()) {
    const groups = new Map();
    for (const entry of entries) {
        const sheet = resolveTargetSheetName(targetSheetSetting, entry, now);
        if (!groups.has(sheet)) groups.set(sheet, []);
        groups.get(sheet).push(entry);
    }
    return groups;
}

/**
 * Selects found entries whose highlight should be re-sent: still pending
 * (no confirmation from the Excel add-in), under the attempt cap, and not
 * sent again too recently. Entries that were never sent (no
 * lastHighlightSentAt) qualify immediately.
 *
 * @param {Array<Object>} entries - Found entries from storage
 * @param {Object} options
 * @param {number} options.now - Current epoch ms
 * @param {number} options.maxAttempts - Max total sends per entry
 * @param {number} options.minAgeMs - Min ms since the last send
 * @returns {Array<Object>} Entries to re-send
 */
export function selectEntriesForHighlightRetry(entries, { now, maxAttempts, minAgeMs }) {
    return (entries || []).filter(entry => {
        if (!entry || !entry.syStudentId) return false;
        if (entry.highlightStatus !== HIGHLIGHT_STATUS.PENDING) return false;
        if ((entry.highlightAttempts || 0) >= maxAttempts) return false;
        if (entry.lastHighlightSentAt && now - entry.lastHighlightSentAt < minAgeMs) return false;
        return true;
    });
}
