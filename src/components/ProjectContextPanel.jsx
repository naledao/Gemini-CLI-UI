import React, { useState } from 'react';
import { FolderTree, GitBranch, Terminal, X } from 'lucide-react';
import FileTree from './FileTree';
import GitPanel from './GitPanel';
import Shell from './Shell';
import { useLanguage } from '../contexts/LanguageContext';

export default function ProjectContextPanel({ 
  selectedProject, 
  selectedSession, 
  onClose, 
  isMobile = false 
}) {
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'git' | 'terminal'

  if (!selectedProject) {
    return (
      <div className="h-full flex flex-col bg-card border-l border-border">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">
            {language === 'zh' ? '工作区' : 'Workspace'}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={t('common.close') || 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {language === 'zh' ? '请在左侧侧边栏中选择一个项目以查看文件、Git 状态与终端' : 'Please select a project from the left sidebar to view files, Git status & terminal'}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card text-foreground select-none">
      {/* Top Header with Tabs & Close */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/90 backdrop-blur-sm flex-shrink-0">
        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/50">
          <button
            onClick={() => setActiveTab('files')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
              activeTab === 'files'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5 text-blue-500" />
            <span>{language === 'zh' ? '文件目录' : 'Files'}</span>
          </button>
          
          <button
            onClick={() => setActiveTab('git')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
              activeTab === 'git'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 text-amber-500" />
            <span>{language === 'zh' ? 'Git 状态' : 'Git'}</span>
          </button>

          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
              activeTab === 'terminal'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-500" />
            <span>{language === 'zh' ? '终端' : 'Terminal'}</span>
          </button>
        </div>

        {/* Right close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={language === 'zh' ? '收起面板' : 'Close panel'}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tab Panels: keep mounted so terminal / git / file state is preserved */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div className={`h-full w-full ${activeTab === 'files' ? 'block' : 'hidden'}`}>
          <FileTree selectedProject={selectedProject} />
        </div>
        <div className={`h-full w-full ${activeTab === 'git' ? 'block' : 'hidden'}`}>
          <GitPanel selectedProject={selectedProject} isMobile={isMobile} />
        </div>
        <div className={`h-full w-full bg-gray-900 ${activeTab === 'terminal' ? 'block' : 'hidden'}`}>
          <Shell
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            isActive={activeTab === 'terminal'}
          />
        </div>
      </div>
    </div>
  );
}
