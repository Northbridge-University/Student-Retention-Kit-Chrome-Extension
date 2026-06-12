/**
 * Side panel presence tracking.
 *
 * Each open side panel document holds a long-lived chrome.runtime port to
 * the background service worker. Tracking the connected ports lets the
 * background answer "is a side panel already open in ANY Chrome window?"
 * synchronously. The check must be synchronous because the ribbon autoCall
 * handler calls chrome.sidePanel.open(), and awaiting anything before that
 * call breaks Chrome's user-gesture chain ("may only be called in response
 * to a user gesture").
 *
 * Why this matters: chrome.sidePanel.open({ tabId }) opens a panel in the
 * window that owns that tab. If the user already has the panel open in a
 * different window (e.g. on a second monitor), opening another one creates
 * a second panel instance that re-processes the same call request — dial
 * followed by an instant hangup. The background uses this tracker to skip
 * opening a panel when one is already open somewhere.
 */

export const SIDEPANEL_PRESENCE_PORT = 'srk_sidepanel_presence';

/**
 * Creates a tracker for open side panel presence ports.
 * Used by the background service worker's chrome.runtime.onConnect listener.
 * @returns {{ handleConnect: Function, isSidePanelOpen: Function, openPanelCount: Function }}
 */
export function createSidePanelPresenceTracker() {
    const ports = new Set();

    return {
        /**
         * Inspects a newly connected port and tracks it if it is a side
         * panel presence port. The port is untracked when it disconnects
         * (panel closed, or service worker restarting).
         * @param {Object} port - chrome.runtime.Port
         * @returns {boolean} true when the port was claimed by this tracker
         */
        handleConnect(port) {
            if (!port || port.name !== SIDEPANEL_PRESENCE_PORT) return false;
            ports.add(port);
            port.onDisconnect.addListener(() => ports.delete(port));
            return true;
        },

        /**
         * Whether at least one side panel is currently open, in any Chrome
         * window. Synchronous on purpose — see module docstring.
         * @returns {boolean}
         */
        isSidePanelOpen() {
            return ports.size > 0;
        },

        /**
         * Number of currently tracked open panels (for diagnostics/logging).
         * @returns {number}
         */
        openPanelCount() {
            return ports.size;
        }
    };
}
