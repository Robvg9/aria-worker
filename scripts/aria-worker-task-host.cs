using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class AriaWorkerTaskHost
{
    private static readonly object LogLock = new object();
    private static string LogPath;

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args != null && args.Length == 2 &&
                String.Equals(args[0], "--self-test", StringComparison.Ordinal))
            {
                LogPath = args[1];
                return RunSelfTest();
            }

            LogPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ARIA", "logs", "persistent-worker-task-host.log");

            if (args == null || args.Length != 7 ||
                !String.Equals(args[0], "--run", StringComparison.Ordinal))
            {
                WriteLog("HOST_ERROR Invalid arguments. Expected --run <powershell> <launcher> <config> <installDir> <node> <taskName>.");
                return 64;
            }

            return RunWorker(args);
        }
        catch (Exception exception)
        {
            WriteLog("HOST_FATAL " + exception);
            return 1;
        }
    }

    private static int RunSelfTest()
    {
        EnsureLogDirectory();
        WriteLog("SELFTEST_HOST_CONSOLE=" + (GetConsoleWindow() == IntPtr.Zero ? "NONE" : "PRESENT"));

        if (GetConsoleWindow() != IntPtr.Zero)
        {
            WriteLog("SELFTEST_RESULT=FAIL_HOST_HAS_CONSOLE");
            return 10;
        }

        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string powershell = Path.Combine(
            windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

        if (!File.Exists(powershell))
        {
            WriteLog("SELFTEST_RESULT=FAIL_POWERSHELL_NOT_FOUND");
            return 11;
        }

        string command =
            "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; " +
            "public static class AriaTaskHostConsoleProbe { " +
            "[DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }' " +
            "-Language CSharp; " +
            "if ([AriaTaskHostConsoleProbe]::GetConsoleWindow() -eq [IntPtr]::Zero) { " +
            "[Console]::Out.WriteLine('CHILD_CONSOLE=NONE'); exit 0 " +
            "} else { [Console]::Out.WriteLine('CHILD_CONSOLE=PRESENT'); exit 9 }";

        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = powershell;
        info.Arguments = Quote("-NoProfile") + " " +
                         Quote("-NonInteractive") + " " +
                         Quote("-ExecutionPolicy") + " " +
                         Quote("Bypass") + " " +
                         Quote("-Command") + " " +
                         Quote(command);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);

        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();

        using (Process child = new Process())
        {
            child.StartInfo = info;
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null)
                    stdout.AppendLine(eventArgs.Data);
            };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null)
                    stderr.AppendLine(eventArgs.Data);
            };

            if (!child.Start())
            {
                WriteLog("SELFTEST_RESULT=FAIL_CHILD_START");
                return 12;
            }

            child.BeginOutputReadLine();
            child.BeginErrorReadLine();

            if (!child.WaitForExit(20000))
            {
                try { child.Kill(); } catch { }
                WriteLog("SELFTEST_RESULT=FAIL_CHILD_TIMEOUT");
                return 13;
            }

            child.WaitForExit();

            string output = stdout.ToString();
            string error = stderr.ToString();

            WriteLog("SELFTEST_CHILD_STDOUT=" + output.Trim().Replace(Environment.NewLine, " | "));
            if (!String.IsNullOrWhiteSpace(error))
                WriteLog("SELFTEST_CHILD_STDERR=" + error.Trim().Replace(Environment.NewLine, " | "));
            WriteLog("SELFTEST_CHILD_EXIT_CODE=" + child.ExitCode);

            if (child.ExitCode != 0 ||
                output.IndexOf("CHILD_CONSOLE=NONE", StringComparison.Ordinal) < 0)
            {
                WriteLog("SELFTEST_RESULT=FAIL_CHILD_CONSOLE_OR_EXIT");
                return 14;
            }
        }

        WriteLog("SELFTEST_RESULT=PASS");
        return 0;
    }

    private static int RunWorker(string[] args)
    {
        string powershell = args[1];
        string launcher = args[2];
        string config = args[3];
        string installDir = args[4];
        string node = args[5];
        string taskName = args[6];

        RequireFile(powershell, "PowerShell executable");
        RequireFile(launcher, "ARIA worker launcher");
        RequireFile(config, "DPAPI worker config");
        RequireFile(node, "Node executable");

        if (!Directory.Exists(installDir))
            throw new DirectoryNotFoundException("ARIA InstallDir was not found: " + installDir);

        EnsureLogDirectory();
        WriteLog("HOST_START");
        WriteLog("HOST_CONSOLE=" + (GetConsoleWindow() == IntPtr.Zero ? "NONE" : "PRESENT"));
        WriteLog("HOST_IDENTITY=" + Environment.UserDomainName + "\\" + Environment.UserName);
        WriteLog("HOST_WORKER_TASK=" + taskName);
        WriteLog("HOST_LAUNCH_MODE=NO_CONSOLE");
        WriteLog("HOST_DPAPI_CONFIG_PATH=" + config);
        WriteLog("HOST_TOKEN_ARGUMENT_OR_LOG=NONE");

        string arguments =
            Quote("-NoProfile") + " " +
            Quote("-NonInteractive") + " " +
            Quote("-ExecutionPolicy") + " " +
            Quote("Bypass") + " " +
            Quote("-File") + " " + Quote(launcher) + " " +
            Quote("-ConfigPath") + " " + Quote(config) + " " +
            Quote("-InstallDir") + " " + Quote(installDir) + " " +
            Quote("-NodePath") + " " + Quote(node) + " " +
            Quote("-TaskName") + " " + Quote(taskName);

        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = powershell;
        info.Arguments = arguments;
        info.WorkingDirectory = installDir;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;

        using (Process child = new Process())
        {
            child.StartInfo = info;
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null)
                    WriteLog("WORKER_STDOUT " + eventArgs.Data);
            };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null)
                    WriteLog("WORKER_STDERR " + eventArgs.Data);
            };

            WriteLog("HOST_CHILD_START");
            if (!child.Start())
                throw new InvalidOperationException("PowerShell worker launcher process did not start.");

            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            child.WaitForExit();
            child.WaitForExit();

            WriteLog("HOST_CHILD_EXIT_CODE=" + child.ExitCode);
            WriteLog("HOST_EXIT");
            return child.ExitCode;
        }
    }

    private static void RequireFile(string path, string label)
    {
        if (String.IsNullOrWhiteSpace(path) || !File.Exists(path))
            throw new FileNotFoundException(label + " was not found.", path);
    }

    private static void EnsureLogDirectory()
    {
        string directory = Path.GetDirectoryName(LogPath);
        if (!String.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);
    }

    private static void WriteLog(string message)
    {
        try
        {
            EnsureLogDirectory();
            string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") +
                          "] PID=" + Process.GetCurrentProcess().Id + " " + message;
            lock (LogLock)
            {
                File.AppendAllText(LogPath, line + Environment.NewLine, new UTF8Encoding(false));
            }
        }
        catch
        {
            // Never print to or allocate a console as a logging fallback.
        }
    }

    // Quote a single argument according to the Windows CommandLineToArgvW rules.
    private static string Quote(string value)
    {
        if (value == null)
            return "\"\"";

        if (value.Length > 0 && value.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            return value;

        StringBuilder result = new StringBuilder();
        result.Append('"');
        int backslashes = 0;

        for (int index = 0; index < value.Length; index++)
        {
            char current = value[index];

            if (current == '\\')
            {
                backslashes++;
                continue;
            }

            if (current == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }

            if (backslashes > 0)
            {
                result.Append('\\', backslashes);
                backslashes = 0;
            }

            result.Append(current);
        }

        if (backslashes > 0)
            result.Append('\\', backslashes * 2);

        result.Append('"');
        return result.ToString();
    }
}
