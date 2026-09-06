import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Globe } from 'lucide-react';

function LanguageToggle({ showLabel = true, className = '' }) {
  const { language, setLanguage } = useLanguage();

  const toggleLanguage = () => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  };

  return (
    <button
      onClick={toggleLanguage}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${className}`}
      title={language === 'zh' ? '切换为 English' : 'Switch to 简体中文'}
      aria-label="Toggle language"
      type="button"
    >
      <Globe className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
      {showLabel && (
        <span>{language === 'zh' ? '中文' : 'EN'}</span>
      )}
    </button>
  );
}

export default LanguageToggle;
