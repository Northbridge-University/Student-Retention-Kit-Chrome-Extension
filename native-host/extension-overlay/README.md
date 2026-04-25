# Extension overlay

The Student Retention Kit extension on the Chrome Web Store ships **without**
the per-process Five9 volume control. This folder is the "DLC": apply it on
top of a local clone of the extension and the feature lights up.

## What it changes

| Target file (in your extension folder)         | Change                                    |
| ---------------------------------------------- | ----------------------------------------- |
| `src/background/background-volume.js`          | Replaces the public no-op stub with the real handler that calls `com.srk.five9volume`. |
| `manifest.json`                                | Adds `"nativeMessaging"` to `permissions` (idempotent). |

Nothing else is touched. The auto-end-call UI (volume inputs, state
transitions) was already wired into the extension and works either way; it
just has nothing to talk to until the overlay is applied AND the native host
is installed.

## Apply

```powershell
cd native-host\extension-overlay
.\apply-overlay.ps1 -ExtensionPath C:\Users\you\Documents\GitHub\Student-Retention-Kit-Chrome-Extension
```

Then in Chrome: `chrome://extensions` -> click **Reload** on the extension.

The native host itself must also be installed — see `..\README.md`.

## Reverting

To go back to the clean public extension, either:

- `git restore manifest.json src/background/background-volume.js` in the
  extension folder, or
- Re-pull the extension repo's `main` branch (overwriting your local copy).
