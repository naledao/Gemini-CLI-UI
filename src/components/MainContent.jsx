import React, { useState } from 'react';
import ChatInterface from './ChatInterface';
import FileViewer from './FileViewer';
import { useLanguage } from '../contexts/LanguageContext';
import { PanelLeftClose, PanelLeftOpen, FolderGit2, Terminal } from 'lucide-react';
import ProjectContextPanel from './ProjectContextPanel';

function MainContent({ 
  selectedProject, 
  selectedSession, 
  ws, 
  sendMessage, 
  messages,
  isMobile,
  sidebarOpen,
  onToggleSidebar,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  // Session Protection Props
  onSessionActive,
  onSessionInactive,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  showRawParameters,
  autoScrollToBottom
}) {
  const { t, language } = useLanguage();
  const [editingFile, setEditingFile] = useState(null);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(() => {
    const saved = localStorage.getItem('rightPanelOpen');
    return saved !== null ? JSON.parse(saved) : false;
  });

  const toggleRightPanel = () => {
    setIsRightPanelOpen(prev => {
      const next = !prev;
      localStorage.setItem('rightPanelOpen', JSON.stringify(next));
      return next;
    });
  };

  const toggleSidebar = onToggleSidebar || onMenuClick;

  const handleFileOpen = (filePath, diffInfo = null) => {
    const file = {
      name: filePath.split('/').pop(),
      path: filePath,
      diffInfo: diffInfo,
      projectName: selectedProject?.name,
      projectPath: selectedProject?.path
    };
    setEditingFile(file);
  };

  const handleCloseEditor = () => {
    setEditingFile(null);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t('mainContent.loadingTitle')}</h2>
          <p>{t('mainContent.loadingSubtitle')}</p>
        </div>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex flex-col">
        {/* Header with sidebar toggle button */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-4 flex-shrink-0">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              onClick={toggleSidebar}
              onTouchStart={(e) => {
                if (isMobile) {
                  e.preventDefault();
                  toggleSidebar?.();
                }
              }}
              className="p-1.5 sm:p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
              title={sidebarOpen ? `${t('sidebar.collapseSidebar')} (Ctrl+B)` : `${t('sidebar.expandSidebar')} (Ctrl+B)`}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-5 h-5" />
              ) : (
                <PanelLeftOpen className="w-5 h-5" />
              )}
            </button>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {t('sidebar.title')}
            </span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400 max-w-md mx-auto px-6">
            <div className="w-16 h-16 mx-auto mb-6 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-3 text-gray-900 dark:text-white">{t('mainContent.chooseProjectTitle')}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              {t('mainContent.chooseProjectDesc')}
            </p>
            {!sidebarOpen && (
              <div className="mb-6">
                <button
                  onClick={toggleSidebar}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all text-sm font-medium shadow-sm hover:shadow active:scale-95"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                  {t('sidebar.expandSidebar')}
                </button>
              </div>
            )}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                💡 <strong>{language === 'zh' ? '提示：' : 'Tip:'}</strong> {isMobile ? (language === 'zh' ? '点击左上角菜单以选择或创建项目' : 'Tap menu icon to select or create a project') : (language === 'zh' ? '在左侧侧边栏中选择项目以开始对话' : 'Select a project from the left sidebar to start chatting')}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            <button
              onClick={toggleSidebar}
              onTouchStart={(e) => {
                if (isMobile) {
                  e.preventDefault();
                  toggleSidebar?.();
                }
              }}
              className="p-1.5 sm:p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation active:scale-95 flex-shrink-0 transition-colors"
              title={sidebarOpen ? `${t('sidebar.collapseSidebar')} (Ctrl+B)` : `${t('sidebar.expandSidebar')} (Ctrl+B)`}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-5 h-5" />
              ) : (
                <PanelLeftOpen className="w-5 h-5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              {selectedSession ? (
                <div>
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white truncate">
                    {selectedSession.summary}
                  </h2>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {selectedProject.displayName} <span className="hidden sm:inline">• {selectedSession.id}</span>
                  </div>
                </div>
              ) : (
                <div>
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                    {t('sidebar.newSession')}
                  </h2>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {selectedProject.displayName}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right side: Workspace Panel Toggle Button */}
          {selectedProject && (
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              <button
                onClick={toggleRightPanel}
                onTouchStart={(e) => {
                  if (isMobile) {
                    e.preventDefault();
                    toggleRightPanel();
                  }
                }}
                className={`px-2.5 py-1.5 rounded-lg transition-all duration-200 flex items-center gap-1.5 border text-xs sm:text-sm font-medium shadow-sm ${
                  isRightPanelOpen
                    ? 'bg-primary/15 text-primary border-primary/40 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700/60'
                }`}
                title={isRightPanelOpen ? (language === 'zh' ? '收起工作区面板' : 'Collapse workspace panel') : (language === 'zh' ? '查看项目文件、Git 与终端' : 'View project files, Git & terminal')}
              >
                <FolderGit2 className="w-4 h-4 text-primary" />
                <Terminal className="w-3.5 h-3.5 text-emerald-500 opacity-90 hidden sm:inline" />
                <span className="hidden sm:inline font-medium">
                  {language === 'zh' ? '文件 & Git & 终端' : 'Files & Git & Terminal'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content Area - Chat & Right Panel */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ChatInterface
            key={selectedProject.name}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            ws={ws}
            sendMessage={sendMessage}
            messages={messages}
            onFileOpen={handleFileOpen}
            onInputFocusChange={onInputFocusChange}
            onSessionActive={onSessionActive}
            onSessionInactive={onSessionInactive}
            onReplaceTemporarySession={onReplaceTemporarySession}
            onNavigateToSession={onNavigateToSession}
            onShowSettings={onShowSettings}
            showRawParameters={showRawParameters}
            autoScrollToBottom={autoScrollToBottom}
          />
        </div>

        {/* Right Desktop Panel: smoothly resizes alongside Chat */}
        {!isMobile && selectedProject && (
          <div
            className={`transition-[width] duration-300 ease-in-out h-full border-l border-border bg-card flex-shrink-0 overflow-hidden ${
              isRightPanelOpen ? 'w-80 lg:w-96 xl:w-[460px]' : 'w-0 border-l-0'
            }`}
          >
            <div className="w-80 lg:w-96 xl:w-[460px] h-full overflow-hidden">
              <ProjectContextPanel
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                onClose={() => setIsRightPanelOpen(false)}
                isMobile={false}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobile && isRightPanelOpen && selectedProject && (
        <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200">
          <div 
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setIsRightPanelOpen(false)} 
          />
          <div className="relative w-[85vw] max-w-md h-full bg-card border-l border-border shadow-2xl z-10 animate-in slide-in-from-right duration-200">
            <ProjectContextPanel
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              onClose={() => setIsRightPanelOpen(false)}
              isMobile={true}
            />
          </div>
        </div>
      )}

      {/* Unified file viewer (for files opened in chat/tool calls) */}
      {editingFile && (
        <FileViewer
          file={editingFile}
          onClose={handleCloseEditor}
          projectPath={selectedProject?.path}
        />
      )}
    </div>
  );
}

export default React.memo(MainContent);
