// [2025-12-17] Version 1.0 - Five9 Connector
// This script runs on https://app-scl.five9.com/* to handle call automation.

// Configuration
const FIVE9_POLL_INTERVAL_MS = 2000;

// Disposition code constants
const DISPOSITION_CODES = {
    "Left Voicemail": "300000000000046",
    "Service Completed": "300000000000043",
    "Outbound Error": "300000000000271",
    "Follow Up": "300000000000048",
    "No Answer": "",        // TODO: Add Five9 disposition code
    "Disconnected": ""      // TODO: Add Five9 disposition code
};

// Call state tracking for monitoring
let currentCallState = null; // null = no call, 'ACTIVE' = in call, 'WRAP_UP' = awaiting disposition
let currentInteractionId = null;
let callStateMonitorInterval = null;

/**
 * Gets the disposition code for a given disposition type
 * @param {string} dispositionType - The disposition type (e.g., "Left Voicemail")
 * @returns {string|null} The Five9 disposition code, or null if not found/empty
 */
function getDispositionCode(dispositionType) {
    const code = DISPOSITION_CODES[dispositionType];
    return (code && code !== "") ? code : null;
}

/**
 * Monitors call state changes and notifies the extension
 */
async function monitorCallState() {
    try {
        const metadataResp = await fetch("https://app-scl.five9.com/appsvcs/rs/svc/auth/metadata");
        if (!metadataResp.ok) return;
        const metadata = await metadataResp.json();

        const interactionsResp = await fetch(`https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
        if (!interactionsResp.ok) return;
        const interactions = await interactionsResp.json();

        const activeCall = interactions.find(i => i.channelType === 'CALL');

        if (activeCall) {
            const newState = activeCall.state; // ACTIVE, WRAP_UP, FINISHED, etc.
            const newInteractionId = activeCall.interactionId;

            // Detect state changes
            if (currentInteractionId === newInteractionId && currentCallState !== newState) {
                console.log(`SRK: Call state changed: ${currentCallState} -> ${newState}`);

                // Notify extension of state change
                chrome.runtime.sendMessage({
                    type: 'FIVE9_CALL_STATE_CHANGED',
                    previousState: currentCallState,
                    newState: newState,
                    interactionId: newInteractionId
                });

                // If state changed to FINISHED, the disposition was set
                if (newState === 'FINISHED') {
                    console.log("SRK: Disposition was set (detected FINISHED state)");
                    chrome.runtime.sendMessage({
                        type: 'FIVE9_DISPOSITION_SET',
                        interactionId: newInteractionId
                    });
                }

                // If state changed to WRAP_UP from ACTIVE, call was disconnected
                if (currentCallState === 'ACTIVE' && newState === 'WRAP_UP') {
                    console.log("SRK: Call disconnected (detected WRAP_UP state)");
                    chrome.runtime.sendMessage({
                        type: 'FIVE9_CALL_DISCONNECTED',
                        interactionId: newInteractionId
                    });
                }
            }

            currentCallState = newState;
            currentInteractionId = newInteractionId;
        } else {
            // No active call
            if (currentCallState !== null) {
                console.log("SRK: No active call (call ended or disposed)");

                // If we had a call before and now we don't, disposition was completed
                if (currentCallState === 'WRAP_UP') {
                    chrome.runtime.sendMessage({
                        type: 'FIVE9_DISPOSITION_SET',
                        interactionId: currentInteractionId
                    });
                }

                chrome.runtime.sendMessage({
                    type: 'FIVE9_CALL_STATE_CHANGED',
                    previousState: currentCallState,
                    newState: null,
                    interactionId: currentInteractionId
                });
            }
            currentCallState = null;
            currentInteractionId = null;
        }
    } catch (error) {
        // Silently fail - don't spam console during polling
    }
}

/**
 * Starts monitoring call state
 */
function startCallStateMonitor() {
    if (callStateMonitorInterval) return; // Already running

    console.log("SRK: Starting call state monitor");
    callStateMonitorInterval = setInterval(monitorCallState, FIVE9_POLL_INTERVAL_MS);
    // Run immediately too
    monitorCallState();
}

/**
 * Stops monitoring call state
 */
function stopCallStateMonitor() {
    if (callStateMonitorInterval) {
        clearInterval(callStateMonitorInterval);
        callStateMonitorInterval = null;
        console.log("SRK: Stopped call state monitor");
    }
}

// Start monitoring when the content script loads
startCallStateMonitor();

console.log("SRK: Five9 Connector Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'executeFive9Call') {
        handleFive9Call(request.phoneNumber, sendResponse);
        return true; // Keep channel open for async response
    }
    if (request.type === 'executeFive9Hangup') {
        handleFive9Hangup(request.dispositionType, sendResponse);
        return true; // Keep channel open
    }
    if (request.type === 'executeFive9DisposeOnly') {
        handleFive9DisposeOnly(request.dispositionType, sendResponse);
        return true; // Keep channel open
    }
    if (request.type === 'executeFive9RestartStation') {
        handleFive9RestartStation(sendResponse);
        return true; // Keep channel open
    }
});

async function handleFive9Call(phoneNumber, sendResponse) {
    try {
        console.log(`SRK: Dialing ${phoneNumber}...`);
        const metadataResp = await fetch("https://app-scl.five9.com/appsvcs/rs/svc/auth/metadata");
        if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
        const metadata = await metadataResp.json();
        
        const url = `https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions/make_external_call`;
        const payload = {
            "number": phoneNumber,
            "skipDNCCheck": false,
            "checkMultipleContacts": true,
            "campaignId": "300000000000483" // Ensure this Campaign ID is correct for your org
        };

        const callResp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (callResp.ok) sendResponse({ success: true });
        else sendResponse({ success: false, error: `${callResp.status} - ${await callResp.text()}` });

    } catch (error) {
        console.error("SRK Call Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleFive9Hangup(dispositionType, sendResponse) {
    try {
        console.log("SRK: Attempting TWO-STEP hangup...");
        console.log("SRK: Disposition type:", dispositionType);

        // Get the disposition code from constants
        const dispositionCode = getDispositionCode(dispositionType);
        console.log("SRK: Disposition code:", dispositionCode);

        const metadataResp = await fetch("https://app-scl.five9.com/appsvcs/rs/svc/auth/metadata");
        if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
        const metadata = await metadataResp.json();

        // Fetch active interactions
        const interactionsResp = await fetch(`https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
        if (!interactionsResp.ok) throw new Error("Could not fetch active interactions");
        const interactions = await interactionsResp.json();

        const activeCall = interactions.find(i => i.channelType === 'CALL');

        // *** ROBUSTNESS FIX: Handle Manual Hangup ***
        if (!activeCall) {
            console.warn("SRK: No active CALL found (assuming already ended).");
            // We return SUCCESS so the automation continues to the next number
            sendResponse({ success: true, warning: "Call was already ended manually." });
            return;
        }

        console.log(`SRK: STEP 1 - Disconnecting interaction ${activeCall.interactionId}...`);

        // STEP 1: DISCONNECT
        const disconnectUrl = `https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions/calls/${activeCall.interactionId}/disconnect`;
        const disconnectResp = await fetch(disconnectUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" }
        });

        if (!disconnectResp.ok) {
             console.warn("Disconnect step warning:", disconnectResp.status);
        }

        await new Promise(r => setTimeout(r, 500));

        // STEP 2: DISPOSE (only if we have a valid disposition code)
        if (dispositionCode) {
            console.log(`SRK: STEP 2 - Disposing interaction with code ${dispositionCode}...`);

            const disposeUrl = `https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions/calls/${activeCall.interactionId}/dispose`;
            const payload = { "dispositionId": dispositionCode };

            const disposeResp = await fetch(disposeUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (disposeResp.ok) {
                console.log("SRK: Hangup Complete.");

                // Get the interaction state after dispose
                const interactionData = await disposeResp.json();
                const state = interactionData?.state || 'UNKNOWN';
                console.log("SRK: Interaction state after dispose:", state);

                sendResponse({ success: true, state: state });
            } else {
                const errorText = await disposeResp.text();
                console.error("Dispose Error:", disposeResp.status, errorText);

                if (disposeResp.status === 404 || disposeResp.status === 435) {
                    sendResponse({ success: true, state: 'UNKNOWN' });
                } else {
                    sendResponse({ success: false, error: `${disposeResp.status} - ${errorText}` });
                }
            }
        } else {
            console.warn("SRK: No disposition code available - skipping dispose step.");
            console.warn("SRK: Call disconnected but not disposed. Add disposition code to constants/dispositions.js");

            // Fetch interaction to get current state (should be WRAP_UP)
            try {
                const interactionsResp = await fetch(`https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
                if (interactionsResp.ok) {
                    const interactions = await interactionsResp.json();
                    const recentCall = interactions.find(i => i.channelType === 'CALL');
                    const state = recentCall?.state || 'WRAP_UP';
                    console.log("SRK: Interaction state after disconnect (no dispose):", state);
                    sendResponse({ success: true, warning: "No disposition code - call disconnected only", state: state });
                } else {
                    sendResponse({ success: true, warning: "No disposition code - call disconnected only", state: 'WRAP_UP' });
                }
            } catch (e) {
                sendResponse({ success: true, warning: "No disposition code - call disconnected only", state: 'WRAP_UP' });
            }
        }

    } catch (error) {
        console.error("SRK Hangup Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handles dispose-only operation (when call already disconnected)
 * This is used when user ends call first, then selects disposition
 */
async function handleFive9DisposeOnly(dispositionType, sendResponse) {
    try {
        console.log("SRK: Attempting DISPOSE-ONLY operation...");
        console.log("SRK: Disposition type:", dispositionType);

        // Get the disposition code from constants
        const dispositionCode = getDispositionCode(dispositionType);
        console.log("SRK: Disposition code:", dispositionCode);

        if (!dispositionCode) {
            console.warn("SRK: No disposition code available - cannot dispose.");
            sendResponse({ success: false, error: "No disposition code for: " + dispositionType });
            return;
        }

        const metadataResp = await fetch("https://app-scl.five9.com/appsvcs/rs/svc/auth/metadata");
        if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
        const metadata = await metadataResp.json();

        // Fetch recently ended interactions (they may still be disposable)
        const interactionsResp = await fetch(`https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
        if (!interactionsResp.ok) throw new Error("Could not fetch interactions");
        const interactions = await interactionsResp.json();

        // Look for the most recent call interaction (may be in WRAP_UP state)
        const recentCall = interactions.find(i => i.channelType === 'CALL');

        if (!recentCall) {
            console.warn("SRK: No recent CALL found to dispose.");
            sendResponse({ success: false, error: "No recent call found to dispose" });
            return;
        }

        console.log(`SRK: Disposing interaction ${recentCall.interactionId} with code ${dispositionCode}...`);

        const disposeUrl = `https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/interactions/calls/${recentCall.interactionId}/dispose`;
        const payload = { "dispositionId": dispositionCode };

        const disposeResp = await fetch(disposeUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (disposeResp.ok) {
            console.log("SRK: Dispose-only Complete.");

            // Get the interaction state after dispose
            const interactionData = await disposeResp.json();
            const state = interactionData?.state || 'UNKNOWN';
            console.log("SRK: Interaction state after dispose-only:", state);

            sendResponse({ success: true, state: state });
        } else {
            const errorText = await disposeResp.text();
            console.error("Dispose Error:", disposeResp.status, errorText);

            if (disposeResp.status === 404 || disposeResp.status === 435) {
                console.warn("SRK: Interaction may have already been disposed or timed out.");
                sendResponse({ success: true, warning: "Interaction already disposed or not found", state: 'UNKNOWN' });
            } else {
                sendResponse({ success: false, error: `${disposeResp.status} - ${errorText}` });
            }
        }

    } catch (error) {
        console.error("SRK Dispose-Only Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handles restarting the Five9 station to re-establish connection
 * Tries to click the native Five9 button first, falls back to API
 */
async function handleFive9RestartStation(sendResponse) {
    try {
        console.log("SRK: Restarting Five9 station...");

        // First, try to click the native Five9 restart button (triggers full SIP re-registration)
        const restartButton = document.getElementById('StationConnectedPopover-restart_station-button');
        if (restartButton) {
            console.log("SRK: Found native restart button, clicking...");
            restartButton.click();
            // Give it a moment to process
            await new Promise(r => setTimeout(r, 500));
            console.log("SRK: Native restart button clicked");
            sendResponse({ success: true, method: 'button' });
            return;
        }

        // If button not found (popover not open), try to open the station popover first
        const stationIndicator = document.querySelector('[data-f9-template="station-connected-indicator"]') ||
                                 document.querySelector('.station-connected-indicator') ||
                                 document.querySelector('#station-indicator');

        if (stationIndicator) {
            console.log("SRK: Opening station popover...");
            stationIndicator.click();
            await new Promise(r => setTimeout(r, 300));

            // Now try to find the restart button again
            const restartBtnAfterOpen = document.getElementById('StationConnectedPopover-restart_station-button');
            if (restartBtnAfterOpen) {
                console.log("SRK: Found restart button after opening popover, clicking...");
                restartBtnAfterOpen.click();
                await new Promise(r => setTimeout(r, 500));
                console.log("SRK: Native restart button clicked");
                sendResponse({ success: true, method: 'button' });
                return;
            }
        }

        // Fallback to API call if button not found
        console.log("SRK: Native button not found, falling back to API...");

        const metadataResp = await fetch("https://app-scl.five9.com/appsvcs/rs/svc/auth/metadata");
        if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
        const metadata = await metadataResp.json();

        const restartUrl = `https://app-scl.five9.com/appsvcs/rs/svc/agents/${metadata.userId}/station/restart`;

        const restartResp = await fetch(restartUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: null })
        });

        if (restartResp.ok || restartResp.status === 204) {
            console.log("SRK: Station restart API call successful");
            sendResponse({ success: true, method: 'api' });
        } else {
            const errorText = await restartResp.text();
            console.error("SRK Station Restart Error:", restartResp.status, errorText);
            sendResponse({ success: false, error: `${restartResp.status} - ${errorText}` });
        }

    } catch (error) {
        console.error("SRK Station Restart Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}