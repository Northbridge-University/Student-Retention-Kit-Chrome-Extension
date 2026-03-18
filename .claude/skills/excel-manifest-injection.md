---
name: excel-manifest-injection
description: How the Chrome extension auto-sideloads the Office Add-in manifest into Excel Online via localStorage injection
---

# Excel Manifest Injection Skill

How the Chrome extension automatically sideloads the Office Add-in manifest into Excel Online by writing to localStorage keys that Office reads at startup.

## Architecture Overview

The system has three layers working together:

1. **Content Script** (`src/content/excelManifestInjector.js`) — Runs at `document_start` in all Excel Online frames. Detects the Office session ID and writes the manifest XML + registration keys into `localStorage`.
2. **Background Script** (`src/background/background.js`) — Serves the manifest XML to the content script (content scripts in cross-origin iframes can't use `chrome.runtime.getURL()`).
3. **Excel Connector** (`src/content/excelConnector.js`) — Bridges `window.postMessage` communication between the loaded Office Add-in taskpane and the Chrome extension via `chrome.runtime.sendMessage`.

## How Office Add-in Sideloading Works

Office Online (Excel Web) reads specific `localStorage` keys to discover sideloaded add-ins. By writing to these keys before Office initializes, we trick Excel into loading our add-in as if the user manually sideloaded it via "Upload My Add-in".

### The Four localStorage Keys

All keys are scoped to a **session ID** (a numeric identifier Office assigns to each Excel session) and the **add-in ID** (`a8b1e479-1b3d-4e9e-9a1c-2f8e1c8b4a0e`).

| Key | Purpose | Value Shape |
|-----|---------|-------------|
| `__OSF_UPLOADFILE.Manifest.16.{ADDIN_ID}` | The manifest XML itself | `{ data: "<xml>...", createdOn: timestamp, refreshRate: 3 }` |
| `__OSF_UPLOADFILE.MyAddins.16.{SESSION_ID}` | List of sideloaded add-in IDs for this session | `{ data: ["addin-id-1", ...], createdOn: timestamp, refreshRate: 3 }` |
| `__OSF_UPLOADFILE.AddinCommandsMyAddins.16.{SESSION_ID}` | Add-ins with ribbon commands enabled | `{ data: ["addin-id-1", ...], createdOn: timestamp, refreshRate: 3 }` |
| `ack3_WAC_Excel_{SESSION_ID}_8` | Acknowledgment flag telling Office to load the add-ins list | `"true"` |

### Value Format

The first three keys store JSON with this structure:

```js
{
    data: <manifest_xml_string | array_of_addin_ids>,
    createdOn: Date.now(),
    refreshRate: 3
}
```

The `ack` key is a simple string `"true"`.

## Injection Flow

### Step 1: Chrome Extension Registers Content Scripts

In `manifest.json`, two content scripts target Excel Online domains:

```json
{
    "matches": [
        "https://excel.office.com/*",
        "https://*.officeapps.live.com/*",
        "https://*.sharepoint.com/*"
    ],
    "js": ["src/content/excelManifestInjector.js"],
    "run_at": "document_start",
    "all_frames": true
}
```

`run_at: "document_start"` ensures the script runs before Office JS initializes, and `all_frames: true` ensures it runs in Office's nested iframes (Excel Online uses multiple iframes).

### Step 2: Check Auto-Sideload Setting

```js
chrome.storage.local.get(['settings', 'autoSideloadManifest'], async (result) => {
    const autoSideloadEnabled = getSettingValue(result, 'autoSideloadManifest', true);
    if (!autoSideloadEnabled) return; // User disabled it
    // ... proceed with injection
});
```

- Enabled by default (`true`)
- Can be disabled: `chrome.storage.local.set({ autoSideloadManifest: false })`
- Checks nested path `settings.excelAddIn.autoSideloadManifest` first, then legacy flat key

### Step 3: Find the Office Session ID

The session ID is required because Office scopes sideloaded add-in registrations per session. Three strategies are tried in order:

**Strategy 1 — Parse `__OSF_UPLOADFILE.MyAddins` keys** (most reliable):
```js
// Look for keys like "__OSF_UPLOADFILE.MyAddins.16.3735224676"
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('__OSF_UPLOADFILE.MyAddins.16.')) {
        const sessionId = key.split('.')[3]; // "3735224676"
    }
}
```

**Strategy 2 — Parse WAC (Web Application Companion) keys**:
```js
// Match keys like "ack3_WAC_Excel_3735224676_8" or "Flyout_WAC_Excel_3735224676__0_ExpirationTime"
const match = key.match(/_WAC_Excel_(\d+)(_|__)/);
```

**Strategy 3 — Use previously stored session ID** from `chrome.storage.local` (fallback for when Office hasn't written keys yet):
```js
const storedSessionId = await getStoredSessionId();
```

When a session ID is found via Strategy 1 or 2, it's stored in `chrome.storage.local` under key `srkSessionId` for future fallback use.

If no session ID is found by any strategy, injection is aborted.

### Step 4: Fetch Manifest XML from Background Script

Content scripts in cross-origin iframes cannot use `chrome.runtime.getURL()` (it returns `chrome-extension://invalid/`). Instead, the content script requests the XML via messaging:

**Content script:**
```js
const response = await chrome.runtime.sendMessage({ type: 'SRK_GET_MANIFEST_XML' });
MANIFEST_XML = response.xml;
```

**Background script:**
```js
if (msg.type === MESSAGE_TYPES.SRK_GET_MANIFEST_XML) {
    fetch(chrome.runtime.getURL('assets/Excel Add-In Manifest.xml'))
        .then(response => response.text())
        .then(xml => sendResponse({ success: true, xml }));
    return true; // Keep sendResponse channel open
}
```

The background handler is a **separate non-async listener** because Chrome only honors `return true` (to keep `sendResponse` open) from synchronous listeners.

### Step 5: Write to localStorage

The `injectManifest(SESSION_ID, manifestXml)` function writes all four keys:

1. **Manifest key** — stores the full XML, always overwritten
2. **MyAddins key** — appends our add-in ID to the existing array (preserves other sideloaded add-ins)
3. **AddinCommandsMyAddins key** — same append logic for command-enabled add-ins
4. **Ack key** — signals Office that sideloaded add-ins are available

If the MyAddins or AddinCommands keys already exist, the function parses the existing JSON and appends our add-in ID only if it's not already present.

### Step 6: Notify Background Script

After injection, the content script fires a notification:

```js
chrome.runtime.sendMessage({
    type: 'SRK_MANIFEST_INJECTED',
    addinId: ADDIN_ID,
    timestamp: Date.now()
});
```

The background script logs this and can forward the event to the side panel.

## The Office Add-in Manifest

Located at `assets/Excel Add-In Manifest.xml`. Key properties:

| Property | Value |
|----------|-------|
| Add-in ID | `a8b1e479-1b3d-4e9e-9a1c-2f8e1c8b4a0e` |
| Type | `TaskPaneApp` (side panel in Excel) |
| Host | `Workbook` (Excel only) |
| Source URL | `https://vsblanco.github.io/Student-Retention-Add-in/react/dist/index.html` |
| Permissions | `ReadWriteDocument` |
| Width | 450px |

The manifest defines:
- **LaunchEvents** — `OnNewDocument` and `OnDocumentOpened` auto-open the add-in
- **SharedRuntime** — Long-lived runtime for persistent background execution
- **Ribbon commands** — Custom "Retention" tab with buttons (Call, Sheets, Taskpane toggle)
- **App domain** — `https://vsblanco.github.io` for the hosted taskpane

## The Excel Connector Bridge

After the add-in loads in its iframe, `excelConnector.js` handles bidirectional communication:

**Add-in → Extension** (via `window.postMessage` → `chrome.runtime.sendMessage`):

| Message Type | Purpose |
|-------------|---------|
| `SRK_CHECK_EXTENSION` | Add-in pings to check if extension is installed |
| `SRK_MASTER_LIST_DATA` | Student data from the Excel workbook |
| `SRK_SELECTED_STUDENTS` | User selected student row(s) in Excel |
| `SRK_OFFICE_USER_INFO` | Authenticated user profile from Office |
| `SRK_SHEET_LIST_RESPONSE` | Available sheets in the workbook |
| `SRK_HIGHLIGHT_CONFIRMATION` | Confirmation that a row was highlighted |
| `SRK_LINKS` | URLs to open from Excel |
| `SRK_PONG` / `SRK_TASKPANE_PONG` | Ping responses for health checks |

**Extension → Add-in** (via `chrome.runtime.onMessage` → `window.postMessage`):

| Message Type | Purpose |
|-------------|---------|
| `SRK_EXTENSION_INSTALLED` | Response to add-in's ping |
| `SRK_TASKPANE_PING` / `SRK_PING` | Health check pings |
| `postToPage` | Generic message forwarding |

The connector also handles:
- **Master list auto-update settings** (`always`, `once-daily`, `never`)
- **Student data transformation** (field alias resolution, Excel date conversion, name format conversion)
- **Stale script detection** via `isExtensionContextValid()` to prevent duplicate processing after extension reloads

## Key Files

| File | Purpose |
|------|---------|
| `src/content/excelManifestInjector.js` | Auto-sideloads manifest XML into Excel's localStorage |
| `src/content/excelConnector.js` | Bridges Office Add-in ↔ Chrome extension messaging |
| `src/background/background.js` | Serves manifest XML and handles injection notifications |
| `assets/Excel Add-In Manifest.xml` | The Office Add-in manifest (single source of truth) |
| `assets/AUTO-SIDELOAD-INFO.md` | User-facing documentation of the feature |
| `manifest.json` | Chrome extension manifest — registers content scripts on Excel domains |
| `src/constants/index.js` | Message type constants (`SRK_GET_MANIFEST_XML`, `SRK_MANIFEST_INJECTED`) |

## Common Patterns When Modifying Injection Code

1. **Always use `run_at: "document_start"`** for the injector — it must write to localStorage before Office JS reads it
2. **Always use `all_frames: true`** — Excel Online nests content in multiple iframes
3. **Fetch manifest XML via the background script** — never use `chrome.runtime.getURL()` directly in content scripts (fails in cross-origin iframes)
4. **Preserve existing sideloaded add-ins** — parse and append to MyAddins arrays, don't overwrite
5. **Store session IDs** for fallback — Office may not have written its localStorage keys yet on first load
6. **Use a non-async listener** for `SRK_GET_MANIFEST_XML` in the background script — async listeners break `sendResponse`
7. **Guard against stale content scripts** — check `isExtensionContextValid()` before using `chrome.runtime` APIs
