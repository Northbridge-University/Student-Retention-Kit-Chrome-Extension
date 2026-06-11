/**
 * Tests for avatar cache logic (avatar-cache.js)
 *
 * Student photos are applied only after they have fully loaded so they don't
 * pop in, and upcoming photos (queue, master list page) are preloaded.
 * These tests verify the pure decision logic mirrored from avatar-cache.js.
 */

// ============================================
// Pure functions extracted for testing
// ============================================

const GENERIC_AVATAR_URL = 'https://example.instructure.com/images/messages/avatar-50.png';

/**
 * Whether a photo URL should start preloading
 */
function shouldPreloadAvatar(url, loadedUrls, failedUrls, pendingUrls) {
    if (!url || url === GENERIC_AVATAR_URL) return false;
    if (loadedUrls.has(url) || failedUrls.has(url) || pendingUrls.has(url)) return false;
    return true;
}

/**
 * Collects the photo URLs to preload for a batch of students
 */
function collectPhotoUrlsToPreload(students, limit = 50) {
    if (!Array.isArray(students)) return [];
    return students
        .slice(0, limit)
        .map(student => student?.Photo || student?.photo)
        .filter(url => url && url !== GENERIC_AVATAR_URL);
}

/**
 * How an avatar should render right now:
 * - 'photo'    — URL is cached, apply instantly (no pop-in possible)
 * - 'fallback' — no usable URL, or it hasn't loaded yet (placeholder shows
 *                while the download runs)
 */
function getAvatarRenderMode(url, loadedUrls, failedUrls) {
    if (!url || url === GENERIC_AVATAR_URL || failedUrls.has(url)) return 'fallback';
    if (loadedUrls.has(url)) return 'photo';
    return 'fallback';
}

/**
 * Whether a finished download may be applied to an element: the load must
 * have succeeded and the element must still be waiting for that same URL
 */
function shouldApplyLoadedPhoto(loadSucceeded, expectedUrl, loadedUrl) {
    return !!loadSucceeded && expectedUrl === loadedUrl;
}

// ============================================
// Tests
// ============================================

describe('shouldPreloadAvatar', () => {
    const none = new Set();

    test('preloads a fresh photo URL', () => {
        expect(shouldPreloadAvatar('https://cdn/img1.png', none, none, none)).toBe(true);
    });

    test('skips missing URLs and the generic avatar', () => {
        expect(shouldPreloadAvatar(null, none, none, none)).toBe(false);
        expect(shouldPreloadAvatar('', none, none, none)).toBe(false);
        expect(shouldPreloadAvatar(GENERIC_AVATAR_URL, none, none, none)).toBe(false);
    });

    test('loads each URL at most once', () => {
        const url = 'https://cdn/img1.png';
        expect(shouldPreloadAvatar(url, new Set([url]), none, none)).toBe(false);
        expect(shouldPreloadAvatar(url, none, new Set([url]), none)).toBe(false);
        expect(shouldPreloadAvatar(url, none, none, new Set([url]))).toBe(false);
    });
});

describe('collectPhotoUrlsToPreload', () => {
    test('collects Photo/photo fields and skips students without one', () => {
        const students = [
            { name: 'A', Photo: 'https://cdn/a.png' },
            { name: 'B' },
            { name: 'C', photo: 'https://cdn/c.png' },
            { name: 'D', Photo: GENERIC_AVATAR_URL }
        ];
        expect(collectPhotoUrlsToPreload(students)).toEqual(['https://cdn/a.png', 'https://cdn/c.png']);
    });

    test('respects the preload limit', () => {
        const students = Array.from({ length: 100 }, (_, i) => ({ Photo: `https://cdn/${i}.png` }));
        expect(collectPhotoUrlsToPreload(students, 50)).toHaveLength(50);
    });

    test('handles non-array input', () => {
        expect(collectPhotoUrlsToPreload(null)).toEqual([]);
        expect(collectPhotoUrlsToPreload(undefined)).toEqual([]);
    });
});

describe('getAvatarRenderMode', () => {
    const none = new Set();

    test('shows the photo instantly when already cached', () => {
        const url = 'https://cdn/img1.png';
        expect(getAvatarRenderMode(url, new Set([url]), none)).toBe('photo');
    });

    test('shows the placeholder while the photo is still loading', () => {
        expect(getAvatarRenderMode('https://cdn/img1.png', none, none)).toBe('fallback');
    });

    test('shows the placeholder for missing, generic, or failed photos', () => {
        const url = 'https://cdn/broken.png';
        expect(getAvatarRenderMode(null, none, none)).toBe('fallback');
        expect(getAvatarRenderMode(GENERIC_AVATAR_URL, none, none)).toBe('fallback');
        expect(getAvatarRenderMode(url, none, new Set([url]))).toBe('fallback');
    });
});

describe('shouldApplyLoadedPhoto', () => {
    test('applies when the load succeeded and the element still wants that URL', () => {
        expect(shouldApplyLoadedPhoto(true, 'https://cdn/a.png', 'https://cdn/a.png')).toBe(true);
    });

    test('skips when the element was reassigned to another student meanwhile', () => {
        expect(shouldApplyLoadedPhoto(true, 'https://cdn/b.png', 'https://cdn/a.png')).toBe(false);
    });

    test('skips when the element was repurposed (e.g. queue count badge)', () => {
        expect(shouldApplyLoadedPhoto(true, '', 'https://cdn/a.png')).toBe(false);
        expect(shouldApplyLoadedPhoto(true, undefined, 'https://cdn/a.png')).toBe(false);
    });

    test('keeps the fallback when the load failed', () => {
        expect(shouldApplyLoadedPhoto(false, 'https://cdn/a.png', 'https://cdn/a.png')).toBe(false);
    });
});
