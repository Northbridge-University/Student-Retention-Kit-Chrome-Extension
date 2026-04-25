// [2025-12-17] Version 1.0 - Five9 Connector
// This script runs on https://*.five9.com/* to handle call automation.

// Configuration
const FIVE9_POLL_INTERVAL_MS = 2000;
const FIVE9_BASE_URL = window.location.origin;

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
// State values from Five9's per-call detail endpoint:
//   OFFERED → RINGING_ON_OTHER_SIDE → TALKING → WRAP_UP → FINISHED
let currentCallState = null;
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
        const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
        if (!metadataResp.ok) return;
        const metadata = await metadataResp.json();

        const interactionsResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
        if (!interactionsResp.ok) return;
        const interactions = await interactionsResp.json();

        const activeCallStub = interactions.find(i => i.channelType === 'CALL');

        let activeCall = null;
        if (activeCallStub) {
            // The list endpoint only returns {channelType, interactionId} — fetch the
            // per-call detail to get the actual `state` field (RINGING_ON_OTHER_SIDE,
            // TALKING, WRAP_UP, FINISHED, etc.) and any other call metadata.
            try {
                const detailResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions/calls/${activeCallStub.interactionId}`);
                if (detailResp.ok) {
                    activeCall = await detailResp.json();
                }
            } catch (_) {
                // If the detail fetch fails, fall back to the stub (no state available)
                activeCall = activeCallStub;
            }
        }

        if (activeCall) {
            const newState = activeCall.state;
            const newInteractionId = activeCall.interactionId || activeCall.id;

            const isNewCall = currentInteractionId !== newInteractionId;
            const isStateChange = !isNewCall && currentCallState !== newState;

            if (isNewCall) {
                // First time seeing this call — emit its initial state so listeners
                // (e.g. auto-end timer) can react to fresh-call appearances, not just
                // transitions within an already-tracked call.
                console.log(`SRK: New call detected: ${newInteractionId} initial state=${newState}`);
                chrome.runtime.sendMessage({
                    type: 'FIVE9_CALL_STATE_CHANGED',
                    previousState: null,
                    newState: newState,
                    interactionId: newInteractionId
                });
            } else if (isStateChange) {
                console.log(`SRK: Call state changed: ${currentCallState} -> ${newState}`);

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

                // If state changed to WRAP_UP from ACTIVE/TALKING, call was disconnected
                if ((currentCallState === 'ACTIVE' || currentCallState === 'TALKING') && newState === 'WRAP_UP') {
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

// On load, check if the station is already connected and notify the background.
// This handles the SSO re-login case where the agent session is still active
// but the extension lost track of the connection state.
(async function checkStationOnLoad() {
    try {
        const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
        if (!metadataResp.ok) return;
        const metadata = await metadataResp.json();

        const stationResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/station`);
        if (!stationResp.ok) return;
        const station = await stationResp.json();

        if (station && (station.stationType || station.stationId || station.type)) {
            console.log("SRK: Station already connected on load, notifying background:", station);
            chrome.runtime.sendMessage({ type: 'FIVE9_STATION_RESTART_VERIFIED' });
        }
    } catch (e) {
        // Silently fail — the restart button is still available as a fallback
    }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'executeFive9Call') {
        handleFive9Call(request.phoneNumber, sendResponse);
        return true; // Keep channel open for async response
    }
    if (request.type === 'executeFive9Hangup') {
        handleFive9Hangup(request.dispositionType, sendResponse);
        return true; // Keep channel open
    }
    if (request.type === 'executeFive9SetPlaybackVolume') {
        setFive9PlaybackVolume(request.percent).then(result => sendResponse(result)).catch(e => sendResponse({success: false, error: e.message}));
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
        const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
        if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
        const metadata = await metadataResp.json();
        
        const url = `${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions/make_external_call`;
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

        const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
        if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
        const metadata = await metadataResp.json();

        // Fetch active interactions
        const interactionsResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
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
        const disconnectUrl = `${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions/calls/${activeCall.interactionId}/disconnect`;
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

            const disposeUrl = `${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions/calls/${activeCall.interactionId}/dispose`;
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
                const interactionsResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
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

        const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
        if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
        const metadata = await metadataResp.json();

        // Fetch recently ended interactions (they may still be disposable)
        const interactionsResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions`);
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

        const disposeUrl = `${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/interactions/calls/${recentCall.interactionId}/dispose`;
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
 * Dispatches a proper click event on an element (mousedown → mouseup → click)
 * to trigger framework event handlers (Angular/React) that may not fire from .click()
 * @param {HTMLElement} el - The element to click
 */
function dispatchRealClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
}

/**
 * Polls the Five9 station/agent endpoint to verify the station reconnected.
 * Checks every 2s for up to maxWaitMs. Sends progress updates back to the extension.
 * @param {number} maxWaitMs - Maximum time to wait (default 20s)
 * @returns {Promise<{connected: boolean}>}
 */
async function waitForStationReconnect(maxWaitMs = 20000) {
    const pollInterval = 2000;
    const maxAttempts = Math.ceil(maxWaitMs / pollInterval);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, pollInterval));

        try {
            const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
            if (!metadataResp.ok) continue;
            const metadata = await metadataResp.json();

            // Check station status — if we can fetch the agent's station info,
            // and the stationId/type exists, the station is connected
            const stationResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/station`);
            if (stationResp.ok) {
                const station = await stationResp.json();
                console.log(`SRK: Station poll #${attempt} — station:`, station);

                // Station has reconnected if it has a valid type and id
                if (station && (station.stationType || station.stationId || station.type)) {
                    console.log("SRK: Station reconnected confirmed!");
                    return { connected: true };
                }
            }
        } catch (e) {
            console.log(`SRK: Station poll #${attempt} error:`, e.message);
        }

        // Send progress update to sidepanel
        try {
            chrome.runtime.sendMessage({
                type: 'FIVE9_RESTART_PROGRESS',
                attempt,
                maxAttempts
            });
        } catch (_) { /* ignore if sidepanel isn't listening */ }
    }

    console.warn("SRK: Station reconnect verification timed out");
    return { connected: false };
}

/**
 * Sets Five9's playback (speaker) volume to a target percentage (0-100).
 *
 * Five9 has no public volume API — its softphone uses an opaque global f9phone
 * object and a Marionette event bus whose command names aren't documented.
 * What IS stable is the volume popover's DOM:
 *   - StationToolbar-playback_volume-node: SPAN that opens the popover
 *   - StationVolumePopover-mute_playback-button: toggles mute (0%)
 *   - StationVolumePopover-max_volume_playback-button: sets 100%
 *   - A [role="slider"] inside the popover with aria-valuenow as current value
 *
 * Strategy:
 *   - Target 0:   click mute button (if not already muted)
 *   - Target 100: click max button (also unmutes)
 *   - Otherwise:  open popover, focus slider, send keyboard events to walk the
 *                 value (PageUp/PageDown = ±10, ArrowUp/ArrowDown = ±1).
 *
 * Each keyboard event triggers Five9's internal IPC, so we batch using
 * page-up steps where possible to minimize round-trips.
 *
 * @param {number} percent - target volume 0-100
 * @returns {Promise<{success: boolean, applied?: number, error?: string}>}
 */
async function setFive9PlaybackVolume(percent) {
    const target = Math.max(0, Math.min(100, Math.round(percent)));

    // 100%: max button is the cleanest path (also unmutes)
    if (target === 100) {
        const popoverWasOpen = !!document.getElementById('StationVolumePopover-container-node');
        if (!popoverWasOpen) {
            const trigger = document.getElementById('StationToolbar-playback_volume-node');
            if (!trigger) return { success: false, error: 'volume trigger not found' };
            dispatchRealClick(trigger);
            await new Promise(r => setTimeout(r, 150));
        }
        const maxBtn = document.getElementById('StationVolumePopover-max_volume_playback-button');
        if (!maxBtn) return { success: false, error: 'max button not found' };
        dispatchRealClick(maxBtn);
        if (!popoverWasOpen) {
            await new Promise(r => setTimeout(r, 100));
            // Click trigger again to close
            const trigger = document.getElementById('StationToolbar-playback_volume-node');
            if (trigger) dispatchRealClick(trigger);
        }
        return { success: true, applied: 100 };
    }

    // 0%: mute button
    if (target === 0) {
        const popoverWasOpen = !!document.getElementById('StationVolumePopover-container-node');
        if (!popoverWasOpen) {
            const trigger = document.getElementById('StationToolbar-playback_volume-node');
            if (!trigger) return { success: false, error: 'volume trigger not found' };
            dispatchRealClick(trigger);
            await new Promise(r => setTimeout(r, 150));
        }
        const muteBtn = document.getElementById('StationVolumePopover-mute_playback-button');
        if (!muteBtn) return { success: false, error: 'mute button not found' };
        // The mute button toggles. Click only if not already muted.
        // Detect mute state via aria-pressed / class. If undetectable, click anyway —
        // worst case we briefly unmute and the next state change will fix it.
        const alreadyMuted = muteBtn.getAttribute('aria-pressed') === 'true' ||
                             muteBtn.classList.contains('active') ||
                             muteBtn.classList.contains('muted');
        if (!alreadyMuted) {
            dispatchRealClick(muteBtn);
        }
        if (!popoverWasOpen) {
            await new Promise(r => setTimeout(r, 100));
            const trigger = document.getElementById('StationToolbar-playback_volume-node');
            if (trigger) dispatchRealClick(trigger);
        }
        return { success: true, applied: 0 };
    }

    // Arbitrary value: walk the slider with keyboard events
    const popoverWasOpen = !!document.getElementById('StationVolumePopover-container-node');
    if (!popoverWasOpen) {
        const trigger = document.getElementById('StationToolbar-playback_volume-node');
        if (!trigger) return { success: false, error: 'volume trigger not found' };
        dispatchRealClick(trigger);
        await new Promise(r => setTimeout(r, 150));
    }

    // The first slider in the popover is playback (index 0); capture is index 1.
    const sliders = document.querySelectorAll('[role="slider"]');
    const slider = sliders[0];
    if (!slider) {
        if (!popoverWasOpen) {
            const trigger = document.getElementById('StationToolbar-playback_volume-node');
            if (trigger) dispatchRealClick(trigger);
        }
        return { success: false, error: 'playback slider not found' };
    }

    const current = parseInt(slider.getAttribute('aria-valuenow') || '0', 10);
    let diff = target - current;

    if (diff !== 0) {
        slider.focus();
        const sendKey = (key) => slider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        const sign = diff > 0 ? 1 : -1;
        const bigKey = diff > 0 ? 'PageUp' : 'PageDown';
        const smallKey = diff > 0 ? 'ArrowUp' : 'ArrowDown';
        let remaining = Math.abs(diff);
        while (remaining >= 10) {
            sendKey(bigKey);
            remaining -= 10;
            await new Promise(r => setTimeout(r, 25));
        }
        while (remaining > 0) {
            sendKey(smallKey);
            remaining -= 1;
            await new Promise(r => setTimeout(r, 25));
        }
    }

    if (!popoverWasOpen) {
        await new Promise(r => setTimeout(r, 100));
        const trigger = document.getElementById('StationToolbar-playback_volume-node');
        if (trigger) dispatchRealClick(trigger);
    }
    return { success: true, applied: target };
}

/**
 * Handles restarting the Five9 station to re-establish connection.
 * First checks if the station is already connected (common after SSO re-login),
 * and if so skips the restart and just notifies the background.
 * Uses proper event dispatch for button clicks and actively polls to
 * verify the station reconnected before reporting success.
 */
async function handleFive9RestartStation(sendResponse) {
    try {
        console.log("SRK: Restarting Five9 station...");

        // --- PRE-CHECK: Is the station already connected? ---
        // This handles the case where the user closed the Five9 tab, reopened via SSO,
        // and the agent session is still active — no restart needed.
        try {
            const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
            if (metadataResp.ok) {
                const metadata = await metadataResp.json();
                const stationResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/station`);
                if (stationResp.ok) {
                    const station = await stationResp.json();
                    if (station && (station.stationType || station.stationId || station.type)) {
                        console.log("SRK: Station is already connected, skipping restart:", station);

                        // Notify background so it updates connection state
                        try {
                            chrome.runtime.sendMessage({ type: 'FIVE9_STATION_RESTART_VERIFIED' });
                        } catch (_) { /* ignore */ }

                        sendResponse({ success: true, method: 'already_connected', verified: true });
                        return;
                    }
                }
            }
        } catch (e) {
            console.log("SRK: Pre-check failed, proceeding with restart:", e.message);
        }

        let restartTriggered = false;
        let method = 'none';

        // --- STRATEGY 1: Click the native restart button ---
        const restartButton = document.getElementById('StationConnectedPopover-restart_station-button');
        if (restartButton) {
            console.log("SRK: Found native restart button, dispatching click...");
            dispatchRealClick(restartButton);
            restartTriggered = true;
            method = 'button';
        }

        // --- STRATEGY 2: Open the station popover first, then click ---
        if (!restartTriggered) {
            const stationIndicator = document.querySelector('[data-f9-template="station-connected-indicator"]') ||
                                     document.querySelector('.station-connected-indicator') ||
                                     document.querySelector('#station-indicator');

            if (stationIndicator) {
                console.log("SRK: Opening station popover...");
                dispatchRealClick(stationIndicator);
                await new Promise(r => setTimeout(r, 500));

                const restartBtnAfterOpen = document.getElementById('StationConnectedPopover-restart_station-button');
                if (restartBtnAfterOpen) {
                    console.log("SRK: Found restart button after opening popover, dispatching click...");
                    dispatchRealClick(restartBtnAfterOpen);
                    restartTriggered = true;
                    method = 'button';
                }
            }
        }

        // --- STRATEGY 3: Fallback to REST API ---
        if (!restartTriggered) {
            console.log("SRK: Native button not found, falling back to API...");

            const metadataResp = await fetch(`${FIVE9_BASE_URL}/appsvcs/rs/svc/auth/metadata`);
            if (!metadataResp.ok) throw new Error("Could not fetch User Metadata");
            const metadata = await metadataResp.json();

            const restartUrl = `${FIVE9_BASE_URL}/appsvcs/rs/svc/agents/${metadata.userId}/station/restart`;

            const restartResp = await fetch(restartUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ value: null })
            });

            if (restartResp.ok || restartResp.status === 204) {
                restartTriggered = true;
                method = 'api';
            } else {
                const errorText = await restartResp.text();
                console.error("SRK Station Restart API Error:", restartResp.status, errorText);
                sendResponse({ success: false, error: `${restartResp.status} - ${errorText}` });
                return;
            }
        }

        console.log(`SRK: Restart triggered via ${method}, now verifying reconnection...`);

        // --- ACTIVELY POLL to verify station reconnected ---
        const result = await waitForStationReconnect(20000);

        if (result.connected) {
            console.log("SRK: Station restart verified — connection confirmed");

            // Notify background to update Five9 connection state immediately,
            // since the webRequest listener may not fire after a restart
            try {
                chrome.runtime.sendMessage({
                    type: 'FIVE9_STATION_RESTART_VERIFIED'
                });
            } catch (_) { /* ignore */ }

            sendResponse({ success: true, method, verified: true });
        } else {
            console.warn("SRK: Station restart sent but could not verify reconnection");
            sendResponse({ success: true, method, verified: false, warning: "Restart triggered but reconnection not confirmed within timeout" });
        }

    } catch (error) {
        console.error("SRK Station Restart Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}