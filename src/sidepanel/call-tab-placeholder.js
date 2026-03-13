// Call Tab Placeholder - Unified placeholder display with priority-based messages
import { FIVE9_CONNECTION_STATES } from '../constants/index.js';
import { elements } from './ui-manager.js';

/**
 * Message types for the Call tab placeholder
 * Higher priority numbers take precedence
 */
export const PLACEHOLDER_MESSAGES = {
    NO_STUDENT_SELECTED: {
        id: 'no_student',
        priority: 1,
        icon: 'fa-user-graduate',
        iconStyle: 'font-size:3em; margin-bottom:15px; opacity:0.5;',
        header: 'No Student Selected',
        message: 'Select a student from the Master List<br>to view details and make calls.'
    },
    FIVE9_NO_TAB: {
        id: 'five9_no_tab',
        priority: 2,
        icon: 'fa-phone-slash',
        iconStyle: 'font-size:3em; margin-bottom:15px; opacity:0.5;',
        header: 'Awaiting Five9 Tab',
        message: 'Please open Five9 in a new tab<br>to enable calling features.'
    },
    FIVE9_AWAITING_AGENT: {
        id: 'five9_awaiting',
        priority: 2,
        icon: 'fa-spinner fa-spin',
        iconStyle: 'font-size:3em; margin-bottom:15px; opacity:0.4;',
        header: 'Awaiting Agent Connection',
        message: 'Five9 tab detected. Waiting for<br>agent to connect...'
    },
    FIVE9_CONNECTION_ERROR: {
        id: 'five9_error',
        priority: 3,
        icon: 'fa-exclamation-triangle',
        iconStyle: 'font-size:3em; margin-bottom:15px; color:#ef4444;',
        header: 'Five9 Connection Error',
        message: 'Could not establish connection.<br>Try restarting the station.'
    }
};

// Track current placeholder state to avoid unnecessary re-renders
let currentPlaceholderMessage = null;

// Track if there's a Five9 connection error
let five9ConnectionError = false;

/**
 * Checks Five9 connection status (duplicated here to avoid circular dependency)
 * @returns {Promise<string>} One of FIVE9_CONNECTION_STATES
 */
async function checkFive9ConnectionState() {
    try {
        const tabs = await chrome.tabs.query({ url: "https://app-scl.five9.com/*" });

        if (tabs.length === 0) {
            return FIVE9_CONNECTION_STATES.NO_TAB;
        }

        const response = await chrome.runtime.sendMessage({
            type: 'GET_FIVE9_CONNECTION_STATE'
        });

        if (response && response.state === FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION) {
            return FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION;
        }

        return FIVE9_CONNECTION_STATES.AWAITING_CONNECTION;
    } catch (error) {
        console.error("Error checking Five9 connection:", error);
        return FIVE9_CONNECTION_STATES.NO_TAB;
    }
}

/**
 * Restarts the Five9 station to re-establish connection
 * Falls back to refreshing the tab if content script isn't available
 * @returns {Promise<{success: boolean, error?: string}>} Result of restart attempt
 */
async function restartFive9Station() {
    try {
        const tabs = await chrome.tabs.query({ url: "https://app-scl.five9.com/*" });
        if (tabs.length === 0) {
            return { success: false, error: "No Five9 tab found" };
        }

        // Try to send restart request to the Five9 content script
        try {
            const response = await chrome.tabs.sendMessage(tabs[0].id, {
                type: 'executeFive9RestartStation'
            });

            if (response && response.success) {
                // Clear error state and show awaiting connection message
                clearConnectionError();
                currentPlaceholderMessage = null;
                renderPlaceholder(PLACEHOLDER_MESSAGES.FIVE9_AWAITING_AGENT);
                showPlaceholder();
                hideCallSection();
                return { success: true };
            } else {
                return { success: false, error: response?.error || "Restart failed" };
            }
        } catch (messageError) {
            // Content script not available - refresh tab and then call restart station
            console.log("Content script not available, refreshing Five9 tab...");

            const tabId = tabs[0].id;

            // Set up listener for when tab finishes loading
            const waitForTabLoad = new Promise((resolve) => {
                const listener = (updatedTabId, changeInfo) => {
                    if (updatedTabId === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);

                // Timeout after 30 seconds
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }, 30000);
            });

            // Reload the tab
            await chrome.tabs.reload(tabId);

            // Clear error state and show awaiting connection message
            clearConnectionError();
            currentPlaceholderMessage = null;
            renderPlaceholder(PLACEHOLDER_MESSAGES.FIVE9_AWAITING_AGENT);
            showPlaceholder();
            hideCallSection();

            // Wait for tab to finish loading
            await waitForTabLoad;

            // Small delay to ensure content script is fully initialized
            await new Promise(r => setTimeout(r, 1500));

            // Now try to restart station with the newly loaded content script
            try {
                console.log("Tab reloaded, sending restart station request...");
                const retryResponse = await chrome.tabs.sendMessage(tabId, {
                    type: 'executeFive9RestartStation'
                });
                if (retryResponse && retryResponse.success) {
                    console.log("Station restart successful after tab reload");
                }
            } catch (retryError) {
                console.log("Restart station after reload failed (user may need to reconnect manually):", retryError.message);
            }

            return { success: true };
        }
    } catch (error) {
        console.error("Error restarting Five9 station:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Updates the unified placeholder content
 * @param {Object} messageConfig - The message configuration from PLACEHOLDER_MESSAGES
 */
function renderPlaceholder(messageConfig) {
    if (!elements.callTabPlaceholder) return;

    // Skip if already showing this message
    if (currentPlaceholderMessage === messageConfig.id) return;
    currentPlaceholderMessage = messageConfig.id;

    // Add restart station button for awaiting agent and error messages
    let actionButton = '';
    if (messageConfig.id === 'five9_awaiting' || messageConfig.id === 'five9_error') {
        actionButton = `<button id="restartStationBtn" style="margin-top:18px; padding:8px 14px; background:transparent; color:#6b7280; border:1px solid #d1d5db; border-radius:6px; cursor:pointer; font-size:0.8em; display:flex; align-items:center; gap:6px; transition:all 0.15s ease;"><i class="fas fa-redo" style="font-size:0.85em;"></i> Restart Station</button>`;
    }

    elements.callTabPlaceholder.innerHTML = `
        <i class="fas ${messageConfig.icon}" style="${messageConfig.iconStyle}"></i>
        <span style="font-size:1.1em; font-weight:500;">${messageConfig.header}</span>
        <span style="font-size:0.9em; margin-top:5px; color:#6b7280;">${messageConfig.message}</span>
        ${actionButton}
    `;

    // Add click handler for restart station button
    if (messageConfig.id === 'five9_awaiting' || messageConfig.id === 'five9_error') {
        const btn = document.getElementById('restartStationBtn');
        if (btn) {
            // Add hover effect
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#f3f4f6';
                btn.style.borderColor = '#9ca3af';
                btn.style.color = '#374151';
            });
            btn.addEventListener('mouseleave', () => {
                if (!btn.disabled) {
                    btn.style.background = 'transparent';
                    btn.style.borderColor = '#d1d5db';
                    btn.style.color = '#6b7280';
                }
            });

            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:0.85em;"></i> Restarting...';
                const result = await restartFive9Station();
                if (!result.success) {
                    // Show error or no tab message
                    if (result.error?.includes("No Five9 tab")) {
                        showConnectionError(false);
                    } else {
                        // Reset button to allow retry
                        btn.disabled = false;
                        btn.style.opacity = '1';
                        btn.style.cursor = 'pointer';
                        btn.innerHTML = '<i class="fas fa-redo" style="font-size:0.85em;"></i> Restart Station';
                        console.error("Station restart failed:", result.error);
                    }
                }
            });
        }
    }
}

/**
 * Shows the placeholder with the given message
 */
function showPlaceholder() {
    if (!elements.callTabPlaceholder) return;
    elements.callTabPlaceholder.style.display = 'flex';
}

/**
 * Hides the placeholder
 */
function hidePlaceholder() {
    if (!elements.callTabPlaceholder) return;
    elements.callTabPlaceholder.style.display = 'none';
    currentPlaceholderMessage = null;
}

/**
 * Shows the Five9 connection error placeholder
 * @param {boolean} hasFive9Tab - Whether a Five9 tab exists
 */
export async function showConnectionError(hasFive9Tab = true) {
    five9ConnectionError = true;
    currentPlaceholderMessage = null; // Force re-render

    if (hasFive9Tab) {
        // Show error with refresh button
        renderPlaceholder(PLACEHOLDER_MESSAGES.FIVE9_CONNECTION_ERROR);
    } else {
        // No Five9 tab - show the no tab message
        renderPlaceholder(PLACEHOLDER_MESSAGES.FIVE9_NO_TAB);
    }
    showPlaceholder();
    hideCallSection();
}

/**
 * Clears the Five9 connection error state
 */
export function clearConnectionError() {
    five9ConnectionError = false;
    currentPlaceholderMessage = null; // Allow next render
}

/**
 * Shows the call section (student card, call interface, etc.)
 */
function showCallSection() {
    const contactTab = document.getElementById('contact');
    if (!contactTab) return;

    Array.from(contactTab.children).forEach(child => {
        if (child.id === 'callTabPlaceholder') {
            child.style.display = 'none';
        } else if (child.classList.contains('section')) {
            child.style.display = '';
        }
    });
}

/**
 * Hides the call section
 */
function hideCallSection() {
    const contactTab = document.getElementById('contact');
    if (!contactTab) return;

    Array.from(contactTab.children).forEach(child => {
        if (child.id === 'callTabPlaceholder') {
            // Placeholder visibility managed separately
        } else if (child.classList.contains('section')) {
            child.style.display = 'none';
        }
    });
}

/**
 * Determines which placeholder message should be shown based on current state
 * Priority order (highest to lowest):
 * 1. Five9 Connection Error - highest priority when error occurred
 * 2. Five9 NO_TAB - always shows first regardless of student selection
 * 3. No student selected
 * 4. Five9 AWAITING_CONNECTION - only when student is selected
 *
 * @param {Object} state - Current state object
 * @param {Array} state.selectedQueue - Currently selected students
 * @param {boolean} state.debugMode - Whether debug/demo mode is enabled
 * @returns {Object} Result with showPlaceholder boolean and message config
 */
export async function determineCallTabState(state = {}) {
    const { selectedQueue = [], debugMode = false } = state;
    const hasStudentSelected = selectedQueue && selectedQueue.length > 0;

    // Check for connection error first - highest priority
    if (five9ConnectionError && !debugMode) {
        // Re-check if Five9 tab still exists
        const tabs = await chrome.tabs.query({ url: "https://app-scl.five9.com/*" });
        const hasFive9Tab = tabs.length > 0;

        return {
            showPlaceholder: true,
            message: hasFive9Tab ? PLACEHOLDER_MESSAGES.FIVE9_CONNECTION_ERROR : PLACEHOLDER_MESSAGES.FIVE9_NO_TAB
        };
    }

    // Check Five9 NO_TAB first - highest priority, shows regardless of student selection
    if (!debugMode) {
        const connectionState = await checkFive9ConnectionState();

        if (connectionState === FIVE9_CONNECTION_STATES.NO_TAB) {
            return {
                showPlaceholder: true,
                message: PLACEHOLDER_MESSAGES.FIVE9_NO_TAB
            };
        }

        // If no student is selected, show that message (second priority)
        if (!hasStudentSelected) {
            return {
                showPlaceholder: true,
                message: PLACEHOLDER_MESSAGES.NO_STUDENT_SELECTED
            };
        }

        // Student is selected, check if awaiting connection
        if (connectionState === FIVE9_CONNECTION_STATES.AWAITING_CONNECTION) {
            return {
                showPlaceholder: true,
                message: PLACEHOLDER_MESSAGES.FIVE9_AWAITING_AGENT
            };
        }
    } else {
        // Debug mode - only check student selection
        if (!hasStudentSelected) {
            return {
                showPlaceholder: true,
                message: PLACEHOLDER_MESSAGES.NO_STUDENT_SELECTED
            };
        }
    }

    // All checks passed - show the call section
    return {
        showPlaceholder: false,
        message: null
    };
}

/**
 * Updates the Call tab display based on current state
 * This is the main function to call when state changes
 *
 * @param {Object} state - Current state object
 * @param {Array} state.selectedQueue - Currently selected students
 * @param {boolean} state.debugMode - Whether debug/demo mode is enabled
 */
export async function updateCallTabDisplay(state = {}) {
    const result = await determineCallTabState(state);

    if (result.showPlaceholder) {
        renderPlaceholder(result.message);
        showPlaceholder();
        hideCallSection();
    } else {
        hidePlaceholder();
        showCallSection();
    }
}

/**
 * Forces a refresh of the Call tab display
 * Useful when Five9 connection state changes
 *
 * @param {Function} getSelectedQueue - Function that returns current selected queue
 * @param {Function} getDebugMode - Function that returns current debug mode state
 */
export async function refreshCallTabDisplay(getSelectedQueue, getDebugMode) {
    const selectedQueue = getSelectedQueue ? getSelectedQueue() : [];
    const debugMode = getDebugMode ? await getDebugMode() : false;

    await updateCallTabDisplay({ selectedQueue, debugMode });
}
