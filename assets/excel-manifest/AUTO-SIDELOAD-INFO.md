# Excel Add-In Auto-Sideload Feature

## Overview

The Chrome extension now automatically sideloads the Student Retention Excel Add-In manifest into Excel Online when you open Excel tabs. This eliminates the need to manually sideload the add-in every time it expires.

## How It Works

1. When you open an Excel tab (excel.office.com or officeapps.live.com)
2. The extension detects the Excel page loading
3. It automatically injects the manifest XML into Excel's localStorage
4. Excel recognizes the manifest and loads the add-in automatically

## Technical Details

The auto-sideload works by:
- Reading the manifest from: `assets/excel-manifest/Excel Add-In Manifest.xml`
- Injecting it into Excel's localStorage using the same keys Office uses:
  - `__OSF_UPLOADFILE.Manifest.16.{add-in-id}`
  - `__OSF_UPLOADFILE.MyAddins.16.{session-id}`
  - `__OSF_UPLOADFILE.AddinCommandsMyAddins.16.{session-id}`

## Enable/Disable

The feature is **enabled by default**.

To disable it:
```javascript
chrome.storage.local.set({ autoSideloadManifest: false });
```

To re-enable it:
```javascript
chrome.storage.local.set({ autoSideloadManifest: true });
```

## Troubleshooting

If the add-in doesn't appear:
1. **Refresh Excel** - Press F5 to reload the page
2. **Check browser console** - Look for "[SRK Auto-Sideloader]" messages
3. **Verify localStorage** - Open DevTools > Application > Local Storage > Look for `__OSF_UPLOADFILE` keys
4. **Manual sideload** - If auto-sideload fails, you can still manually sideload via Insert > Add-ins > Upload My Add-in

## Limitations

- This only works for **Excel Online** (not desktop Excel)
- The add-in manifest must stay at `assets/excel-manifest/` (the background
  script and `manifest.json` reference it by path)
- Changes to the manifest require reloading the extension

## Files Involved

- `assets/excel-manifest/Excel Add-In Manifest.xml` - The manifest file
- `src/content/excelManifestInjector.js` - Content script that injects manifest
- `src/constants/index.js` - Configuration constants

## Future Enhancements

Potential improvements:
- UI toggle in settings panel
- Status indicator showing if add-in is loaded
- Auto-refresh Excel after injection
- Multiple manifest support
- Version checking and auto-update
