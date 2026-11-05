// OpenDots desktop launcher.
//
// Build (no SDK required, ships with .NET Framework):
//   csc /target:winexe /out:OpenDots.exe /r:System.Windows.Forms.dll OpenDots.cs
//
// Behaviour:
//   OpenDots.exe            -> ensure the stack is up, then open the app window
//   OpenDots.exe --install  -> run install.ps1 (one-click installation)
//
// The window is Edge/Chrome in application mode, so it has no address bar and
// gets its own taskbar entry: the same shape as a desktop chat app.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    private const string Url = "http://localhost:8080";

    [STAThread]
    private static void Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;

        if (args.Length > 0 && args[0] == "--install")
        {
            RunPowerShell(Path.Combine(dir, "install.ps1"), false);
            return;
        }

        if (!IsReady(2))
        {
            Cursor.Current = Cursors.WaitCursor;
            RunPowerShell(Path.Combine(dir, "start.ps1"), true);
        }

        OpenAppWindow();
    }

    private static bool IsReady(int attempts)
    {
        for (int i = 0; i < attempts; i++)
        {
            try
            {
                using (var client = new WebClient())
                {
                    client.Headers.Add("User-Agent", "OpenDots-Launcher");
                    string body = client.DownloadString(Url + "/api/health");
                    if (body != null && body.Contains("\"ok\":true")) return true;
                }
            }
            catch
            {
                if (i + 1 < attempts) Thread.Sleep(1500);
            }
        }
        return false;
    }

    private static void RunPowerShell(string script, bool hidden)
    {
        if (!File.Exists(script))
        {
            MessageBox.Show("Missing " + script + ".\r\nRun the installer first.",
                "OpenDots", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var psi = new ProcessStartInfo("powershell.exe")
        {
            Arguments = "-NoProfile -ExecutionPolicy Bypass " +
                        (hidden ? "-WindowStyle Hidden " : "") +
                        "-File \"" + script + "\"",
            UseShellExecute = false,
            CreateNoWindow = hidden,
            WorkingDirectory = Path.GetDirectoryName(script)
        };
        using (var p = Process.Start(psi))
        {
            if (p != null) p.WaitForExit(hidden ? 240000 : 600000);
        }
    }

    private static void OpenAppWindow()
    {
        foreach (string candidate in BrowserCandidates())
        {
            if (!File.Exists(candidate)) continue;
            try
            {
                Process.Start(new ProcessStartInfo(candidate)
                {
                    Arguments = "--app=" + Url + " --window-size=1440,900",
                    UseShellExecute = false
                });
                return;
            }
            catch { }
        }
        Process.Start(Url); // fall back to the default browser
    }

    private static string[] BrowserCandidates()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return new[]
        {
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe")
        };
    }
}
