using System;
using System.Runtime.InteropServices;

internal static class AriaConsoleSubsystemProbe
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    private static int Main()
    {
        if (GetConsoleWindow() == IntPtr.Zero)
        {
            Console.WriteLine("DETACHED_CHILD_CONSOLE=NONE");
            return 0;
        }

        Console.WriteLine("DETACHED_CHILD_CONSOLE=PRESENT");
        return 9;
    }
}
