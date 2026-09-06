import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageToggle from './LanguageToggle';
import GeminiLogo from './GeminiLogo';

const SetupForm = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { register } = useAuth();
  const { t } = useLanguage();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    
    if (username.length < 3) {
      setError(t('auth.usernameMinLength'));
      return;
    }
    
    if (password.length < 6) {
      setError(t('auth.passwordMinLength'));
      return;
    }
    
    setIsLoading(true);
    
    const result = await register(username, password);
    
    if (!result.success) {
      setError(result.error);
    }
    
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {/* Top right language switch */}
      <div className="absolute top-4 right-4">
        <LanguageToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <GeminiLogo size={64} />
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t('auth.welcomeSetup')}</h1>
            <p className="text-muted-foreground mt-2">
              {t('auth.setupSubtitle')}
            </p>
          </div>

          {/* Setup Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1">
                {t('auth.username')}
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('auth.usernamePlaceholder')}
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                {t('auth.password')}
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('auth.passwordPlaceholder')}
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1">
                {t('auth.confirmPassword')}
              </label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('auth.confirmPasswordPlaceholder')}
                required
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md transition-colors duration-200"
            >
              {isLoading ? t('auth.settingUp') : t('auth.createAccount')}
            </button>
          </form>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {t('auth.singleUserNotice')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupForm;
