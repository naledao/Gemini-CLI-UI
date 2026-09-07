import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { java } from '@codemirror/lang-java';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { go } from '@codemirror/lang-go';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import {
  AlertTriangle,
  Check,
  Code2,
  Download,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import { api, authenticatedFetch } from '../utils/api';
import { EnhancedMessageRenderer } from './EnhancedMessageRenderer';
import { useLanguage } from '../contexts/LanguageContext';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

const getExtension = (name = '') => {
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index + 1).toLowerCase() : '';
};

const getLanguageExtensions = (filename = '') => {
  const ext = getExtension(filename);
  switch (ext) {
    case 'js':
      return [javascript()];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'ts':
      return [javascript({ typescript: true })];
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'py':
      return [python()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'java':
      return [java()];
    case 'yaml':
    case 'yml':
      return [yaml()];
    case 'xml':
    case 'svg':
      return [xml()];
    case 'sql':
      return [sql()];
    case 'go':
      return [go()];
    case 'c':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hh':
    case 'hpp':
    case 'hxx':
      return [cpp()];
    default:
      return [];
  }
};

function FileViewer({ file, onClose, projectPath }) {
  const { t, language } = useLanguage();
  const ext = getExtension(file?.name || '');
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);
  const isJson = ext === 'json';

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  );
  const [wordWrap, setWordWrap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    if (isMarkdown) return 'preview';
    if (isJson) return 'formatted';
    return 'source';
  });
  const originalContentRef = useRef('');

  const relativePath = useMemo(() => {
    if (!file?.path) return '';
    const root = (projectPath || file.projectPath || '').replace(/\\/g, '/').replace(/\/$/, '');
    const current = String(file.path).replace(/\\/g, '/');
    if (root && (current === root || current.startsWith(`${root}/`))) {
      return current.slice(root.length).replace(/^\//, '') || file.name;
    }
    return current;
  }, [file?.path, file?.projectPath, file?.name, projectPath]);

  const formattedJson = useMemo(() => {
    if (!isJson) return { content, error: '' };
    try {
      return { content: JSON.stringify(JSON.parse(content), null, 2), error: '' };
    } catch (error) {
      return { content, error: error.message || 'Invalid JSON' };
    }
  }, [content, isJson]);

  const displayContent = !isEditing && isJson && viewMode === 'formatted'
    ? formattedJson.content
    : content;

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    const load = async () => {
      setLoading(true);
      setLoadError('');
      setIsEditing(false);
      setSaveSuccess(false);
      setViewMode(isMarkdown ? 'preview' : isJson ? 'formatted' : 'source');

      try {
        if (isImage) {
          const response = await authenticatedFetch(
            `/api/projects/${encodeURIComponent(file.projectName)}/files/content?path=${encodeURIComponent(file.path)}`
          );
          if (!response.ok) {
            let message = `Failed to load image (${response.status})`;
            try {
              const data = await response.json();
              message = data.error || message;
            } catch {}
            throw new Error(message);
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setImageUrl(objectUrl);
          return;
        }

        const response = await api.readFile(file.projectName, file.path);
        let data = {};
        try {
          data = await response.json();
        } catch {}
        if (!response.ok) {
          throw new Error(data.error || `Failed to load file (${response.status})`);
        }
        if (!cancelled) {
          const text = typeof data.content === 'string' ? data.content : '';
          originalContentRef.current = text;
          setContent(text);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error.message || 'Failed to load file');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file?.projectName, file?.path, isImage, isMarkdown, isJson]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && isEditing && !isImage) {
        event.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [content, isEditing, isImage]);

  const handleSave = async () => {
    if (!isEditing || isImage || saving) return;
    setSaving(true);
    try {
      const response = await api.saveFile(file.projectName, file.path, content);
      let data = {};
      try {
        data = await response.json();
      } catch {}
      if (!response.ok) {
        throw new Error(data.error || `Save failed (${response.status})`);
      }
      originalContentRef.current = content;
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 1800);
    } catch (error) {
      window.alert(`${language === 'zh' ? '保存失败' : 'Save failed'}: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    if (isImage && imageUrl) {
      const anchor = document.createElement('a');
      anchor.href = imageUrl;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const toggleEditing = () => {
    if (isImage || loadError) return;
    setIsEditing(prev => {
      const next = !prev;
      if (next) setViewMode('source');
      return next;
    });
  };

  const editorExtensions = useMemo(() => [
    ...getLanguageExtensions(file?.name || ''),
    ...(wordWrap ? [EditorView.lineWrapping] : []),
  ], [file?.name, wordWrap]);

  const typeLabel = isImage ? 'IMAGE' : (ext ? ext.toUpperCase() : 'TEXT');
  const dirty = content !== originalContentRef.current;

  return (
    <div className={`fixed inset-0 z-[80] md:bg-black/55 md:flex md:items-center md:justify-center ${isFullscreen ? 'md:p-0' : 'md:p-4'}`}>
      <div className={`bg-background text-foreground shadow-2xl flex flex-col overflow-hidden w-full h-full border-border ${
        isFullscreen
          ? 'md:w-full md:h-full md:rounded-none'
          : 'md:w-full md:max-w-6xl md:h-[84vh] md:max-h-[900px] md:rounded-xl md:border'
      }`}>
        <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border flex-shrink-0 min-w-0 bg-card">
          <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] sm:text-xs font-mono font-bold truncate px-1">{typeLabel}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-semibold text-sm sm:text-base truncate">{file.name}</h3>
              {!isImage && isEditing && dirty && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 flex-shrink-0">
                  {language === 'zh' ? '未保存' : 'Unsaved'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate" title={relativePath}>{relativePath}</p>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {!loadError && !isImage && (isMarkdown || isJson) && !isEditing && (
              <div className="hidden sm:flex items-center rounded-md bg-muted p-0.5 mr-1">
                {isMarkdown ? (
                  <>
                    <button
                      onClick={() => setViewMode('preview')}
                      className={`px-2.5 py-1.5 text-xs rounded ${viewMode === 'preview' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{language === 'zh' ? '预览' : 'Preview'}</span>
                    </button>
                    <button
                      onClick={() => setViewMode('source')}
                      className={`px-2.5 py-1.5 text-xs rounded ${viewMode === 'source' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <span className="inline-flex items-center gap-1"><Code2 className="w-3.5 h-3.5" />{language === 'zh' ? '源码' : 'Source'}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setViewMode('formatted')}
                      className={`px-2.5 py-1.5 text-xs rounded ${viewMode === 'formatted' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {language === 'zh' ? '格式化' : 'Formatted'}
                    </button>
                    <button
                      onClick={() => setViewMode('source')}
                      className={`px-2.5 py-1.5 text-xs rounded ${viewMode === 'source' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {language === 'zh' ? '源码' : 'Source'}
                    </button>
                  </>
                )}
              </div>
            )}

            {!loadError && !isImage && (
              <button
                onClick={toggleEditing}
                className={`p-2 rounded-md transition-colors ${isEditing ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                title={isEditing ? (language === 'zh' ? '退出编辑' : 'Exit edit mode') : (language === 'zh' ? '编辑文件' : 'Edit file')}
              >
                {isEditing ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              </button>
            )}

            {!loadError && !isImage && isEditing && (
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className={`px-2.5 py-2 rounded-md text-xs sm:text-sm flex items-center gap-1.5 text-white disabled:opacity-50 ${saveSuccess ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                title={language === 'zh' ? '保存 (Ctrl+S)' : 'Save (Ctrl+S)'}
              >
                {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                <span className="hidden md:inline">{saveSuccess ? t('common.saved') : saving ? t('common.saving') : t('common.save')}</span>
              </button>
            )}

            {!loadError && !isImage && (
              <button
                onClick={() => setWordWrap(prev => !prev)}
                className={`p-2 rounded-md ${wordWrap ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                title={wordWrap ? (language === 'zh' ? '关闭自动换行' : 'Disable word wrap') : (language === 'zh' ? '自动换行' : 'Enable word wrap')}
              >
                <span className="text-xs font-mono font-bold">↵</span>
              </button>
            )}

            <button
              onClick={() => setIsDarkMode(prev => !prev)}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
              title={language === 'zh' ? '切换查看器主题' : 'Toggle viewer theme'}
            >
              <span className="text-sm">{isDarkMode ? '☀️' : '🌙'}</span>
            </button>

            {!loading && !loadError && (
              <button
                onClick={handleDownload}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
                title={language === 'zh' ? '下载文件' : 'Download file'}
              >
                <Download className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => setIsFullscreen(prev => !prev)}
              className="hidden md:flex p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
              title={isFullscreen ? (language === 'zh' ? '还原窗口' : 'Restore') : (language === 'zh' ? '全屏' : 'Fullscreen')}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
              title={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {(isMarkdown || isJson) && !isEditing && !loading && !loadError && (
          <div className="sm:hidden px-3 py-2 border-b border-border bg-card flex items-center gap-1">
            {isMarkdown ? (
              <>
                <button onClick={() => setViewMode('preview')} className={`flex-1 py-1.5 text-xs rounded ${viewMode === 'preview' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{language === 'zh' ? '预览' : 'Preview'}</button>
                <button onClick={() => setViewMode('source')} className={`flex-1 py-1.5 text-xs rounded ${viewMode === 'source' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{language === 'zh' ? '源码' : 'Source'}</button>
              </>
            ) : (
              <>
                <button onClick={() => setViewMode('formatted')} className={`flex-1 py-1.5 text-xs rounded ${viewMode === 'formatted' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{language === 'zh' ? '格式化' : 'Formatted'}</button>
                <button onClick={() => setViewMode('source')} className={`flex-1 py-1.5 text-xs rounded ${viewMode === 'source' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{language === 'zh' ? '源码' : 'Source'}</button>
              </>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-3 text-muted-foreground">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">{language === 'zh' ? `正在加载 ${file.name}...` : `Loading ${file.name}...`}</span>
            </div>
          ) : loadError ? (
            <div className="h-full flex items-center justify-center px-6 text-center">
              <div className="max-w-md">
                <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-500" />
                <h4 className="font-semibold mb-1">{language === 'zh' ? '无法预览此文件' : 'Unable to preview this file'}</h4>
                <p className="text-sm text-muted-foreground break-words">{loadError}</p>
              </div>
            </div>
          ) : isImage ? (
            <div className="h-full overflow-auto bg-muted/30 p-4 flex items-center justify-center">
              <img src={imageUrl} alt={file.name} className="max-w-full max-h-full object-contain rounded-lg shadow" />
            </div>
          ) : isMarkdown && viewMode === 'preview' && !isEditing ? (
            <div className="h-full overflow-auto bg-background">
              <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6">
                <EnhancedMessageRenderer content={content} isDarkMode={isDarkMode} />
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col overflow-hidden">
              {isJson && !isEditing && viewMode === 'formatted' && formattedJson.error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 flex-shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{language === 'zh' ? `JSON 格式无效，已显示原始内容：${formattedJson.error}` : `Invalid JSON, showing source: ${formattedJson.error}`}</span>
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-hidden">
                <CodeMirror
                  value={displayContent}
                  onChange={(value) => {
                    if (isEditing) setContent(value);
                  }}
                  editable={isEditing}
                  readOnly={!isEditing}
                  extensions={editorExtensions}
                  theme={isDarkMode ? oneDark : undefined}
                  height="100%"
                  style={{ fontSize: '14px', height: '100%' }}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    dropCursor: isEditing,
                    allowMultipleSelections: isEditing,
                    indentOnInput: isEditing,
                    bracketMatching: true,
                    closeBrackets: isEditing,
                    autocompletion: isEditing,
                    highlightSelectionMatches: true,
                    searchKeymap: true,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {!loading && !loadError && !isImage && (
          <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 border-t border-border bg-card text-[11px] sm:text-xs text-muted-foreground flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span>{content.split('\n').length} {language === 'zh' ? '行' : 'lines'}</span>
              <span>{content.length} {language === 'zh' ? '字符' : 'chars'}</span>
              <span className="font-mono">{typeLabel}</span>
            </div>
            <div className="hidden sm:flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" />
              <span>{isEditing ? (language === 'zh' ? '编辑模式' : 'Edit mode') : (language === 'zh' ? '只读查看' : 'Read only')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FileViewer;
