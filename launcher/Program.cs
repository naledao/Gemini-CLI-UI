using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GeminiCliUiLauncher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class LauncherConfig
{
    public string ProjectPath { get; set; } = string.Empty;
    public int ProxyPort { get; set; } = 7897;
    public string NodePath { get; set; } = string.Empty;
}

internal sealed class MainForm : Form
{
    private readonly TextBox _projectPath = new();
    private readonly TextBox _nodePath = new();
    private readonly TextBox _proxyPort = new();
    private readonly Button _browseButton = new();
    private readonly Button _nodeBrowseButton = new();
    private readonly Button _startButton = new();
    private readonly TextBox _logBox = new();
    private Process? _serverProcess;

    private static readonly string ConfigDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "GeminiCliUiLauncher");

    private static readonly string ConfigPath = Path.Combine(ConfigDirectory, "config.json");

    public MainForm()
    {
        Text = "Gemini CLI UI Launcher";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(700, 560);
        Size = new Size(820, 650);
        Font = new Font("Microsoft YaHei UI", 9F);

        var title = new Label
        {
            Text = "Gemini CLI UI Launcher",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 16F, FontStyle.Bold),
            Location = new Point(24, 22)
        };

        var pathLabel = new Label
        {
            Text = "本地代码地址",
            AutoSize = true,
            Location = new Point(26, 76)
        };

        _projectPath.Location = new Point(28, 101);
        _projectPath.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        _projectPath.Width = 650;

        _browseButton.Text = "选择";
        _browseButton.Location = new Point(690, 99);
        _browseButton.Size = new Size(88, 30);
        _browseButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _browseButton.Click += BrowseButton_Click;

        var nodeLabel = new Label
        {
            Text = "Node.js 地址",
            AutoSize = true,
            Location = new Point(26, 146)
        };

        _nodePath.Location = new Point(28, 171);
        _nodePath.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        _nodePath.Width = 650;

        _nodeBrowseButton.Text = "选择";
        _nodeBrowseButton.Location = new Point(690, 169);
        _nodeBrowseButton.Size = new Size(88, 30);
        _nodeBrowseButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _nodeBrowseButton.Click += NodeBrowseButton_Click;

        var proxyLabel = new Label
        {
            Text = "代理端口（127.0.0.1）",
            AutoSize = true,
            Location = new Point(26, 216)
        };

        _proxyPort.Location = new Point(28, 241);
        _proxyPort.Width = 160;
        _proxyPort.Text = "7897";

        _startButton.Text = "启动";
        _startButton.Location = new Point(28, 288);
        _startButton.Size = new Size(160, 42);
        _startButton.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);
        _startButton.Click += StartButton_Click;

        var logLabel = new Label
        {
            Text = "运行日志",
            AutoSize = true,
            Location = new Point(26, 352)
        };

        _logBox.Location = new Point(28, 377);
        _logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        _logBox.Size = new Size(750, 220);
        _logBox.Multiline = true;
        _logBox.ReadOnly = true;
        _logBox.ScrollBars = ScrollBars.Vertical;
        _logBox.WordWrap = false;
        _logBox.BackColor = SystemColors.Window;

        Controls.AddRange([
            title, pathLabel, _projectPath, _browseButton,
            nodeLabel, _nodePath, _nodeBrowseButton,
            proxyLabel, _proxyPort, _startButton, logLabel, _logBox
        ]);

        Load += (_, _) => LoadConfig();
        FormClosing += (_, _) => SaveConfigSilently();
    }

    private void BrowseButton_Click(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择 Gemini-CLI-UI 本地代码目录",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false
        };

        if (Directory.Exists(_projectPath.Text))
            dialog.SelectedPath = _projectPath.Text;

        if (dialog.ShowDialog(this) == DialogResult.OK)
            _projectPath.Text = dialog.SelectedPath;
    }

    private void NodeBrowseButton_Click(object? sender, EventArgs e)
    {
        using var dialog = new OpenFileDialog
        {
            Title = "选择 Node.js 的 node.exe",
            Filter = "Node.js (node.exe)|node.exe|可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };

        var currentNodePath = _nodePath.Text.Trim().Trim('"');
        if (File.Exists(currentNodePath))
        {
            dialog.InitialDirectory = Path.GetDirectoryName(currentNodePath);
            dialog.FileName = Path.GetFileName(currentNodePath);
        }

        if (dialog.ShowDialog(this) == DialogResult.OK)
            _nodePath.Text = dialog.FileName;
    }

    private async void StartButton_Click(object? sender, EventArgs e)
    {
        if (!TryReadSettings(out var projectDir, out var proxyPort, out var nodePath, out var npmPath))
            return;

        SaveConfig(projectDir, proxyPort, nodePath);
        _startButton.Enabled = false;
        _browseButton.Enabled = false;
        _nodeBrowseButton.Enabled = false;
        _logBox.Clear();

        try
        {
            var proxy = $"http://127.0.0.1:{proxyPort}";
            var nodeDirectory = Path.GetDirectoryName(nodePath)!;
            var currentPath = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["HTTP_PROXY"] = proxy,
                ["HTTPS_PROXY"] = proxy,
                ["ALL_PROXY"] = proxy,
                ["http_proxy"] = proxy,
                ["https_proxy"] = proxy,
                ["all_proxy"] = proxy,
                ["PATH"] = string.IsNullOrWhiteSpace(currentPath)
                    ? nodeDirectory
                    : nodeDirectory + Path.PathSeparator + currentPath
            };

            Log($"项目目录：{projectDir}");
            Log($"Node.js：{nodePath}");
            Log($"代理：{proxy}");
            Log(string.Empty);

            var dependencySnapshotBeforePull = CaptureDependencySnapshot(projectDir);

            Log("[1/4] 拉取最新代码...");
            await RunCommandAsync(
                "git.exe",
                $"-c http.proxy={Quote(proxy)} -c https.proxy={Quote(proxy)} pull --ff-only",
                projectDir,
                env);

            var dependencySnapshotAfterPull = CaptureDependencySnapshot(projectDir);
            var nodeModulesExists = Directory.Exists(Path.Combine(projectDir, "node_modules"));
            var dependencyFilesChanged = dependencySnapshotBeforePull != dependencySnapshotAfterPull;

            Log("[2/4] 检查依赖...");
            if (!nodeModulesExists || dependencyFilesChanged)
            {
                Log(!nodeModulesExists
                    ? "node_modules 不存在，开始安装依赖..."
                    : "package.json/package-lock.json 已变化，开始安装/更新依赖...");
                await RunCommandAsync(npmPath, "install", projectDir, env);
            }
            else
            {
                Log("依赖清单未变化，跳过 npm install。");
            }

            Log("[3/4] 构建项目...");
            await RunCommandAsync(npmPath, "run build", projectDir, env);

            var port = ReadProjectPort(projectDir);
            var url = $"http://127.0.0.1:{port}";

            Log($"[4/4] 启动服务，端口 {port}...");
            StartServer(projectDir, npmPath, env);

            Log("等待服务可访问...");
            var ready = await WaitForServerAsync(url, TimeSpan.FromSeconds(45));
            if (!ready)
                throw new InvalidOperationException($"服务在 45 秒内没有响应：{url}");

            Log($"启动成功：{url}");
            Log("正在打开默认浏览器...");
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Log(string.Empty);
            Log($"启动失败：{ex.Message}");
            MessageBox.Show(this, ex.Message, "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _startButton.Enabled = true;
            _browseButton.Enabled = true;
            _nodeBrowseButton.Enabled = true;
        }
    }

    private bool TryReadSettings(out string projectDir, out int proxyPort, out string nodePath, out string npmPath)
    {
        projectDir = _projectPath.Text.Trim().Trim('"');
        proxyPort = 0;
        nodePath = _nodePath.Text.Trim().Trim('"');
        npmPath = string.Empty;

        if (!Directory.Exists(projectDir))
        {
            MessageBox.Show(this, "本地代码地址不存在。", "配置错误", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        if (!File.Exists(Path.Combine(projectDir, "package.json")) ||
            !Directory.Exists(Path.Combine(projectDir, ".git")))
        {
            MessageBox.Show(this, "该目录不是有效的 Gemini-CLI-UI Git 项目目录。", "配置错误", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        if (!int.TryParse(_proxyPort.Text.Trim(), out proxyPort) || proxyPort is < 1 or > 65535)
        {
            MessageBox.Show(this, "代理端口必须是 1-65535 之间的数字。", "配置错误", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        if (!File.Exists(nodePath) || !Path.GetFileName(nodePath).Equals("node.exe", StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show(this, "Node.js 地址必须指向一个存在的 node.exe。", "配置错误", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        var nodeDirectory = Path.GetDirectoryName(nodePath);
        if (string.IsNullOrWhiteSpace(nodeDirectory))
        {
            MessageBox.Show(this, "无法解析 Node.js 所在目录。", "配置错误", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        npmPath = Path.Combine(nodeDirectory, "npm.cmd");
        if (!File.Exists(npmPath))
        {
            MessageBox.Show(this, $"所选 Node.js 目录中没有找到 npm.cmd：{npmPath}", "配置错误", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        return true;
    }

    private async Task RunCommandAsync(
        string fileName,
        string arguments,
        string workingDirectory,
        IReadOnlyDictionary<string, string> environment)
    {
        using var process = new Process();
        process.StartInfo = CreateProcessStartInfo(fileName, arguments, workingDirectory, environment);
        var outputLines = new List<string>();
        var outputLock = new object();

        void CaptureAndLog(string? line)
        {
            if (line is null)
                return;

            lock (outputLock)
                outputLines.Add(line);

            Log(line);
        }

        process.OutputDataReceived += (_, e) => CaptureAndLog(e.Data);
        process.ErrorDataReceived += (_, e) => CaptureAndLog(e.Data);

        try
        {
            if (!process.Start())
                throw new InvalidOperationException($"无法启动命令：{fileName}");
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            throw new InvalidOperationException($"找不到或无法启动 {fileName}。请确认 Git、Node.js/npm 已安装并加入 PATH。", ex);
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        process.WaitForExit();

        if (process.ExitCode != 0)
        {
            string[] outputTail;
            lock (outputLock)
                outputTail = outputLines.TakeLast(40).ToArray();

            var outputText = string.Join(Environment.NewLine, outputTail);
            if ((outputText.Contains("node-pty", StringComparison.OrdinalIgnoreCase) ||
                 outputText.Contains("node-gyp", StringComparison.OrdinalIgnoreCase)) &&
                (outputText.Contains("Could not find any Visual Studio installation", StringComparison.OrdinalIgnoreCase) ||
                 outputText.Contains("Desktop development with C++", StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException(
                    "npm 安装失败：node-pty 需要本机 C++ 编译环境，但当前没有检测到可用的 Visual Studio Build Tools。" +
                    Environment.NewLine + Environment.NewLine +
                    "请安装 Visual Studio Build Tools，并勾选“Desktop development with C++（使用 C++ 的桌面开发）”。" +
                    Environment.NewLine +
                    "如果依赖文件没有变化，启动器会自动跳过 npm install，不会再次触发该问题。");
            }

            var details = outputTail.Length == 0
                ? string.Empty
                : Environment.NewLine + Environment.NewLine + "最后的命令输出：" + Environment.NewLine + outputText;

            throw new InvalidOperationException(
                $"命令执行失败（退出码 {process.ExitCode}）：{fileName} {arguments}{details}");
        }
    }

    private readonly record struct DependencySnapshot(string PackageJsonHash, string PackageLockHash);

    private static DependencySnapshot CaptureDependencySnapshot(string projectDir)
    {
        return new DependencySnapshot(
            ComputeFileSha256(Path.Combine(projectDir, "package.json")),
            ComputeFileSha256(Path.Combine(projectDir, "package-lock.json")));
    }

    private static string ComputeFileSha256(string path)
    {
        if (!File.Exists(path))
            return string.Empty;

        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    private void StartServer(
        string projectDir,
        string npmPath,
        IReadOnlyDictionary<string, string> environment)
    {
        if (_serverProcess is { HasExited: false })
        {
            Log("已有由本启动器创建的服务进程正在运行，跳过重复启动。");
            return;
        }

        _serverProcess?.Dispose();
        _serverProcess = new Process
        {
            StartInfo = CreateProcessStartInfo(npmPath, "run server", projectDir, environment),
            EnableRaisingEvents = true
        };

        _serverProcess.OutputDataReceived += (_, e) => { if (e.Data is not null) Log("[server] " + e.Data); };
        _serverProcess.ErrorDataReceived += (_, e) => { if (e.Data is not null) Log("[server] " + e.Data); };
        _serverProcess.Exited += (_, _) => Log($"[server] 服务进程已退出，退出码：{_serverProcess?.ExitCode}");

        try
        {
            if (!_serverProcess.Start())
                throw new InvalidOperationException("无法启动 npm run server。");
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            throw new InvalidOperationException("无法启动 npm。请确认 Node.js/npm 已安装并加入 PATH。", ex);
        }

        _serverProcess.BeginOutputReadLine();
        _serverProcess.BeginErrorReadLine();
    }

    private static ProcessStartInfo CreateProcessStartInfo(
        string fileName,
        string arguments,
        string workingDirectory,
        IReadOnlyDictionary<string, string> environment)
    {
        var psi = new ProcessStartInfo(fileName, arguments)
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        foreach (var pair in environment)
            psi.Environment[pair.Key] = pair.Value;

        return psi;
    }

    private static int ReadProjectPort(string projectDir)
    {
        var envPath = Path.Combine(projectDir, ".env");
        if (!File.Exists(envPath))
            return 4008;

        foreach (var rawLine in File.ReadLines(envPath))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
                continue;

            var equalsIndex = line.IndexOf('=');
            if (equalsIndex <= 0)
                continue;

            var key = line[..equalsIndex].Trim();
            if (!key.Equals("PORT", StringComparison.OrdinalIgnoreCase))
                continue;

            var value = line[(equalsIndex + 1)..].Trim().Trim('"', '\'');
            if (int.TryParse(value, out var port) && port is > 0 and <= 65535)
                return port;
        }

        return 4008;
    }

    private static async Task<bool> WaitForServerAsync(string url, TimeSpan timeout)
    {
        using var handler = new HttpClientHandler
        {
            Proxy = null,
            UseProxy = false,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(2) };

        var end = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < end)
        {
            try
            {
                using var response = await client.GetAsync(url);
                if ((int)response.StatusCode < 500)
                    return true;
            }
            catch
            {
                // Server is still starting.
            }

            await Task.Delay(750);
        }

        return false;
    }

    private void Log(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => Log(message));
            return;
        }

        _logBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
        _logBox.SelectionStart = _logBox.TextLength;
        _logBox.ScrollToCaret();
    }

    private void LoadConfig()
    {
        var fallback = FindProjectRoot(AppContext.BaseDirectory) ?? string.Empty;
        var fallbackNodePath = FindNodeFromPath() ?? string.Empty;
        var config = new LauncherConfig { ProjectPath = fallback, ProxyPort = 7897, NodePath = fallbackNodePath };

        try
        {
            if (File.Exists(ConfigPath))
            {
                config = JsonSerializer.Deserialize<LauncherConfig>(File.ReadAllText(ConfigPath)) ?? config;
                if (string.IsNullOrWhiteSpace(config.ProjectPath))
                    config.ProjectPath = fallback;
                if (string.IsNullOrWhiteSpace(config.NodePath))
                    config.NodePath = fallbackNodePath;
            }
        }
        catch
        {
            // Keep defaults when config is malformed.
        }

        _projectPath.Text = config.ProjectPath;
        _nodePath.Text = config.NodePath;
        _proxyPort.Text = config.ProxyPort.ToString();
    }

    private void SaveConfig(string projectDir, int proxyPort, string nodePath)
    {
        Directory.CreateDirectory(ConfigDirectory);
        var config = new LauncherConfig { ProjectPath = projectDir, ProxyPort = proxyPort, NodePath = nodePath };
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true }));
    }

    private void SaveConfigSilently()
    {
        if (!int.TryParse(_proxyPort.Text.Trim(), out var port) || port is < 1 or > 65535)
            port = 7897;

        try
        {
            SaveConfig(_projectPath.Text.Trim(), port, _nodePath.Text.Trim().Trim('"'));
        }
        catch
        {
            // Closing the launcher should not fail because config cannot be saved.
        }
    }

    private static string? FindProjectRoot(string startPath)
    {
        var directory = new DirectoryInfo(startPath);
        for (var i = 0; directory is not null && i < 6; i++, directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) &&
                Directory.Exists(Path.Combine(directory.FullName, ".git")))
                return directory.FullName;
        }

        return null;
    }

    private static string? FindNodeFromPath()
    {
        var pathValue = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(pathValue))
            return null;

        foreach (var rawEntry in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var entry = rawEntry.Trim('"');
            if (entry.Length == 0)
                continue;

            try
            {
                var candidate = Path.Combine(entry, "node.exe");
                if (File.Exists(candidate))
                    return Path.GetFullPath(candidate);
            }
            catch
            {
                // Ignore malformed PATH entries.
            }
        }

        return null;
    }

    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";
}
