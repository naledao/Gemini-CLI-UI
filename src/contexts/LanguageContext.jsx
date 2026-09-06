import React, { createContext, useContext, useState, useEffect } from 'react';
import zh from '../locales/zh';
import en from '../locales/en';

const translations = { zh, en };

export const SUPPORTED_LANGUAGES = [
  { code: 'zh', name: '简体中文' },
  { code: 'en', name: 'English' },
];

const LanguageContext = createContext();

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(() => {
    const savedLanguage = localStorage.getItem('language');
    if (savedLanguage && (savedLanguage === 'zh' || savedLanguage === 'en')) {
      return savedLanguage;
    }
    // 默认使用中文
    return 'zh';
  });

  useEffect(() => {
    localStorage.setItem('language', language);
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = (lang) => {
    if (lang === 'zh' || lang === 'en') {
      setLanguageState(lang);
    }
  };

  /**
   * Translate key with optional interpolation
   * e.g. t('sidebar.newProject')
   * e.g. t('common.minutesAgo', { count: 5 })
   */
  const t = (key, params = {}) => {
    if (!key) return '';

    const keys = key.split('.');
    let current = translations[language];

    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k];
      } else {
        current = null;
        break;
      }
    }

    // Fallback to English if not found in current language
    if (current === null || current === undefined) {
      let fallback = translations.en;
      for (const k of keys) {
        if (fallback && typeof fallback === 'object' && k in fallback) {
          fallback = fallback[k];
        } else {
          fallback = null;
          break;
        }
      }
      current = fallback !== null && fallback !== undefined ? fallback : key;
    }

    // String interpolation
    if (typeof current === 'string' && params && typeof params === 'object') {
      let result = current;
      for (const [paramKey, paramValue] of Object.entries(params)) {
        result = result.replace(new RegExp(`\{${paramKey}\}`, 'g'), String(paramValue));
      }
      return result;
    }

    return current;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, supportedLanguages: SUPPORTED_LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
};
