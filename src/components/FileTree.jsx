import React, { useState, useEffect } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Folder, FolderOpen, File, FileText, FileCode, List, TableProperties, Eye, RefreshCw, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import FileViewer from './FileViewer';
import { api } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';

function FileTree({ selectedProject }) {
  const { t, language } = useLanguage();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [selectedFile, setSelectedFile] = useState(null);
  const [viewMode, setViewMode] = useState('detailed'); // 'simple', 'detailed', 'compact'
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    if (selectedProject) {
      fetchFiles();
    }
  }, [selectedProject?.name]);

  // Load view mode preference from localStorage
  useEffect(() => {
    const savedViewMode = localStorage.getItem('file-tree-view-mode');
    if (savedViewMode && ['simple', 'detailed', 'compact'].includes(savedViewMode)) {
      setViewMode(savedViewMode);
    }
  }, []);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const closeContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    window.addEventListener('click', closeContextMenu);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const response = await api.getFiles(selectedProject.name);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ File fetch failed:', response.status, errorText);
        setFiles([]);
        return;
      }
      
      const data = await response.json();
      setFiles(data);
      setLastRefresh(Date.now());
    } catch (error) {
      console.error('❌ Error fetching files:', error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  // Expose refresh function globally for other components to trigger
  useEffect(() => {
    if (selectedProject) {
      window.refreshFileTree = () => {
        console.log('Manual file tree refresh triggered');
        fetchFiles();
      };
    }
    return () => {
      delete window.refreshFileTree;
    };
  }, [selectedProject]);

  const toggleDirectory = (path) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  const openContextMenu = (event, item) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 176;
    const menuHeight = 44;
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);

    setContextMenu({
      x: Math.min(Math.max(event.clientX, margin), maxX),
      y: Math.min(Math.max(event.clientY, margin), maxY),
      path: item.path
    });
  };

  const copyContextMenuPath = async () => {
    const fullPath = contextMenu?.path;
    if (!fullPath) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullPath);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = fullPath;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } finally {
      setContextMenu(null);
    }
  };

  // Change view mode and save preference
  const changeViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('file-tree-view-mode', mode);
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Format date as relative time
  const formatRelativeTime = (date) => {
    if (!date) return '-';
    const now = new Date();
    const past = new Date(date);
    const diffInSeconds = Math.floor((now - past) / 1000);
    
    if (diffInSeconds < 60) return language === 'zh' ? '刚刚' : 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} ${language === 'zh' ? '分钟前' : 'min ago'}`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} ${language === 'zh' ? '小时前' : 'hours ago'}`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} ${language === 'zh' ? '天前' : 'days ago'}`;
    return past.toLocaleDateString();
  };

  const renderFileTree = (items, level = 0) => {
    return items.map((item) => (
      <div key={item.path} className="select-none">
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start p-2 h-auto font-normal text-left hover:bg-accent",
          )}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onContextMenu={(event) => openContextMenu(event, item)}
          onClick={() => {
            if (item.type === 'directory') {
              toggleDirectory(item.path);
            } else {
              setSelectedFile({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            }
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0 w-full">
            {item.type === 'directory' ? (
              <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-muted-foreground">
                {expandedDirs.has(item.path) ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            ) : (
              <span className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            {item.type === 'directory' ? (
              expandedDirs.has(item.path) ? (
                <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )
            ) : (
              getFileIcon(item.name)
            )}
            <span className="text-sm truncate text-foreground">
              {item.name}
            </span>
          </div>
        </Button>
        
        {item.type === 'directory' && expandedDirs.has(item.path) && (
          item.children && item.children.length > 0 ? (
            <div>
              {renderFileTree(item.children, level + 1)}
            </div>
          ) : (
            <div
              className="text-xs text-muted-foreground/60 italic py-1.5 flex items-center gap-1 select-none"
              style={{ paddingLeft: `${level * 16 + 36}px` }}
            >
              <span>{language === 'zh' ? '(空文件夹)' : '(empty folder)'}</span>
            </div>
          )
        )}
      </div>
    ));
  };

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs'];
    const docExtensions = ['md', 'txt', 'doc', 'pdf'];
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];
    
    if (codeExtensions.includes(ext)) {
      return <FileCode className="w-4 h-4 text-green-500 flex-shrink-0" />;
    } else if (docExtensions.includes(ext)) {
      return <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />;
    } else if (imageExtensions.includes(ext)) {
      return <File className="w-4 h-4 text-purple-500 flex-shrink-0" />;
    } else {
      return <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
    }
  };

  // Render detailed view with table-like layout
  const renderDetailedView = (items, level = 0) => {
    return items.map((item) => (
      <div key={item.path} className="select-none">
        <div
          className={cn(
            "grid grid-cols-12 gap-2 p-2 hover:bg-accent cursor-pointer items-center transition-colors",
          )}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onContextMenu={(event) => openContextMenu(event, item)}
          onClick={() => {
            if (item.type === 'directory') {
              toggleDirectory(item.path);
            } else {
              setSelectedFile({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            }
          }}
        >
          <div className="col-span-5 flex items-center gap-1.5 min-w-0">
            {item.type === 'directory' ? (
              <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-muted-foreground">
                {expandedDirs.has(item.path) ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            ) : (
              <span className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            {item.type === 'directory' ? (
              expandedDirs.has(item.path) ? (
                <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )
            ) : (
              getFileIcon(item.name)
            )}
            <span className="text-sm truncate text-foreground font-medium">
              {item.name}
            </span>
          </div>
          <div className="col-span-2 text-sm text-muted-foreground">
            {item.type === 'file' 
              ? formatFileSize(item.size) 
              : (item.children ? `${item.children.length} ${language === 'zh' ? '项' : 'items'}` : '-')}
          </div>
          <div className="col-span-3 text-sm text-muted-foreground">
            {formatRelativeTime(item.modified)}
          </div>
          <div className="col-span-2 text-sm text-muted-foreground font-mono">
            {item.permissionsRwx || '-'}
          </div>
        </div>
        
        {item.type === 'directory' && expandedDirs.has(item.path) && (
          item.children && item.children.length > 0 ? (
            renderDetailedView(item.children, level + 1)
          ) : (
            <div
              className="text-xs text-muted-foreground/60 italic py-1.5 flex items-center gap-1 select-none"
              style={{ paddingLeft: `${level * 16 + 36}px` }}
            >
              <span>{language === 'zh' ? '(空文件夹)' : '(empty folder)'}</span>
            </div>
          )
        )}
      </div>
    ));
  };

  // Render compact view with inline details
  const renderCompactView = (items, level = 0) => {
    return items.map((item) => (
      <div key={item.path} className="select-none">
        <div
          className={cn(
            "flex items-center justify-between p-2 hover:bg-accent cursor-pointer transition-colors",
          )}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onContextMenu={(event) => openContextMenu(event, item)}
          onClick={() => {
            if (item.type === 'directory') {
              toggleDirectory(item.path);
            } else {
              setSelectedFile({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            }
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {item.type === 'directory' ? (
              <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-muted-foreground">
                {expandedDirs.has(item.path) ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            ) : (
              <span className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            {item.type === 'directory' ? (
              expandedDirs.has(item.path) ? (
                <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )
            ) : (
              getFileIcon(item.name)
            )}
            <span className="text-sm truncate text-foreground font-medium">
              {item.name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {item.type === 'file' ? (
              <>
                <span>{formatFileSize(item.size)}</span>
                <span className="font-mono">{item.permissionsRwx}</span>
              </>
            ) : (
              <span>{item.children ? `${item.children.length} ${language === 'zh' ? '项' : 'items'}` : '-'}</span>
            )}
          </div>
        </div>
        
        {item.type === 'directory' && expandedDirs.has(item.path) && (
          item.children && item.children.length > 0 ? (
            renderCompactView(item.children, level + 1)
          ) : (
            <div
              className="text-xs text-muted-foreground/60 italic py-1.5 flex items-center gap-1 select-none"
              style={{ paddingLeft: `${level * 16 + 36}px` }}
            >
              <span>{language === 'zh' ? '(空文件夹)' : '(empty folder)'}</span>
            </div>
          )
        )}
      </div>
    ));
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">
          Loading files...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* View Mode Toggle & Refresh Button */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t('files.title')}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-muted text-muted-foreground hover:text-foreground mr-1"
            onClick={fetchFiles}
            disabled={loading}
            title={language === 'zh' ? '刷新文件列表' : 'Refresh files'}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-primary' : ''}`} />
          </Button>
          <div className="h-4 w-[1px] bg-border mx-1" />
          <Button
            variant={viewMode === 'simple' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => changeViewMode('simple')}
            title={language === 'zh' ? '列表视图' : 'Simple view'}
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'compact' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => changeViewMode('compact')}
            title={language === 'zh' ? '紧凑视图' : 'Compact view'}
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'detailed' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => changeViewMode('detailed')}
            title={language === 'zh' ? '详细视图' : 'Detailed view'}
          >
            <TableProperties className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Column Headers for Detailed View */}
      {viewMode === 'detailed' && files.length > 0 && (
        <div className="px-4 pt-2 pb-1 border-b border-border">
          <div className="grid grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground">
            <div className="col-span-5">{t('common.name')}</div>
            <div className="col-span-2">{t('common.size')}</div>
            <div className="col-span-3">{t('common.modified')}</div>
            <div className="col-span-2">{t('common.permissions')}</div>
          </div>
        </div>
      )}
      
      <ScrollArea className="flex-1 p-4">
        {files.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
              <Folder className="w-6 h-6 text-muted-foreground" />
            </div>
            <h4 className="font-medium text-foreground mb-1">{t('files.noFilesFound')}</h4>
            <p className="text-sm text-muted-foreground">
              {language === 'zh' ? '请检查项目目录是否可正常访问' : 'Check if the project path is accessible'}
            </p>
          </div>
        ) : (
          <div className={viewMode === 'detailed' ? '' : 'space-y-1'}>
            {viewMode === 'simple' && renderFileTree(files)}
            {viewMode === 'compact' && renderCompactView(files)}
            {viewMode === 'detailed' && renderDetailedView(files)}
          </div>
        )}
      </ScrollArea>

      {contextMenu && (
        <div
          className="fixed z-[100] w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={copyContextMenuPath}
          >
            <Copy className="h-4 w-4 flex-shrink-0" />
            <span>{language === 'zh' ? '复制完整路径' : 'Copy full path'}</span>
          </button>
        </div>
      )}
      
      {/* Unified File Viewer Modal */}
      {selectedFile && (
        <FileViewer
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
          projectPath={selectedFile.projectPath}
        />
      )}
    </div>
  );
}

export default FileTree;