// Five9 Integration - Monitors Five9 connection status
import { STORAGE_KEYS, FIVE9_CONNECTION_STATES } from '../constants/index.js';
import { storageGet } from '../utils/storage.js';
import { elements } from './ui-manager.js';
import { updateCallTabDisplay, showConnectionError, clearConnectionError } from './call-tab-placeholder.js';

let five9ConnectionCheckInterval = null;
let lastFive9ConnectionState = FIVE9_CONNECTION_STATES.NO_TAB;
let cachedDebugMode = null; // In-memory cache to avoid async storage reads on every tick

/**
 * Initializes the debug mode cache from storage.
 * Call once at startup so subsequent checks are synchronous.
 */
export async function initDebugModeCache() {
    const data = await storageGet(STORAGE_KEYS.CALL_DEMO);
    cachedDebugMode = data[STORAGE_KEYS.CALL_DEMO] || false;

    // Keep cache in sync when the setting changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEYS.CALL_DEMO]) {
            cachedDebugMode = changes[STORAGE_KEYS.CALL_DEMO].newValue || false;
        }
    });
}

/**
 * Checks Five9 connection status with three states:
 * - NO_TAB: No Five9 tab detected
 * - AWAITING_CONNECTION: Tab exists but agent not connected
 * - ACTIVE_CONNECTION: Agent connected (network activity detected)
 * @returns {Promise<string>} One of FIVE9_CONNECTION_STATES
 */
export async function checkFive9Connection() {
    try {
        // First check if Five9 tab is open
        const tabs = await chrome.tabs.query({ url: "https://app-atl.five9.com/*" });

        if (tabs.length === 0) {
            return FIVE9_CONNECTION_STATES.NO_TAB;
        }

        // Tab exists - now check if agent is connected via network monitoring
        const response = await chrome.runtime.sendMessage({
            type: 'GET_FIVE9_CONNECTION_STATE'
        });

        // If we have active connection from network monitoring, return that
        if (response && response.state === FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION) {
            return FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION;
        }

        // Tab exists but no agent connection detected yet
        return FIVE9_CONNECTION_STATES.AWAITING_CONNECTION;
    } catch (error) {
        console.error("Error checking Five9 connection:", error);
        return FIVE9_CONNECTION_STATES.NO_TAB;
    }
}

/**
 * Updates the Call tab display based on Five9 connection state
 * Uses the unified call-tab-placeholder system for displaying messages
 * @param {Array} selectedQueue - Currently selected students
 * @param {boolean} [debugModeOverride] - Optional debug mode override (if not provided, fetches from storage)
 */
export async function updateFive9ConnectionIndicator(selectedQueue, debugModeOverride = null) {
    // Use cached debug mode (synchronous) unless an explicit override is provided
    const isDebugMode = debugModeOverride !== null ? debugModeOverride : (cachedDebugMode ?? false);

    // Skip Five9 monitoring entirely in demo mode
    if (isDebugMode) {
        // Clear any lingering Five9 error state
        clearConnectionError();
        await updateCallTabDisplay({
            selectedQueue: selectedQueue || [],
            debugMode: true
        });
        return;
    }

    // Track connection state changes
    const connectionState = await checkFive9Connection();
    if (connectionState !== lastFive9ConnectionState) {
        lastFive9ConnectionState = connectionState;
    }

    // Use the unified placeholder system to update the display
    await updateCallTabDisplay({
        selectedQueue: selectedQueue || [],
        debugMode: false
    });
}

/**
 * Starts monitoring Five9 connection status
 */
export function startFive9ConnectionMonitor(getSelectedQueue) {
    // Initial check
    if (getSelectedQueue) {
        updateFive9ConnectionIndicator(getSelectedQueue());
    }

    // Check every 3 seconds
    five9ConnectionCheckInterval = setInterval(() => {
        if (getSelectedQueue) {
            updateFive9ConnectionIndicator(getSelectedQueue());
        }
    }, 3000);
}

/**
 * Stops monitoring Five9 connection status
 */
export function stopFive9ConnectionMonitor() {
    if (five9ConnectionCheckInterval) {
        clearInterval(five9ConnectionCheckInterval);
        five9ConnectionCheckInterval = null;
    }
}

/**
 * Setup Five9 status listeners from background.js
 */
export function setupFive9StatusListeners(callManager, getSelectedQueue) {
    chrome.runtime.onMessage.addListener(async (message, sender) => {
        // Handle Five9 call initiation status
        if (message.type === 'callStatus') {
            if (!message.success) {
                console.error("Five9 call failed:", message.error);
                // Revert call UI state if call failed
                if (callManager && callManager.getCallActiveState()) {
                    callManager.toggleCallState(true);
                }

                // Check if this is a connection error (receiving end doesn't exist)
                // Skip in demo mode since it doesn't use Five9
                const demoData = await storageGet(STORAGE_KEYS.CALL_DEMO);
                const isDemo = demoData[STORAGE_KEYS.CALL_DEMO] || false;

                if (!isDemo && message.error && (
                    message.error.includes('disconnected') ||
                    message.error.includes('Receiving end does not exist') ||
                    message.error.includes('Could not establish connection')
                )) {
                    // Check if Five9 tab still exists
                    const tabs = await chrome.tabs.query({ url: "https://app-atl.five9.com/*" });
                    const hasFive9Tab = tabs.length > 0;
                    showConnectionError(hasFive9Tab);
                }
            }
        }

        // Handle Five9 hangup status
        if (message.type === 'hangupStatus') {
            if (!message.success) {
                console.error("Five9 hangup failed:", message.error);
            }
        }

        // Handle Five9 connection state changes from network monitoring
        if (message.type === 'FIVE9_CONNECTION_STATE_CHANGED') {
            // Immediately update the indicator when state changes
            if (getSelectedQueue) {
                updateFive9ConnectionIndicator(getSelectedQueue());
            }
        }

        // Handle disposition set externally (through Five9 UI)
        // Skip if in demo mode - demo mode doesn't use Five9
        if (message.type === 'FIVE9_DISPOSITION_SET') {
            if (callManager && callManager.getCallActiveState() && !callManager.debugMode) {
                // Call was disposed through Five9 UI - reset our state
                callManager.handleExternalDisposition();
            }
        }

        // Handle call disconnected externally (through Five9 UI)
        // Skip if in demo mode - demo mode doesn't use Five9
        if (message.type === 'FIVE9_CALL_DISCONNECTED') {
            if (callManager && callManager.getCallActiveState() && !callManager.waitingForDisposition && !callManager.debugMode) {
                // Call was disconnected through Five9 UI - update to awaiting disposition
                callManager.handleExternalDisconnect();
            }
        }
    });
}
