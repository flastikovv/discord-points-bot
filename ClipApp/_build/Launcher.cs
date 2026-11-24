using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("ClipApp")]
[assembly: System.Reflection.AssemblyProduct("ClipApp")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class Launcher
{
    [STAThread]
    static void Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string py = Path.Combine(dir, @"runtime\python\pythonw.exe");
        string srv = Path.Combine(dir, @"app\server.py");
        if (!File.Exists(py) || !File.Exists(srv))
        {
            MessageBox.Show("Не найдены файлы программы (runtime\\python или app\\server.py).\n" +
                            "Запусти установщик ClipApp_Setup.exe ещё раз.", "ClipApp", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var psi = new ProcessStartInfo(py, "\"" + srv + "\"");
        psi.WorkingDirectory = Path.Combine(dir, "app");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process p = Process.Start(psi);
        if (p.WaitForExit(8000) && p.ExitCode != 0)
        {
            string log = Path.Combine(dir, @"data\app.log");
            string tail = "";
            try
            {
                string[] lines = File.ReadAllLines(log);
                int n = Math.Max(0, lines.Length - 15);
                tail = string.Join("\n", lines, n, lines.Length - n);
            }
            catch { }
            MessageBox.Show("ClipApp не запустился.\n\n" + tail, "ClipApp", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
