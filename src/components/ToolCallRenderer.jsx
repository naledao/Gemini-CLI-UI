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
  Compass
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export default function ToolCallRenderer({ message, onFileOpen }) {
  const { t, language } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);

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

  if (toolName === 'run_shell_command' || toolName === 'Bash') {
    icon = <Terminal className="w-3.5 h-3.5 text-emerald-500" />;
    actionTitle = language === 'zh' ? '执行命令' : 'Run Command';
    actionDetail = inputParams.command || inputParams.cmd || '';
  } else if (toolName === 'read_file' || toolName === 'Read') {
    icon = <FileText className="w-3.5 h-3.5 text-sky-500" />;
    actionTitle = language === 'zh' ? '读取文件' : 'Read File';
    actionDetail = inputParams.file_path || inputParams.path || '';
  } else if (toolName === 'grep_search' || toolName === 'Grep') {
    icon = <Search className="w-3.5 h-3.5 text-amber-500" />;
    actionTitle = language === 'zh' ? '代码搜索' : 'Search Pattern';
    actionDetail = inputParams.pattern || inputParams.query || '';
  } else if (toolName === 'glob') {
    icon = <FolderOpen className="w-3.5 h-3.5 text-indigo-500" />;
    actionTitle = language === 'zh' ? '检索文件' : 'Find Files';
    actionDetail = inputParams.pattern || '';
  } else if (toolName === 'write_file' || toolName === 'Write' || toolName === 'replace') {
    icon = <Edit3 className="w-3.5 h-3.5 text-purple-500" />;
    actionTitle = language === 'zh' ? '写入修改' : 'Edit File';
    actionDetail = inputParams.file_path || inputParams.path || '';
  } else if (toolName === 'update_topic') {
    icon = <Compass className="w-3.5 h-3.5 text-orange-500" />;
    actionTitle = language === 'zh' ? '规划意图' : 'Strategic Intent';
    actionDetail = inputParams.strategic_intent || inputParams.title || '';
  }

  const isCompleted = !!message.toolResult;
  const isError = message.toolResult?.isError || message.toolResult?.status === 'error';
  const resultContent = message.toolResult ? String(message.toolResult.content || message.toolResult.output || '') : '';

  return (
    <div className="my-2 rounded-lg border border-border/70 bg-card/80 overflow-hidden shadow-sm transition-all">
      {/* Header bar - Click to toggle */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 cursor-pointer select-none transition-colors text-xs"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          {icon}
          <span className="font-semibold text-foreground flex-shrink-0">{actionTitle}</span>
          {actionDetail && (
            <span className="font-mono text-muted-foreground truncate opacity-90 max-w-[320px] sm:max-w-md">
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
