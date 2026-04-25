// Student Retention Kit - Five9 Volume Host
// =========================================
// Chrome native messaging host that adjusts the per-process audio session
// volume of the Five9 Softphone via the Windows Core Audio API. This lets
// the extension mute/unmute Five9 calls during automation WITHOUT affecting
// the volume of any other application (which is what Five9's own UI does
// — it changes endpoint volume, affecting every app routed to the headset).
//
// Protocol: Chrome native messaging (stdin/stdout, 4-byte little-endian
// length prefix + UTF-8 JSON message). One request per message; one response.
//
// Commands accepted (JSON `action` field):
//   {"action":"ping"}                    → {"ok":true,"sessions":[...]}
//   {"action":"setVolume","percent":N}   → {"ok":true,"applied":N,"matched":K}
//   {"action":"setMute","muted":true}    → {"ok":true,"matched":K}
//   {"action":"getVolume"}               → {"ok":true,"volume":N,"muted":bool}
//
// All commands target every running process whose executable name contains
// "Five9" (case-insensitive). In practice this matches "Five9SoftPhone.exe"
// and any helper variants that happen to have an audio session.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace StudentRetentionKit.Five9VolumeHost;

internal static class Program
{
    private const string ProcessNameMatch = "Five9";

    private static int Main()
    {
        var stdin = Console.OpenStandardInput();
        var stdout = Console.OpenStandardOutput();

        try
        {
            while (true)
            {
                var msg = ReadMessage(stdin);
                if (msg == null) return 0; // EOF — Chrome closed the pipe
                var response = HandleMessage(msg);
                WriteMessage(stdout, response);
            }
        }
        catch (Exception ex)
        {
            // Last-ditch: report fatal errors so the extension can log them.
            try { WriteMessage(stdout, $"{{\"ok\":false,\"error\":\"host fatal: {Escape(ex.Message)}\"}}"); }
            catch { /* swallow */ }
            return 1;
        }
    }

    // ---------- Native messaging framing ----------

    private static string? ReadMessage(Stream stdin)
    {
        var lenBuf = new byte[4];
        if (!ReadExact(stdin, lenBuf, 4)) return null;
        var len = BitConverter.ToInt32(lenBuf, 0);
        if (len <= 0 || len > 1_048_576) // 1 MB cap per Chrome's limit
            throw new InvalidDataException($"invalid message length: {len}");
        var buf = new byte[len];
        if (!ReadExact(stdin, buf, len))
            throw new EndOfStreamException("truncated message body");
        return Encoding.UTF8.GetString(buf);
    }

    private static bool ReadExact(Stream s, byte[] buf, int count)
    {
        int read = 0;
        while (read < count)
        {
            var n = s.Read(buf, read, count - read);
            if (n <= 0) return read == 0 ? false : throw new EndOfStreamException();
            read += n;
        }
        return true;
    }

    private static void WriteMessage(Stream stdout, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        var len = BitConverter.GetBytes(bytes.Length);
        stdout.Write(len, 0, 4);
        stdout.Write(bytes, 0, bytes.Length);
        stdout.Flush();
    }

    // ---------- Command dispatch ----------

    private static string HandleMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var action = root.TryGetProperty("action", out var a) ? a.GetString() : null;

            return action switch
            {
                "ping"      => Ping(),
                "setVolume" => SetVolume(root),
                "setMute"   => SetMute(root),
                "getVolume" => GetVolume(),
                _           => $"{{\"ok\":false,\"error\":\"unknown action: {Escape(action ?? "null")}\"}}"
            };
        }
        catch (Exception ex)
        {
            return $"{{\"ok\":false,\"error\":\"{Escape(ex.Message)}\"}}";
        }
    }

    private static string Ping()
    {
        var sessions = AudioControl.FindMatchingSessions(ProcessNameMatch);
        var sb = new StringBuilder("{\"ok\":true,\"sessions\":[");
        for (int i = 0; i < sessions.Count; i++)
        {
            if (i > 0) sb.Append(',');
            var s = sessions[i];
            sb.Append("{\"pid\":").Append(s.Pid)
              .Append(",\"name\":\"").Append(Escape(s.ProcessName)).Append("\"")
              .Append(",\"volume\":").Append((int)Math.Round(s.Volume * 100))
              .Append(",\"muted\":").Append(s.Muted ? "true" : "false")
              .Append('}');
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static string SetVolume(JsonElement root)
    {
        if (!root.TryGetProperty("percent", out var p)) return "{\"ok\":false,\"error\":\"percent required\"}";
        var percent = Math.Max(0, Math.Min(100, p.GetInt32()));
        var level = percent / 100f;
        var matched = AudioControl.ApplyToMatchingSessions(ProcessNameMatch, ctrl =>
        {
            ctrl.SetMasterVolume(level, IntPtr.Zero);
            // setVolume implicitly unmutes — matches Five9's max-button behavior.
            ctrl.SetMute(false, IntPtr.Zero);
        });
        return $"{{\"ok\":true,\"applied\":{percent},\"matched\":{matched}}}";
    }

    private static string SetMute(JsonElement root)
    {
        if (!root.TryGetProperty("muted", out var m)) return "{\"ok\":false,\"error\":\"muted required\"}";
        var muted = m.GetBoolean();
        var matched = AudioControl.ApplyToMatchingSessions(ProcessNameMatch, ctrl => ctrl.SetMute(muted, IntPtr.Zero));
        return $"{{\"ok\":true,\"muted\":{(muted ? "true" : "false")},\"matched\":{matched}}}";
    }

    private static string GetVolume()
    {
        var sessions = AudioControl.FindMatchingSessions(ProcessNameMatch);
        if (sessions.Count == 0) return "{\"ok\":false,\"error\":\"no Five9 audio sessions found\"}";
        // Report the first matching session (typically the main softphone process).
        var s = sessions[0];
        return $"{{\"ok\":true,\"volume\":{(int)Math.Round(s.Volume * 100)},\"muted\":{(s.Muted ? "true" : "false")},\"pid\":{s.Pid}}}";
    }

    // ---------- Util ----------

    private static string Escape(string? s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
        {
            switch (c)
            {
                case '"':  sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n");  break;
                case '\r': sb.Append("\\r");  break;
                case '\t': sb.Append("\\t");  break;
                default:
                    if (c < 0x20) sb.Append($"\\u{(int)c:x4}");
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
