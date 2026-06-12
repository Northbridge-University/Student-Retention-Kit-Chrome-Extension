// Excel Integration - Monitors Excel connection status and displays status indicator
import { STORAGE_KEYS, MESSAGE_TYPES } from '../constants/index.js';

let excelConnectionCheckInterval = null;
let excelHeartbeatInterval = null;
let lastExcelConnectionState = 'disconnected'; // 'disconnected', 'searching', 'connected'
let lastOfficeAddinPing = 0; // Timestamp of last Office Add-in communication
let lastConnectorHeartbeat = 0; // Timestamp of last connector heartbeat
// The status only reads "connected" while heartbeat pongs keep arriving, so
// the panel pings the add-in every HEARTBEAT_INTERVAL. The timeout is more
// than twice the interval so a single lost pong doesn't flicker the status.
const CONNECTION_TIMEOUT = 12000; // ms without add-in traffic = searching
const HEARTBEAT_INTERVAL = 5000; // ms between SRK_PING heartbeats

/**
 * Excel/SharePoint URL patterns to check for
 */
const EXCEL_URL_PATTERNS = [
    "https://excel.office.com/*",
    "https://*.officeapps.live.com/*",
    "https://*.sharepoint.com/*"
];

/**
 * Checks if Excel/SharePoint tab is currently open
 * @returns {Promise<boolean>}
 */
export async function checkExcelTabOpen() {
    try {
        const tabs = await chrome.tabs.query({ url: EXCEL_URL_PATTERNS });
        return tabs.length > 0;
    } catch (error) {
        console.error("Error checking Excel tab:", error);
        return false;
    }
}

/**
 * Checks if the Office add-in is actually connected by analyzing connector messages
 * @returns {Promise<'connected'|'searching'|'disconnected'>}
 */
export async function checkExcelConnectionStatus() {
    try {
        const hasExcelTab = await checkExcelTabOpen();

        if (!hasExcelTab) {
            // Reset connection state when tabs close
            if (lastOfficeAddinPing > 0) {
                lastOfficeAddinPing = 0;
                console.log('📊 Excel tab closed - resetting connection state');
            }
            return 'disconnected';
        }

        const now = Date.now();
        const hasRecentHeartbeat = (now - lastConnectorHeartbeat) < CONNECTION_TIMEOUT;

        if (!hasRecentHeartbeat) {
            // Excel tab is open but no connector heartbeat
            return 'searching';
        }

        // If we've ever received an add-in ping (and heartbeat is active), consider it connected
        // Office Add-in typically pings once on load, not continuously
        if (lastOfficeAddinPing > 0) {
            return 'connected';
        }

        // Connector is active but Office Add-in has never connected
        return 'searching';

    } catch (error) {
        console.error("Error checking Excel connection status:", error);
        return 'disconnected';
    }
}

/**
 * Handles incoming messages from the Excel connector
 * @param {object} message - The message from the connector
 */
function handleConnectorMessage(message) {
    if (!message || !message.type) return;

    const now = Date.now();

    switch (message.type) {
        case MESSAGE_TYPES.SRK_CONNECTOR_ACTIVE:
            lastConnectorHeartbeat = now;
            console.log('📊 Excel connector activated');
            break;

        case MESSAGE_TYPES.SRK_OFFICE_ADDIN_CONNECTED:
            lastOfficeAddinPing = now;
            lastConnectorHeartbeat = now;
            console.log('✅ Office Add-in connected to Excel connector');
            break;

        case MESSAGE_TYPES.SRK_TASKPANE_PONG:
            lastOfficeAddinPing = now;
            lastConnectorHeartbeat = now;
            console.log('🏓 Received pong from Office Add-in');
            break;

        case MESSAGE_TYPES.SRK_PONG:
            lastOfficeAddinPing = now;
            lastConnectorHeartbeat = now;
            // Pongs arrive every HEARTBEAT_INTERVAL while connected; only log
            // the ones that change the status (first contact / recovery).
            if (lastExcelConnectionState !== 'connected') {
                console.log('🏓 Received SRK_PONG from Office Add-in:', message);
                if (message.timestamp && message.source) {
                    console.log(`   Timestamp: ${message.timestamp}`);
                    console.log(`   Source: ${message.source}`);
                }
            }
            break;
    }

    // Trigger immediate status update
    updateExcelConnectionIndicator();
}

/**
 * Updates the Excel connection status indicator in the settings page
 */
export async function updateExcelConnectionIndicator() {
    const statusDot = document.getElementById('excelStatusDot');
    const statusText = document.getElementById('excelStatusText');

    if (!statusDot || !statusText) return;

    const status = await checkExcelConnectionStatus();

    // Update UI based on status
    switch (status) {
        // Colors match the other connection statuses in the settings page
        // (Canvas/Five9/Power Automate in connections-modal.js): green text +
        // #10b981 dot when connected, #f59e0b for in-between states.
        case 'connected':
            statusDot.style.backgroundColor = '#10b981';
            statusDot.title = 'Connected';
            statusText.textContent = 'Connected';
            statusText.style.color = 'green';
            break;

        case 'searching':
            statusDot.style.backgroundColor = '#f59e0b';
            statusDot.title = 'Searching...';
            statusText.textContent = 'Searching...';
            statusText.style.color = '#f59e0b';
            break;

        case 'disconnected':
        default:
            statusDot.style.backgroundColor = '#ef4444'; // Red
            statusDot.title = 'Disconnected';
            statusText.textContent = 'Disconnected';
            statusText.style.color = 'var(--text-secondary)';
            break;
    }

    // Log connection state changes
    if (status !== lastExcelConnectionState) {
        lastExcelConnectionState = status;
        console.log(`📊 Excel connection status changed to: ${status}`);
    }
}

/**
 * Periodic heartbeat ping to the Office Add-in. Same SRK_PING round-trip as
 * sendConnectionPing (relayed by the background to the Excel tab, answered
 * by the add-in's commands runtime with SRK_PONG), but flagged as a
 * heartbeat so the relay points skip their per-message logging — this fires
 * every few seconds for the whole lifetime of the panel.
 */
async function sendHeartbeatPing() {
    try {
        if (!(await checkExcelTabOpen())) return;

        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.SRK_PING,
            heartbeat: true,
            payload: { type: MESSAGE_TYPES.SRK_PING, heartbeat: true }
        }).catch(() => {
            // Background not ready; the next heartbeat retries.
        });
    } catch (error) {
        // tabs.query failed; the next heartbeat retries.
    }
}

/**
 * Starts monitoring Excel connection status
 * Checks every 3 seconds, pings the add-in every 5 seconds, and listens for
 * connector messages
 */
export function startExcelConnectionMonitor() {
    // Clear any existing intervals
    if (excelConnectionCheckInterval) {
        clearInterval(excelConnectionCheckInterval);
    }
    if (excelHeartbeatInterval) {
        clearInterval(excelHeartbeatInterval);
    }

    // Set up message listener for connector messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        handleConnectorMessage(message);
    });

    // Initial check
    updateExcelConnectionIndicator();

    // Monitor every 3 seconds
    excelConnectionCheckInterval = setInterval(() => {
        updateExcelConnectionIndicator();
    }, 3000);

    // Keep the add-in heartbeat fresh; without this the status decays to
    // "Searching..." CONNECTION_TIMEOUT after the initial panel-open ping
    // even though Excel and the add-in are still alive.
    excelHeartbeatInterval = setInterval(sendHeartbeatPing, HEARTBEAT_INTERVAL);

    console.log('🔄 Excel connection monitor started');
}

/**
 * Stops monitoring Excel connection status
 */
export function stopExcelConnectionMonitor() {
    if (excelConnectionCheckInterval) {
        clearInterval(excelConnectionCheckInterval);
        excelConnectionCheckInterval = null;
    }
    if (excelHeartbeatInterval) {
        clearInterval(excelHeartbeatInterval);
        excelHeartbeatInterval = null;
    }
    console.log('⏹️ Excel connection monitor stopped');
}

/**
 * Sends a ping to the Excel add-in to check connectivity
 * This is called when the taskpane opens
 */
export async function pingExcelAddIn() {
    try {
        const hasExcelTab = await checkExcelTabOpen();

        if (!hasExcelTab) {
            console.log('🏓 No Excel tab open, skipping ping');
            return;
        }

        console.log('🏓 Sending ping to Excel Add-in...');

        // Send ping message to background/content script which will relay to Office Add-in
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.SRK_TASKPANE_PING,
            timestamp: Date.now()
        }).catch((error) => {
            console.log('🏓 Ping failed (extension context may not be ready):', error.message);
        });

    } catch (error) {
        console.error('🏓 Error sending ping to Excel Add-in:', error);
    }
}

/**
 * Sends a simple SRK_PING message to the Office add-in to test connection
 * This is called when the side panel opens to instantly check connectivity
 */
export async function sendConnectionPing() {
    try {
        const hasExcelTab = await checkExcelTabOpen();

        if (!hasExcelTab) {
            console.log('🏓 No Excel tab open, skipping SRK_PING');
            return;
        }

        console.log('🏓 Sending SRK_PING to Office Add-in...');

        // Send ping message to background/content script which will relay to Office Add-in
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.SRK_PING,
            payload: { type: MESSAGE_TYPES.SRK_PING }
        }).catch((error) => {
            console.log('🏓 SRK_PING failed (extension context may not be ready):', error.message);
        });

    } catch (error) {
        console.error('🏓 Error sending SRK_PING to Office Add-in:', error);
    }
}

/**
 * Clean up on page unload
 */
export function cleanup() {
    stopExcelConnectionMonitor();
}
