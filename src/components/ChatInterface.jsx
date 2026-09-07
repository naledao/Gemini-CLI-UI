/*
 * ChatInterface.jsx - Chat Component with Session Protection Integration
 * 
 * SESSION PROTECTION INTEGRATION:
 * ===============================
 * 
 * This component integrates with the Session Protection System to prevent project updates
 * from interrupting active conversations:
 * 
 * Key Integration Points:
 * 1. handleSubmit() - Marks session as active when user sends message (including temp ID for new sessions)
 * 2. session-created handler - Replaces temporary session ID with real WebSocket session ID  
 * 3. gemini-complete handler - Marks session as inactive when conversation finishes
 * 4. session-aborted handler - Marks session as inactive when conversation is aborted
 * 
 * This ensures uninterrupted chat experience by coordinating with App.jsx to pause sidebar updates.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useDropzone } from 'react-dropzone';
import TodoList from './TodoList';
import GeminiLogo from './GeminiLogo.jsx';
import { Sparkles, Square, Paperclip, FileText } from 'lucide-react';
import { EnhancedMessageRenderer } from './EnhancedMessageRenderer';
import ToolCallRenderer from './ToolCallRenderer';
import { MicButton } from './MicButton.jsx';
import { api } from '../utils/api';
import { playNotificationSound } from '../utils/notificationSound';
import { useLanguage } from '../contexts/LanguageContext';

const formatAttachmentSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isImageAttachment = (file) => {
  if (file?.type?.startsWith('image/')) return true;
  const ext = file?.name?.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
};

const GEMINI_RUNTIME_MESSAGE_TYPES = new Set([
  'session-created',
  'gemini-response',
  'gemini-tool-use',
  'gemini-tool-result',
  'gemini-delta',
  'gemini-output',
  'gemini-interactive-prompt',
  'gemini-error',
  'gemini-complete',
  'gemini-status',
  'gemini-stats',
  'session-aborted',
  'session-abort-failed'
]);

const normalizeProjectPath = (value = '') => String(value || '').replace(/\\/g, '/').replace(/\/$/, '');

const isGeminiRuntimeMessage = (message) => {
  if (!message) return false;
  if (GEMINI_RUNTIME_MESSAGE_TYPES.has(message.type)) return true;
  return message.type === 'error' && !!(message.projectName || message.projectPath || message.runId);
};

const messageBelongsToProject = (message, project) => {
  if (!project || !isGeminiRuntimeMessage(message)) return false;
  if (message.projectName) return message.projectName === project.name;
  if (message.projectPath) {
    return normalizeProjectPath(message.projectPath) === normalizeProjectPath(project.path);
  }
  // Runtime messages without ownership are unsafe once multiple projects can
  // run concurrently, so do not attach them to whichever project is visible.
  return false;
};

// Memoized message component to prevent unnecessary re-renders
const MessageComponent = memo(({ message, index, prevMessage, createDiff, onFileOpen, onShowSettings, showRawParameters, withinAssistantGroup = false }) => {
  const { t, language } = useLanguage();
  const isGrouped = withinAssistantGroup || (prevMessage && prevMessage.type === message.type && 
                   prevMessage.type === 'assistant' && 
                   !prevMessage.isToolUse && !message.isToolUse);

  return (
    <div
      className={withinAssistantGroup
        ? 'w-full'
        : `chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
      style={{ minHeight: '1px' }} // Prevent collapse
    >
      {message.type === 'system' ? (
        /* System message in center */
        <div className="flex justify-center w-full py-2">
          <div className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg px-4 py-2 text-sm max-w-md text-center">
            {message.content}
          </div>
        </div>
      ) : message.type === 'user' ? (
        /* User message bubble on the right */
        <div className="flex items-end space-x-0 sm:space-x-3 w-full sm:w-auto sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="bg-blue-600 text-white rounded-2xl rounded-br-md px-3 sm:px-4 py-2 shadow-sm flex-1 sm:flex-initial">
            <div className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
            {message.images && message.images.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {message.images.map((img, idx) => (
                  <img
                    key={idx}
                    src={img.data}
                    alt={img.name}
                    className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => window.open(img.data, '_blank')}
                  />
                ))}
              </div>
            )}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {message.attachments.map((attachment, idx) => (
                  attachment.isImage && attachment.data ? (
                    <img
                      key={`${attachment.path || attachment.name}-${idx}`}
                      src={attachment.data}
                      alt={attachment.name}
                      className="rounded-lg max-w-40 max-h-32 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(attachment.data, '_blank')}
                    />
                  ) : (
                    <button
                      key={`${attachment.path || attachment.name}-${idx}`}
                      type="button"
                      onClick={() => attachment.path && onFileOpen && onFileOpen(attachment.path)}
                      className="max-w-full flex items-center gap-2 rounded-lg bg-white/15 hover:bg-white/20 px-2.5 py-2 text-left transition-colors"
                      title={attachment.path || attachment.name}
                    >
                      <FileText className="w-4 h-4 flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium truncate">{attachment.name}</span>
                        <span className="block text-[10px] text-blue-100">{formatAttachmentSize(attachment.size)}</span>
                      </span>
                    </button>
                  )
                ))}
              </div>
            )}
            <div className="text-xs text-blue-100 mt-1 text-right">
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
          {!isGrouped && (
            <div className="hidden sm:flex w-8 h-8 bg-blue-600 rounded-full items-center justify-center text-white text-sm flex-shrink-0">
              U
            </div>
          )}
        </div>
      ) : (
        /* Gemini/Error messages on the left */
        <div className="w-full">
          {!isGrouped && (
            <div className="flex items-center space-x-2 mb-1">
              {message.type === 'error' ? (
                <div className="w-7 h-7 bg-red-600 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0">
                  !
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-0.5">
                  <GeminiLogo className="w-full h-full" />
                </div>
              )}
              <div className="text-xs font-medium text-gray-900 dark:text-white">
                {message.type === 'error' ? 'Error' : 'Gemini'}
              </div>
            </div>
          )}
          
          <div className="w-full">
            
            {message.isToolUse ? (
              <ToolCallRenderer
                message={message}
                onFileOpen={onFileOpen}
              />
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-3">
                      Interactive Prompt
                    </h4>
                    {(() => {
                      const lines = message.content.split('\n').filter(line => line.trim());
                      const questionLine = lines.find(line => line.includes('?')) || lines[0] || '';
                      const options = [];
                      
                      // Parse the menu options
                      lines.forEach(line => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });
                      
                      return (
                        <>
                          <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                            {questionLine}
                          </p>
                          
                          {/* Option buttons */}
                          <div className="space-y-2 mb-4">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                                  option.isSelected
                                    ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                    : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                                } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                    option.isSelected
                                      ? 'bg-white/20'
                                      : 'bg-amber-100 dark:bg-amber-800/50'
                                  }`}>
                                    {option.number}
                                  </span>
                                  <span className="text-sm sm:text-base font-medium flex-1">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                          
                          <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3">
                            <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
                              ⏳ Waiting for your response in the CLI
                            </p>
                            <p className="text-amber-800 dark:text-amber-200 text-xs">
                              Please select an option in your terminal where Gemini is running.
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isToolUse && message.toolName === 'Read' ? (
              // Simple Read tool indicator
              (() => {
                try {
                  const input = JSON.parse(message.toolInput);
                  if (input.file_path) {
                    const filename = input.file_path.split('/').pop();
                    return (
                      <div className="bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-300 dark:border-blue-600 pl-3 py-1 mb-2 text-sm text-blue-700 dark:text-blue-300">
                        📖 Read{' '}
                        <button 
                          onClick={() => onFileOpen && onFileOpen(input.file_path)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-mono"
                        >
                          {filename}
                        </button>
                      </div>
                    );
                  }
                } catch (e) {
                  return (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-300 dark:border-blue-600 pl-3 py-1 mb-2 text-sm text-blue-700 dark:text-blue-300">
                      📖 Read file
                    </div>
                  );
                }
              })()
            ) : message.isToolUse && message.toolName === 'TodoWrite' ? (
              // Simple TodoWrite tool indicator with tasks
              (() => {
                try {
                  const input = JSON.parse(message.toolInput);
                  if (input.todos && Array.isArray(input.todos)) {
                    return (
                      <div className="bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-300 dark:border-blue-600 pl-3 py-1 mb-2">
                        <div className="text-sm text-blue-700 dark:text-blue-300 mb-2">
                          📝 Update todo list
                        </div>
                        <TodoList todos={input.todos} />
                      </div>
                    );
                  }
                } catch (e) {
                  return (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-300 dark:border-blue-600 pl-3 py-1 mb-2 text-sm text-blue-700 dark:text-blue-300">
                      📝 Update todo list
                    </div>
                  );
                }
              })()
            ) : message.isToolUse && message.toolName === 'TodoRead' ? (
              // Simple TodoRead tool indicator
              <div className="bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-300 dark:border-blue-600 pl-3 py-1 mb-2 text-sm text-blue-700 dark:text-blue-300">
                📋 Read todo list
              </div>
            ) : (
              <div className={`text-sm ${message.type === 'error' ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800 relative' : 'text-gray-700 dark:text-gray-300'}`}>
                {message.type === 'error' && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(message.content)
                        .catch(() => {
                          // Silently fail if clipboard access is denied
                        });
                    }}
                    className="absolute top-2 right-2 px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  >
                    Copy
                  </button>
                )}
                {message.type === 'assistant' ? (
                  <EnhancedMessageRenderer 
                    content={message.content} 
                    isDarkMode={document.documentElement.classList.contains('dark')}
                  />
                ) : (
                  <div className={`whitespace-pre-wrap ${message.type === 'error' ? 'select-all cursor-text pr-16' : ''}`}>
                    {message.content}
                  </div>
                )}
              </div>
            )}
            
            {!withinAssistantGroup && (
              <div className={`text-xs text-gray-500 dark:text-gray-400 mt-1 ${isGrouped ? 'opacity-0 group-hover:opacity-100' : ''}`}>
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// Presentation-only grouping. The underlying chatMessages array intentionally
// stays flat so WebSocket updates, tool-result matching, persistence and
// historical session conversion keep their existing data model.
const groupMessagesForDisplay = (messages, isLoading) => {
  const groups = [];
  let currentAssistantGroup = null;

  messages.forEach((message, index) => {
    if (message?.type === 'assistant') {
      if (!currentAssistantGroup) {
        currentAssistantGroup = {
          kind: 'assistant-group',
          id: `assistant-group-${message.id || String(message.timestamp || index)}-${index}`,
          messages: [],
          isLoading: false
        };
        groups.push(currentAssistantGroup);
      }
      currentAssistantGroup.messages.push(message);
      return;
    }

    // User/system/error entries remain standalone and delimit an assistant
    // presentation group so their original ordering is never changed.
    currentAssistantGroup = null;
    groups.push({
      kind: 'message',
      id: `message-${message?.id || String(message?.timestamp || index)}-${index}`,
      message
    });
  });

  if (isLoading) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.kind === 'assistant-group') {
      lastGroup.isLoading = true;
    } else {
      groups.push({
        kind: 'assistant-group',
        id: `assistant-group-loading-${groups.length}`,
        messages: [],
        isLoading: true
      });
    }
  }

  return groups;
};

const AssistantMessageGroup = memo(({
  group,
  createDiff,
  onFileOpen,
  onShowSettings,
  showRawParameters,
  statusText,
  elapsedTime
}) => {
  const lastMessage = group.messages[group.messages.length - 1];
  const timestamp = lastMessage?.timestamp || new Date();

  return (
    <div className="chat-message assistant px-3 sm:px-0">
      <div className="w-full">
        <div className="flex items-center space-x-2 mb-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-0.5">
            <GeminiLogo className="w-full h-full" />
          </div>
          <div className="text-xs font-medium text-gray-900 dark:text-white">Gemini</div>
        </div>

        <div className="space-y-2">
          {group.messages.map((message, index) => (
            <MessageComponent
              key={`${message.id || index}-${message.timestamp}`}
              message={message}
              index={index}
              prevMessage={index > 0 ? group.messages[index - 1] : null}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              withinAssistantGroup
            />
          ))}

          {group.isLoading && (
            <div className="flex items-center gap-2 py-1 text-sm text-gray-500 dark:text-gray-400">
              <span className="animate-pulse text-primary">✻</span>
              <span>{statusText}...</span>
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500">({elapsedTime}s)</span>
            </div>
          )}
        </div>

        {group.messages.length > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {new Date(timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
});

// Unified attachment preview for images and regular files before sending.
const AttachmentPreview = ({ file, onRemove, error }) => {
  const [preview, setPreview] = useState(null);
  const isImage = isImageAttachment(file);
  
  useEffect(() => {
    if (!isImage) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);
  
  return (
    <div className="relative group rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      {isImage ? (
        <img src={preview} alt={file.name} className="w-20 h-20 object-cover" />
      ) : (
        <div className="w-44 h-20 px-3 flex items-center gap-2">
          <FileText className="w-7 h-7 text-blue-500 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate" title={file.name}>{file.name}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{formatAttachmentSize(file.size)}</div>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-80 hover:opacity-100"
        aria-label="Remove attachment"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

// ChatInterface: Main chat component with Session Protection System integration
// 
// Session Protection System prevents automatic project updates from interrupting active conversations:
// - onSessionActive: Called when user sends message to mark session as protected
// - onSessionInactive: Called when conversation completes/aborts to re-enable updates
// - onReplaceTemporarySession: Called to replace temporary session ID with real WebSocket session ID
//
// This ensures uninterrupted chat experience by pausing sidebar refreshes during conversations.
function ChatInterface({ selectedProject, selectedSession, ws, sendMessage, messages, onFileOpen, onInputFocusChange, onSessionActive, onSessionInactive, onReplaceTemporarySession, onNavigateToSession, onShowSettings, showRawParameters, autoScrollToBottom }) {
  const { t, language } = useLanguage();
  const processedIndexStorageKey = `gemini_processed_index:${selectedProject?.name || 'none'}`;
  const activeRunStorageKey = `gemini_active_run:${selectedProject?.name || 'none'}`;
  const pendingSessionStorageKey = `pendingSessionId:${selectedProject?.name || 'none'}`;
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return localStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [chatMessages, setChatMessages] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = localStorage.getItem(`chat_messages_${selectedProject.name}`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(() => !!sessionStorage.getItem(activeRunStorageKey));
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentRunId, setCurrentRunId] = useState(() => sessionStorage.getItem(activeRunStorageKey));
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [sessionMessages, setSessionMessages] = useState([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [permissionMode, setPermissionMode] = useState('default');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [attachmentErrors, setAttachmentErrors] = useState(new Map());
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [debouncedInput, setDebouncedInput] = useState('');
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);
  const [canAbortSession, setCanAbortSession] = useState(() => !!sessionStorage.getItem(activeRunStorageKey));
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [slashCommands, setSlashCommands] = useState([]);
  const [filteredCommands, setFilteredCommands] = useState([]);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [geminiStatus, setGeminiStatus] = useState(null);
  const [sessionModel, setSessionModel] = useState('gemini-3.8-flash');
  const [thinkingLevel, setThinkingLevel] = useState('HIGH');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);

  // Update elapsed time every second while loading
  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(timer);
  }, [isLoading]);

  // Animate the status indicator phase
  useEffect(() => {
    if (!isLoading) return;

    const timer = setInterval(() => {
      setAnimationPhase(prev => (prev + 1) % 4);
    }, 500);

    return () => clearInterval(timer);
  }, [isLoading]);

  // Derive cycling action words and status display
  const actionWordsEn = useMemo(() => ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'], []);
  const actionWordsZh = useMemo(() => ['思考中', '处理中', '分析中', '执行中', '计算中', '推理中'], []);
  const actionWords = language === 'zh' ? actionWordsZh : actionWordsEn;
  const actionIndex = Math.floor(elapsedTime / 3) % actionWords.length;
  const statusText = geminiStatus?.text || actionWords[actionIndex];
  const spinners = ['✻', '✹', '✸', '✶'];
  const currentSpinner = spinners[animationPhase];

  // Refocus textarea when loading completes
  const prevLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading]);

  // Load local Gemini configuration on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const token = localStorage.getItem('auth-token');
        const res = await fetch('/api/config', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const data = await res.json();
          if (data.geminiConfig) {
            if (data.geminiConfig.model) setSessionModel(data.geminiConfig.model);
            if (data.geminiConfig.thinkingLevel) setThinkingLevel(data.geminiConfig.thinkingLevel);
          }
        }
      } catch (e) {}
    };
    fetchConfig();
  }, []);


  // Memoized diff calculation to prevent recalculating on every render
  const createDiff = useMemo(() => {
    const cache = new Map();
    return (oldStr, newStr) => {
      const key = `${oldStr.length}-${newStr.length}-${oldStr.slice(0, 50)}`;
      if (cache.has(key)) {
        return cache.get(key);
      }
      
      const result = calculateDiff(oldStr, newStr);
      cache.set(key, result);
      if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      return result;
    };
  }, []);

  // Load session messages from API
  const loadSessionMessages = useCallback(async (projectName, sessionId) => {
    if (!projectName || !sessionId) return [];
    
    setIsLoadingSessionMessages(true);
    try {
      const response = await api.sessionMessages(projectName, sessionId);
      if (!response.ok) {
        throw new Error('Failed to load session messages');
      }
      const data = await response.json();
      return data.messages || [];
    } catch (error) {
      // console.error('Error loading session messages:', error);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);

  // Actual diff calculation function
  const calculateDiff = (oldStr, newStr) => {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    
    // Simple diff algorithm - find common lines and differences
    const diffLines = [];
    let oldIndex = 0;
    let newIndex = 0;
    
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      const oldLine = oldLines[oldIndex];
      const newLine = newLines[newIndex];
      
      if (oldIndex >= oldLines.length) {
        // Only new lines remaining
        diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
        newIndex++;
      } else if (newIndex >= newLines.length) {
        // Only old lines remaining
        diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
        oldIndex++;
      } else if (oldLine === newLine) {
        // Lines are the same - skip in diff view (or show as context)
        oldIndex++;
        newIndex++;
      } else {
        // Lines are different
        diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
        diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
        oldIndex++;
        newIndex++;
      }
    }
    
    return diffLines;
  };

  const convertSessionMessages = (rawMessages) => {
    const converted = [];
    const toolResults = new Map(); // Map tool_use_id to tool result
    
    // First pass: collect all tool results
    for (const msg of rawMessages) {
      if (msg.message?.role === 'user' && Array.isArray(msg.message?.content)) {
        for (const part of msg.message.content) {
          if (part.type === 'tool_result') {
            toolResults.set(part.tool_use_id, {
              content: part.content,
              isError: part.is_error,
              timestamp: new Date(msg.timestamp || Date.now())
            });
          }
        }
      }
    }
    
    // Second pass: process messages and attach tool results to tool uses
    for (const msg of rawMessages) {
      // Handle user messages
      if (msg.message?.role === 'user' && msg.message?.content) {
        let content = '';
        let messageType = 'user';
        
        if (Array.isArray(msg.message.content)) {
          // Handle array content, but skip tool results (they're attached to tool uses)
          const textParts = [];
          
          for (const part of msg.message.content) {
            if (part.type === 'text') {
              textParts.push(part.text);
            }
            // Skip tool_result parts - they're handled in the first pass
          }
          
          content = textParts.join('\n');
        } else if (typeof msg.message.content === 'string') {
          content = msg.message.content;
        } else {
          content = String(msg.message.content);
        }
        
        // Skip command messages and empty content
        if (content && !content.startsWith('<command-name>') && !content.startsWith('[Request interrupted')) {
          converted.push({
            type: messageType,
            content: content,
            timestamp: msg.timestamp || new Date().toISOString()
          });
        }
      }
      
      // Handle assistant messages
      else if (msg.message?.role === 'assistant' && msg.message?.content) {
        if (Array.isArray(msg.message.content)) {
          for (const part of msg.message.content) {
            if (part.type === 'text') {
              converted.push({
                type: 'assistant',
                content: part.text,
                timestamp: msg.timestamp || new Date().toISOString()
              });
            } else if (part.type === 'tool_use') {
              // Get the corresponding tool result
              const toolResult = toolResults.get(part.id);
              
              converted.push({
                type: 'assistant',
                content: '',
                timestamp: msg.timestamp || new Date().toISOString(),
                isToolUse: true,
                toolName: part.name,
                toolInput: JSON.stringify(part.input),
                toolResult: toolResult ? (typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)) : null,
                toolError: toolResult?.isError || false,
                toolResultTimestamp: toolResult?.timestamp || new Date()
              });
            }
          }
        } else if (typeof msg.message.content === 'string') {
          converted.push({
            type: 'assistant',
            content: msg.message.content,
            timestamp: msg.timestamp || new Date().toISOString()
          });
        }
      }
    }
    
    return converted;
  };

  // Memoize expensive convertSessionMessages operation
  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  // Define scroll functions early to avoid hoisting issues in useEffect dependencies
  const scrollToBottom = useCallback((instant = false) => {
    if (scrollContainerRef.current) {
      if (instant) {
        scrollContainerRef.current.classList.add('scroll-instant');
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        // Remove instant class after scroll
        requestAnimationFrame(() => {
          scrollContainerRef.current?.classList.remove('scroll-instant');
        });
      } else {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
      setIsUserScrolledUp(false);
    }
  }, []);

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    if (!scrollContainerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Consider "near bottom" if within 50px of the bottom
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  // Handle scroll events to detect when user manually scrolls up
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const nearBottom = isNearBottom();
      setIsUserScrolledUp(!nearBottom);
    }
  }, [isNearBottom]);

  // Track previous session ID using useRef to properly detect session changes
  const previousSessionIdRef = useRef(null);
  
  useEffect(() => {
    // Load session messages when session changes
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        // Check if this is actually a different session
        const isNewSession = previousSessionIdRef.current !== selectedSession.id;
        
        if (isNewSession) {
          // console.log('Loading messages for session:', selectedSession.id, 'previous:', previousSessionIdRef.current);
          previousSessionIdRef.current = selectedSession.id;
          setCurrentSessionId(selectedSession.id);
          
          // Only load messages from API if this is a user-initiated session change
          // For system-initiated changes, preserve existing messages and rely on WebSocket
          if (!isSystemSessionChange) {
            // Clear existing messages immediately to show loading state
            setChatMessages([]);
            setSessionMessages([]);
            
            setIsLoadingSessionMessages(true);
            try {
              const messages = await loadSessionMessages(selectedProject.name, selectedSession.id);
              setSessionMessages(messages);
              // convertedMessages will be automatically updated via useMemo
              // Scroll to bottom after loading session messages if auto-scroll is enabled
              if (autoScrollToBottom) {
                setTimeout(() => scrollToBottom(), 200);
              }
            } catch (error) {
              // console.error('Failed to load session messages:', error);
            } finally {
              setIsLoadingSessionMessages(false);
            }
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        }
      } else {
        setChatMessages([]);
        setSessionMessages([]);
        setCurrentSessionId(null);
        previousSessionIdRef.current = null;
      }
    };
    
    loadMessages();
  }, [selectedSession, selectedProject, loadSessionMessages, scrollToBottom, isSystemSessionChange, autoScrollToBottom]);

  // Update chatMessages when convertedMessages changes
  useEffect(() => {
    if (sessionMessages.length > 0) {
      setChatMessages(convertedMessages);
    }
  }, [convertedMessages, sessionMessages]);

  // Notify parent when input focus changes
  useEffect(() => {
    if (onInputFocusChange) {
      onInputFocusChange(isInputFocused);
    }
  }, [isInputFocused, onInputFocusChange]);

  // Persist input draft to localStorage
  useEffect(() => {
    if (selectedProject && input !== '') {
      localStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else if (selectedProject && input === '') {
      localStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  // Persist chat messages to localStorage
  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      localStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, selectedProject]);

  // Load saved state when project changes (but don't interfere with session loading)
  useEffect(() => {
    if (selectedProject) {
      // Always load saved input draft for the project
      const savedInput = localStorage.getItem(`draft_input_${selectedProject.name}`) || '';
      if (savedInput !== input) {
        setInput(savedInput);
      }
    }
  }, [selectedProject?.name]);

  // Listen for settings change
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'gemini-tools-settings') {
        // Add a system message to notify settings have been applied
        setChatMessages(prev => [...prev, {
          id: `system-${Date.now()}`,
          type: 'system',
          content: '⚙️ Settings updated.',
          timestamp: new Date().toISOString()
        }]);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const processedMessageIndexRef = useRef(Number(sessionStorage.getItem(processedIndexStorageKey) || 0));

  useEffect(() => {
    // Handle all new WebSocket messages sequentially to prevent dropping batched deltas
    if (messages.length < processedMessageIndexRef.current) {
      processedMessageIndexRef.current = 0;
      sessionStorage.setItem(processedIndexStorageKey, '0');
    }

    if (messages.length > processedMessageIndexRef.current) {
      const pendingMessages = messages.slice(processedMessageIndexRef.current);
      processedMessageIndexRef.current = messages.length;
      sessionStorage.setItem(processedIndexStorageKey, String(messages.length));

      const processMessage = (latestMessage) => {
        if (!latestMessage) return;

        if (isGeminiRuntimeMessage(latestMessage)) {
          if (!messageBelongsToProject(latestMessage, selectedProject)) {
            return;
          }
          if (latestMessage.runId) {
            setCurrentRunId(latestMessage.runId);
            sessionStorage.setItem(activeRunStorageKey, latestMessage.runId);
          }
        }

        switch (latestMessage.type) {
        case 'session-created':
          // New session created by Gemini CLI - we receive the real session ID here
          if (latestMessage.model) {
            setSessionModel(latestMessage.model);
          }
          // Store it temporarily until conversation completes (prevents premature session association)
          if (latestMessage.sessionId && !currentSessionId) {
            sessionStorage.setItem(pendingSessionStorageKey, latestMessage.sessionId);
            
            // Session Protection: Replace temporary "new-session-*" identifier with real session ID
            // This maintains protection continuity - no gap between temp ID and real ID
            // The temporary session is removed and real session is marked as active
            if (onReplaceTemporarySession) {
              onReplaceTemporarySession(selectedProject?.name, latestMessage.sessionId, latestMessage.runId || currentRunId);
            }
          }
          break;
          
        case 'gemini-response':
          const messageData = latestMessage.data.message || latestMessage.data;
          
          // Handle Gemini CLI session duplication bug workaround:
          // When resuming a session, Gemini CLI creates a new session instead of resuming.
          // We detect this by checking for system/init messages with session_id that differs
          // from our current session. When found, we need to switch the user to the new session.
          if (latestMessage.data.type === 'system' && 
              latestMessage.data.subtype === 'init' && 
              latestMessage.data.session_id && 
              currentSessionId && 
              latestMessage.data.session_id !== currentSessionId) {
            
            // Debug - Gemini CLI session duplication detected
            
            // Mark this as a system-initiated session change to preserve messages
            setIsSystemSessionChange(true);
            
            // Switch to the new session using React Router navigation
            // This triggers the session loading logic in App.jsx without a page reload
            if (onNavigateToSession) {
              onNavigateToSession(latestMessage.data.session_id);
            }
            return; // Don't process the message further, let the navigation handle it
          }
          
          // Handle system/init for new sessions (when currentSessionId is null)
          if (latestMessage.data.type === 'system' && 
              latestMessage.data.subtype === 'init' && 
              latestMessage.data.session_id && 
              !currentSessionId) {
            
            // Debug - New session init detected
            
            // Mark this as a system-initiated session change to preserve messages
            setIsSystemSessionChange(true);
            
            // Switch to the new session
            if (onNavigateToSession) {
              onNavigateToSession(latestMessage.data.session_id);
            }
            return; // Don't process the message further, let the navigation handle it
          }
          
          // For system/init messages that match current session, just ignore them
          if (latestMessage.data.type === 'system' && 
              latestMessage.data.subtype === 'init' && 
              latestMessage.data.session_id && 
              currentSessionId && 
              latestMessage.data.session_id === currentSessionId) {
            // Debug - System init message for current session, ignoring
            return; // Don't process the message further
          }
          
          // Handle different types of content in the response
          if (Array.isArray(messageData.content)) {
            for (const part of messageData.content) {
              if (part.type === 'tool_use') {
                // Add tool use message
                const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput: toolInput,
                  toolId: part.id,
                  toolResult: null // Will be updated when result comes in
                }]);
                
                // Trigger file refresh for file-related operations
                if (['Write', 'write_file', 'Edit', 'MultiEdit', 'Create', 'Delete'].includes(part.name)) {
                  console.log(`File operation detected: ${part.name}`);
                  // Dispatch custom event for FileTree to refresh
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('file-operation', {
                      detail: { 
                        toolName: part.name,
                        projectName: selectedProject?.name
                      }
                    }));
                  }, 500); // Small delay to ensure file operation completes
                }
              } else if (part.type === 'text' && part.text?.trim()) {
                // Add regular text message
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: part.text,
                  timestamp: new Date()
                }]);
              }
            }
          } else if (typeof messageData.content === 'string' && messageData.content.trim()) {
            // Add regular text message
            setChatMessages(prev => [...prev, {
              type: 'assistant',
              content: messageData.content,
              timestamp: new Date()
            }]);
          }
          
          // Handle tool results from user messages (these come separately)
          if (messageData.role === 'user' && Array.isArray(messageData.content)) {
            for (const part of messageData.content) {
              if (part.type === 'tool_result') {
                // Find the corresponding tool use and update it with the result
                setChatMessages(prev => prev.map(msg => {
                  if (msg.isToolUse && msg.toolId === part.tool_use_id) {
                    return {
                      ...msg,
                      toolResult: {
                        content: part.content,
                        isError: part.is_error,
                        timestamp: new Date()
                      }
                    };
                  }
                  return msg;
                }));
              }
            }
          }
          break;
          
        case 'gemini-tool-use':
          setIsLoading(true);
          setCanAbortSession(true);
          const toolData = latestMessage.tool;
          if (toolData) {
            const toolInput = toolData.input ? JSON.stringify(toolData.input, null, 2) : '';
            setChatMessages(prev => [...prev, {
              type: 'assistant',
              content: '',
              timestamp: new Date(),
              isToolUse: true,
              toolName: toolData.name,
              toolInput: toolInput,
              toolId: toolData.id,
              toolResult: null
            }]);
            setGeminiStatus({
              text: language === 'zh' ? `正在调用工具: ${toolData.name}` : `Running tool: ${toolData.name}`,
              can_interrupt: true
            });
          }
          break;

        case 'gemini-tool-result':
          setIsLoading(true);
          setCanAbortSession(true);
          const resData = latestMessage.result;
          if (resData) {
            setChatMessages(prev => prev.map(msg => {
              if (msg.isToolUse && msg.toolId === resData.toolId) {
                return {
                  ...msg,
                  toolResult: {
                    content: resData.content,
                    isError: resData.isError,
                    timestamp: new Date()
                  }
                };
              }
              return msg;
            }));
            setGeminiStatus({
              text: language === 'zh' ? '思考中' : 'Thinking',
              can_interrupt: true
            });
          }
          break;

        case 'gemini-delta':
          setIsLoading(true);
          setCanAbortSession(true);
          const chunk = latestMessage.content || '';
          if (chunk) {
            setChatMessages(prev => {
              if (prev.length === 0) {
                return [{
                  type: 'assistant',
                  content: chunk,
                  timestamp: new Date()
                }];
              }
              const last = prev[prev.length - 1];
              // If the last message is an assistant text response (not tool use), append to it
              if (last.type === 'assistant' && !last.isToolUse) {
                const copy = [...prev];
                copy[copy.length - 1] = {
                  ...last,
                  content: last.content + chunk
                };
                return copy;
              } else {
                // Otherwise start a new assistant text message block
                return [...prev, {
                  type: 'assistant',
                  content: chunk,
                  timestamp: new Date()
                }];
              }
            });
            setGeminiStatus({
              text: language === 'zh' ? '正在回复' : 'Responding',
              can_interrupt: true
            });
          }
          break;

        case 'gemini-output':
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: latestMessage.data,
            timestamp: new Date()
          }]);
          break;
        case 'gemini-interactive-prompt':
          // Handle interactive prompts from CLI
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: latestMessage.data,
            timestamp: new Date(),
            isInteractivePrompt: true
          }]);
          break;

        case 'gemini-error':
        case 'error':
          // console.log('Gemini error, setting isLoading to false:', latestMessage.error);
          setChatMessages(prev => [...prev, {
            type: 'error',
            content: `Error: ${latestMessage.error || 'Unknown error'}`,
            timestamp: new Date()
          }]);
          setIsLoading(false);
          setCanAbortSession(false);
          setGeminiStatus(null);
          sessionStorage.removeItem(activeRunStorageKey);
          if (onSessionInactive) {
            onSessionInactive(selectedProject?.name, latestMessage.sessionId || currentSessionId, latestMessage.runId || currentRunId);
          }
          setCurrentRunId(null);
          break;
          
        case 'gemini-complete':
          // console.log('Gemini completed, setting isLoading to false');
          setIsLoading(false);
          setCanAbortSession(false);
          setGeminiStatus(null);

          // Play notification sound when response is complete
          playNotificationSound();
          
          // Session Protection: Mark session as inactive to re-enable automatic project updates
          // Conversation is complete, safe to allow project updates again
          // Use real session ID if available, otherwise use pending session ID
          const activeSessionId = currentSessionId || sessionStorage.getItem(pendingSessionStorageKey);
          if (onSessionInactive) {
            onSessionInactive(selectedProject?.name, latestMessage.sessionId || activeSessionId, latestMessage.runId || currentRunId);
          }
          
          // If we have a pending session ID and the conversation completed successfully, use it
          const pendingSessionId = sessionStorage.getItem(pendingSessionStorageKey);
          if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
                setCurrentSessionId(pendingSessionId);
            sessionStorage.removeItem(pendingSessionStorageKey);
          }
          sessionStorage.removeItem(activeRunStorageKey);
          setCurrentRunId(null);
          
          // Clear persisted chat messages after successful completion
          if (selectedProject && latestMessage.exitCode === 0) {
            localStorage.removeItem(`chat_messages_${selectedProject.name}`);
          }

          // Auto sync session messages from backend on completion for guaranteed consistency
          const finalSessionId = currentSessionId || pendingSessionId;
          if (finalSessionId && selectedProject && latestMessage.exitCode === 0) {
            setTimeout(() => {
              loadSessionMessages(selectedProject.name, finalSessionId).catch(() => {});
            }, 400);
          }
          break;

          case 'session-aborted':
          setIsLoading(false);
          setCanAbortSession(false);
          setGeminiStatus(null);

          // Session Protection: Mark session as inactive when aborted
          // User or system aborted the conversation, re-enable project updates
          if (onSessionInactive) {
            onSessionInactive(selectedProject?.name, latestMessage.sessionId || currentSessionId, latestMessage.runId || currentRunId);
          }
          sessionStorage.removeItem(activeRunStorageKey);
          setCurrentRunId(null);

          setChatMessages(prev => [...prev, {
            type: 'system',
            content: language === 'zh' ? '⏹️ 已手动停止任务' : '⏹️ Task stopped manually',
            timestamp: new Date()
          }]);
          break;

          case 'session-abort-failed':
          // Backend could not find/signal the requested run. Keep the UI in a
          // running state instead of falsely claiming the task was stopped.
          setIsLoading(true);
          setCanAbortSession(true);
          setGeminiStatus({
            text: language === 'zh' ? '停止失败，任务仍在运行' : 'Stop failed; task is still running',
            can_interrupt: true
          });
          setChatMessages(prev => [...prev, {
            type: 'error',
            content: language === 'zh'
              ? '停止失败：后端没有找到对应的运行进程，请重试。'
              : 'Stop failed: the backend could not find the matching running process. Please try again.',
            timestamp: new Date()
          }]);
          break;

          case 'gemini-status':
          // Handle Gemini working status messages
          // Debug - Received gemini-status message
          const statusData = latestMessage.data;
          if (statusData) {
            // Parse the status message to extract relevant information
            let statusInfo = {
              text: 'Working...',
              tokens: 0,
              can_interrupt: true
            };

            // Check for different status message formats
            if (statusData.message) {
              statusInfo.text = statusData.message;
            } else if (statusData.status) {
              statusInfo.text = statusData.status;
            } else if (typeof statusData === 'string') {
              statusInfo.text = statusData;
            }

            // Extract token count
            if (statusData.tokens) {
              statusInfo.tokens = statusData.tokens;
            } else if (statusData.token_count) {
              statusInfo.tokens = statusData.token_count;
            }

            // Check if can interrupt
            if (statusData.can_interrupt !== undefined) {
              statusInfo.can_interrupt = statusData.can_interrupt;
            }

            // Debug - Setting claude status
            setGeminiStatus(statusInfo);
            setIsLoading(true);
            setCanAbortSession(statusInfo.can_interrupt);
          }
          break;
          }
          };

          for (const msg of pendingMessages) {
          processMessage(msg);
          }
          }
          }, [messages]);

  // Load file list when project changes
  useEffect(() => {
    if (selectedProject) {
      fetchProjectFiles();
    }
  }, [selectedProject]);

  const fetchProjectFiles = async () => {
    try {
      const response = await api.getFiles(selectedProject.name);
      if (response.ok) {
        const files = await response.json();
        // Flatten the file tree to get all file paths
        const flatFiles = flattenFileTree(files);
        setFileList(flatFiles);
      }
    } catch (error) {
      // console.error('Error fetching files:', error);
    }
  };

  const flattenFileTree = (files, basePath = '') => {
    let result = [];
    for (const file of files) {
      const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
      if (file.type === 'directory' && file.children) {
        result = result.concat(flattenFileTree(file.children, fullPath));
      } else if (file.type === 'file') {
        result.push({
          name: file.name,
          path: fullPath,
          relativePath: file.path
        });
      }
    }
    return result;
  };

  // Handle @ symbol detection and file filtering
  useEffect(() => {
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's a space after the @ symbol (which would end the file reference)
      if (!textAfterAt.includes(' ')) {
        setAtSymbolPosition(lastAtIndex);
        setShowFileDropdown(true);
        
        // Filter files based on the text after @
        const filtered = fileList.filter(file => 
          file.name.toLowerCase().includes(textAfterAt.toLowerCase()) ||
          file.path.toLowerCase().includes(textAfterAt.toLowerCase())
        ).slice(0, 10); // Limit to 10 results
        
        setFilteredFiles(filtered);
        setSelectedFileIndex(-1);
      } else {
        setShowFileDropdown(false);
        setAtSymbolPosition(-1);
      }
    } else {
      setShowFileDropdown(false);
      setAtSymbolPosition(-1);
    }
  }, [input, cursorPosition, fileList]);

  // Debounced input handling
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInput(input);
    }, 150); // 150ms debounce
    
    return () => clearTimeout(timer);
  }, [input]);

  // Show only recent messages for better performance
  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  // Group only for presentation. Streaming/tool-result updates continue to
  // operate on the original flat chatMessages array.
  const displayMessages = useMemo(() => {
    return groupMessagesForDisplay(visibleMessages, isLoading);
  }, [visibleMessages, isLoading]);

  // Capture scroll position before render when auto-scroll is disabled
  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop
      };
    }
  });

  // Auto-scroll to bottom when new messages arrive OR during streaming text updates
  const lastMessageContent = chatMessages[chatMessages.length - 1]?.content;
  useEffect(() => {
    if (scrollContainerRef.current && chatMessages.length > 0) {
      if (autoScrollToBottom) {
        // If auto-scroll is enabled, always scroll to bottom unless user has manually scrolled up
        if (!isUserScrolledUp) {
          scrollToBottom();
        }
      } else {
        // When auto-scroll is disabled, preserve the visual position
        const container = scrollContainerRef.current;
        const prevHeight = scrollPositionRef.current.height;
        const prevTop = scrollPositionRef.current.top;
        const newHeight = container.scrollHeight;
        const heightDiff = newHeight - prevHeight;
        
        // If content was added above the current view, adjust scroll position
        if (heightDiff > 0 && prevTop > 0) {
          container.scrollTop = prevTop + heightDiff;
        }
      }
    }
  }, [chatMessages.length, lastMessageContent, isUserScrolledUp, scrollToBottom, autoScrollToBottom]);

  // Scroll to bottom when component mounts with existing messages or when messages first load
  useEffect(() => {
    if (scrollContainerRef.current && chatMessages.length > 0) {
      // Always scroll to bottom when messages first load (user expects to see latest)
      // Also reset scroll state
      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(true), 200); // Instant scroll on initial load
    }
  }, [chatMessages.length > 0, scrollToBottom]); // Trigger when messages first appear

  // Add scroll event listener to detect user scrolling
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Initial textarea setup
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

      // Check if initially expanded
      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
      const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
      setIsTextareaExpanded(isExpanded);
    }
  }, []); // Only run once on mount

  // Reset textarea height when input is cleared programmatically
  useEffect(() => {
    if (textareaRef.current && !input.trim()) {
      textareaRef.current.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  }, [input]);

  const handleTranscript = useCallback((text) => {
    if (text.trim()) {
      setInput(prevInput => {
        const newInput = prevInput.trim() ? `${prevInput} ${text}` : text;
        
        // Update textarea height after setting new content
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
            
            // Check if expanded after transcript
            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
            const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
            setIsTextareaExpanded(isExpanded);
          }
        }, 0);
        
        return newInput;
      });
    }
  }, []);

  // Load earlier messages by increasing the visible message count
  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount(prevCount => prevCount + 100);
  }, []);

  // Handle files from drag & drop, file picker, or clipboard.
  const handleAttachmentFiles = useCallback((files) => {
    const validFiles = [];
    const errors = new Map();

    for (const file of files) {
      const image = isImageAttachment(file);
      const maxSize = image ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
      if (file.size > maxSize) {
        errors.set(
          file.name,
          language === 'zh'
            ? `${file.name} 超过大小限制（${image ? '图片最大 5 MB' : '文件最大 20 MB'}）`
            : `${file.name} exceeds the size limit (${image ? '5 MB for images' : '20 MB for files'})`
        );
        continue;
      }
      validFiles.push(file);
    }

    setAttachmentErrors(errors);
    if (validFiles.length > 0) {
      setAttachedFiles(prev => {
        const remaining = Math.max(0, 10 - prev.length);
        if (validFiles.length > remaining) {
          setAttachmentErrors(current => new Map(current).set(
            '__limit__',
            language === 'zh' ? '一次最多上传 10 个附件' : 'You can upload up to 10 attachments at a time'
          ));
        }
        return [...prev, ...validFiles.slice(0, remaining)];
      });
    }
  }, [language]);

  // Handle clipboard file data. This covers screenshots and browsers that expose copied files.
  const handlePaste = useCallback(async (e) => {
    const clipboardFiles = Array.from(e.clipboardData.files || []);
    if (clipboardFiles.length > 0) {
      handleAttachmentFiles(clipboardFiles);
      return;
    }

    const itemFiles = Array.from(e.clipboardData.items || [])
      .map(item => item.kind === 'file' ? item.getAsFile() : null)
      .filter(Boolean);
    if (itemFiles.length > 0) {
      handleAttachmentFiles(itemFiles);
    }
  }, [handleAttachmentFiles]);

  // Setup dropzone for all file types. Per-type limits are enforced above and again on the server.
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: 20 * 1024 * 1024,
    maxFiles: 10,
    onDrop: handleAttachmentFiles,
    onDropRejected: () => {
      setAttachmentErrors(prev => new Map(prev).set(
        '__drop__',
        language === 'zh' ? '部分附件超过数量或大小限制' : 'Some attachments exceed the count or size limit'
      ));
    },
    noClick: true,
    noKeyboard: true
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isLoading || !selectedProject) return;

    const commandText = input.trim() || (language === 'zh'
      ? '请查看并分析这些附件。'
      : 'Please review and analyze these attachments.');

    // Upload attachments first. The backend stores them persistently inside the project.
    let uploadedAttachments = [];
    if (attachedFiles.length > 0) {
      const formData = new FormData();
      attachedFiles.forEach(file => {
        formData.append('attachments', file);
      });
      
      try {
        const token = localStorage.getItem('auth-token');
        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`/api/projects/${selectedProject.name}/upload-attachments`, {
          method: 'POST',
          headers: headers,
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to upload attachments');
        }
        
        const result = await response.json();
        uploadedAttachments = result.attachments || [];
      } catch (error) {
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `${language === 'zh' ? '附件上传失败' : 'Failed to upload attachments'}: ${error.message}`,
          timestamp: new Date()
        }]);
        return;
      }
    }

    const runId = globalThis.crypto?.randomUUID?.() || `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userMessage = {
      id: `user-${runId}`,
      runId,
      type: 'user',
      content: input,
      attachments: uploadedAttachments,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setCurrentRunId(runId);
    sessionStorage.setItem(activeRunStorageKey, runId);
    // console.log('Setting isLoading to true after sending message');
    setIsLoading(true);
    setCanAbortSession(true);
    // Set a default status when starting
    setGeminiStatus({
      text: 'Processing',
      tokens: 0,
      can_interrupt: true
    });
    
    // Always scroll to bottom when user sends a message and reset scroll state
    setIsUserScrolledUp(false); // Reset scroll state so auto-scroll works for Gemini's response
    setTimeout(() => scrollToBottom(), 100); // Longer delay to ensure message is rendered

    // Session Protection: Mark session as active to prevent automatic project updates during conversation
    // This is crucial for maintaining chat state integrity. We handle two cases:
    // 1. Existing sessions: Use the real currentSessionId
    // 2. New sessions: Use this project's stable run ID until Gemini reports the real session ID
    // This ensures no gap in protection between message send and session creation
    const sessionToActivate = currentSessionId || `run:${runId}`;
    if (onSessionActive) {
      onSessionActive(selectedProject.name, sessionToActivate);
    }

    // Send command to Gemini CLI via WebSocket with persistent attachment metadata.
    const sent = sendMessage({
      type: 'gemini-command',
      command: commandText,
      options: {
        runId,
        projectName: selectedProject.name,
        projectPath: selectedProject.path,
        cwd: selectedProject.path,
        sessionId: currentSessionId,
        resume: !!currentSessionId,
        attachments: uploadedAttachments.map(({ data, ...attachment }) => attachment)
      }
    });

    if (sent === false) {
      setIsLoading(false);
      setCanAbortSession(false);
      setGeminiStatus(null);
      sessionStorage.removeItem(activeRunStorageKey);
      setCurrentRunId(null);
      if (onSessionInactive) {
        onSessionInactive(selectedProject.name, currentSessionId, runId);
      }
      setChatMessages(prev => [...prev, {
        type: 'error',
        content: language === 'zh' ? '网络连接尚未就绪，请等待连接建立后重试' : 'WebSocket connection is not ready. Please wait and try again.',
        timestamp: new Date()
      }]);
      return;
    }

    setInput('');
    setAttachedFiles([]);
    setAttachmentErrors(new Map());
    setIsTextareaExpanded(false);
    
    // Reset textarea height


    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    // Clear the saved draft since message was sent
    if (selectedProject) {
      localStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  };

  const handleKeyDown = (e) => {
    // Handle file dropdown navigation
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev < filteredFiles.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev > 0 ? prev - 1 : filteredFiles.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowFileDropdown(false);
        return;
      }
    }
    
    // Handle Tab key for mode switching (only when file dropdown is not showing)
    // Disabled for Gemini - no permission modes
    /*
    if (e.key === 'Tab' && !showFileDropdown) {
      e.preventDefault();
      const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      const currentIndex = modes.indexOf(permissionMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      setPermissionMode(modes[nextIndex]);
      return;
    }
    */
    
    // Handle Enter key: Ctrl+Enter (Cmd+Enter on Mac) sends, Shift+Enter creates new line
    if (e.key === 'Enter') {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        // Ctrl+Enter or Cmd+Enter: Send message
        e.preventDefault();
        handleSubmit(e);
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Plain Enter: Also send message (keeping original behavior)
        e.preventDefault();
        handleSubmit(e);
      }
      // Shift+Enter: Allow default behavior (new line)
    }
  };

  const selectFile = (file) => {
    const textBeforeAt = input.slice(0, atSymbolPosition);
    const textAfterAtQuery = input.slice(atSymbolPosition);
    const spaceIndex = textAfterAtQuery.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterAtQuery.slice(spaceIndex) : '';
    
    const newInput = textBeforeAt + '@' + file.path + ' ' + textAfterQuery;
    const newCursorPos = textBeforeAt.length + 1 + file.path.length + 1;
    
    // Immediately ensure focus is maintained
    if (textareaRef.current && !textareaRef.current.matches(':focus')) {
      textareaRef.current.focus();
    }
    
    // Update input and cursor position
    setInput(newInput);
    setCursorPosition(newCursorPos);
    
    // Hide dropdown
    setShowFileDropdown(false);
    setAtSymbolPosition(-1);
    
    // Set cursor position synchronously 
    if (textareaRef.current) {
      // Use requestAnimationFrame for smoother updates
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          // Ensure focus is maintained
          if (!textareaRef.current.matches(':focus')) {
            textareaRef.current.focus();
          }
        }
      });
    }
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setInput(newValue);
    setCursorPosition(e.target.selectionStart);
    
    // Handle height reset when input becomes empty
    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  };

  const handleTextareaClick = (e) => {
    setCursorPosition(e.target.selectionStart);
  };



  const handleNewSession = () => {
    setChatMessages([]);
    setInput('');
    setIsLoading(false);
    setCanAbortSession(false);
  };
  
  const handleAbortSession = () => {
    console.log('🛑 Aborting session requested by user, sessionId:', currentSessionId, 'runId:', currentRunId);

    // Wait for backend confirmation. Previously the UI immediately claimed
    // success even when only Gemini's wrapper process had died.
    setCanAbortSession(false);
    setGeminiStatus({
      text: language === 'zh' ? '正在停止' : 'Stopping',
      can_interrupt: false
    });

    const sent = sendMessage({
      type: 'abort-session',
      sessionId: currentSessionId || selectedSession?.id,
      runId: currentRunId,
      projectName: selectedProject?.name,
      projectPath: selectedProject?.path
    });

    if (sent === false) {
      setCanAbortSession(true);
      setGeminiStatus({
        text: language === 'zh' ? '停止失败，连接不可用' : 'Stop failed; connection unavailable',
        can_interrupt: true
      });
    }
  };

  const handleModeSwitch = () => {
    // Disabled for Gemini - no permission modes
    // const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    // const currentIndex = modes.indexOf(permissionMode);
    // const nextIndex = (currentIndex + 1) % modes.length;
    // setPermissionMode(modes[nextIndex]);
  };

  // Don't render if no project is selected
  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p>Select a project to start chatting with Gemini</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>
        {`
          details[open] .details-chevron {
            transform: rotate(180deg);
          }
        `}
      </style>
      <div className="h-full flex flex-col">
        {/* Messages Area - Scrollable Middle Section */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-0 py-3 sm:p-4 space-y-3 sm:space-y-4 relative"
        style={{ 
          scrollBehavior: 'smooth',
          // Force GPU acceleration for smoother scrolling
          transform: 'translateZ(0)',
          willChange: 'scroll-position'
        }}
      >
        {isLoadingSessionMessages && chatMessages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
              <p>Loading session messages...</p>
            </div>
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 dark:text-gray-400 px-6 sm:px-4">
              <p className="font-bold text-lg sm:text-xl mb-3">{t('chat.startConversation')}</p>
              <p className="text-sm sm:text-base leading-relaxed">
                {t('chat.startDescription')}
              </p>
            </div>
          </div>
        ) : (
          <>
            {chatMessages.length > visibleMessageCount && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
                {language === 'zh' 
                  ? `显示最近 ${visibleMessageCount} 条消息 (共 ${chatMessages.length} 条) • ` 
                  : `Showing last ${visibleMessageCount} messages (${chatMessages.length} total) • `}
                <button 
                  className="ml-1 text-blue-600 hover:text-blue-700 underline"
                  onClick={loadEarlierMessages}
                >
                  {language === 'zh' ? '加载更早消息' : 'Load earlier messages'}
                </button>
              </div>
            )}
            
            {displayMessages.map((displayItem, index) => {
              if (displayItem.kind === 'assistant-group') {
                return (
                  <AssistantMessageGroup
                    key={displayItem.id}
                    group={displayItem}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    showRawParameters={showRawParameters}
                    statusText={statusText}
                    elapsedTime={elapsedTime}
                  />
                );
              }

              const message = displayItem.message;
              return (
                <MessageComponent
                  key={displayItem.id}
                  message={message}
                  index={index}
                  prevMessage={null}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  showRawParameters={showRawParameters}
                />
              );
            })}
          </>
        )}
        
        <div ref={messagesEndRef} />
      </div>


      {/* Input Area - Fixed Bottom */}
      <div className="p-2 sm:p-4 md:p-6 flex-shrink-0">
        {/* Gemini Model & Reasoning Effort Indicator (Read-only) */}
        <div className="max-w-4xl mx-auto mb-3">
          <div className="flex items-center justify-center gap-2">
            <div className="px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 bg-card/90 dark:bg-gray-850 border-border text-foreground shadow-sm flex items-center gap-2.5 backdrop-blur-sm select-none flex-wrap justify-center">
              <div className="flex items-center gap-1.5 text-primary font-semibold">
                <div className="w-2 h-2 rounded-full animate-pulse bg-emerald-500 flex-shrink-0" />
                <span>Gemini CLI</span>
              </div>
              
              <span className="text-border hidden sm:inline">|</span>
              
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">{language === 'zh' ? '模型' : 'Model'}:</span>
                <span className="font-mono font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
                  {sessionModel}
                </span>
              </div>
              
              <span className="text-border hidden sm:inline">|</span>
              
              <div className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="text-muted-foreground">{language === 'zh' ? '推理强度' : 'Reasoning'}:</span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  {thinkingLevel === 'HIGH' ? (language === 'zh' ? '高 (HIGH)' : 'High') :
                   thinkingLevel === 'LOW' ? (language === 'zh' ? '低 (LOW)' : 'Low') :
                   thinkingLevel === 'MEDIUM' ? (language === 'zh' ? '中 (MEDIUM)' : 'Medium') :
                   thinkingLevel || (language === 'zh' ? '标准' : 'Standard')}
                </span>
              </div>
            </div>
            
            {/* Scroll to bottom button - positioned next to mode indicator */}
            {isUserScrolledUp && chatMessages.length > 0 && (
              <button
                onClick={scrollToBottom}
                className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
                title={language === 'zh' ? '滚到底部' : 'Scroll to bottom'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
            )}
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto">
          {/* Drag overlay */}
          {isDragActive && (
            <div className="absolute inset-0 bg-blue-500/20 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg">
                <svg className="w-8 h-8 text-blue-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm font-medium">{t('chat.dropFilesHere')}</p>
              </div>
            </div>
          )}
          
          {/* Attachment previews */}
          {attachedFiles.length > 0 && (
            <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <AttachmentPreview
                    key={`${file.name}-${file.lastModified}-${index}`}
                    file={file}
                    onRemove={() => {
                      setAttachedFiles(prev => prev.filter((_, i) => i !== index));
                    }}
                    error={attachmentErrors.get(file.name)}
                  />
                ))}
              </div>
            </div>
          )}
          {attachmentErrors.size > 0 && (
            <div className="mb-2 space-y-1">
              {Array.from(new Set(attachmentErrors.values())).slice(0, 3).map((error, index) => (
                <div key={`${error}-${index}`} className="text-xs text-red-600 dark:text-red-400">{error}</div>
              ))}
            </div>
          )}
          
          {/* File dropdown - positioned outside dropzone to avoid conflicts */}
          {showFileDropdown && filteredFiles.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 backdrop-blur-sm">
              {filteredFiles.map((file, index) => (
                <div
                  key={file.path}
                  className={`px-4 py-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0 touch-manipulation ${
                    index === selectedFileIndex
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                  onMouseDown={(e) => {
                    // Prevent textarea from losing focus on mobile
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectFile(file);
                  }}
                >
                  <div className="font-medium text-sm">{file.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {file.path}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <div {...getRootProps()} className={`chat-input-container relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200 ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}>
            <input {...getInputProps()} />
            {isLoading ? (
              <div className="w-full pl-12 pr-24 sm:pr-32 py-3 sm:py-4 flex items-center gap-2.5 min-h-[40px] sm:min-h-[56px] select-none">
                <span className="text-base sm:text-lg text-primary animate-pulse flex-shrink-0">
                  {currentSpinner}
                </span>
                <span className="text-sm sm:text-base font-medium text-gray-800 dark:text-gray-100 truncate">
                  {statusText}...
                </span>
                <span className="text-xs sm:text-sm font-mono text-gray-400 dark:text-gray-500 flex-shrink-0">
                  ({elapsedTime}s)
                </span>
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onClick={handleTextareaClick}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                onInput={(e) => {
                  // Immediate resize on input for better UX
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                  setCursorPosition(e.target.selectionStart);
                  
                  // Check if textarea is expanded (more than 2 lines worth of height)
                  const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);
                  const isExpanded = e.target.scrollHeight > lineHeight * 2;
                  setIsTextareaExpanded(isExpanded);
                }}
                placeholder={t('chat.inputPlaceholder')}
                rows={1}
                className="chat-input-placeholder w-full pl-12 pr-28 sm:pr-40 py-3 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none min-h-[40px] sm:min-h-[56px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-sm sm:text-base transition-all duration-200"
                style={{ height: 'auto' }}
              />
            )}
            {/* Clear button - shown when there's text and not loading */}
            {input.trim() && !isLoading && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInput('');
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.focus();
                  }
                  setIsTextareaExpanded(false);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInput('');
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.focus();
                  }
                  setIsTextareaExpanded(false);
                }}
                className="absolute -left-0.5 -top-3 sm:right-28 sm:left-auto sm:top-1/2 sm:-translate-y-1/2 w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group z-10 shadow-sm"
                title={t('chat.clearInput')}
              >
                <svg 
                  className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M6 18L18 6M6 6l12 12" 
                  />
                </svg>
              </button>
            )}
            {/* File / image upload button */}
            <button
              type="button"
              onClick={open}
              disabled={isLoading}
              className={`absolute left-2 bottom-3 sm:bottom-4 p-2 rounded-lg transition-colors ${
                isLoading ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={t('chat.uploadFiles')}
            >
              <Paperclip className="w-5 h-5 text-gray-500" />
            </button>
            
            {/* Mic button - HIDDEN */}
            <div className="absolute right-16 sm:right-16 top-1/2 transform -translate-y-1/2" style={{ display: 'none' }}>
              <MicButton 
                onTranscript={handleTranscript}
                className="w-10 h-10 sm:w-10 sm:h-10"
              />
            </div>
            {/* Send or Stop button */}
            {isLoading ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAbortSession();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAbortSession();
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 h-9 sm:h-10 px-3 sm:px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl sm:rounded-full flex items-center justify-center gap-1.5 transition-all shadow-md hover:shadow-lg active:scale-95 text-xs sm:text-sm font-medium z-10 cursor-pointer"
                title={language === 'zh' ? '停止 (Stop)' : 'Stop'}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span className="font-medium">{language === 'zh' ? '停止' : 'Stop'}</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSubmit(e);
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleSubmit(e);
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800 shadow-sm"
              >
                <svg 
                  className="w-4 h-4 sm:w-5 sm:h-5 text-white transform rotate-90" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" 
                  />
                </svg>
              </button>
            )}
          </div>
          {/* Hint text */}
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2 hidden sm:block">
            {language === 'zh' 
              ? '按 Enter 发送 • Shift+Enter 换行 • Tab 切换模式 • @ 引用文件' 
              : 'Press Enter to send • Shift+Enter for new line • Tab to change modes • @ to reference files'}
          </div>
          <div className={`text-xs text-gray-500 dark:text-gray-400 text-center mt-2 sm:hidden transition-opacity duration-200 ${
            isInputFocused ? 'opacity-100' : 'opacity-0'
          }`}>
            {language === 'zh'
              ? 'Enter 发送 • Tab 切换模式 • @ 引用文件'
              : 'Enter to send • Tab for modes • @ for files'}
          </div>
        </form>
      </div>
    </div>
    </>
  );
}

export default React.memo(ChatInterface);