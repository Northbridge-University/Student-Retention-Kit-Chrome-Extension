// Canvas User ID Cache
//
// The extension used to cache full user profiles + course lists per student
// with an expiring TTL tied to course end dates. That cache was gutted in
// favor of a simpler model: map SyStudentId -> canvasUserId permanently.
// Canvas user IDs are provisioned once and never change, so there's no TTL.
// The expiring full-profile cache was removed — every Master List run now
// pulls fresh user/course data, and the ID cache only skips the
// /users/sis_user_id:{X} round-trip.
//
// This module re-exports canvasUserIdCache helpers under the old names so
// existing call sites in canvas-api.js and connections-modal.js keep working.

import {
    getCachedCanvasUserId,
    setCachedCanvasUserId,
    clearCachedCanvasUserId,
    clearAllCanvasUserIds,
    getCanvasUserIdCacheSize
} from './canvasUserIdCache.js';
import { STORAGE_KEYS } from '../constants/index.js';

export { getCachedCanvasUserId, setCachedCanvasUserId, clearCachedCanvasUserId };

/**
 * Returns the raw cache map (SyStudentId -> canvasUserId).
 */
export async function getCache() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.CANVAS_USER_ID_CACHE]);
    return data[STORAGE_KEYS.CANVAS_USER_ID_CACHE] || {};
}

/**
 * Stats for the Canvas Settings modal.
 */
export async function getCacheStats() {
    const totalEntries = await getCanvasUserIdCacheSize();
    return { totalEntries };
}

/**
 * Clears the entire cache.
 */
export async function clearAllCache() {
    await clearAllCanvasUserIds();
}

/**
 * Exports the cache as a CSV string with headers SyStudentId,CanvasUserId.
 */
export async function exportCacheAsCsv() {
    const map = await getCache();
    const rows = ['SyStudentId,CanvasUserId'];
    for (const [syStudentId, canvasUserId] of Object.entries(map)) {
        rows.push(`${csvEscape(syStudentId)},${csvEscape(canvasUserId)}`);
    }
    return rows.join('\r\n');
}

function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}
