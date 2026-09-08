import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sessionManager from './sessionManager.js';
import GeminiResponseHandler from './gemini-response-handler.js';
import { settingsDb } from './database/db.js';
import { getSystemHomeDirectory, createSystemUserEnvironment } from './system-home.js';


function resolveToolWorkingDirectory(toolName, params, workspaceRoot) {
  const nonFsTools = new Set([
    'google_web_search',
    'web_search',
    'web_fetch',
    'update_topic',
    'activate_skill',
    'enter_plan_mode'
  ]);
  if (nonFsTools.has(toolName)) {
    return null;
  }

  const p = params || {};
  const rawWorkdir = p.dir_path || p.workdir || p.cwd;
  if (rawWorkdir && typeof rawWorkdir === 'string' && rawWorkdir.trim()) {
    const trimmed = rawWorkdir.trim();
    if (path.isAbsolute(trimmed)) {
      return path.normalize(trimmed);
    }
    return path.resolve(workspaceRoot, trimmed);
  }

  return workspaceRoot;
}

let activeGeminiProcesses = new Map(); // Track active processes by session ID

async function getGeminiUpstreamBaseUrl() {
  const fromEnv = process.env.GOOGLE_GEMINI_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  try {
    const envPath = path.join(getSystemHomeDirectory(), '.gemini', '.env');
    const content = await fs.readFile(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^GOOGLE_GEMINI_BASE_URL\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (value) return value.replace(/\/$/, '');
    }
  } catch {
    // Gemini CLI can still use its default endpoint when no custom gateway is configured.
  }

  return null;
}

function getGeminiRunStatus(runId) {
  if (!runId) {
    return { active: false, runId: null };
  }

  const geminiProcess = activeGeminiProcesses.get(runId);
  if (!geminiProcess) {
    return { active: false, runId };
  }

  return {
    active: geminiProcess.exitCode === null,
    runId: geminiProcess.runId || runId,
    sessionId: geminiProcess.capturedSessionId || null,
    projectName: geminiProcess.projectName || null,
    projectPath: geminiProcess.projectPath || null,
    runtimeStatus: geminiProcess.runtimeStatus || null
  };
}
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_BINARY_SETTING_KEY = 'gemini_binary_path';
const GEMINI_APPROVAL_MODES = new Set(['default', 'auto_edit', 'plan', 'yolo']);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getConfiguredGeminiBinaryPath() {
  const configured = settingsDb.get(GEMINI_BINARY_SETTING_KEY);
  return configured?.trim() || null;
}

async function resolveEmbeddedGeminiPath() {
  const runtimeId = `${process.platform}-${process.arch}`;
  const executableName = process.platform === 'win32' ? 'gemini.exe' : 'gemini';
  const candidates = [
    path.resolve(moduleDir, '..', 'runtime', runtimeId, executableName),
    path.resolve(process.cwd(), 'runtime', runtimeId, executableName),
    path.resolve(path.dirname(process.execPath), 'runtime', runtimeId, executableName)
  ];

  const uniqueCandidates = [...new Set(candidates)];
  for (const candidate of uniqueCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Embedded Gemini runtime is missing for ${runtimeId}. Expected ${executableName} in one of: ${uniqueCandidates.join(', ')}. ` +
    `Build or install runtime/${runtimeId} before starting Gemini.`
  );
}

async function resolveGeminiLaunch() {
  const override = process.env.GEMINI_PATH?.trim();
  if (override) {
    const configuredPath = path.resolve(override.replace(/^"|"$/g, ''));
    if (!(await fileExists(configuredPath))) {
      throw new Error(`GEMINI_PATH does not exist: ${configuredPath}`);
    }
    if (/\.js$/i.test(configuredPath)) {
      return { command: process.execPath, prefixArgs: [configuredPath], displayPath: configuredPath, source: 'development-override' };
    }
    return { command: configuredPath, prefixArgs: [], displayPath: configuredPath, source: 'development-override' };
  }

  const persistedPath = getConfiguredGeminiBinaryPath();
  if (persistedPath) {
    const configuredPath = path.resolve(persistedPath.replace(/^"|"$/g, ''));
    if (!(await fileExists(configuredPath))) {
      throw new Error(
        `Configured Gemini CLI binary does not exist: ${configuredPath}. ` +
        'Choose another binary in Settings or reset the setting to use the embedded runtime.'
      );
    }
    return { command: configuredPath, prefixArgs: [], displayPath: configuredPath, source: 'configured' };
  }

  const embeddedPath = await resolveEmbeddedGeminiPath();
  return { command: embeddedPath, prefixArgs: [], displayPath: embeddedPath, source: 'embedded' };
}

async function spawnGemini(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, images, attachments, runId } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let fullResponse = ''; // Accumulate the full response
    
    // Process images if provided
    
    // Build Gemini CLI command - start with print/resume flags first
    const args = [];
    
    // Always trust workspace in automated/headless mode
    args.push('--skip-trust');

    // Approval mode is selected by Gemini CLI UI. Validate it server-side so
    // arbitrary client input cannot be forwarded as a CLI argument.
    const approvalMode = GEMINI_APPROVAL_MODES.has(options.approvalMode)
      ? options.approvalMode
      : 'default';
    args.push(`--approval-mode=${approvalMode}`);

    // Resume existing session if sessionId is provided
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    // Add prompt flag with command if we have a command
    if (command && command.trim()) {
      args.push('--prompt', command);
    }
    
    // Use cwd (actual project directory) instead of projectPath (Gemini's metadata directory)
    // Debug - cwd and projectPath
    // Keep Unicode paths intact (for example C:\项目\代码 on Windows).
    const workingDir = path.resolve(String(cwd || process.cwd()).trim());
    // Debug - workingDir
    
    // Collect persistent attachment paths. New clients upload files before the
    // WebSocket command, so Gemini can read the files directly without another copy.
    const attachmentPaths = [];
    if (Array.isArray(attachments)) {
      for (const attachment of attachments) {
        if (!attachment?.path) continue;
        try {
          const resolvedPath = path.resolve(attachment.path);
          const relativePath = path.relative(path.resolve(workingDir), resolvedPath);
          if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
          const stat = await fs.stat(resolvedPath);
          if (stat.isFile()) attachmentPaths.push(resolvedPath);
        } catch (error) {
          // Ignore missing or invalid attachment paths.
        }
      }
    }

    // Backward compatibility for old clients that still send base64 images.
    // Persist those images in the project too, and intentionally never delete them.
    if (images && images.length > 0) {
      try {
        const persistentDir = path.join(
          workingDir,
          '.gemini-cli-ui',
          'uploads',
          `legacy-${Date.now()}-${Math.round(Math.random() * 1e9)}`
        );
        await fs.mkdir(persistentDir, { recursive: true });

        for (const [index, image] of images.entries()) {
          const matches = image.data?.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) continue;

          const [, mimeType, base64Data] = matches;
          const extension = (mimeType.split('/')[1] || 'png').replace(/[^a-zA-Z0-9]/g, '');
          const filepath = path.join(persistentDir, `image_${index}.${extension}`);
          await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
          attachmentPaths.push(filepath);
        }
      } catch (error) {
        // Keep the main task available even if a legacy image cannot be persisted.
      }
    }

    if (attachmentPaths.length > 0 && command && command.trim()) {
      const attachmentNote = `

[Attached files are persisted in this project. Read them from these paths:]
${attachmentPaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      const promptIndex = args.indexOf('--prompt');
      if (promptIndex !== -1) {
        args[promptIndex + 1] = `${args[promptIndex + 1]}${attachmentNote}`;
      }
    }

    // Add basic flags for Gemini
    // Only add debug flag if explicitly requested
    if (options.debug) {
      args.push('--debug');
    }
    
    // Add MCP config flag only if MCP servers are configured
    try {
      // Use already imported modules (fs.promises is imported as fs, path, os)
      const fsSync = await import('fs'); // Import synchronous fs methods
      
      // Check for MCP config in ~/.gemini.json
      const geminiConfigPath = path.join(getSystemHomeDirectory(), '.gemini.json');
      
      
      let hasMcpServers = false;
      
      // Check Gemini config for MCP servers
      if (fsSync.existsSync(geminiConfigPath)) {
        try {
          const geminiConfig = JSON.parse(fsSync.readFileSync(geminiConfigPath, 'utf8'));
          
          // Check global MCP servers
          if (geminiConfig.mcpServers && Object.keys(geminiConfig.mcpServers).length > 0) {
            hasMcpServers = true;
          }
          
          // Check project-specific MCP servers
          if (!hasMcpServers && geminiConfig.geminiProjects) {
            const currentProjectPath = process.cwd();
            const projectConfig = geminiConfig.geminiProjects[currentProjectPath];
            if (projectConfig && projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0) {
              hasMcpServers = true;
            }
          }
        } catch (e) {
        }
      }
      
      
      if (hasMcpServers) {
        // Use Gemini config file if it has MCP servers
        let configPath = null;
        
        if (fsSync.existsSync(geminiConfigPath)) {
          try {
            const geminiConfig = JSON.parse(fsSync.readFileSync(geminiConfigPath, 'utf8'));
            
            // Check if we have any MCP servers (global or project-specific)
            const hasGlobalServers = geminiConfig.mcpServers && Object.keys(geminiConfig.mcpServers).length > 0;
            const currentProjectPath = process.cwd();
            const projectConfig = geminiConfig.geminiProjects && geminiConfig.geminiProjects[currentProjectPath];
            const hasProjectServers = projectConfig && projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0;
            
            if (hasGlobalServers || hasProjectServers) {
              configPath = geminiConfigPath;
            }
          } catch (e) {
            // No valid config found
          }
        }
        
        if (configPath) {
          args.push('--mcp-config', configPath);
        } else {
        }
      }
    } catch (error) {
      // If there's any error checking for MCP configs, don't add the flag
      // MCP config check failed, proceeding without MCP support
    }
    
    // Add model only if explicitly provided, otherwise let local Gemini CLI use its default configuration
    if (options.model) {
      args.push('--model', options.model);
    }
    
    // Use stream-json output format for real-time tool calls and delta typing streaming
    args.push('-o', 'stream-json');
    
    const geminiLaunch = await resolveGeminiLaunch();
    const upstreamBaseUrl = await getGeminiUpstreamBaseUrl();
    const launchArgs = [...geminiLaunch.prefixArgs, ...args];
    console.log('🚀 Spawning Gemini CLI:', geminiLaunch.displayPath, args.join(' '));
    console.log('📂 Working directory:', workingDir);
    
    const geminiProcess = spawn(geminiLaunch.command, launchArgs, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Inherit the caller environment, but force the real OS account home so
      // sandbox/launcher temporary HOME values cannot redirect ~/.gemini.
      env: createSystemUserEnvironment(),
      // On POSIX make Gemini the leader of its own process group. Gemini CLI
      // starts a second Node process internally; without a dedicated group,
      // killing only the wrapper leaves that child orphaned and still working.
      detached: process.platform !== 'win32'
    });
    
    // Prefer the client-generated run ID. Session IDs can be unavailable until
    // Gemini emits init, while runId is stable from the moment the task starts.
    const processKey = runId || capturedSessionId || sessionId || Date.now().toString();
    activeGeminiProcesses.set(processKey, geminiProcess);
    
    // Store sessionId on the process object for debugging
    geminiProcess.sessionId = processKey;
    geminiProcess.runId = runId || null;
    geminiProcess.capturedSessionId = capturedSessionId || sessionId || null;
    geminiProcess.projectName = options.projectName || null;
    geminiProcess.projectPath = projectPath || cwd || workingDir || null;
    geminiProcess.runtimeStatus = null;

    const sendRuntimeStatus = (data) => {
      const status = {
        can_interrupt: true,
        timestamp: new Date().toISOString(),
        ...(upstreamBaseUrl ? { upstream: upstreamBaseUrl } : {}),
        ...data
      };
      geminiProcess.runtimeStatus = status;
      try {
        ws.send(JSON.stringify({ type: 'gemini-status', data: status }));
      } catch (error) {
        console.warn('Failed to send Gemini runtime status:', error.message);
      }
    };
    
    // Close stdin to signal we're done sending input
    geminiProcess.stdin.end();
    
    // Add timeout handler (10 minutes for long analysis tasks, users can click Stop anytime)
    let hasReceivedOutput = false;
    let terminalEventSent = false;
    const sendTerminalEvent = (event) => {
      if (terminalEventSent) return false;
      terminalEventSent = true;
      try {
        ws.send(JSON.stringify(event));
      } catch (error) {
        console.warn('Failed to send Gemini terminal event:', error.message);
      }
      return true;
    };
    const timeoutMs = 600000; // 10 minutes
    const timeout = setTimeout(() => {
      if (!hasReceivedOutput) {
        console.error('⏰ Gemini CLI timeout - no output received after', timeoutMs, 'ms');
        sendTerminalEvent({
          type: 'gemini-error',
          error: 'Gemini CLI timeout - no response received'
        });
        geminiProcess.kill('SIGTERM');
      }
    }, timeoutMs);
    
    // Save user message to session when starting
    if (command && capturedSessionId) {
      sessionManager.addMessage(capturedSessionId, 'user', command);
    }
    
    // Handle stdout with JSON stream line buffering
    let lineBuffer = '';
    const toolWorkingDirs = new Map();
    
    geminiProcess.stdout.on('data', (data) => {
      hasReceivedOutput = true;
      clearTimeout(timeout);
      
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // keep uncompleted partial line in buffer
      
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        
        // Skip debug and non-functional logs
        if (line.includes('[DEBUG]') || 
            line.includes('Flushing log events') || 
            line.includes('Clearcut response') ||
            line.includes('[MemoryDiscovery]') ||
            line.includes('[BfsFileSearch]') ||
            line.includes('Loaded cached credentials')) {
          continue;
        }
        
        try {
          const event = JSON.parse(line);
          
          if (event.type === 'init') {
            if (event.session_id) {
              capturedSessionId = event.session_id;
              geminiProcess.capturedSessionId = capturedSessionId;
              if (!sessionCreatedSent) {
                sessionCreatedSent = true;
                
                // If this is a new session, create it in sessionManager
                if (!sessionManager.getSession(capturedSessionId)) {
                  sessionManager.createSession(capturedSessionId, cwd || process.cwd());
                }
                
                // Add user message to sessionManager if it wasn't already added
                if (command && !sessionId) {
                  sessionManager.addMessage(capturedSessionId, 'user', command);
                }
                
                // Legacy clients without runId are re-keyed to the real session.
                // New clients keep the stable runId key for exact cancellation.
                if (!runId && processKey !== capturedSessionId) {
                  activeGeminiProcesses.delete(processKey);
                  activeGeminiProcesses.set(capturedSessionId, geminiProcess);
                }
                
                ws.send(JSON.stringify({
                  type: 'session-created',
                  sessionId: capturedSessionId,
                  model: event.model || 'gemini-3.8-flash',
                  isResume: !!sessionId
                }));
              }
            }
          } else if (event.type === 'tool_use') {
            const toolId = event.tool_id || `call_${Date.now()}`;
            const resolvedWd = resolveToolWorkingDirectory(event.tool_name, event.parameters, workingDir);
            if (toolId && resolvedWd) {
              toolWorkingDirs.set(toolId, resolvedWd);
            }
            // Real-time tool invocation event
            ws.send(JSON.stringify({
              type: 'gemini-tool-use',
              tool: {
                id: toolId,
                name: event.tool_name,
                input: event.parameters,
                workingDirectory: resolvedWd,
                workspaceRoot: workingDir,
                context: {
                  connector: 'gemini-cli',
                  workspaceRoot: workingDir,
                  workingDirectory: resolvedWd
                }
              }
            }));
          } else if (event.type === 'tool_result') {
            const toolId = event.tool_id;
            const resolvedWd = (toolId && toolWorkingDirs.get(toolId)) ?? resolveToolWorkingDirectory(null, null, workingDir);
            // Real-time tool execution result event
            ws.send(JSON.stringify({
              type: 'gemini-tool-result',
              result: {
                toolId: event.tool_id,
                status: event.status,
                content: event.output,
                isError: event.status !== 'success',
                workingDirectory: resolvedWd,
                workspaceRoot: workingDir,
                context: {
                  connector: 'gemini-cli',
                  workspaceRoot: workingDir,
                  workingDirectory: resolvedWd
                }
              }
            }));
          } else if (event.type === 'message' && event.role === 'assistant') {
            // Real-time delta text stream
            const text = event.content || '';
            if (text) {
              fullResponse += text;
              ws.send(JSON.stringify({
                type: 'gemini-delta',
                content: text
              }));
            }
          } else if (event.type === 'result') {
            if (event.stats) {
              ws.send(JSON.stringify({
                type: 'gemini-stats',
                stats: event.stats
              }));
            }
          }
        } catch (e) {
          // If not valid JSON, treat as raw plain text line
          fullResponse += (fullResponse ? '\n' : '') + line;
          ws.send(JSON.stringify({
            type: 'gemini-delta',
            content: line + '\n'
          }));
        }
      }
    });
    
    // Handle stderr - accumulate diagnostic output and surface structured runtime status.
    let stderrBuffer = '';
    let stderrLineBuffer = '';
    let lastRetryAttempt = 0;
    const processStderrLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      const retryMatch = line.match(/Attempt\s+(\d+)\s+failed\s+with\s+status\s+(\d+)\.\s+Retrying\s+with\s+backoff/i);
      if (retryMatch) {
        const attempt = Number(retryMatch[1]);
        const statusCode = Number(retryMatch[2]);
        lastRetryAttempt = attempt;
        sendRuntimeStatus(statusCode === 429
          ? {
              kind: 'rate_limit',
              phase: 'retrying',
              attempt,
              statusCode,
              status: 'RESOURCE_EXHAUSTED'
            }
          : {
              kind: 'retry',
              phase: 'retrying',
              attempt,
              statusCode
            });
        return;
      }

      if (/Upstream rate limit exceeded|RESOURCE_EXHAUSTED/i.test(line)) {
        sendRuntimeStatus({
          kind: 'rate_limit',
          phase: 'retrying',
          attempt: lastRetryAttempt || null,
          statusCode: 429,
          status: 'RESOURCE_EXHAUSTED'
        });
        return;
      }

      if (/invalid_grant/i.test(line)) {
        sendRuntimeStatus({
          kind: 'auth_error',
          phase: 'failed',
          statusCode: 400,
          status: 'invalid_grant'
        });
      }
    };

    geminiProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      stderrBuffer += errorMsg;
      stderrLineBuffer += errorMsg;
      const lines = stderrLineBuffer.split(/\r?\n/);
      stderrLineBuffer = lines.pop() || '';
      for (const line of lines) processStderrLine(line);
      console.error('Gemini CLI stderr:', errorMsg);
    });
    
    // Handle process completion
    geminiProcess.on('close', async (code, signal) => {
      console.log(`Gemini CLI process exited with code ${code}${signal ? ` signal ${signal}` : ''}`);
      clearTimeout(timeout);
      const wasAborted = geminiProcess.abortRequested === true;

      if (stderrLineBuffer.trim()) {
        processStderrLine(stderrLineBuffer);
        stderrLineBuffer = '';
      }
      
      // Flush any remaining content in lineBuffer
      if (lineBuffer && lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer.trim());
          if (event.type === 'message' && event.role === 'assistant' && event.content) {
            fullResponse += event.content;
            ws.send(JSON.stringify({
              type: 'gemini-delta',
              content: event.content
            }));
          }
        } catch (e) {
          fullResponse += lineBuffer.trim();
          ws.send(JSON.stringify({
            type: 'gemini-delta',
            content: lineBuffer.trim()
          }));
        }
        lineBuffer = '';
      }
      
      // Clean up process reference
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeGeminiProcesses.delete(processKey);
      if (finalSessionId !== processKey) {
        activeGeminiProcesses.delete(finalSessionId);
      }
      
      // Save assistant response to session if we have one
      if (finalSessionId && fullResponse) {
        sessionManager.addMessage(finalSessionId, 'assistant', fullResponse);
      }
      
      // If process failed with non-zero code and produced no output, notify client of error
      if (!wasAborted && code !== 0 && !hasReceivedOutput && !fullResponse) {
        sendTerminalEvent({
          type: 'gemini-error',
          error: stderrBuffer.trim() || `Gemini CLI process exited with code ${code}`
        });
      }

      // abort-session already emitted a scoped session-aborted event. Do not
      // follow it with gemini-complete/gemini-error for the same cancelled run.
      if (wasAborted) {
        resolve();
      } else if (code === 0) {
        sendTerminalEvent({
          type: 'gemini-complete',
          exitCode: code,
          isNewSession: !sessionId && !!command // Flag to indicate this was a new session
        });
        resolve();
      } else {
        sendTerminalEvent({
          type: 'gemini-complete',
          exitCode: code,
          isNewSession: !sessionId && !!command
        });
        reject(new Error(`Gemini CLI exited with code ${code}`));
      }
    });
    
    // Handle process errors
    geminiProcess.on('error', (error) => {
      // console.error('Gemini CLI process error:', error);
      
      // Clean up process reference on error
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeGeminiProcesses.delete(processKey);
      if (finalSessionId !== processKey) {
        activeGeminiProcesses.delete(finalSessionId);
      }
      
      sendTerminalEvent({
        type: 'gemini-error',
        error: error.message
      });
      
      reject(error);
    });
    
    // Handle stdin for interactive mode
    // Gemini with --prompt flag doesn't need stdin
    if (command && command.trim()) {
      // We're using --prompt flag, so just close stdin
      geminiProcess.stdin.end();
    } else {
      // Interactive mode without initial prompt
      // Keep stdin open for interactive use
    }
  });
}

function signalGeminiProcessTree(geminiProcess, signal) {
  if (!geminiProcess?.pid) return false;

  // POSIX: because spawnGemini uses detached:true, -pid addresses the whole
  // Gemini process group (wrapper plus every descendant it started).
  if (process.platform !== 'win32') {
    try {
      process.kill(-geminiProcess.pid, signal);
      return true;
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.warn(`Failed to signal Gemini process group ${geminiProcess.pid}:`, error.message);
      }
    }
  }

  // Fallback for legacy/non-POSIX processes.
  try {
    return geminiProcess.kill(signal);
  } catch (error) {
    console.warn(`Failed to signal Gemini PID ${geminiProcess.pid}:`, error.message);
    return false;
  }
}

function abortGeminiSession(sessionId, runId = null) {
  console.log('🛑 abortGeminiSession called with sessionId:', sessionId, 'runId:', runId, 'active count:', activeGeminiProcesses.size);

  let processToKill = null;
  let processKey = null;

  if (runId) {
    processToKill = activeGeminiProcesses.get(runId);
    processKey = runId;
  }

  if (!processToKill && sessionId) {
    processToKill = activeGeminiProcesses.get(sessionId);
    processKey = sessionId;

    if (!processToKill) {
      for (const [key, proc] of activeGeminiProcesses.entries()) {
        if (proc.capturedSessionId === sessionId || key === sessionId) {
          processToKill = proc;
          processKey = key;
          break;
        }
      }
    }
  }

  // A legacy caller with no identifier is safe only when exactly one task is
  // running. Never guess a process when multiple projects are active.
  if (!processToKill && !runId && !sessionId && activeGeminiProcesses.size === 1) {
    const [[onlyKey, onlyProcess]] = Array.from(activeGeminiProcesses.entries());
    processToKill = onlyProcess;
    processKey = onlyKey;
  }

  if (processToKill) {
    console.log(`🛑 Terminating Gemini process PID: ${processToKill.pid} (key: ${processKey})`);
    try {
      processToKill.abortRequested = true;
      const signaled = signalGeminiProcessTree(processToKill, 'SIGTERM');
      if (!signaled) {
        processToKill.abortRequested = false;
        return false;
      }

      // Force kill fallback after 1.5s
      setTimeout(() => {
        signalGeminiProcessTree(processToKill, 'SIGKILL');
      }, 1500);

      // Keep the process registered until its close/error handler runs. This
      // prevents a second click from seeing an empty map while descendants are
      // still shutting down and lets normal cleanup remove the exact run key.
      return true;
    } catch (error) {
      console.error('Error killing process:', error);
      activeGeminiProcesses.delete(processKey);
      return false;
    }
  }

  return false;
}

export {
  GEMINI_BINARY_SETTING_KEY,
  getConfiguredGeminiBinaryPath,
  resolveEmbeddedGeminiPath,
  resolveGeminiLaunch,
  spawnGemini,
  abortGeminiSession,
  getGeminiRunStatus
};