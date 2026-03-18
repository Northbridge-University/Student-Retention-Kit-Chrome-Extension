---
name: five9-communication
description: How the Chrome extension communicates with Five9 — detecting login state, starting/ending calls, and setting dispositions
---

# Five9 Communication

How the Chrome extension detects Five9 login state, starts/ends calls, and sets dispositions.

## Architecture Overview

Communication follows a three-hop messaging chain:

```
Sidepanel  →  Background (service worker)  →  Content Script (five9Connector.js on *.five9.com)
           ←  (sendResponse / sendMessage)  ←
```

The content script runs on the Five9 domain and makes authenticated REST API calls using the
agent's existing Five9 session cookies. The background script routes messages between the
sidepanel and whichever tab is running Five9. The sidepanel exposes UI controls and state.

### Key Files

| File | Role |
|------|------|
| `src/content/five9Connector.js` | Runs on `*.five9.com` — all Five9 REST calls, call monitoring, disposition |
| `src/background/background.js` | Routes messages, monitors Five9 network activity and tab lifecycle |
| `src/sidepanel/callManager.js` | Call UI logic — dial, hangup, disposition buttons, automation timers |
| `src/sidepanel/five9-integration.js` | Connection-status checking and call-state listeners in the sidepanel |
| `src/constants/dispositions.js` | Maps disposition names → Five9 disposition IDs |
| `src/constants/index.js` | `FIVE9_CONNECTION_STATES` enum |

---

## Detecting Five9 Login / Connection

Three layers determine whether the user is on Five9 and logged in:

### 1. Tab Detection

```js
chrome.tabs.query({ url: "https://*.five9.com/*" })
```

If no matching tab exists → state = `NO_TAB`.
A `chrome.tabs.onRemoved` listener resets state when the Five9 tab closes (`background.js:1128`).

### 2. Network Activity Monitoring

The background script uses `chrome.webRequest.onCompleted` to watch for:

```
POST https://*.five9.com/*/voice-events/agent-connection  →  status 204
```

A successful response proves the agent's voice channel is active.
State moves to `ACTIVE_CONNECTION` and is persisted in `chrome.storage.local`.

### 3. Content Script Station Check (on load)

When `five9Connector.js` loads it fetches:

1. `GET /appsvcs/rs/svc/auth/metadata` — retrieves `userId`
2. `GET /appsvcs/rs/svc/agents/{userId}/station` — checks station connection

If the station is already connected it sends `FIVE9_STATION_RESTART_VERIFIED`.

### Connection States (`FIVE9_CONNECTION_STATES`)

| State | Meaning |
|-------|---------|
| `NO_TAB` | No Five9 tab open |
| `AWAITING_CONNECTION` | Tab exists, agent not yet connected |
| `ACTIVE_CONNECTION` | Agent voice channel active |

---

## Starting a Call

### Message Flow

1. **Sidepanel** — `callManager.js:initiateCall(phoneNumber)` sends:
   ```js
   chrome.runtime.sendMessage({ type: 'triggerFive9Call', phoneNumber })
   ```

2. **Background** — handler at `background.js:762-797`:
   - Finds the Five9 tab via `chrome.tabs.query`
   - Cleans the phone number (strips non-digits, adds `+1` prefix if needed)
   - Forwards to content script:
     ```js
     chrome.tabs.sendMessage(five9TabId, { type: 'executeFive9Call', phoneNumber })
     ```

3. **Content Script** — `five9Connector.js:163-210`:
   - **Endpoint**: `POST /appsvcs/rs/svc/agents/{userId}/interactions/make_external_call`
   - **Payload**:
     ```json
     {
       "number": "+1XXXXXXXXXX",
       "skipDNCCheck": false,
       "checkMultipleContacts": true,
       "campaignId": "300000000000483"
     }
     ```
   - Returns `{ success: true/false, error? }` back through the chain as `callStatus`.

---

## Ending a Call

Ending a call is a **two-step** process: disconnect first, then dispose.

### Message Flow

1. **Sidepanel** — `callManager.js:hangupCall(dispositionType)` sends:
   ```js
   chrome.runtime.sendMessage({ type: 'triggerFive9Hangup', dispositionType })
   ```

2. **Background** — handler at `background.js:801-823` forwards as `executeFive9Hangup`.

3. **Content Script** — `five9Connector.js:handleFive9Hangup()` (lines 212-312):

   **Step 1 — Disconnect**:
   ```
   PUT /appsvcs/rs/svc/agents/{userId}/interactions/calls/{interactionId}/disconnect
   ```
   No request body.

   **Step 2 — Dispose** (after a 500 ms delay, if a disposition code is available):
   ```
   PUT /appsvcs/rs/svc/agents/{userId}/interactions/calls/{interactionId}/dispose
   ```
   Body: `{ "dispositionId": "<code>" }`

   If no active call is found the handler returns success (the call was already ended manually).
   Status codes 404 and 435 are handled gracefully.

---

## Setting a Disposition

### Disposition Codes

Defined in `src/constants/dispositions.js`:

| Display Name | Five9 Disposition ID |
|-------------|---------------------|
| Left Voicemail | `300000000000046` |
| Service Completed | `300000000000043` |
| Outbound Error | `300000000000271` |
| Follow Up | `300000000000048` |
| No Answer | *(missing — TODO)* |
| Disconnected | *(missing — TODO)* |

### Two Scenarios

**A. Call still active — user picks a disposition**

Triggers `hangupCall(dispositionType)` which disconnects + disposes in one flow (see above).

**B. Call already ended — user picks a disposition afterward (dispose-only)**

1. Sidepanel sends `triggerFive9DisposeOnly`
2. Background forwards as `executeFive9DisposeOnly`
3. Content script `handleFive9DisposeOnly()` (`five9Connector.js:318-387`):
   - Fetches active interactions and finds the most recent call still in `WRAP_UP` state
   - Calls: `PUT /appsvcs/rs/svc/agents/{userId}/interactions/calls/{interactionId}/dispose`
   - Body: `{ "dispositionId": "<code>" }`

---

## Call State Monitoring

`five9Connector.js` polls every 2 seconds (`setInterval(monitorCallState, 2000)`):

```
GET /appsvcs/rs/svc/agents/{userId}/interactions
```

It tracks transitions between states and broadcasts changes:

| State | Meaning | Message Sent |
|-------|---------|-------------|
| `null` | No active call | — |
| `ACTIVE` | Call in progress | `FIVE9_CALL_STATE_CHANGED` |
| `WRAP_UP` | Call ended, awaiting disposition | `FIVE9_CALL_DISCONNECTED` |
| `FINISHED` | Disposition complete | `FIVE9_DISPOSITION_SET` |

---

## Five9 REST API Summary

All requests use the agent's session cookies (content script runs on `*.five9.com`).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/appsvcs/rs/svc/auth/metadata` | GET | Get current user ID |
| `/appsvcs/rs/svc/agents/{userId}/station` | GET | Check station connection |
| `/appsvcs/rs/svc/agents/{userId}/station/restart` | PUT | Restart station connection |
| `/appsvcs/rs/svc/agents/{userId}/interactions` | GET | List active interactions |
| `/appsvcs/rs/svc/agents/{userId}/interactions/make_external_call` | POST | Initiate outbound call |
| `/appsvcs/rs/svc/agents/{userId}/interactions/calls/{id}/disconnect` | PUT | Hang up a call |
| `/appsvcs/rs/svc/agents/{userId}/interactions/calls/{id}/dispose` | PUT | Set disposition on a call |

---

## Station Restart (DOM Fallback)

When the REST station restart fails, `five9Connector.js` (lines 490-520) falls back to DOM
manipulation — locating the restart button via:

```js
document.getElementById('StationConnectedPopover-restart_station-button')
// or
document.querySelector('[data-f9-template="station-connected-indicator"]')
```

It dispatches synthetic events (`mousedown` → `mouseup` → `click`) to trigger Five9's
framework handlers.

---

## Chrome Message Types

| Sidepanel → Background | Background → Content Script | Response → Sidepanel |
|------------------------|----------------------------|---------------------|
| `triggerFive9Call` | `executeFive9Call` | `callStatus` |
| `triggerFive9Hangup` | `executeFive9Hangup` | `hangupStatus` |
| `triggerFive9DisposeOnly` | `executeFive9DisposeOnly` | `disposeStatus` |

Content script also broadcasts these unsolicited messages:
- `FIVE9_CALL_STATE_CHANGED`
- `FIVE9_CALL_DISCONNECTED`
- `FIVE9_DISPOSITION_SET`
- `FIVE9_STATION_RESTART_VERIFIED`
