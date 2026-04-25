# Five9 Volume Host

Tiny Chrome native messaging host that lets the Student Retention Kit
extension adjust **only** the Five9 Softphone's audio session volume — not
the Windows endpoint volume Five9's own UI changes.

## Why this exists

Five9's Softphone is a native Windows app (the browser tab is just a remote).
When you change volume in Five9's UI, it calls into the native softphone,
which sets the **Windows endpoint master volume** for your headset device.
That affects every other app routed to that device (Spotify, Teams, browser
audio, etc.).

This host uses Windows' Core Audio APIs to set the **per-process audio
session volume** — the same thing the Windows Volume Mixer slider does for
each running app. Five9's contribution to the audio mix is changed in
isolation; nothing else is affected.

## What it does

The extension can send four commands over native messaging:

| Action       | Payload                  | Effect                                                  |
| ------------ | ------------------------ | ------------------------------------------------------- |
| `ping`       | —                        | Returns the list of Five9 audio sessions found.         |
| `setVolume`  | `{percent: 0..100}`      | Sets per-process volume; also unmutes.                  |
| `setMute`    | `{muted: true \| false}` | Mutes or unmutes the Five9 audio session.               |
| `getVolume`  | —                        | Returns the first Five9 session's volume + mute state.  |

The host targets every running process whose executable name contains
`Five9` (case-insensitive), so it picks up the main `Five9SoftPhone` process
plus any helpers that happen to have an audio session.

## Build

Requires the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
on Windows.

```powershell
cd native-host
dotnet publish -c Release -r win-x64
```

Output: `bin\Release\net8.0-windows\win-x64\publish\Five9VolumeHost.exe`
(~5-8 MB, single file, no .NET runtime install needed).

The project is configured for **Native AOT** compilation — produces a
real native binary, not a managed .NET assembly. This minimizes
antivirus false positives compared to PyInstaller-style script bundling.

## Install (one-time, no admin needed)

After building:

```powershell
cd native-host
PowerShell -ExecutionPolicy Bypass -File .\install.ps1
```

This will:

1. Copy `Five9VolumeHost.exe` to `%LocalAppData%\StudentRetentionKit\`
2. Generate a Chrome native messaging manifest pointing at it
3. Register the manifest under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.srk.five9volume`

After install: reload the extension and test a call. The Auto-End Calls
volume settings will now control only Five9's audio.

### SmartScreen behavior

SmartScreen's "Windows protected your PC" warning **only fires on files
that have the Mark of the Web (MOTW)** — the metadata Windows attaches to
files downloaded from the internet, email attachments, or untrusted
network shares.

Files **built locally** on your own machine (i.e. by `dotnet publish`)
have no MOTW. SmartScreen does not fire. As long as you build the host
yourself with `dotnet publish` and run `install.ps1` from your local
clone, you should never see the warning.

Defensive mitigations already in place:
- `install.ps1` calls `Unblock-File` after copying — strips MOTW even if
  it somehow got attached (e.g. if you downloaded a pre-built exe).
- Native AOT compilation produces a real native PE binary, not a packed
  script bundle, so behavioral heuristics see it as a normal Windows
  executable.
- The csproj sets a clear AssemblyTitle, Description, Company, and
  Version that show up in File Properties → Details.

If SmartScreen does fire (rare): click **More info → Run anyway** once
and Windows will trust it permanently for that file path.

## Uninstall

```powershell
PowerShell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Removes the registry key and installed files.

## Manual sanity check

To verify the host responds without going through Chrome, run it directly:

```powershell
& "$env:LocalAppData\StudentRetentionKit\Five9VolumeHost.exe"
```

It will hang waiting for input on stdin (the native messaging protocol).
That's expected — Ctrl+C to exit. If it crashes immediately or fails to
launch, that's an issue worth reporting.

To test a real round-trip from the extension:

1. Open `chrome://extensions/` → click the **service worker** link for the
   Student Retention Kit extension to open the background console.
2. In that console, run:
   ```js
   chrome.runtime.sendNativeMessage('com.srk.five9volume', { action: 'ping' }, (r) => console.log(r));
   ```
3. Expected response (with a Five9 call active or softphone running):
   ```js
   { ok: true, sessions: [{ pid: 12345, name: 'Five9SoftPhone', volume: 80, muted: false }] }
   ```

If `sessions: []`, no Five9 process has a live audio session yet — start a
call and try again.

## Files

| File                       | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `Program.cs`               | Native messaging protocol I/O + command dispatch.      |
| `AudioControl.cs`          | Windows Core Audio COM interop. Self-contained.        |
| `Five9VolumeHost.csproj`   | .NET 8 AOT-compiled native binary.                     |
| `manifest.template.json`   | Chrome native messaging manifest, install-time edited. |
| `install.ps1`              | Per-user install (copy + register).                    |
| `uninstall.ps1`            | Reverse of install.                                    |

## Security

- **`allowed_origins` is locked to your extension ID.** Other extensions
  cannot call this host.
- **No network, no file writes** outside install location. Just reads
  audio session state and adjusts volume.
- **No persistent process.** Chrome spawns the host on demand and pipes
  stdin/stdout; the host exits when Chrome closes the connection.
- **Source is plain C# in two files** — auditable end-to-end. No third-
  party runtime libraries beyond the .NET BCL.
