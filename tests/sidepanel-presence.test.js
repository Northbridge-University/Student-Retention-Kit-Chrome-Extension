/**
 * Tests for the side panel presence tracker
 * (src/utils/sidepanel-presence.js).
 *
 * The background uses the tracker to decide, synchronously, whether a
 * ribbon autoCall should open a side panel or whether one is already open
 * in some Chrome window (e.g. on a second monitor).
 *
 * Like the other suites, the pure logic is mirrored here because the
 * source modules are ES modules (the jest setup has no ESM transform).
 * Keep these in sync with src/utils/sidepanel-presence.js.
 */

// ============================================
// Mirrored from src/utils/sidepanel-presence.js
// ============================================

const SIDEPANEL_PRESENCE_PORT = 'srk_sidepanel_presence';

function createSidePanelPresenceTracker() {
    const ports = new Set();

    return {
        handleConnect(port) {
            if (!port || port.name !== SIDEPANEL_PRESENCE_PORT) return false;
            ports.add(port);
            port.onDisconnect.addListener(() => ports.delete(port));
            return true;
        },

        isSidePanelOpen() {
            return ports.size > 0;
        },

        openPanelCount() {
            return ports.size;
        }
    };
}

// ============================================
// Test helpers
// ============================================

/** Minimal stand-in for a chrome.runtime.Port. */
function createFakePort(name) {
    const disconnectListeners = [];
    return {
        name,
        onDisconnect: {
            addListener: (fn) => disconnectListeners.push(fn)
        },
        // Simulates the port closing (panel closed / service worker restart)
        triggerDisconnect: () => disconnectListeners.forEach(fn => fn())
    };
}

// ============================================
// Tests
// ============================================

describe('createSidePanelPresenceTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = createSidePanelPresenceTracker();
    });

    test('reports no panel open initially', () => {
        expect(tracker.isSidePanelOpen()).toBe(false);
        expect(tracker.openPanelCount()).toBe(0);
    });

    test('claims and tracks a presence port', () => {
        const port = createFakePort(SIDEPANEL_PRESENCE_PORT);

        expect(tracker.handleConnect(port)).toBe(true);
        expect(tracker.isSidePanelOpen()).toBe(true);
        expect(tracker.openPanelCount()).toBe(1);
    });

    test('ignores ports with other names', () => {
        const port = createFakePort('some_other_port');

        expect(tracker.handleConnect(port)).toBe(false);
        expect(tracker.isSidePanelOpen()).toBe(false);
    });

    test('ignores null/undefined ports without throwing', () => {
        expect(tracker.handleConnect(null)).toBe(false);
        expect(tracker.handleConnect(undefined)).toBe(false);
        expect(tracker.isSidePanelOpen()).toBe(false);
    });

    test('tracks one port per open panel (multiple windows)', () => {
        const portA = createFakePort(SIDEPANEL_PRESENCE_PORT);
        const portB = createFakePort(SIDEPANEL_PRESENCE_PORT);

        tracker.handleConnect(portA);
        tracker.handleConnect(portB);

        expect(tracker.openPanelCount()).toBe(2);
    });

    test('untracks a port when it disconnects', () => {
        const port = createFakePort(SIDEPANEL_PRESENCE_PORT);
        tracker.handleConnect(port);

        port.triggerDisconnect();

        expect(tracker.isSidePanelOpen()).toBe(false);
        expect(tracker.openPanelCount()).toBe(0);
    });

    test('still reports open when one of two panels closes', () => {
        const portA = createFakePort(SIDEPANEL_PRESENCE_PORT);
        const portB = createFakePort(SIDEPANEL_PRESENCE_PORT);
        tracker.handleConnect(portA);
        tracker.handleConnect(portB);

        portA.triggerDisconnect();

        expect(tracker.isSidePanelOpen()).toBe(true);
        expect(tracker.openPanelCount()).toBe(1);
    });

    test('handles reconnect after service worker restart (same panel, new port)', () => {
        const oldPort = createFakePort(SIDEPANEL_PRESENCE_PORT);
        tracker.handleConnect(oldPort);

        // Service worker restart: in reality a NEW tracker instance sees the
        // reconnect, but the old port disconnecting must not corrupt state
        // if both events land on the same instance.
        oldPort.triggerDisconnect();
        const newPort = createFakePort(SIDEPANEL_PRESENCE_PORT);
        tracker.handleConnect(newPort);

        expect(tracker.isSidePanelOpen()).toBe(true);
        expect(tracker.openPanelCount()).toBe(1);
    });
});
