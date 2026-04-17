// Permanent cache mapping SyStudentId (SIS) → Canvas numeric user ID.
//
// Canvas assigns a user ID once when an account is provisioned and it never
// changes for that account's lifetime, so this cache has no TTL. A 404 from
// /users/{cachedId} invalidates the single entry and the caller re-resolves
// via /users/sis_user_id:{X}.

import { STORAGE_KEYS } from '../constants/index.js';

async function readAll() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.CANVAS_USER_ID_CACHE]);
    return data[STORAGE_KEYS.CANVAS_USER_ID_CACHE] || {};
}

async function writeAll(map) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CANVAS_USER_ID_CACHE]: map });
}

export async function getCachedCanvasUserId(syStudentId) {
    if (!syStudentId) return null;
    const map = await readAll();
    const id = map[String(syStudentId)];
    return id != null ? id : null;
}

export async function setCachedCanvasUserId(syStudentId, canvasUserId) {
    if (!syStudentId || canvasUserId == null) return;
    const map = await readAll();
    map[String(syStudentId)] = canvasUserId;
    await writeAll(map);
}

export async function clearCachedCanvasUserId(syStudentId) {
    if (!syStudentId) return;
    const map = await readAll();
    if (map[String(syStudentId)] === undefined) return;
    delete map[String(syStudentId)];
    await writeAll(map);
}

export async function clearAllCanvasUserIds() {
    await writeAll({});
}

export async function getCanvasUserIdCacheSize() {
    const map = await readAll();
    return Object.keys(map).length;
}
