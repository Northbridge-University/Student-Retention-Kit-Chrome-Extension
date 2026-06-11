/**
 * Tests for master list pagination logic
 *
 * The master list only renders a page of students at a time for performance
 * (50 by default, plus 50 per "Show More" click). Searching, sorting, and
 * stats always operate on the full list. These tests verify the pure
 * decision logic mirrored from student-renderer.js.
 */

// ============================================
// Pure functions extracted for testing
// ============================================

const MASTER_LIST_CHUNK_SIZE = 50;

/**
 * How many items get built on the initial render
 */
function getInitialBuildCount(totalEntries) {
    return Math.min(MASTER_LIST_CHUNK_SIZE, totalEntries);
}

/**
 * The new visible limit after a "Show More" click
 */
function increaseVisibleLimit(visibleLimit, totalEntries) {
    return Math.min(visibleLimit + MASTER_LIST_CHUNK_SIZE, totalEntries);
}

/**
 * Whether the "Show More" row should be visible.
 * Hidden while a filter is active (filters show all matches) and when
 * everything is already visible.
 */
function isShowMoreVisible(totalEntries, visibleLimit, filterActive) {
    return !filterActive && totalEntries - visibleLimit > 0;
}

/**
 * How many items must be in the DOM for an operation.
 * Filters/sort/stats need the full list; otherwise only the visible page.
 */
function getRequiredBuildCount(totalEntries, visibleLimit, needsFullList) {
    return needsFullList ? totalEntries : Math.min(visibleLimit, totalEntries);
}

/**
 * Whether a list item at the given index is visible in the paginated view
 */
function isItemVisibleUnpaginated(index, visibleLimit) {
    return index < visibleLimit;
}

// ============================================
// Tests
// ============================================

describe('master list pagination', () => {
    test('initial render builds at most 50 items', () => {
        expect(getInitialBuildCount(500)).toBe(50);
        expect(getInitialBuildCount(51)).toBe(50);
    });

    test('initial render builds everything for small lists', () => {
        expect(getInitialBuildCount(30)).toBe(30);
        expect(getInitialBuildCount(50)).toBe(50);
        expect(getInitialBuildCount(0)).toBe(0);
    });

    test('Show More reveals 50 more students per click', () => {
        let limit = MASTER_LIST_CHUNK_SIZE;
        limit = increaseVisibleLimit(limit, 500);
        expect(limit).toBe(100);
        limit = increaseVisibleLimit(limit, 500);
        expect(limit).toBe(150);
    });

    test('Show More caps the limit at the total number of students', () => {
        expect(increaseVisibleLimit(50, 70)).toBe(70);
        expect(increaseVisibleLimit(70, 70)).toBe(70);
    });

    test('Show More button is visible only when more students remain', () => {
        expect(isShowMoreVisible(500, 50, false)).toBe(true);
        expect(isShowMoreVisible(51, 50, false)).toBe(true);
        expect(isShowMoreVisible(50, 50, false)).toBe(false);
        expect(isShowMoreVisible(30, 50, false)).toBe(false);
        expect(isShowMoreVisible(0, 50, false)).toBe(false);
    });

    test('Show More button is hidden while a search or campus filter is active', () => {
        expect(isShowMoreVisible(500, 50, true)).toBe(false);
    });

    test('searching requires the full list to be rendered, not just the first page', () => {
        expect(getRequiredBuildCount(500, 50, true)).toBe(500);
    });

    test('without a filter only the visible page needs to be rendered', () => {
        expect(getRequiredBuildCount(500, 50, false)).toBe(50);
        expect(getRequiredBuildCount(500, 100, false)).toBe(100);
        expect(getRequiredBuildCount(30, 50, false)).toBe(30);
    });

    test('paginated view shows exactly the first visibleLimit items', () => {
        expect(isItemVisibleUnpaginated(0, 50)).toBe(true);
        expect(isItemVisibleUnpaginated(49, 50)).toBe(true);
        expect(isItemVisibleUnpaginated(50, 50)).toBe(false);
        expect(isItemVisibleUnpaginated(99, 100)).toBe(true);
    });
});
