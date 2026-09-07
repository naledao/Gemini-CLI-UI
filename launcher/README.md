# Gemini CLI UI Launcher

一个简化的 Windows 启动器。

界面只有两个配置项：

- 本地代码地址
- 本地代理端口（默认 `7897`，实际代理地址为 `http://127.0.0.1:<端口>`）

点击“启动”后自动执行：

1. 校验本地 Git 项目目录。
2. 使用配置的本地代理执行 `git pull --ff-only`。
3. 使用同一代理环境执行 `npm install`。
4. 执行 `npm run build`。
5. 执行 `npm run server`。
6. 读取项目 `.env` 中的 `PORT`；未配置时使用服务端默认端口 `4008`。
7. 等待服务可访问后自动打开默认浏览器。

启动器不会执行 `git reset`、`git clean` 或 `git stash`，因此不会为了更新代码主动覆盖本地修改。如果本地修改导致 `git pull --ff-only` 无法继续，会直接在日志中报错并停止后续步骤。

配置保存在：

```text
%LOCALAPPDATA%\GeminiCliUiLauncher\config.json
```

## 构建

在项目根目录执行：

```powershell
npm run launcher:build
```

产物：

```text
launcher\dist\Gemini-CLI-UI-Launcher.exe
```

该构建为 `win-x64`、self-contained、single-file，可直接双击运行，不要求目标机器额外安装 .NET Runtime；但目标机器仍需具备 Git 和 Node.js/npm，因为启动器需要更新并构建本地 Gemini-CLI-UI 源码。
