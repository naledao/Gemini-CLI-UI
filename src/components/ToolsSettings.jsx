import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { X, Settings, Moon, Sun, Volume2, Globe, ArrowUpDown, Terminal, FolderOpen, RotateCcw, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { api } from '../utils/api';

const GEMINI_APPROVAL_MODES = ['default', 'auto_edit', 'plan', 'yolo'];

const normalizeApprovalMode = (mode) =>
  GEMINI_APPROVAL_MODES.includes(mode) ? mode : 'default';

function ToolsSettings({ isOpen, onClose }) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { t, language, setLanguage, supportedLanguages } = useLanguage();
  const [enableNotificationSound, setEnableNotificationSound] = useState(false);
  const [projectSortOrder, setProjectSortOrder] = useState('name');
  const [approvalMode, setApprovalMode] = useState('default');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [geminiBinaryPath, setGeminiBinaryPath] = useState('');
  const [geminiBinaryInfo, setGeminiBinaryInfo] = useState(null);
  const [binaryValidation, setBinaryValidation] = useState(null);
  const [binaryError, setBinaryError] = useState('');
  const [isBinaryLoading, setIsBinaryLoading] = useState(false);
  const [isSelectingBinary, setIsSelectingBinary] = useState(false);
  const [isValidatingBinary, setIsValidatingBinary] = useState(false);

  const isWindowsClient = typeof navigator !== 'undefined' &&
    /Win/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '');

  // Load saved settings
  useEffect(() => {
    if (!isOpen) return;

    try {
      const savedSettings = localStorage.getItem('gemini-tools-settings');
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        if (typeof settings.enableNotificationSound === 'boolean') {
          setEnableNotificationSound(settings.enableNotificationSound);
        }
        if (settings.projectSortOrder) setProjectSortOrder(settings.projectSortOrder);
        setApprovalMode(normalizeApprovalMode(settings.approvalMode));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }

    let cancelled = false;
    setIsBinaryLoading(true);
    setBinaryError('');
    setBinaryValidation(null);

    api.getGeminiBinarySettings()
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || t('toolsSettings.binaryLoadFailed'));
        }
        if (cancelled) return;
        setGeminiBinaryInfo(result);
        setGeminiBinaryPath(result.configuredPath || '');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Error loading Gemini binary settings:', error);
        setBinaryError(error.message || t('toolsSettings.binaryLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setIsBinaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const saveSettings = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    setBinaryError('');

    try {
      const current = JSON.parse(localStorage.getItem('gemini-tools-settings') || '{}');
      const updatedSettings = {
        ...current,
        enableNotificationSound,
        projectSortOrder,
        approvalMode: normalizeApprovalMode(approvalMode)
      };

      localStorage.setItem('gemini-tools-settings', JSON.stringify(updatedSettings));

      // Trigger storage event for cross-component sync
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'gemini-tools-settings',
        newValue: JSON.stringify(updatedSettings),
        storageArea: localStorage
      }));

      const binaryPath = geminiBinaryPath.trim();
      const binaryResponse = binaryPath
        ? await api.setGeminiBinary(binaryPath)
        : await api.resetGeminiBinary();
      const binaryResult = await binaryResponse.json().catch(() => ({}));
      if (!binaryResponse.ok) {
        throw new Error(binaryResult.error || t('toolsSettings.settingsFailed'));
      }

      setGeminiBinaryInfo(binaryResult);
      setGeminiBinaryPath(binaryResult.configuredPath || '');
      if (binaryResult.version) {
        setBinaryValidation({
          valid: true,
          path: binaryResult.effectivePath,
          version: binaryResult.version,
          source: binaryResult.source
        });
      } else {
        setBinaryValidation(null);
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setBinaryError(error.message || t('toolsSettings.settingsFailed'));
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const selectGeminiBinary = async () => {
    if (isSelectingBinary) return;
    setIsSelectingBinary(true);
    setBinaryError('');
    try {
      const response = await api.selectGeminiBinaryFile(geminiBinaryPath.trim() || geminiBinaryInfo?.effectivePath || '');
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || t('toolsSettings.binaryPickerFailed'));
      }
      if (!result.cancelled && result.path) {
        setGeminiBinaryPath(result.path);
        setBinaryValidation(null);
      }
    } catch (error) {
      console.error('Error selecting Gemini binary:', error);
      setBinaryError(error.message || t('toolsSettings.binaryPickerFailed'));
    } finally {
      setIsSelectingBinary(false);
    }
  };

  const validateGeminiBinary = async () => {
    if (isValidatingBinary) return;
    setIsValidatingBinary(true);
    setBinaryError('');
    setBinaryValidation(null);
    try {
      const response = await api.validateGeminiBinary(geminiBinaryPath.trim());
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.valid) {
        throw new Error(result.error || t('toolsSettings.binaryInvalid'));
      }
      setBinaryValidation(result);
    } catch (error) {
      console.error('Error validating Gemini binary:', error);
      setBinaryError(error.message || t('toolsSettings.binaryInvalid'));
    } finally {
      setIsValidatingBinary(false);
    }
  };

  const resetGeminiBinaryPending = () => {
    setGeminiBinaryPath('');
    setBinaryValidation(null);
    setBinaryError('');
  };

  const sourceLabel = (source) => {
    if (source === 'development-override') return t('toolsSettings.developmentOverride');
    if (source === 'configured') return t('toolsSettings.customBinary');
    return t('toolsSettings.embeddedRuntime');
  };

  const persistedConfiguredPath = geminiBinaryInfo?.configuredPath || '';
  const hasPendingBinaryChange = geminiBinaryPath.trim() !== persistedConfiguredPath;
  const pendingEffectivePath = geminiBinaryPath.trim() || geminiBinaryInfo?.defaultPath || '';
  const displayedEffectivePath = hasPendingBinaryChange
    ? pendingEffectivePath
    : (geminiBinaryInfo?.effectivePath || geminiBinaryInfo?.defaultPath || '');
  const displayedSource = hasPendingBinaryChange
    ? (geminiBinaryPath.trim() ? 'configured' : 'embedded')
    : geminiBinaryInfo?.source;

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] md:p-4 bg-background/95">
      <div className="bg-background border border-border md:rounded-xl shadow-2xl w-full md:max-w-2xl h-full md:h-auto md:max-h-[85vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border flex-shrink-0 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Settings className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-semibold text-foreground">
                {t('toolsSettings.title')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {language === 'zh' ? '管理界面显示与偏好设置' : 'Manage interface display and preferences'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground touch-manipulation"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
          {/* Language Settings */}
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="font-medium text-foreground">
                    {t('quickSettings.language')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {language === 'zh' ? '选择界面显示语言' : 'Choose interface display language'}
                  </div>
                </div>
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="text-sm bg-background border border-border text-foreground rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 min-w-[120px]"
              >
                {supportedLanguages.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Theme Settings */}
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isDarkMode ? <Moon className="w-5 h-5 text-gray-400" /> : <Sun className="w-5 h-5 text-yellow-500" />}
                <div>
                  <div className="font-medium text-foreground">
                    {t('quickSettings.darkMode')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {language === 'zh' ? '在浅色与深色主题之间切换' : 'Toggle between light and dark themes'}
                  </div>
                </div>
              </div>
              <button
                onClick={toggleDarkMode}
                className="relative inline-flex h-7 w-12 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                role="switch"
                aria-checked={isDarkMode}
              >
                <span
                  className={`${
                    isDarkMode ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 flex items-center justify-center`}
                >
                  {isDarkMode ? (
                    <Moon className="w-3 h-3 text-gray-700" />
                  ) : (
                    <Sun className="w-3 h-3 text-yellow-500" />
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Project Sorting */}
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ArrowUpDown className="w-5 h-5 text-indigo-500" />
                <div>
                  <div className="font-medium text-foreground">
                    {language === 'zh' ? '项目排序方式' : 'Project Sorting'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {language === 'zh' ? '控制左侧侧边栏中项目的排列规则' : 'How projects are ordered in the sidebar'}
                  </div>
                </div>
              </div>
              <select
                value={projectSortOrder}
                onChange={(e) => setProjectSortOrder(e.target.value)}
                className="text-sm bg-background border border-border text-foreground rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 min-w-[120px]"
              >
                <option value="name">{language === 'zh' ? '按名称排序' : 'Alphabetical'}</option>
                <option value="date">{language === 'zh' ? '按最近活动' : 'Recent Activity'}</option>
              </select>
            </div>
          </div>

          {/* Gemini CLI Session / Approval Mode */}
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <ShieldCheck className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {language === 'zh' ? '会话模式' : 'Session Mode'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {language === 'zh'
                      ? '控制 Gemini CLI 执行工具时的审批策略'
                      : 'Controls how Gemini CLI approves tool execution'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    {approvalMode === 'default' && (language === 'zh'
                      ? '默认：需要时询问确认。'
                      : 'Default: asks for confirmation when needed.')}
                    {approvalMode === 'auto_edit' && (language === 'zh'
                      ? '自动编辑：自动批准编辑类操作，其他敏感操作仍可能询问。'
                      : 'Auto Edit: auto-approves edit operations; other sensitive actions may still ask.')}
                    {approvalMode === 'plan' && (language === 'zh'
                      ? '计划：只读研究与规划模式。'
                      : 'Plan: read-only research and planning mode.')}
                    {approvalMode === 'yolo' && (language === 'zh'
                      ? 'YOLO：自动批准所有工具调用，请仅在可信环境中使用。'
                      : 'YOLO: auto-approves all tool calls. Use only in trusted environments.')}
                  </div>
                </div>
              </div>
              <select
                value={approvalMode}
                onChange={(e) => setApprovalMode(normalizeApprovalMode(e.target.value))}
                className="text-sm bg-background border border-border text-foreground rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 min-w-[130px] flex-shrink-0"
              >
                <option value="default">Default</option>
                <option value="auto_edit">Auto Edit</option>
                <option value="plan">Plan</option>
                <option value="yolo">YOLO</option>
              </select>
            </div>
          </div>

          {/* Gemini CLI Binary */}
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Terminal className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">
                  {t('toolsSettings.geminiBinaryTitle')}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('toolsSettings.geminiBinaryDesc')}
                </div>

                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={geminiBinaryPath}
                    onChange={(e) => {
                      setGeminiBinaryPath(e.target.value);
                      setBinaryValidation(null);
                      setBinaryError('');
                    }}
                    placeholder={t('toolsSettings.geminiBinaryPlaceholder')}
                    disabled={isBinaryLoading || isSaving}
                    className="min-w-0 flex-1 h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:opacity-50"
                  />
                  <div className="flex gap-2 flex-shrink-0">
                    {isWindowsClient && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={selectGeminiBinary}
                        disabled={isSelectingBinary || isBinaryLoading || isSaving}
                        className="h-9 gap-1.5"
                      >
                        {isSelectingBinary ? (
                          <div className="w-3.5 h-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <FolderOpen className="w-4 h-4" />
                        )}
                        {t('toolsSettings.selectBinary')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={validateGeminiBinary}
                      disabled={isValidatingBinary || isBinaryLoading || isSaving}
                      className="h-9"
                    >
                      {isValidatingBinary ? t('toolsSettings.validatingBinary') : t('toolsSettings.validateBinary')}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetGeminiBinaryPending}
                    disabled={isBinaryLoading || isSaving}
                    className="h-7 px-2 text-xs gap-1.5 text-muted-foreground"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t('toolsSettings.resetBinary')}
                  </Button>
                  {displayedSource && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-background text-muted-foreground">
                      {sourceLabel(displayedSource)}
                    </span>
                  )}
                  {binaryValidation?.version && (
                    <span className="text-[11px] text-muted-foreground">
                      {t('toolsSettings.binaryVersion')}: {binaryValidation.version}
                    </span>
                  )}
                </div>

                <div className="mt-2 text-xs text-muted-foreground break-all">
                  <span className="font-medium text-foreground/80">{t('toolsSettings.effectiveBinary')}:</span>{' '}
                  {isBinaryLoading ? '...' : (displayedEffectivePath || '-')}
                </div>

                {hasPendingBinaryChange && !geminiBinaryPath.trim() && (
                  <div className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                    {t('toolsSettings.binaryDefaultPending')}
                  </div>
                )}

                {binaryValidation?.valid && (
                  <div className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{t('toolsSettings.binaryValid')}</span>
                  </div>
                )}

                {binaryError && (
                  <div className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span className="break-all">{binaryError}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Notification Sound Settings */}
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Volume2 className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="font-medium text-foreground">
                    {t('toolsSettings.enableNotificationSound')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('toolsSettings.soundDesc')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {enableNotificationSound && (
                  <button
                    onClick={async () => {
                      const { playNotificationSound } = await import('../utils/notificationSound');
                      const currentSettings = JSON.parse(localStorage.getItem('gemini-tools-settings') || '{}');
                      localStorage.setItem('gemini-tools-settings', JSON.stringify({
                        ...currentSettings,
                        enableNotificationSound: true
                      }));
                      playNotificationSound();
                      localStorage.setItem('gemini-tools-settings', JSON.stringify(currentSettings));
                    }}
                    className="px-2.5 py-1 text-xs bg-muted hover:bg-muted/80 text-foreground rounded border border-border transition-colors"
                  >
                    {t('toolsSettings.testSound')}
                  </button>
                )}
                <input
                  type="checkbox"
                  checked={enableNotificationSound}
                  onChange={(e) => setEnableNotificationSound(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-background border-border rounded focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 md:p-6 border-t border-border flex-shrink-0 gap-3 bg-muted/20">
          <div className="flex items-center justify-center sm:justify-start gap-2 order-2 sm:order-1">
            {saveStatus === 'success' && (
              <div className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t('toolsSettings.settingsSaved')}
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="text-red-600 dark:text-red-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {t('toolsSettings.settingsFailed')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 order-1 sm:order-2">
            <Button 
              variant="outline" 
              onClick={onClose} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-9 text-sm touch-manipulation"
            >
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={saveSettings} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-9 text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 touch-manipulation"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('common.saving')}
                </div>
              ) : (
                t('toolsSettings.saveSettings')
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ToolsSettings;
