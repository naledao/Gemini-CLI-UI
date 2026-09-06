import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Folder, FolderOpen, ChevronRight, Loader2, CornerDownLeft } from 'lucide-react';
import { api } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';

export default function DirectoryAutocomplete({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className = '',
  autoFocus = false,
  onSelectDirectory
}) {
  const { t, language } = useLanguage();
  const [suggestions, setSuggestions] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const debounceTimerRef = useRef(null);

  // Fetch directories based on query path
  const fetchDirectories = useCallback(async (searchPath) => {
    // Only search if empty (defaults to HOME) or starts with / or ~
    const pathStr = (searchPath || '').trim();
    if (pathStr && !pathStr.startsWith('/') && !pathStr.startsWith('~') && !pathStr.startsWith('.')) {
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.getDirectories(pathStr);
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.directories || []);
        setCurrentPath(data.currentPath || '');
        setIsOpen(true);
        setSelectedIndex(-1);
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced input change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Trigger suggestion fetch
    debounceTimerRef.current = setTimeout(() => {
      fetchDirectories(value);
    }, 180);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, fetchDirectories]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (dirPath) => {
    // Ensure trailing slash so the user can continue typing subdirectories
    const formatted = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    onChange(formatted);
    if (onSelectDirectory) {
      onSelectDirectory(formatted);
    }
    // Re-fetch next level subdirectories
    fetchDirectories(formatted);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleInputKeyDown = (e) => {
    if (!isOpen || suggestions.length === 0) {
      if (onKeyDown) onKeyDown(e);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Tab') {
      // Autocomplete on Tab
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex].path);
      } else if (suggestions.length > 0) {
        e.preventDefault();
        handleSelect(suggestions[0].path);
      }
    } else if (e.key === 'Enter') {
      // If an item is actively highlighted with arrows, select it on Enter
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex].path);
        return;
      }
      // Otherwise pass through to parent form submit
      if (onKeyDown) onKeyDown(e);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      if (onKeyDown) onKeyDown(e);
    } else {
      if (onKeyDown) onKeyDown(e);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            fetchDirectories(value);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={className}
        />
        {isLoading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          </div>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-xl z-50 overflow-hidden max-h-64 flex flex-col animate-in fade-in-0 zoom-in-95 duration-100">
          {/* Header showing current directory */}
          {currentPath && (
            <div className="px-3 py-1.5 bg-muted/60 border-b border-border text-[11px] font-mono text-muted-foreground flex items-center justify-between">
              <div className="flex items-center gap-1 truncate">
                <FolderOpen className="w-3 h-3 text-primary flex-shrink-0" />
                <span className="truncate">{currentPath}</span>
              </div>
              <span className="text-[10px] opacity-75 hidden sm:inline">Tab / 点击选择</span>
            </div>
          )}

          {/* Directory list */}
          <div className="overflow-y-auto flex-1 divide-y divide-border/30">
            {suggestions.length > 0 ? (
              suggestions.map((dir, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={dir.path}
                    onClick={() => handleSelect(dir.path)}
                    className={`px-3 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'hover:bg-muted/80 text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-primary-foreground' : 'text-blue-500'}`} />
                      <span className="font-mono truncate">{dir.name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] opacity-60 ml-2 flex-shrink-0">
                      <span>子目录</span>
                      <ChevronRight className="w-3 h-3" />
                    </div>
                  </div>
                );
              })
            ) : !isLoading ? (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                {language === 'zh' ? '该目录下无子文件夹' : 'No subdirectories found'}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
