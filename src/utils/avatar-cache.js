// Avatar Cache - Preloads student photos and applies them without pop-in
//
// Student photos are background-images that the browser fetches at display
// time, so they visibly "pop in" once the download finishes. This module
// keeps the placeholder (icon/initials) visible until a photo has fully
// loaded, swaps it in with a short fade, and preloads upcoming photos
// (call queue, rendered master list page, previous calls) so most swaps
// happen instantly from cache.
import { GENERIC_AVATAR_URL } from '../constants/index.js';

const loadedUrls = new Set();
const failedUrls = new Set();
const pendingLoads = new Map(); // url -> Promise<boolean>

// The photo URL each avatar element is currently waiting for, so a slow load
// never overwrites an element that has since been reused for someone else
const expectedUrlByElement = new WeakMap();

/**
 * Whether a photo URL has already been loaded (applying it won't pop in)
 * @param {string} url - Photo URL
 * @returns {boolean}
 */
export function isAvatarLoaded(url) {
    return loadedUrls.has(url);
}

/**
 * Starts downloading a photo so it's cached before it's displayed.
 * Safe to call repeatedly — loads each URL at most once.
 * @param {string} url - Photo URL
 * @returns {Promise<boolean>} Resolves true when the photo is usable
 */
export function preloadAvatar(url) {
    if (!url || url === GENERIC_AVATAR_URL) return Promise.resolve(false);
    if (loadedUrls.has(url)) return Promise.resolve(true);
    if (failedUrls.has(url)) return Promise.resolve(false);
    if (pendingLoads.has(url)) return pendingLoads.get(url);

    const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            loadedUrls.add(url);
            pendingLoads.delete(url);
            resolve(true);
        };
        img.onerror = () => {
            failedUrls.add(url);
            pendingLoads.delete(url);
            resolve(false);
        };
        img.src = url;
    });
    pendingLoads.set(url, promise);
    return promise;
}

/**
 * Preloads the photos of a batch of students (e.g. the call queue or the
 * rendered master list page)
 * @param {Array} students - Student entries (uses Photo/photo field)
 * @param {number} [limit=50] - Max number of photos to preload
 */
export function preloadStudentPhotos(students, limit = 50) {
    if (!Array.isArray(students)) return;
    students.slice(0, limit).forEach(student => {
        const url = student?.Photo || student?.photo;
        if (url && url !== GENERIC_AVATAR_URL) {
            preloadAvatar(url);
        }
    });
}

/**
 * Applies a student photo to an avatar element without pop-in.
 *
 * Cached photos apply immediately. Otherwise the fallback (icon/initials)
 * stays visible while the photo downloads, and the photo swaps in with a
 * short fade once it's fully loaded. If the load fails, or the element has
 * been reassigned to another student in the meantime, the swap is skipped.
 *
 * @param {HTMLElement} element - The avatar element
 * @param {string|null} url - Photo URL, or null to just show the fallback
 * @param {Object} handlers
 * @param {Function} handlers.applyPhoto - Sets the element's photo styles
 * @param {Function} [handlers.applyFallback] - Sets the placeholder styles
 */
export function applyAvatarPhoto(element, url, { applyPhoto, applyFallback }) {
    if (!element) return;
    expectedUrlByElement.set(element, url || '');

    if (!url || url === GENERIC_AVATAR_URL || failedUrls.has(url)) {
        if (applyFallback) applyFallback();
        return;
    }

    if (loadedUrls.has(url)) {
        applyPhoto();
        return;
    }

    if (applyFallback) applyFallback();
    preloadAvatar(url).then((ok) => {
        if (!ok) return; // keep the fallback on failure
        if (expectedUrlByElement.get(element) !== url) return; // element reused
        applyPhoto();
        element.classList.remove('avatar-fade-in');
        void element.offsetWidth; // restart the animation if it ran before
        element.classList.add('avatar-fade-in');
    });
}

/**
 * Stops a pending photo from being applied to an element. Call when the
 * element is repurposed for non-photo content (e.g. the queue count badge).
 * @param {HTMLElement} element - The avatar element
 */
export function cancelPendingAvatar(element) {
    if (element) {
        expectedUrlByElement.delete(element);
    }
}
