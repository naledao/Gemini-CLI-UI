import React, { useState } from 'react';
import { 
  Terminal, 
  FileText, 
  Search, 
  Edit3, 
  Wrench, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  FolderOpen,
  Folder,
  Copy,
  Check,
  GitBranch,
  Compass
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

function shortenPath(p, maxLen = 34) {
  if (!p || typeof p !== 'string') return '';
  const normalized = p.replace(/\\/g, '/');
  if (normalized.length <= maxLen) return normalized;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) return normalized;
  const lastParts = segments.slice(-2).join('/');
  return `…/${lastParts}`;
}

export default function ToolCallRenderer({ message, onFileOpen }) {
  const { t, language } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedWd, setCopiedWd] = useState(false);

  // Parse input parameters safely
  let inputParams = {};
  try {
    if (typeof message.toolInput === 'string') {
      inputParams = JSON.parse(message.toolInput);
    } else if (typeof message.toolInput === 'object') {
      inputParams = message.toolInput || {};
    }
  } catch (e) {
    inputParams = { raw: message.toolInput };
  }

  // Determine tool icon, title and description
  const toolName = message.toolName || 'tool';
  let icon = <Wrench className="w-3.5 h-3.5 text-blue-500" />;
  let actionTitle = toolName;
  let actionDetail = '';

  if (toolName === 'run_shell_command' || toolName === 'Bash' || toolName === 'exec_command') {
    icon = <Terminal className="w-3.5 h-3.5 text-emerald-500" />;
    actionTitle = language === 'zh' ? '执行命令' : 'Run Command';
    actionDetail = inputParams.command || inputParams.cmd || '';
  } else if (toolName === 'read_file' || toolName === 'Read' || toolName === 'read_files') {
    icon = <FileText className="w-3.5 h-3.5 text-sky-500" />;
    actionTitle = language === 'zh' ? '读取文件' : 'Read File';
    actionDetail = inputParams.file_path || inputParams.path || (Array.isArray(inputParams.paths) ? inputParams.paths.join(', ') : '');
  } else if (toolName === 'grep_search' || toolName === 'Grep' || toolName === 'search_text' || toolName === 'code_search') {
    icon = <Search className="w-3.5 h-3.5 text-amber-500" />;
    actionTitle = language === 'zh' ? '代码搜索' : 'Search Pattern';
    actionDetail = inputParams.pattern || inputParams.query || '';
  } else if (toolName === 'glob' || toolName === 'list_directory' || toolName === 'list_dir' || toolName === 'list_files') {
    icon = <FolderOpen className="w-3.5 h-3.5 text-indigo-500" />;
    actionTitle = language === 'zh' ? '检索文件' : 'Find Files';
    actionDetail = inputParams.pattern || inputParams.dir_path || inputParams.path || '';
  } else if (toolName === 'write_file' || toolName === 'Write' || toolName === 'replace' || toolName === 'apply_patch') {
    icon = <Edit3 className="w-3.5 h-3.5 text-purple-500" />;
    actionTitle = language === 'zh' ? '写入修改' : 'Edit File';
    actionDetail = inputParams.file_path || inputParams.path || '';
  } else if (toolName?.startsWith('git_') || toolName === 'git') {
    icon = <GitBranch className="w-3.5 h-3.5 text-rose-500" />;
    actionTitle = language === 'zh' ? 'Git 操作' : 'Git Operation';
    actionDetail = toolName;
  } else if (toolName === 'update_topic') {
    icon = <Compass className="w-3.5 h-3.5 text-orange-500" />;
    actionTitle = language === 'zh' ? '规划意图' : 'Strategic Intent';
    actionDetail = inputParams.strategic_intent || inputParams.title || '';
  }

  // Resolve workingDirectory from event, toolResult, context, or parameters
  const rawWd = message.workingDirectory
    || message.toolResult?.workingDirectory
    || message.context?.workingDirectory
    || inputParams.workdir
    || inputParams.dir_path
    || inputParams.cwd
    || null;

  const nonFsTools = new Set([
    'google_web_search',
    'web_search',
    'web_fetch',
    'update_topic',
    'activate_skill',
    'enter_plan_mode'
  ]);
  const hasExplicitDir = !!(inputParams.workdir || inputParams.dir_path || inputParams.cwd);
  const displayWorkingDirectory = (!nonFsTools.has(toolName) || hasExplicitDir) ? rawWd : null;

  const handleCopyWorkingDir = async (e) => {
    e.stopPropagation();
    if (!displayWorkingDirectory) return;
    try {
      await navigator.clipboard.writeText(displayWorkingDirectory);
      setCopiedWd(true);
      setTimeout(() => setCopiedWd(false), 2000);
    } catch (err) {
      console.error('Failed to copy directory:', err);
    }
  };

  const isCompleted = !!message.toolResult;
  const isError = message.toolResult?.isError || message.toolResult?.status === 'error';
  const resultContent = message.toolResult ? String(message.toolResult.content || message.toolResult.output || '') : '';

  return (
    <div className="my-2 rounded-lg border border-border/70 bg-card/80 overflow-hidden shadow-sm transition-all">
      {/* Header bar - Click to toggle */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 cursor-pointer select-none transition-colors text-xs gap-2"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon}
          <span className="font-semibold text-foreground flex-shrink-0">{actionTitle}</span>

          {/* Working directory chip in header (visible in both collapsed and expanded states) */}
          {displayWorkingDirectory && (
            <span
              onClick={handleCopyWorkingDir}
              title={`${language === 'zh' ? '工作目录 (点击复制)：' : 'Working Directory (click to copy): '}${displayWorkingDirectory}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/90 hover:bg-muted font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 max-w-[190px] sm:max-w-[280px] md:max-w-[360px] truncate group cursor-pointer border border-border/50 shadow-2xs"
            >
              <Folder className="w-3 h-3 text-sky-500 flex-shrink-0" />
              <span className="truncate">{shortenPath(displayWorkingDirectory)}</span>
              {copiedWd ? (
                <Check className="w-3 h-3 text-emerald-500 flex-shrink-0 animate-in zoom-in-50" />
              ) : (
                <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-muted-foreground" />
              )}
            </span>
          )}

          {actionDetail && (
            <span className="font-mono text-muted-foreground truncate opacity-85 max-w-[180px] sm:max-w-xs md:max-w-sm">
              {actionDetail}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isCompleted ? (
            <div className="flex items-center gap-1.5 text-blue-500 text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{language === 'zh' ? '运行中' : 'Running'}</span>
            </div>
          ) : isError ? (
            <div className="flex items-center gap-1 text-red-500 text-[11px]">
              <XCircle className="w-3.5 h-3.5" />
              <span>{language === 'zh' ? '失败' : 'Failed'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{language === 'zh' ? '已完成' : 'Done'}</span>
            </div>
          )}
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="p-3 border-t border-border/50 space-y-2.5 bg-background/50 text-xs animate-in fade-in-0 duration-100">
          {/* Working directory row */}
          {displayWorkingDirectory && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-sky-500" />
                  {language === 'zh' ? '工作目录：' : 'Working Directory:'}
                </span>
                <button
                  type="button"
                  onClick={handleCopyWorkingDir}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                  title={language === 'zh' ? '复制完整路径' : 'Copy Full Path'}
                >
                  {copiedWd ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span className="text-emerald-500 font-medium">{language === 'zh' ? '已复制' : 'Copied'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>{language === 'zh' ? '复制路径' : 'Copy Path'}</span>
                    </>
                  )}
                </button>
              </div>
              <div className="p-2 rounded bg-muted/60 font-mono text-[11px] text-foreground/90 break-all select-all flex items-center justify-between border border-border/40">
                <span>{displayWorkingDirectory}</span>
              </div>
            </div>
          )}

          {/* Input details */}
          {message.toolInput && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1">
                {language === 'zh' ? '输入参数：' : 'Input Parameters:'}
              </div>
              <pre className="p-2 rounded bg-muted/70 font-mono text-[11px] text-foreground/90 overflow-x-auto whitespace-pre-wrap break-all max-h-36">
                {typeof message.toolInput === 'string' ? message.toolInput : JSON.stringify(message.toolInput, null, 2)}
              </pre>
            </div>
          )}

          {/* Execution Result details */}
          {isCompleted && resultContent && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1">
                {language === 'zh' ? '执行输出：' : 'Output:'}
              </div>
              <pre className="p-2.5 rounded bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto whitespace-pre leading-relaxed max-h-56 overflow-y-auto">
                {resultContent}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
