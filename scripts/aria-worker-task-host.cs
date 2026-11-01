using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class AriaWorkerTaskHost
{
    private const uint DetachedProcess = 0x00000008;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const int StartfUseStdHandles = 0x00000100;
    private const uint GenericRead = 0x80000000;
    private const uint FileAppendData = 0x00000004;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint OpenAlways = 4;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint Infinite = 0xFFFFFFFF;
    private const uint WaitObject0 = 0;
    private const int ErrorInvalidHandle = -1;

    private static readonly object LogLock = new object();
    private static string LogPath;

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref StartupInfo lpStartupInfo,
        out ProcessInformation lpProcessInformation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        ref SecurityAttributes lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

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

            if (args != null && args.Length == 3 &&
                String.Equals(args[0], "--self-test-detach", StringComparison.Ordinal))
            {
                LogPath = args[2];
                return RunDetachedSelfTest(args[1]);
            }

            if (args != null && args.Length == 4 &&
                String.Equals(args[0], "--self-test-dpapi", StringComparison.Ordinal))
            {
                LogPath = args[3];
                return RunDpapiSelfTest(args[1], args[2]);
            }

            if (args != null && args.Length == 3 &&
                String.Equals(args[0], "--self-test-config", StringComparison.Ordinal))
            {
                LogPath = args[2];
                return RunConfigSelfTest(args[1]);
            }

            LogPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ARIA", "logs", "persistent-worker-supervisor.log");

            if (args == null || args.Length != 5 ||
                !String.Equals(args[0], "--run", StringComparison.Ordinal))
            {
                WriteLog("HOST_ERROR Invalid arguments. Expected --run <config> <installDir> <nodePath> <taskName>.");
                return 64;
            }

            return RunWorker(args[1], args[2], args[3], args[4]);
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

        WriteLog("SELFTEST_RESULT=PASS");
        return 0;
    }

    private static int RunDetachedSelfTest(string probeExecutable)
    {
        EnsureLogDirectory();
        WriteLog("SELFTEST_HOST_CONSOLE=" + (GetConsoleWindow() == IntPtr.Zero ? "NONE" : "PRESENT"));

        if (GetConsoleWindow() != IntPtr.Zero)
        {
            WriteLog("SELFTEST_RESULT=FAIL_HOST_HAS_CONSOLE");
            return 10;
        }

        if (!File.Exists(probeExecutable))
        {
            WriteLog("SELFTEST_RESULT=FAIL_PROBE_EXECUTABLE_MISSING");
            return 11;
        }

        int exitCode = RunDetachedProcess(
            probeExecutable,
            String.Empty,
            Environment.CurrentDirectory,
            BuildBaseEnvironment());

        WriteLog("SELFTEST_DETACHED_CHILD_EXIT_CODE=" + exitCode);
        string log = File.ReadAllText(LogPath);

        if (exitCode != 0 ||
            log.IndexOf("DETACHED_CHILD_CONSOLE=NONE", StringComparison.Ordinal) < 0)
        {
            WriteLog("SELFTEST_RESULT=FAIL_DETACHED_CHILD_CONSOLE");
            return 12;
        }

        WriteLog("SELFTEST_RESULT=PASS");
        return 0;
    }

    private static int RunConfigSelfTest(string configPath)
    {
        EnsureLogDirectory();
        Dictionary<string, string> environment = BuildWorkerEnvironment(configPath);
        string token = environment.ContainsKey("ARIA_WORKER_TOKEN")
            ? environment["ARIA_WORKER_TOKEN"] : null;

        if (String.IsNullOrEmpty(token) || token.Length < 32)
        {
            WriteLog("SELFTEST_CONFIG_DPAPI=FAIL");
            return 15;
        }

        environment["ARIA_WORKER_TOKEN"] = null;
        token = null;
        WriteLog("SELFTEST_CONFIG_DPAPI=PASS");
        WriteLog("SELFTEST_CONFIG_TOKEN_LOGGED=NO");
        return 0;
    }

    private static int RunDpapiSelfTest(string encryptedHex, string expectedSha256)
    {
        EnsureLogDirectory();
        byte[] clear = null;

        try
        {
            clear = DecryptDpapiSecureString(encryptedHex);
            string plaintext = Encoding.Unicode.GetString(clear).TrimEnd('\0');
            byte[] hashBytes = SHA256.Create().ComputeHash(Encoding.UTF8.GetBytes(plaintext));
            string actualHash = ToHex(hashBytes);

            bool match = String.Equals(actualHash, expectedSha256, StringComparison.OrdinalIgnoreCase);
            WriteLog("SELFTEST_DPAPI_ROUNDTRIP=" + (match ? "PASS" : "FAIL"));
            WriteLog("SELFTEST_DPAPI_PLAINTEXT_LOGGED=NO");

            plaintext = null;
            Array.Clear(hashBytes, 0, hashBytes.Length);
            return match ? 0 : 13;
        }
        finally
        {
            if (clear != null)
                Array.Clear(clear, 0, clear.Length);
        }
    }

    private static int RunWorker(string configPath, string installDir, string nodePath, string taskName)
    {
        RequireFile(configPath, "DPAPI worker config");
        RequireFile(nodePath, "Node executable");
        if (!Directory.Exists(installDir))
            throw new DirectoryNotFoundException("ARIA InstallDir was not found: " + installDir);

        string workerScript = Path.Combine(installDir, "scripts", "aria-persistent-windows-worker-v1.js");
        RequireFile(workerScript, "ARIA Windows worker entrypoint");

        EnsureLogDirectory();
        WriteLog("HOST_START");
        WriteLog("HOST_CONSOLE=" + (GetConsoleWindow() == IntPtr.Zero ? "NONE" : "PRESENT"));
        WriteLog("HOST_IDENTITY=" + WindowsIdentity.GetCurrent().Name);
        WriteLog("HOST_TASK=" + taskName);
        WriteLog("HOST_LAUNCH_MODE=DETACHED_PROCESS");
        WriteLog("HOST_CONFIG_PATH=" + configPath);
        WriteLog("HOST_TOKEN_ARGUMENT_OR_LOG=NONE");

        Dictionary<string, string> environment = BuildWorkerEnvironment(configPath);
        int delaySeconds = 5;

        while (true)
        {
            WriteLog("Starting ARIA Windows worker.");
            int exitCode;

            try
            {
                exitCode = RunDetachedProcess(
                    nodePath,
                    Quote(workerScript),
                    installDir,
                    environment);
            }
            catch (Exception exception)
            {
                WriteLog("Worker launch error: " + exception.Message);
                exitCode = 1;
            }

            if (exitCode == 0)
            {
                WriteLog("Worker exited cleanly with code 0; supervisor stopping without restart.");
                WriteLog("HOST_EXIT");
                return 0;
            }

            WriteLog("Worker exited with code " + exitCode + "; restarting in " + delaySeconds + " seconds.");
            Thread.Sleep(TimeSpan.FromSeconds(delaySeconds));
            delaySeconds = Math.Min(60, delaySeconds * 2);
        }
    }

    private static Dictionary<string, string> BuildWorkerEnvironment(string configPath)
    {
        string json = File.ReadAllText(configPath, Encoding.UTF8);
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 2 * 1024 * 1024;

        Dictionary<string, object> document =
            serializer.Deserialize<Dictionary<string, object>>(json);

        if (document == null ||
            !String.Equals(GetString(document, "format"), "aria-worker-config-dpapi-v1", StringComparison.Ordinal))
            throw new InvalidDataException("Worker config format is not recognized.");

        string expectedSid = WindowsIdentity.GetCurrent().User.Value;
        if (!String.Equals(GetString(document, "protectedForSid"), expectedSid, StringComparison.Ordinal))
            throw new InvalidDataException("Worker config was protected for a different Windows user.");

        string encryptedToken = GetString(document, "workerTokenDpapi");
        if (String.IsNullOrWhiteSpace(encryptedToken))
            throw new InvalidDataException("DPAPI worker token is missing.");

        byte[] clearToken = DecryptDpapiSecureString(encryptedToken);
        string token;
        try
        {
            token = Encoding.Unicode.GetString(clearToken).TrimEnd('\0');
        }
        finally
        {
            Array.Clear(clearToken, 0, clearToken.Length);
        }

        if (token.Length < 32)
            throw new InvalidDataException("Decrypted worker token is shorter than 32 characters.");

        object rawValues;
        if (!document.TryGetValue("values", out rawValues))
            throw new InvalidDataException("Worker config values are missing.");

        Dictionary<string, object> values = rawValues as Dictionary<string, object>;
        if (values == null)
            throw new InvalidDataException("Worker config values are invalid.");

        string controlUrl = GetString(values, "ARIA_CONTROL_URL");
        Uri controlUri;
        if (!Uri.TryCreate(controlUrl, UriKind.Absolute, out controlUri) ||
            !String.Equals(controlUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            !String.IsNullOrEmpty(controlUri.UserInfo) ||
            !String.IsNullOrEmpty(controlUri.Query) ||
            !String.IsNullOrEmpty(controlUri.Fragment) ||
            (controlUri.AbsolutePath != "/" && controlUri.AbsolutePath != String.Empty))
            throw new InvalidDataException("ARIA_CONTROL_URL must be an HTTPS origin.");

        string adapter = GetString(values, "ARIA_AUTONOMY_ADAPTER");
        string workspace = GetString(values, "ARIA_WORKSPACE_ROOT");
        if (!File.Exists(adapter))
            throw new FileNotFoundException("Approved worker adapter was not found.", adapter);
        if (!Directory.Exists(workspace))
            throw new DirectoryNotFoundException("Worker workspace was not found: " + workspace);

        string workerId = GetString(values, "ARIA_WORKER_ID");
        if (String.IsNullOrWhiteSpace(workerId) || workerId.IndexOfAny(new char[] { '\r', '\n' }) >= 0)
            throw new InvalidDataException("ARIA_WORKER_ID is invalid.");

        Dictionary<string, string> environment = BuildBaseEnvironment();
        environment["ARIA_WORKER_TOKEN"] = token;

        string[] allowedKeys = new string[] {
            "ARIA_CONTROL_URL", "ARIA_AUTONOMY_ADAPTER", "ARIA_WORKSPACE_ROOT",
            "ARIA_OLLAMA_URL", "ARIA_OLLAMA_MODEL", "ARIA_OLLAMA_TIMEOUT_MS",
            "ARIA_WORKER_ID", "ARIA_WORKER_POLL_MS", "ARIA_WORKER_HEARTBEAT_MS"
        };

        foreach (string key in allowedKeys)
        {
            object rawValue;
            if (values.TryGetValue(key, out rawValue) && rawValue != null)
                environment[key] = Convert.ToString(rawValue, System.Globalization.CultureInfo.InvariantCulture);
        }

        environment["ARIA_WORKER_TOKEN"] = token;
        WriteLog("DPAPI_CURRENT_USER_CONFIG=PASS");
        WriteLog("DPAPI_TOKEN_VALUE_LOGGED=NO");
        WriteLog("WORKER_ADAPTER=" + adapter);
        WriteLog("WORKER_ID=" + workerId);
        return environment;
    }

    private static Dictionary<string, string> BuildBaseEnvironment()
    {
        Dictionary<string, string> environment =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        IDictionary current = Environment.GetEnvironmentVariables();
        foreach (DictionaryEntry entry in current)
        {
            string key = Convert.ToString(entry.Key);
            string value = Convert.ToString(entry.Value);
            if (!String.IsNullOrEmpty(key) && value != null && key.IndexOf('\0') < 0 && value.IndexOf('\0') < 0)
                environment[key] = value;
        }

        return environment;
    }

    private static int RunDetachedProcess(
        string executable,
        string arguments,
        string workingDirectory,
        Dictionary<string, string> environment)
    {
        RequireFile(executable, "Detached process executable");

        SecurityAttributes security = new SecurityAttributes();
        security.nLength = Marshal.SizeOf(typeof(SecurityAttributes));
        security.lpSecurityDescriptor = IntPtr.Zero;
        security.bInheritHandle = true;

        IntPtr stdoutHandle = IntPtr.Zero;
        IntPtr stdinHandle = IntPtr.Zero;
        IntPtr environmentPointer = IntPtr.Zero;
        ProcessInformation processInfo = new ProcessInformation();

        try
        {
            stdoutHandle = CreateFile(
                LogPath, FileAppendData, FileShareRead | FileShareWrite,
                ref security, OpenAlways, FileAttributeNormal, IntPtr.Zero);
            if (stdoutHandle == new IntPtr(ErrorInvalidHandle))
                throw new IOException("Could not open worker log for child stdout/stderr.", Marshal.GetExceptionForHR(Marshal.GetHRForLastWin32Error()));

            stdinHandle = CreateFile(
                "NUL", GenericRead, FileShareRead | FileShareWrite,
                ref security, OpenExisting, FileAttributeNormal, IntPtr.Zero);
            if (stdinHandle == new IntPtr(ErrorInvalidHandle))
                throw new IOException("Could not open NUL for detached child stdin.");

            StartupInfo startup = new StartupInfo();
            startup.cb = Marshal.SizeOf(typeof(StartupInfo));
            startup.dwFlags = StartfUseStdHandles;
            startup.hStdInput = stdinHandle;
            startup.hStdOutput = stdoutHandle;
            startup.hStdError = stdoutHandle;

            environmentPointer = BuildEnvironmentBlock(environment);

            string commandLine = Quote(executable);
            if (!String.IsNullOrEmpty(arguments))
                commandLine += " " + arguments;

            StringBuilder mutableCommandLine = new StringBuilder(commandLine);

            bool created = CreateProcess(
                executable,
                mutableCommandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                DetachedProcess | CreateUnicodeEnvironment,
                environmentPointer,
                workingDirectory,
                ref startup,
                out processInfo);

            if (!created)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess(DETACHED_PROCESS) failed.");

            WriteLog("DETACHED_CHILD_CREATED PID=" + processInfo.dwProcessId);

            uint waitResult = WaitForSingleObject(processInfo.hProcess, Infinite);
            if (waitResult != WaitObject0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject failed for detached child.");

            uint exitCode;
            if (!GetExitCodeProcess(processInfo.hProcess, out exitCode))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed for detached child.");

            return unchecked((int)exitCode);
        }
        finally
        {
            if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
            if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
            if (stdinHandle != IntPtr.Zero && stdinHandle != new IntPtr(ErrorInvalidHandle)) CloseHandle(stdinHandle);
            if (stdoutHandle != IntPtr.Zero && stdoutHandle != new IntPtr(ErrorInvalidHandle)) CloseHandle(stdoutHandle);
            if (environmentPointer != IntPtr.Zero)
            {
                // The environment block contains the DPAPI-decrypted worker token.
                int length = 0;
                while (Marshal.ReadInt16(environmentPointer, length) != 0 ||
                       Marshal.ReadInt16(environmentPointer, length + 2) != 0)
                    length += 2;
                length += 4;
                byte[] zeroes = new byte[length];
                Marshal.Copy(zeroes, 0, environmentPointer, length);
                Marshal.FreeHGlobal(environmentPointer);
            }
        }
    }

    private static IntPtr BuildEnvironmentBlock(Dictionary<string, string> environment)
    {
        SortedDictionary<string, string> sorted =
            new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (KeyValuePair<string, string> pair in environment)
        {
            if (pair.Key == null || pair.Value == null ||
                pair.Key.IndexOf('\0') >= 0 || pair.Value.IndexOf('\0') >= 0 ||
                pair.Key.IndexOf('=') > 0)
                continue;

            sorted[pair.Key] = pair.Value;
        }

        StringBuilder block = new StringBuilder();
        foreach (KeyValuePair<string, string> pair in sorted)
            block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
        block.Append('\0');

        byte[] bytes = Encoding.Unicode.GetBytes(block.ToString());
        IntPtr memory = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, memory, bytes.Length);
        Array.Clear(bytes, 0, bytes.Length);
        return memory;
    }

    private static byte[] DecryptDpapiSecureString(string encryptedHex)
    {
        byte[] encrypted = FromHex(encryptedHex);
        try
        {
            return ProtectedData.Unprotect(
                encrypted, null, DataProtectionScope.CurrentUser);
        }
        finally
        {
            Array.Clear(encrypted, 0, encrypted.Length);
        }
    }

    private static byte[] FromHex(string value)
    {
        string hex = (value ?? String.Empty).Trim();
        if (hex.Length == 0 || hex.Length % 2 != 0)
            throw new InvalidDataException("DPAPI token blob is not valid hexadecimal.");

        byte[] bytes = new byte[hex.Length / 2];
        for (int i = 0; i < bytes.Length; i++)
            bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
        return bytes;
    }

    private static string ToHex(byte[] bytes)
    {
        StringBuilder output = new StringBuilder(bytes.Length * 2);
        foreach (byte value in bytes)
            output.Append(value.ToString("x2"));
        return output.ToString();
    }

    private static string GetString(Dictionary<string, object> document, string key)
    {
        object value;
        if (!document.TryGetValue(key, out value) || value == null)
            return null;
        return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
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
            // Never allocate or print to a console as a logging fallback.
        }
    }

    // Quote one argument according to Windows CommandLineToArgvW rules.
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
