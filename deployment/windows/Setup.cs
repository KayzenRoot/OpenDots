// NexBot distributable installer stub.
//
// Build (see build-installer.cmd): compile this stub, then append a zip payload
// to the resulting exe. At run time the zip is read from the end of the file —
// the exe's own bytes at the front are ignored by the ZIP central directory.
//
// Installs into %LOCALAPPDATA%\NexBot, so no administrator rights are needed,
// then runs deployment\windows\install.ps1 from the extracted payload.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

internal static class Setup
{
    private const string AppName = "NexBot";

    [STAThread]
    private static void Main()
    {
        string target = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);

        try
        {
            Cursor.Current = Cursors.WaitCursor;

            if (Directory.Exists(target))
            {
                // Keep the operator's configuration across upgrades.
                foreach (string keep in Directory.GetFiles(target, ".env.local"))
                    File.SetAttributes(keep, FileAttributes.Normal);
            }
            else
            {
                Directory.CreateDirectory(target);
            }

            string self = Assembly.GetExecutingAssembly().Location;
            byte[] payload = ReadPayload(self);
            using (var ms = new MemoryStream(payload, false))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    if (entry.FullName.EndsWith("/")) continue;
                    // Never overwrite an existing configuration on upgrade.
                    if (entry.FullName == ".env.local" && File.Exists(Path.Combine(target, ".env.local")))
                        continue;
                    string dest = Path.Combine(target, entry.FullName);
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    entry.ExtractToFile(dest, true);
                }
            }

            string install = Path.Combine(target, @"deployment\windows\install.ps1");
            if (!File.Exists(install))
                throw new FileNotFoundException("The installer payload is incomplete.", install);

            var psi = new ProcessStartInfo("powershell.exe")
            {
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + install + "\"",
                WorkingDirectory = target,
                UseShellExecute = false
            };
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                if (p.ExitCode != 0)
                    MessageBox.Show("Installation finished with errors (exit " + p.ExitCode + ").\r\n" +
                                    "Logs: " + target, AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("Installation failed:\r\n\r\n" + ex.Message,
                AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.Exit(1);
        }
    }

    /// <summary>
    /// Read the appended zip. The layout is: [stub exe][zip][int64 zip length].
    /// The explicit length avoids relying on ZIP end-of-central-directory
    /// offsets, which .NET does not adjust for a prefixed (self-extracting) file.
    /// </summary>
    private static byte[] ReadPayload(string self)
    {
        using (FileStream fs = File.OpenRead(self))
        {
            if (fs.Length < 16) throw new InvalidDataException("Installer payload is missing.");
            fs.Seek(-8, SeekOrigin.End);
            var lenBytes = new byte[8];
            if (fs.Read(lenBytes, 0, 8) != 8)
                throw new InvalidDataException("Installer payload is corrupt.");
            long zipLen = BitConverter.ToInt64(lenBytes, 0);
            long zipStart = fs.Length - 8 - zipLen;
            if (zipLen <= 0 || zipStart <= 0)
                throw new InvalidDataException("Installer payload is corrupt.");
            fs.Seek(zipStart, SeekOrigin.Begin);
            var buffer = new byte[zipLen];
            int read = 0;
            while (read < zipLen)
            {
                int n = fs.Read(buffer, read, (int)(zipLen - read));
                if (n <= 0) throw new InvalidDataException("Installer payload is truncated.");
                read += n;
            }
            return buffer;
        }
    }
}
