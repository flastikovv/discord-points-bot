// ClipApp installer: unpacks the app and downloads/installs everything it needs (Python, packages, ffmpeg,
// whisper + model, deno). Reuses what is already installed. Also handles /uninstall.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("ClipApp Setup")]
[assembly: AssemblyProduct("ClipApp")]
[assembly: AssemblyVersion("1.0.0.0")]

class SetupForm : Form
{
    const string APPNAME = "ClipApp";
    const string PY_URL = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip";
    const string PIP_URL = "https://bootstrap.pypa.io/get-pip.py";
    const string FF_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
    static readonly string[] WHISPER_URLS = {
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5907/whisper-bin-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip" };
    const string MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
    const string DENO_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";

    TextBox dirBox, logBox;
    CheckBox desk, runAfter;
    Button go, browse;
    ProgressBar bar;
    Label status;
    bool uninstall;
    volatile bool finished;

    public static bool Silent;
    public static string SilentDir;
    public static int ExitCode;
    public static bool NoReg;
    StreamWriter fileLog;

    void Finish()
    {
        finished = true;
        BeginInvoke((Action)delegate { go.Text = "Закрыть"; go.Enabled = true; if (Silent) Close(); });
    }

    public SetupForm(bool uninstall)
    {
        this.uninstall = uninstall;
        Text = uninstall ? "Удаление ClipApp" : "Установка ClipApp";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        Width = 680; Height = 520; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 9.5f);
        BackColor = Color.FromArgb(26, 28, 34); ForeColor = Color.FromArgb(233, 234, 238);

        var title = new Label { Text = uninstall ? "Удаление ClipApp" : "ClipApp — нарезка видео и стримов в вертикальные клипы",
            Left = 20, Top = 16, Width = 630, Height = 28, Font = new Font("Segoe UI", 13f, FontStyle.Bold) };
        Controls.Add(title);
        var hint = new Label { Left = 20, Top = 48, Width = 630, Height = 40, ForeColor = Color.FromArgb(150, 156, 170),
            Text = uninstall ? "Программа будет удалена. Твои готовые клипы (в выбранных тобой папках) не трогаются."
                             : "Установщик сам скачает и поставит всё нужное: Python, ffmpeg, распознавание речи (whisper, ~470 МБ), " +
                               "загрузчик ссылок. Уже установленное будет использовано повторно." };
        Controls.Add(hint);
        Controls.Add(new Label { Text = uninstall ? "Папка программы:" : "Куда установить:", Left = 20, Top = 98, Width = 140 });
        dirBox = new TextBox { Left = 160, Top = 95, Width = 390, BackColor = Color.FromArgb(34, 37, 45), ForeColor = ForeColor,
            BorderStyle = BorderStyle.FixedSingle };
        dirBox.Text = uninstall ? AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\') : DefaultDir();
        Controls.Add(dirBox);
        browse = new Button { Text = "Обзор…", Left = 560, Top = 93, Width = 90, FlatStyle = FlatStyle.Flat };
        browse.Click += delegate {
            var d = new FolderBrowserDialog { SelectedPath = dirBox.Text, Description = "Папка для ClipApp" };
            if (d.ShowDialog(this) == DialogResult.OK) dirBox.Text = Path.Combine(d.SelectedPath, d.SelectedPath.EndsWith(APPNAME) ? "" : APPNAME).TrimEnd('\\');
        };
        Controls.Add(browse);
        desk = new CheckBox { Text = uninstall ? "Удалить также настройки, пресеты и скачанные по ссылкам видео (папка data)" : "Ярлык на рабочем столе",
            Left = 160, Top = 128, Width = 490, Checked = !uninstall };
        runAfter = new CheckBox { Text = "Запустить ClipApp после установки", Left = 160, Top = 154, Width = 400, Checked = true, Visible = !uninstall };
        Controls.Add(desk); Controls.Add(runAfter);
        go = new Button { Text = uninstall ? "Удалить" : "Установить", Left = 530, Top = 150, Width = 120, Height = 32,
            FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(255, 196, 70), ForeColor = Color.Black, Font = new Font("Segoe UI", 10f, FontStyle.Bold) };
        go.Click += delegate { if (finished) Close(); else Start(); };
        Controls.Add(go);
        bar = new ProgressBar { Left = 20, Top = 196, Width = 630, Height = 18 };
        Controls.Add(bar);
        status = new Label { Left = 20, Top = 218, Width = 630, Height = 22 };
        Controls.Add(status);
        logBox = new TextBox { Left = 20, Top = 244, Width = 630, Height = 220, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(14, 15, 18), ForeColor = Color.FromArgb(185, 191, 204), BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Consolas", 9f) };
        Controls.Add(logBox);
    }

    static string DefaultDir()
    {
        try { if (Directory.Exists(@"E:\")) return @"E:\ClipApp"; } catch { }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\ClipApp");
    }

    void Log(string s)
    {
        BeginInvoke((Action)delegate { logBox.AppendText(s + "\r\n"); });
        try { lock (this) { if (fileLog != null) { fileLog.WriteLine(DateTime.Now.ToString("HH:mm:ss ") + s); fileLog.Flush(); } } } catch { }
    }
    void Status(string s) { BeginInvoke((Action)delegate { status.Text = s; }); }
    void Prog(int p) { BeginInvoke((Action)delegate { bar.Value = Math.Max(0, Math.Min(100, p)); }); }

    void Start()
    {
        go.Enabled = false; browse.Enabled = false; dirBox.ReadOnly = true;
        string dir = dirBox.Text.Trim();
        bool opt = desk.Checked, run = runAfter.Checked;
        try
        {
            string lf = uninstall ? Path.Combine(Path.GetTempPath(), "ClipApp_uninstall.log") : Path.Combine(dir, "install.log");
            Directory.CreateDirectory(Path.GetDirectoryName(lf));
            fileLog = new StreamWriter(lf, false, new UTF8Encoding(true));
        }
        catch { }
        var t = new Thread(delegate () {
            try
            {
                if (uninstall) DoUninstall(dir, opt); else DoInstall(dir, opt, run);
            }
            catch (Exception e)
            {
                ExitCode = 1;
                Log("ОШИБКА: " + e.Message);
                if (Silent) BeginInvoke((Action)delegate { Close(); });
                Status("Ошибка — подробности ниже. Можно запустить установщик ещё раз: скачанное не потеряется.");
                BeginInvoke((Action)delegate { go.Enabled = true; go.Text = "Повторить"; });
            }
        });
        t.IsBackground = true; t.Start();
    }

    // ------------------------------------------------------------------------------------------ install
    void DoInstall(string dir, bool desktop, bool run)
    {
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        Directory.CreateDirectory(dir);
        string rt = Path.Combine(dir, "runtime");
        string dl = Path.Combine(dir, @"data\_setup");
        Directory.CreateDirectory(rt); Directory.CreateDirectory(dl);

        Status("Распаковываю программу…"); Prog(2);
        KillRunning(dir);
        ExtractPayload(dir);
        Log("Программа распакована в " + dir);

        // Python
        string py = Path.Combine(rt, @"python\python.exe");
        if (!File.Exists(py))
        {
            Status("Скачиваю Python…");
            string z = Download(PY_URL, Path.Combine(dl, "python.zip"), 5, 12);
            Unzip(z, Path.Combine(rt, "python"));
            string pth = Path.Combine(rt, @"python\python312._pth");
            File.WriteAllText(pth, "python312.zip\r\n.\r\nLib\\site-packages\r\nimport site\r\n");
            string gp = Download(PIP_URL, Path.Combine(dl, "get-pip.py"), 12, 14);
            Status("Ставлю pip…");
            Run(py, "\"" + gp + "\" --no-warn-script-location", rt);
        }
        else Log("Python уже есть — пропускаю");
        Status("Ставлю пакеты Python (numpy, Pillow, yt-dlp, anthropic)…"); Prog(16);
        Run(py, "-m pip install --disable-pip-version-check --no-warn-script-location --upgrade numpy pillow \"yt-dlp[default]\" anthropic", rt);
        Prog(28);

        // ffmpeg
        string ff = Path.Combine(rt, @"ffmpeg\ffmpeg.exe");
        if (!File.Exists(ff))
        {
            Status("Скачиваю ffmpeg (~115 МБ)…");
            string z = Download(FF_URL, Path.Combine(dl, "ffmpeg.zip"), 28, 45);
            string tmp = Path.Combine(dl, "ff");
            Unzip(z, tmp);
            Directory.CreateDirectory(Path.Combine(rt, "ffmpeg"));
            foreach (string f in Directory.GetFiles(tmp, "*.exe", SearchOption.AllDirectories))
                File.Copy(f, Path.Combine(rt, "ffmpeg", Path.GetFileName(f)), true);
            Directory.Delete(tmp, true);
        }
        else Log("ffmpeg уже есть — пропускаю");
        Prog(46);

        // whisper
        bool haveWhisper = File.Exists(@"E:\tools\whisper\main.exe") && File.Exists(@"E:\tools\whisper\ggml-small.bin");
        string wdir = Path.Combine(rt, "whisper");
        if (!haveWhisper && !File.Exists(Path.Combine(wdir, "whisper-cli.exe")) && !File.Exists(Path.Combine(wdir, "main.exe")))
        {
            Status("Скачиваю whisper (распознавание речи)…");
            string z = null;
            foreach (string u in WHISPER_URLS)
            {
                try { z = Download(u, Path.Combine(dl, "whisper.zip"), 46, 50); break; }
                catch (Exception e) { Log("  не вышло: " + e.Message); }
            }
            if (z == null) throw new Exception("Не удалось скачать whisper");
            string tmp = Path.Combine(dl, "wh");
            Unzip(z, tmp);
            Directory.CreateDirectory(wdir);
            foreach (string f in Directory.GetFiles(tmp, "*", SearchOption.AllDirectories))
                if (f.EndsWith(".exe") || f.EndsWith(".dll")) File.Copy(f, Path.Combine(wdir, Path.GetFileName(f)), true);
            Directory.Delete(tmp, true);
        }
        else if (haveWhisper) Log("whisper найден в E:\\tools\\whisper — использую его");
        if (!haveWhisper && !File.Exists(Path.Combine(wdir, "ggml-small.bin")))
        {
            Status("Скачиваю модель речи ggml-small (~470 МБ, это самое долгое)…");
            Download(MODEL_URL, Path.Combine(wdir, "ggml-small.bin"), 50, 90);
        }
        Prog(90);

        // deno (YouTube links)
        string deno = Path.Combine(rt, @"deno\deno.exe");
        if (!File.Exists(deno))
        {
            Status("Скачиваю Deno (нужен для ссылок YouTube)…");
            string z = Download(DENO_URL, Path.Combine(dl, "deno.zip"), 90, 97);
            Unzip(z, Path.Combine(rt, "deno"));
        }
        Prog(97);

        // shortcuts + uninstall entry
        if (NoReg) { Prog(100); Status("Готово (без ярлыков)."); Log("Готово (тестовая установка без ярлыков)."); Finish(); return; }
        Status("Создаю ярлыки…");
        string exe = Path.Combine(dir, "ClipApp.exe");
        string self = Application.ExecutablePath;
        string setupCopy = Path.Combine(dir, "ClipApp_Setup.exe");
        if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(setupCopy), StringComparison.OrdinalIgnoreCase))
            File.Copy(self, setupCopy, true);
        string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "ClipApp.lnk");
        Shortcut(startMenu, exe, dir);
        if (desktop) Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "ClipApp.lnk"), exe, dir);
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipApp"))
        {
            k.SetValue("DisplayName", "ClipApp — нарезка в вертикаль");
            k.SetValue("DisplayVersion", "1.0");
            k.SetValue("Publisher", "ClipApp");
            k.SetValue("DisplayIcon", exe);
            k.SetValue("InstallLocation", dir);
            k.SetValue("UninstallString", "\"" + setupCopy + "\" /uninstall");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
        try { Directory.Delete(dl, true); } catch { }
        Prog(100);
        Status("Готово! ClipApp установлен.");
        Log("Готово. Ярлык ClipApp — на рабочем столе и в меню «Пуск».");
        Finish();
        if (run) Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = dir, UseShellExecute = true });
    }

    void ExtractPayload(string dir)
    {
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
        if (s == null) throw new Exception("В установщике нет файлов программы");
        using (var za = new ZipArchive(s, ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry e in za.Entries)
            {
                if (string.IsNullOrEmpty(e.Name)) continue;
                string dst = Path.Combine(dir, e.FullName.Replace('/', '\\'));
                bool userFile = e.FullName.StartsWith("config/") || e.FullName.StartsWith("banners/");
                if (userFile && File.Exists(dst)) continue;   // never overwrite the user's key or banners
                Directory.CreateDirectory(Path.GetDirectoryName(dst));
                e.ExtractToFile(dst, true);
            }
        }
    }

    static void KillRunning(string dir)
    {
        // close a running ClipApp (its python) so files can be replaced
        try
        {
            foreach (Process p in Process.GetProcessesByName("pythonw"))
            {
                try { if (p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) p.Kill(); } catch { }
            }
        }
        catch { }
    }

    string Download(string url, string dst, int p0, int p1)
    {
        Log("Скачиваю " + url);
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = "ClipApp-Setup/1.0";
                req.AllowAutoRedirect = true;
                req.Timeout = 60000; req.ReadWriteTimeout = 120000;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var rs = resp.GetResponseStream())
                using (var fs = File.Create(dst + ".part"))
                {
                    long total = resp.ContentLength, got = 0;
                    byte[] buf = new byte[1 << 16];
                    int n; DateTime last = DateTime.MinValue;
                    while ((n = rs.Read(buf, 0, buf.Length)) > 0)
                    {
                        fs.Write(buf, 0, n); got += n;
                        if ((DateTime.Now - last).TotalMilliseconds > 300)
                        {
                            last = DateTime.Now;
                            if (total > 0) Prog(p0 + (int)((p1 - p0) * got / total));
                            Status(string.Format("Скачиваю {0}: {1:0} / {2:0} МБ", Path.GetFileName(dst), got / 1048576.0, total / 1048576.0));
                        }
                    }
                }
                if (File.Exists(dst)) File.Delete(dst);
                File.Move(dst + ".part", dst);
                return dst;
            }
            catch (Exception e)
            {
                if (attempt >= 3) throw new Exception("не удалось скачать " + url + ": " + e.Message);
                Log("  повтор (" + e.Message + ")");
                Thread.Sleep(3000);
            }
        }
    }

    static void Unzip(string zip, string dst)
    {
        Directory.CreateDirectory(dst);
        using (ZipArchive za = ZipFile.OpenRead(zip))
            foreach (ZipArchiveEntry e in za.Entries)
            {
                string p = Path.Combine(dst, e.FullName.Replace('/', '\\'));
                if (string.IsNullOrEmpty(e.Name)) { Directory.CreateDirectory(p); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(p));
                e.ExtractToFile(p, true);
            }
    }

    void Run(string exe, string args, string cwd)
    {
        var psi = new ProcessStartInfo(exe, args) { WorkingDirectory = cwd, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        using (var p = Process.Start(psi))
        {
            p.ErrorDataReceived += delegate (object o, DataReceivedEventArgs e) { if (e.Data != null && e.Data.Trim() != "") Log("  " + e.Data); };
            p.BeginErrorReadLine();
            string line;
            while ((line = p.StandardOutput.ReadLine()) != null)
                if (line.Trim() != "") Log("  " + line);
            p.WaitForExit();
            if (p.ExitCode != 0) throw new Exception(Path.GetFileName(exe) + " завершился с кодом " + p.ExitCode);
        }
    }

    static void Shortcut(string lnk, string target, string dir)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object sh = Activator.CreateInstance(t);
        object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
        Type st = sc.GetType();
        st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
        st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { dir });
        st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
        st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "ClipApp — нарезка видео и стримов в вертикальные клипы" });
        st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
    }

    // ---------------------------------------------------------------------------------------- uninstall
    void DoUninstall(string dir, bool withData)
    {
        if (!File.Exists(Path.Combine(dir, "ClipApp.exe")) || !Directory.Exists(Path.Combine(dir, "app")))
            throw new Exception("В этой папке нет ClipApp: " + dir);
        Status("Удаляю…");
        KillRunning(dir);
        foreach (string lnk in new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "ClipApp.lnk"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "ClipApp.lnk") })
            if (File.Exists(lnk)) File.Delete(lnk);
        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipApp"); } catch { }
        Prog(20);
        foreach (string sub in new[] { "app", "runtime", "_build" })
        {
            string p = Path.Combine(dir, sub);
            if (Directory.Exists(p)) { Log("Удаляю " + p); Directory.Delete(p, true); }
        }
        Prog(70);
        if (withData && Directory.Exists(Path.Combine(dir, "data"))) { Log("Удаляю настройки и кэш"); Directory.Delete(Path.Combine(dir, "data"), true); }
        foreach (string f in new[] { "ClipApp.exe", "Как пользоваться.txt", "ClipApp.ico" })
            if (File.Exists(Path.Combine(dir, f))) File.Delete(Path.Combine(dir, f));
        // the setup copy deletes itself after exit
        Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 > nul & del \"" + Path.Combine(dir, "ClipApp_Setup.exe") + "\"")
            { CreateNoWindow = true, UseShellExecute = false });
        Prog(100);
        Status("ClipApp удалён. Баннеры и ключ остались в " + dir + " (banners, config) — удали вручную, если не нужны.");
        Finish();
    }

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool un = false, nodesk = false, norun = false;
        foreach (string a in args)
        {
            string l = a.ToLower();
            if (l.Contains("uninstall")) un = true;
            else if (l == "/silent") Silent = true;
            else if (l.StartsWith("/dir=")) SilentDir = a.Substring(5).Trim('"');
            else if (l == "/nodesktop") nodesk = true;
            else if (l == "/norun") norun = true;
            else if (l == "/noreg") NoReg = true;
        }
        var f = new SetupForm(un);
        if (SilentDir != null) f.dirBox.Text = SilentDir;
        if (nodesk) f.desk.Checked = un;
        if (norun) f.runAfter.Checked = false;
        if (Silent) f.Shown += delegate { f.Start(); };
        Application.Run(f);
        Environment.Exit(ExitCode);
    }
}
