// Permanent cache mapping ClassSectionId (SIS course ID) → Canvas numeric
// course ID. Canvas course IDs never change for the life of the course, so
// this cache has no TTL. Mirrors canvasUserIdCache.js.

import { STORAGE_KEYS } from '../constants/index.js';

async function readAll() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.CANVAS_COURSE_ID_CACHE]);
    return data[STORAGE_KEYS.CANVAS_COURSE_ID_CACHE] || {};
}

async function writeAll(map) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CANVAS_COURSE_ID_CACHE]: map });
}

export async function getCachedCanvasCourseId(sisCourseId) {
    if (!sisCourseId) return null;
    const map = await readAll();
    const id = map[String(sisCourseId)];
    return id != null ? id : null;
}

export async function setCachedCanvasCourseIds(pairs) {
    if (!pairs || pairs.length === 0) return;
    const map = await readAll();
    let changed = false;
    for (const [sisCourseId, canvasCourseId] of pairs) {
        if (!sisCourseId || canvasCourseId == null) continue;
        const key = String(sisCourseId);
        if (map[key] !== canvasCourseId) {
            map[key] = canvasCourseId;
            changed = true;
        }
    }
    if (changed) await writeAll(map);
}

export async function clearAllCanvasCourseIds() {
    await writeAll({});
}
