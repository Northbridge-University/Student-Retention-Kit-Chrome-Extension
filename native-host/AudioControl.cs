// Windows Core Audio COM interop — minimal interfaces needed to enumerate
// per-process audio sessions on every output device and control volume/mute
// at the session level (NOT the endpoint level, which is what affects all
// apps routed to that device).
//
// Reference docs:
//   IMMDeviceEnumerator  → https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/
//   IAudioSessionManager2 → https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/
//   ISimpleAudioVolume   → https://learn.microsoft.com/en-us/windows/win32/api/audioclient/
//
// These are well-known stable Windows APIs. AOT-compatible — no reflection.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace StudentRetentionKit.Five9VolumeHost;

internal static class AudioControl
{
    // --- COM CLSIDs / IIDs ---
    private static readonly Guid CLSID_MMDeviceEnumerator = new("BCDE0395-E52F-467C-8E3D-C4579291692E");
    private static readonly Guid IID_IAudioSessionManager2 = new("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    // --- Constants ---
    private const int eRender = 0;        // EDataFlow.eRender — output devices
    private const int DEVICE_STATE_ACTIVE = 0x00000001;
    private const uint CLSCTX_INPROC_SERVER = 0x1;

    public record SessionInfo(int Pid, string ProcessName, float Volume, bool Muted);

    /// <summary>
    /// Enumerates audio sessions on every active output device, returning those
    /// whose owning process name contains the given substring (case-insensitive).
    /// </summary>
    public static List<SessionInfo> FindMatchingSessions(string nameSubstring)
    {
        var results = new List<SessionInfo>();
        ForEachMatchingSession(nameSubstring, (pid, name, ctrl) =>
        {
            ctrl.GetMasterVolume(out var vol);
            ctrl.GetMute(out var muted);
            results.Add(new SessionInfo(pid, name, vol, muted != 0));
        });
        return results;
    }

    /// <summary>
    /// Applies an action to ISimpleAudioVolume on every matching session.
    /// Returns the number of sessions touched.
    /// </summary>
    public static int ApplyToMatchingSessions(string nameSubstring, Action<ISimpleAudioVolume> action)
    {
        int count = 0;
        ForEachMatchingSession(nameSubstring, (_, _, ctrl) =>
        {
            action(ctrl);
            count++;
        });
        return count;
    }

    private static void ForEachMatchingSession(string nameSubstring, Action<int, string, ISimpleAudioVolume> visit)
    {
        var enumeratorType = Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator)
            ?? throw new InvalidOperationException("MMDeviceEnumerator CLSID not available");
        var enumeratorObj = Activator.CreateInstance(enumeratorType)
            ?? throw new InvalidOperationException("failed to create MMDeviceEnumerator");
        var enumerator = (IMMDeviceEnumerator)enumeratorObj;

        try
        {
            var hr = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out var deviceCollection);
            if (hr != 0) throw new COMException("EnumAudioEndpoints failed", hr);

            try
            {
                deviceCollection.GetCount(out var deviceCount);
                for (uint d = 0; d < deviceCount; d++)
                {
                    deviceCollection.Item(d, out var device);
                    if (device == null) continue;
                    try
                    {
                        var smGuid = IID_IAudioSessionManager2;
                        device.Activate(ref smGuid, CLSCTX_INPROC_SERVER, IntPtr.Zero, out var smObj);
                        var manager = (IAudioSessionManager2)smObj;
                        try
                        {
                            manager.GetSessionEnumerator(out var sessionEnum);
                            try
                            {
                                sessionEnum.GetCount(out var sessionCount);
                                for (int s = 0; s < sessionCount; s++)
                                {
                                    sessionEnum.GetSession(s, out var session);
                                    if (session == null) continue;
                                    try
                                    {
                                        var session2 = (IAudioSessionControl2)session;
                                        if (session2.GetProcessId(out var pid) != 0) continue;
                                        if (pid <= 0) continue;
                                        string procName;
                                        try { procName = Process.GetProcessById((int)pid).ProcessName; }
                                        catch { continue; } // Process exited between enumeration and lookup.
                                        if (procName.IndexOf(nameSubstring, StringComparison.OrdinalIgnoreCase) < 0) continue;

                                        var ctrl = (ISimpleAudioVolume)session;
                                        visit((int)pid, procName, ctrl);
                                    }
                                    finally { Marshal.ReleaseComObject(session); }
                                }
                            }
                            finally { Marshal.ReleaseComObject(sessionEnum); }
                        }
                        finally { Marshal.ReleaseComObject(manager); }
                    }
                    finally { Marshal.ReleaseComObject(device); }
                }
            }
            finally { Marshal.ReleaseComObject(deviceCollection); }
        }
        finally { Marshal.ReleaseComObject(enumerator); }
    }

    // --- COM interfaces (subset of MMDeviceAPI / AudioPolicy / AudioClient) ---

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        // Other methods omitted — we only need EnumAudioEndpoints.
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr session);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr audioVolume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
        [PreserveSig] int RegisterSessionNotification(IntPtr notifications);
        [PreserveSig] int UnregisterSessionNotification(IntPtr notifications);
        [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr duckNotification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr duckNotification);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int sessionCount);
        [PreserveSig] int GetSession(int sessionIndex, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    // IAudioSessionControl2 inherits IAudioSessionControl. We declare the full
    // vtable in order so QueryInterface to this GUID works correctly.
    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl2
    {
        // --- IAudioSessionControl ---
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, ref Guid eventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid groupingParam, ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr newNotifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr newNotifications);
        // --- IAudioSessionControl2 ---
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string retVal);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string retVal);
        [PreserveSig] int GetProcessId(out uint retVal);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, IntPtr eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute(bool mute, IntPtr eventContext);
        [PreserveSig] int GetMute(out int mute);
    }
}
