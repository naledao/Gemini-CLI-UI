import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import sessionManager from './sessionManager.js';
import GeminiResponseHandler from './gemini-response-handler.js';

let activeGeminiProcesses = new Map(); // Track active processes by session ID

async function spawnGemini(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, images } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let fullResponse = ''; // Accumulate the full response
    
    // Process images if provided
    
    // Build Gemini CLI command - start with print/resume flags first
    const args = [];
    
    // Always trust workspace in automated/headless mode
    args.push('--skip-trust');

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
    // Clean the path by removing any non-printable characters
    const cleanPath = (cwd || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
    const workingDir = cleanPath;
    // Debug - workingDir
    
    // Handle images by saving them to temporary files and passing paths to Gemini
    const tempImagePaths = [];
    let tempDir = null;
    if (images && images.length > 0) {
      try {
        // Create temp directory in the project directory so Gemini can access it
        tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
        await fs.mkdir(tempDir, { recursive: true });
        
        // Save each image to a temp file
        for (const [index, image] of images.entries()) {
          // Extract base64 data and mime type
          const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            // console.error('Invalid image data format');
            continue;
          }
          
          const [, mimeType, base64Data] = matches;
          const extension = mimeType.split('/')[1] || 'png';
          const filename = `image_${index}.${extension}`;
          const filepath = path.join(tempDir, filename);
          
          // Write base64 data to file
          await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
          tempImagePaths.push(filepath);
        }
        
        // Include the full image paths in the prompt for Gemini to reference
        // Gemini CLI can read images from file paths in the prompt
        if (tempImagePaths.length > 0 && command && command.trim()) {
          const imageNote = `\n\n[画像を添付しました: ${tempImagePaths.length}枚の画像があります。以下のパスに保存されています:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
          const modifiedCommand = command + imageNote;
          
          // Update the command in args
          const promptIndex = args.indexOf('--prompt');
          if (promptIndex !== -1 && args[promptIndex + 1] === command) {
            args[promptIndex + 1] = modifiedCommand;
          } else if (promptIndex !== -1) {
            // If we're using context, update the full prompt
            args[promptIndex + 1] = args[promptIndex + 1] + imageNote;
          }
        }
        
        
      } catch (error) {
        // console.error('Error processing images for Gemini:', error);
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
      const geminiConfigPath = path.join(os.homedir(), '.gemini.json');
      
      
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
    
    // Try to find gemini in PATH first, then fall back to environment variable
    const geminiPath = process.env.GEMINI_PATH || 'gemini';
    console.log('🚀 Spawning Gemini CLI:', geminiPath, args.join(' '));
    console.log('📂 Working directory:', workingDir);
    
    const geminiProcess = spawn(geminiPath, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env } // Inherit all environment variables
    });
    
    // Attach temp file info to process for cleanup later
    geminiProcess.tempImagePaths = tempImagePaths;
    geminiProcess.tempDir = tempDir;
    
    // Store process reference for potential abort
    const processKey = capturedSessionId || sessionId || Date.now().toString();
    activeGeminiProcesses.set(processKey, geminiProcess);
    
    // Store sessionId on the process object for debugging
    geminiProcess.sessionId = processKey;
    
    // Close stdin to signal we're done sending input
    geminiProcess.stdin.end();
    
    // Add timeout handler (10 minutes for long analysis tasks, users can click Stop anytime)
    let hasReceivedOutput = false;
    const timeoutMs = 600000; // 10 minutes
    const timeout = setTimeout(() => {
      if (!hasReceivedOutput) {
        console.error('⏰ Gemini CLI timeout - no output received after', timeoutMs, 'ms');
        ws.send(JSON.stringify({
          type: 'gemini-error',
          error: 'Gemini CLI timeout - no response received'
        }));
        geminiProcess.kill('SIGTERM');
      }
    }, timeoutMs);
    
    // Save user message to session when starting
    if (command && capturedSessionId) {
      sessionManager.addMessage(capturedSessionId, 'user', command);
    }
    
    // Handle stdout with JSON stream line buffering
    let lineBuffer = '';
    
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
                
                if (processKey !== capturedSessionId) {
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
            // Real-time tool invocation event
            ws.send(JSON.stringify({
              type: 'gemini-tool-use',
              tool: {
                id: event.tool_id || `call_${Date.now()}`,
                name: event.tool_name,
                input: event.parameters
              }
            }));
          } else if (event.type === 'tool_result') {
            // Real-time tool execution result event
            ws.send(JSON.stringify({
              type: 'gemini-tool-result',
              result: {
                toolId: event.tool_id,
                status: event.status,
                content: event.output,
                isError: event.status !== 'success'
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
    
    // Handle stderr - accumulate diagnostic output for logging or error reporting
    let stderrBuffer = '';
    geminiProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      stderrBuffer += errorMsg;
      console.error('Gemini CLI stderr:', errorMsg);
    });
    
    // Handle process completion
    geminiProcess.on('close', async (code) => {
      console.log(`Gemini CLI process exited with code ${code}`);
      clearTimeout(timeout);
      
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
      activeGeminiProcesses.delete(finalSessionId);
      
      // Save assistant response to session if we have one
      if (finalSessionId && fullResponse) {
        sessionManager.addMessage(finalSessionId, 'assistant', fullResponse);
      }
      
      // If process failed with non-zero code and produced no output, notify client of error
      if (code !== 0 && !hasReceivedOutput && !fullResponse) {
        ws.send(JSON.stringify({
          type: 'gemini-error',
          error: stderrBuffer.trim() || `Gemini CLI process exited with code ${code}`
        }));
      }
      
      ws.send(JSON.stringify({
        type: 'gemini-complete',
        exitCode: code,
        isNewSession: !sessionId && !!command // Flag to indicate this was a new session
      }));
      
      // Clean up temporary image files if any
      if (geminiProcess.tempImagePaths && geminiProcess.tempImagePaths.length > 0) {
        for (const imagePath of geminiProcess.tempImagePaths) {
          await fs.unlink(imagePath).catch(err => {
            // console.error(`Failed to delete temp image ${imagePath}:`, err)
          });
        }
        if (geminiProcess.tempDir) {
          await fs.rm(geminiProcess.tempDir, { recursive: true, force: true }).catch(err => {
            // console.error(`Failed to delete temp directory ${geminiProcess.tempDir}:`, err)
          });
        }
      }
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}`));
      }
    });
    
    // Handle process errors
    geminiProcess.on('error', (error) => {
      // console.error('Gemini CLI process error:', error);
      
      // Clean up process reference on error
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeGeminiProcesses.delete(finalSessionId);
      
      ws.send(JSON.stringify({
        type: 'gemini-error',
        error: error.message
      }));
      
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

function abortGeminiSession(sessionId) {
  console.log('🛑 abortGeminiSession called with sessionId:', sessionId, 'active count:', activeGeminiProcesses.size);

  let processToKill = null;
  let processKey = null;

  if (sessionId) {
    processToKill = activeGeminiProcesses.get(sessionId);
    processKey = sessionId;

    if (!processToKill) {
      for (const [key, proc] of activeGeminiProcesses.entries()) {
        if (key.includes(sessionId) || sessionId.includes(key)) {
          processToKill = proc;
          processKey = key;
          break;
        }
      }
    }
  }

  // Fallback: If not found by ID or no ID provided, kill the active processes
  if (!processToKill && activeGeminiProcesses.size > 0) {
    const entries = Array.from(activeGeminiProcesses.entries());
    const [lastKey, lastProc] = entries[entries.length - 1];
    processToKill = lastProc;
    processKey = lastKey;
  }

  if (processToKill) {
    console.log(`🛑 Terminating Gemini process PID: ${processToKill.pid} (key: ${processKey})`);
    try {
      // Kill process
      processToKill.kill('SIGTERM');
      
      // Also try to kill the entire process group if available
      try {
        if (processToKill.pid) {
          process.kill(-processToKill.pid, 'SIGTERM');
        }
      } catch (e) {}

      // Force kill fallback after 1.5s
      setTimeout(() => {
        try {
          processToKill.kill('SIGKILL');
          if (processToKill.pid) process.kill(-processToKill.pid, 'SIGKILL');
        } catch (e) {}
      }, 1500);

      activeGeminiProcesses.delete(processKey);
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
  spawnGemini,
  abortGeminiSession
};