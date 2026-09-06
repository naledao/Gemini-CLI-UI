// Load environment variables from .env file
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const envPath = path.join(__dirname, '../.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  });
} catch (e) {
  // console.log('No .env file found or error reading it:', e.message);
}

// console.log('PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn, execSync } from 'child_process';
import os from 'os';
import pty from 'node-pty';
import fetch from 'node-fetch';
import mime from 'mime-types';

import { getProjects, getSessions, getSessionMessages, renameProject, deleteSession, deleteProject, addProjectManually, extractProjectDirectory, clearProjectDirectoryCache } from './projects.js';
import { spawnGemini, abortGeminiSession } from './gemini-cli.js';
import sessionManager from './sessionManager.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import gitRoutes from './routes/git.js';
import { initializeDatabase } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';

// File system watcher for projects folder
let projectsWatcher = null;
const connectedClients = new Set();

// Setup file system watcher for Gemini projects folder using chokidar
async function setupProjectsWatcher() {
  const chokidar = (await import('chokidar')).default;
  const geminiProjectsPath = path.join(process.env.HOME, '.gemini', 'projects');
  
  if (projectsWatcher) {
    projectsWatcher.close();
  }
  
  try {
    // Initialize chokidar watcher with optimized settings
    projectsWatcher = chokidar.watch(geminiProjectsPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/*.tmp',
        '**/*.swp',
        '**/.DS_Store'
      ],
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files on startup
      followSymlinks: false,
      depth: 10, // Reasonable depth limit
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms for file to stabilize
        pollInterval: 50
      }
    });
    
    // Debounce function to prevent excessive notifications
    let debounceTimer;
    const debouncedUpdate = async (eventType, filePath) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          
          // Clear project directory cache when files change
          clearProjectDirectoryCache();
          
          // Get updated projects list
          const updatedProjects = await getProjects();
          
          // Notify all connected clients about the project changes
          const updateMessage = JSON.stringify({
            type: 'projects_updated',
            projects: updatedProjects,
            timestamp: new Date().toISOString(),
            changeType: eventType,
            changedFile: path.relative(geminiProjectsPath, filePath)
          });
          
          connectedClients.forEach(client => {
            if (client.readyState === client.OPEN) {
              client.send(updateMessage);
            }
          });
          
        } catch (error) {
          // console.error('❌ Error handling project changes:', error);
        }
      }, 300); // 300ms debounce (slightly faster than before)
    };
    
    // Set up event listeners
    projectsWatcher
      .on('add', (filePath) => debouncedUpdate('add', filePath))
      .on('change', (filePath) => debouncedUpdate('change', filePath))
      .on('unlink', (filePath) => debouncedUpdate('unlink', filePath))
      .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath))
      .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath))
      .on('error', (error) => {
        // console.error('❌ Chokidar watcher error:', error);
      })
      .on('ready', () => {
      });
    
  } catch (error) {
    // console.error('❌ Failed to setup projects watcher:', error);
  }
}


const app = express();
const server = http.createServer(app);

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({ 
  server,
  verifyClient: (info) => {
    console.log('🔗 WebSocket connection attempt from:', info.req.headers.host, 'url:', info.req.url);
    
    // Extract token from query parameters or headers
    const url = new URL(info.req.url, 'http://localhost');
    const token = url.searchParams.get('token') || 
                  info.req.headers.authorization?.split(' ')[1];
    
    // Verify token
    const user = authenticateWebSocket(token);
    if (!user) {
      console.log('❌ WebSocket authentication failed');
      return false;
    }
    
    // Store user info in the request for later use
    info.req.user = user;
    console.log('✅ WebSocket authenticated for user:', user.username);
    return true;
  }
});

app.use(cors());
app.use(express.json());

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// Static files served after API routes
app.use(express.static(path.join(__dirname, '../dist')));

// Helper to read local Gemini CLI configuration (model and thinking settings)
function getLocalGeminiConfig() {
  const settingsPath = path.join(process.env.HOME || '/root', '.gemini', 'settings.json');
  let config = {
    model: 'gemini-3.8-flash',
    thinkingLevel: 'HIGH',
    includeThoughts: true
  };

  try {
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const overrides = raw?.modelConfigs?.customOverrides || [];
      if (overrides.length > 0) {
        const first = overrides[0];
        if (first?.modelConfig?.model) {
          config.model = first.modelConfig.model;
        }
        const thinking = first?.modelConfig?.generateContentConfig?.thinkingConfig;
        if (thinking?.thinkingLevel) {
          config.thinkingLevel = thinking.thinkingLevel;
        }
        if (typeof thinking?.includeThoughts === 'boolean') {
          config.includeThoughts = thinking.includeThoughts;
        }
      }
    }
  } catch (e) {
    console.error('Error reading local Gemini CLI settings:', e);
  }
  return config;
}

// API Routes (protected)
app.get('/api/config', authenticateToken, (req, res) => {
  const host = req.headers.host || `${req.hostname}:${PORT}`;
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';
  const geminiConfig = getLocalGeminiConfig();
  
  res.json({
    serverPort: PORT,
    wsUrl: `${protocol}://${host}`,
    geminiConfig
  });
});

app.get('/api/projects', authenticateToken, async (req, res) => {
  try {
    const projects = await getProjects();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
  try {
    // Extract the actual project directory path
    const projectPath = await extractProjectDirectory(req.params.projectName);
    
    // Get sessions from sessionManager
    const sessions = sessionManager.getProjectSessions(projectPath);
    
    // Apply pagination
    const { limit = 5, offset = 0 } = req.query;
    const paginatedSessions = sessions.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    res.json({
      sessions: paginatedSessions,
      total: sessions.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    const messages = sessionManager.getSessionMessages(sessionId);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
  try {
    const { displayName } = req.body;
    await renameProject(req.params.projectName, displayName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    await sessionManager.deleteSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete project endpoint (only if empty)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    await deleteProject(projectName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Filesystem directory autocomplete & navigation endpoint
app.get('/api/filesystem/directories', authenticateToken, async (req, res) => {
  console.log('📂 [API] /api/filesystem/directories query:', req.query.path, 'user:', req.user?.username);
  try {
    let inputPath = req.query.path ? req.query.path.trim() : '';
    if (!inputPath) {
      inputPath = process.env.HOME || '/root';
    } else if (inputPath === '~' || inputPath.startsWith('~/')) {
      inputPath = inputPath.replace(/^~/, process.env.HOME || '/root');
    }

    // Resolve path
    let targetDir = path.resolve(inputPath);
    let filterPrefix = '';

    // Check if targetDir exists and is directory
    let isDir = false;
    try {
      const stat = await fsPromises.stat(targetDir);
      isDir = stat.isDirectory();
    } catch (e) {
      isDir = false;
    }

    // If not a directory or path does not end with separator and does not exist,
    // look inside the parent directory with prefix filtering
    if (!isDir) {
      filterPrefix = path.basename(targetDir).toLowerCase();
      targetDir = path.dirname(targetDir);
      try {
        const stat = await fsPromises.stat(targetDir);
        if (!stat.isDirectory()) {
          return res.json({ currentPath: targetDir, parentPath: null, directories: [] });
        }
      } catch (e) {
        return res.json({ currentPath: targetDir, parentPath: null, directories: [] });
      }
    }

    const entries = await fsPromises.readdir(targetDir, { withFileTypes: true });
    const directories = [];

    for (const entry of entries) {
      // Only directories or symlinks pointing to directories
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const name = entry.name;
        // Skip hidden files unless prefix starts with dot
        if (name.startsWith('.') && !filterPrefix.startsWith('.')) {
          continue;
        }
        // Skip heavy / noisy directories
        if (name === 'node_modules' || name === '.git' || name === 'proc' || name === 'sys') {
          continue;
        }

        if (!filterPrefix || name.toLowerCase().startsWith(filterPrefix)) {
          directories.push({
            name,
            path: path.join(targetDir, name)
          });
        }
      }
    }

    // Sort alphabetically, limit to 60 items
    directories.sort((a, b) => a.name.localeCompare(b.name));
    if (directories.length > 60) {
      directories.length = 60;
    }

    const parentPath = targetDir === '/' ? null : path.dirname(targetDir);

    console.log('📂 [API] returning directories count:', directories.length, 'for targetDir:', targetDir);

    res.json({
      currentPath: targetDir,
      parentPath,
      filterPrefix,
      directories
    });
  } catch (error) {
    console.error('📂 [API] Error in /api/filesystem/directories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create project endpoint
app.post('/api/projects/create', authenticateToken, async (req, res) => {
  try {
    const { path: projectPath } = req.body;
    
    if (!projectPath || !projectPath.trim()) {
      return res.status(400).json({ error: 'Project path is required' });
    }
    
    const project = await addProjectManually(projectPath.trim());
    res.json({ success: true, project });
  } catch (error) {
    // console.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper to recursively build file tree for FileTree component
async function buildFileTree(dirPath, maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return [];
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const name = entry.name;
      // Skip hidden files/dirs and noisy build/dependency folders
      if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'build' || name === 'target' || name === '__pycache__') {
        continue;
      }

      const fullPath = path.join(dirPath, name);
      try {
        const stat = await fsPromises.stat(fullPath);
        const isDirectory = stat.isDirectory();
        
        const mode = stat.mode;
        const permissionsRwx = [
          (mode & 0o400 ? 'r' : '-'),
          (mode & 0o200 ? 'w' : '-'),
          (mode & 0o100 ? 'x' : '-'),
          (mode & 0o040 ? 'r' : '-'),
          (mode & 0o020 ? 'w' : '-'),
          (mode & 0o010 ? 'x' : '-'),
          (mode & 0o004 ? 'r' : '-'),
          (mode & 0o002 ? 'w' : '-'),
          (mode & 0o001 ? 'x' : '-')
        ].join('');

        const item = {
          name,
          path: fullPath,
          type: isDirectory ? 'directory' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          permissionsRwx
        };

        if (isDirectory) {
          item.children = await buildFileTree(fullPath, maxDepth, depth + 1);
        }

        items.push(item);
      } catch (err) {
        // Skip inaccessible entries
      }
    }

    return items.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  } catch (error) {
    return [];
  }
}

// Get project files tree endpoint
app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
  try {
    const projectPath = await extractProjectDirectory(req.params.projectName);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const files = await buildFileTree(projectPath);
    res.json(files);
  } catch (error) {
    console.error('Error fetching project files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Read file content endpoint
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath } = req.query;
    
    // console.log('📄 File read request:', projectName, filePath);
    
    // Using fsPromises from import
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    const content = await fsPromises.readFile(filePath, 'utf8');
    res.json({ content, path: filePath });
  } catch (error) {
    // console.error('Error reading file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Serve binary file content endpoint (for images, etc.)
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { path: filePath } = req.query;
    
    // console.log('🖼️ Binary file serve request:', projectName, filePath);
    
    // Using fs from import
    // Using mime from import
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Check if file exists
    try {
      await fsPromises.access(filePath);
    } catch (error) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get file extension and set appropriate content type
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      // console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading file' });
      }
    });
    
  } catch (error) {
    // console.error('Error serving binary file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Save file content endpoint
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath, content } = req.body;
    
    // console.log('💾 File save request:', projectName, filePath);
    
    // Using fsPromises from import
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Create backup of original file
    try {
      const backupPath = filePath + '.backup.' + Date.now();
      await fsPromises.copyFile(filePath, backupPath);
      // console.log('📋 Created backup:', backupPath);
    } catch (backupError) {
      // console.warn('Could not create backup:', backupError.message);
    }
    
    // Write the new content
    await fsPromises.writeFile(filePath, content, 'utf8');
    
    res.json({ 
      success: true, 
      path: filePath,
      message: 'File saved successfully' 
    });
  } catch (error) {
    // console.error('Error saving file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File or directory not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
  const url = request.url;
  
  // Parse URL to get pathname without query parameters
  const urlObj = new URL(url, 'http://localhost');
  const pathname = urlObj.pathname;
  
  if (pathname === '/ws') {
    handleChatConnection(ws);
  } else if (pathname === '/shell') {
    handleShellConnection(ws);
  } else {
    ws.close();
  }
});

// Handle shell WebSocket connections for interactive terminal emulation
function handleShellConnection(ws) {
  console.log('🐚 Shell client connected');
  let shellProcess = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'init') {
        const projectPath = data.projectPath || process.env.HOME || '/root';
        const cols = data.cols || 80;
        const rows = data.rows || 24;

        // Ensure target directory exists and is a directory
        let cwd = projectPath;
        try {
          const stat = await fsPromises.stat(cwd);
          if (!stat.isDirectory()) {
            cwd = path.dirname(cwd);
          }
        } catch (e) {
          cwd = process.env.HOME || '/root';
        }

        console.log(`🐚 Starting interactive shell in: ${cwd} (${cols}x${rows})`);

        try {
          shellProcess = pty.spawn('bash', ['--login'], {
            name: 'xterm-256color',
            cols: cols,
            rows: rows,
            cwd: cwd,
            env: {
              ...process.env,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
              FORCE_COLOR: '3'
            }
          });

          console.log('🟢 Shell process started with PTY, PID:', shellProcess.pid);

          shellProcess.onData((outputData) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'output',
                data: outputData
              }));
            }
          });

          shellProcess.onExit((exitCode) => {
            console.log('🔚 Shell process exited with code:', exitCode.exitCode);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'output',
                data: `\r\n\x1b[33m[Process exited with code ${exitCode.exitCode}]\x1b[0m\r\n`
              }));
            }
            shellProcess = null;
          });
        } catch (spawnError) {
          console.error('❌ Failed to spawn shell process:', spawnError);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'output',
              data: `\r\n\x1b[31mError starting shell: ${spawnError.message}\x1b[0m\r\n`
            }));
          }
        }
      } else if (data.type === 'input') {
        if (shellProcess && shellProcess.write) {
          shellProcess.write(data.data);
        }
      } else if (data.type === 'resize') {
        if (shellProcess && shellProcess.resize) {
          try {
            shellProcess.resize(data.cols, data.rows);
          } catch (err) {}
        }
      }
    } catch (error) {
      console.error('❌ Shell message parsing error:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Shell client disconnected');
    if (shellProcess) {
      try {
        shellProcess.kill();
      } catch (err) {}
      shellProcess = null;
    }
  });

  ws.on('error', (error) => {
    console.error('❌ Shell WebSocket error:', error);
  });
}

// Handle chat WebSocket connections
function handleChatConnection(ws) {
  // console.log('💬 Chat WebSocket connected');
  
  // Add to connected clients for project updates
  connectedClients.add(ws);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (data.type === 'gemini-command') {
        console.log('💬 User message:', data.command || '[Continue/Resume]');
        console.log('📁 Project:', data.options?.projectPath || 'Unknown');
        console.log('📂 cwd:', data.options?.cwd || 'Unknown');
        console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
        await spawnGemini(data.command, data.options, ws);
      } else if (data.type === 'abort-session') {
        console.log('🛑 Abort session request:', data.sessionId);
        const success = abortGeminiSession(data.sessionId);
        ws.send(JSON.stringify({
          type: 'session-aborted',
          sessionId: data.sessionId,
          success
        }));
      }
    } catch (error) {
      console.error('❌ Chat WebSocket error:', error.message);
      ws.send(JSON.stringify({
        type: 'gemini-error',
        error: error.message
      }));
    }
  });
  
  ws.on('close', () => {
    // Remove from connected clients
    connectedClients.delete(ws);
  });
}

// Audio transcription endpoint
app.post('/api/transcribe', authenticateToken, async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({ storage: multer.memoryStorage() });
    
    // Handle multipart form data
    upload.single('audio')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process audio file' });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }
      
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
      }
      
      try {
        // Create form data for OpenAI
        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype
        });
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');
        formData.append('language', 'en');
        
        // Make request to OpenAI
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders()
          },
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
        }
        
        const data = await response.json();
        let transcribedText = data.text || '';
        
        // Check if enhancement mode is enabled
        const mode = req.body.mode || 'default';
        
        // If no transcribed text, return empty
        if (!transcribedText) {
          return res.json({ text: '' });
        }
        
        // If default mode, return transcribed text without enhancement
        if (mode === 'default') {
          return res.json({ text: transcribedText });
        }
        
        // Handle different enhancement modes
        try {
          const OpenAI = (await import('openai')).default;
          const openai = new OpenAI({ apiKey });
          
          let prompt, systemMessage, temperature = 0.7, maxTokens = 800;
          
          switch (mode) {
            case 'prompt':
              systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
              prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
              break;
              
            case 'vibe':
            case 'instructions':
            case 'architect':
              systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
              temperature = 0.5; // Lower temperature for more controlled output
              prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
              break;
              
            default:
              // No enhancement needed
              break;
          }
          
          // Only make GPT call if we have a prompt
          if (prompt) {
            const completion = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: prompt }
              ],
              temperature: temperature,
              max_tokens: maxTokens
            });
            
            transcribedText = completion.choices[0].message.content || transcribedText;
          }
          
        } catch (gptError) {
          // console.error('GPT processing error:', gptError);
          // Fall back to original transcription if GPT fails
        }
        
        res.json({ text: transcribedText });
        
      } catch (error) {
        // console.error('Transcription error:', error);
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    // console.error('Endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Image upload endpoint
app.post('/api/projects/:projectName/upload-images', authenticateToken, async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const path = (await import('path')).default;
    const fs = (await import('fs')).promises;
    const os = (await import('os')).default;
    
    // Configure multer for image uploads
    const storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'gemini-ui-uploads', String(req.user.id));
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, uniqueSuffix + '-' + sanitizedName);
      }
    });
    
    const fileFilter = (req, file, cb) => {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
      }
    };
    
    const upload = multer({
      storage,
      fileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 5
      }
    });
    
    // Handle multipart form data
    upload.array('images', 5)(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No image files provided' });
      }
      
      try {
        // Process uploaded images
        const processedImages = await Promise.all(
          req.files.map(async (file) => {
            // Read file and convert to base64
            const buffer = await fs.readFile(file.path);
            const base64 = buffer.toString('base64');
            const mimeType = file.mimetype;
            
            // Clean up temp file immediately
            await fs.unlink(file.path);
            
            return {
              name: file.originalname,
              data: `data:${mimeType};base64,${base64}`,
              size: file.size,
              mimeType: mimeType
            };
          })
        );
        
        res.json({ images: processedImages });
      } catch (error) {
        // console.error('Error processing images:', error);
        // Clean up any remaining files
        await Promise.all(req.files.map(f => fs.unlink(f.path).catch(() => {})));
        res.status(500).json({ error: 'Failed to process images' });
      }
    });
  } catch (error) {
    // console.error('Error in image upload endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const PORT = process.env.PORT || 4008;

// Initialize database and start server
async function startServer() {
  try {
    // Initialize authentication database
    await initializeDatabase();
    // console.log('✅ Database initialization skipped (testing)');
    
    server.listen(PORT, '0.0.0.0', async () => {
      // console.log(`Gemini CLI UI server running on http://0.0.0.0:${PORT}`);
      
      // Start watching the projects folder for changes
      await setupProjectsWatcher(); // Re-enabled with better-sqlite3
    });
  } catch (error) {
    // console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
