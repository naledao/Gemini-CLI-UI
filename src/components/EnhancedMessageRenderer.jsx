import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';

const CodeBlock = ({ language, value, isDarkMode }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      console.error('Failed to copy code');
    });
  };

  // Detect language if not specified
  let detectedLanguage = language;
  if (!detectedLanguage) {
    const lowerValue = value.toLowerCase();
    if (lowerValue.includes('<!doctype html') || lowerValue.includes('<html')) {
      detectedLanguage = 'html';
    } else if (lowerValue.includes('def ') || lowerValue.includes('import ') || lowerValue.includes('print(')) {
      detectedLanguage = 'python';
    } else if (lowerValue.includes('function ') || lowerValue.includes('const ') || lowerValue.includes('let ') || lowerValue.includes('=>')) {
      detectedLanguage = 'javascript';
    } else if (lowerValue.includes('#!/bin/bash') || lowerValue.includes('#!/bin/sh')) {
      detectedLanguage = 'bash';
    } else if (lowerValue.includes('select ') || lowerValue.includes('insert into ')) {
      detectedLanguage = 'sql';
    }
  }

  const displayLang = detectedLanguage ? detectedLanguage.toUpperCase() : 'CODE';

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-border/80 bg-card shadow-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-muted/70 border-b border-border/60 text-xs font-mono text-muted-foreground">
        <span className="text-[11px] font-semibold tracking-wider opacity-80">{displayLang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-500" />
              <span className="text-green-500">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* Code body */}
      <div className="relative overflow-x-auto">
        <SyntaxHighlighter
          language={detectedLanguage || 'text'}
          style={isDarkMode ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: '0.875rem 1rem',
            background: isDarkMode ? '#181825' : '#f8fafc',
            fontSize: '0.8125rem',
            lineHeight: '1.6',
            fontFamily: 'JetBrains Mono, Consolas, Monaco, monospace',
          }}
          showLineNumbers={value.includes('\n') && value.split('\n').length > 5}
          wrapLines={true}
          wrapLongLines={true}
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            color: isDarkMode ? '#4a5568' : '#94a3b8',
            fontSize: '0.75rem'
          }}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

// Normalize Markdown emphasis syntax: safely move any inner whitespace to outer side
// to strictly conform to CommonMark flanking delimiter rules without corrupting emphasis
const normalizeMarkdownEmphasis = (text) => {
  if (!text) return '';
  const parts = text.split(/(```[\s\S]*?```|`[^`]*?`)/g);
  return parts.map((part, index) => {
    // Odd indices are code blocks or inline code - don't modify
    if (index % 2 === 1) return part;
    
    // Fix emphasis inner spaces (e.g. "** text **" -> " **text** ", "**text **" -> "**text** ")
    return part.replace(/\*\*([^*\n]+?)\*\*/g, (match, inner) => {
      const trimmed = inner.trim();
      if (!trimmed) return match;
      const leadingSpace = inner.startsWith(' ') ? ' ' : '';
      const trailingSpace = inner.endsWith(' ') ? ' ' : '';
      return `${leadingSpace}**${trimmed}**${trailingSpace}`;
    });
  }).join('');
};

export const EnhancedMessageRenderer = ({ content, isDarkMode = true }) => {
  // Strip out any internal credential notices if present
  let cleanContent = content || '';
  if (cleanContent.startsWith('Error: Loaded cached credentials')) {
    cleanContent = cleanContent.replace(/^Error:\s*Loaded cached credentials\.?\s*\n?/i, '');
  }
  cleanContent = normalizeMarkdownEmphasis(cleanContent);

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ node, className, children, ...props }) => {
            // In case a block code was rendered without pre
            const match = /language-(\w+)/.exec(className || '');
            const hasNewlines = String(children || '').includes('\n');
            if (match || (hasNewlines && String(children || '').split('\n').length > 1)) {
              return (
                <CodeBlock
                  language={match ? match[1] : ''}
                  value={String(children || '').replace(/\n$/, '')}
                  isDarkMode={isDarkMode}
                />
              );
            }
            
            return (
              <code className="px-1.5 py-0.5 mx-0.5 bg-muted text-primary font-mono rounded text-xs border border-border/50 break-words font-normal">
                {children}
              </code>
            );
          },
          pre: ({ children, ...props }) => {
            if (React.isValidElement(children)) {
              const codeProps = children.props || {};
              const className = codeProps.className || '';
              const match = /language-(\w+)/.exec(className);
              const language = match ? match[1] : '';
              const rawChildren = codeProps.children;
              const value = (Array.isArray(rawChildren) ? rawChildren.join('') : String(rawChildren || '')).replace(/\n$/, '');
              
              return (
                <CodeBlock
                  language={language}
                  value={value}
                  isDarkMode={isDarkMode}
                />
              );
            }
            return <pre {...props}>{children}</pre>;
          },
          h1: ({ children }) => (
            <h1 className="text-xl font-bold mt-5 mb-2.5 text-foreground border-b border-border/40 pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-4 mb-2 text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-3 mb-1.5 text-foreground">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold mt-2.5 mb-1 text-foreground">
              {children}
            </h4>
          ),
          p: ({ children }) => {
            if (!children) return null;
            return (
              <p className="mb-2.5 text-sm leading-relaxed text-foreground/90">
                {children}
              </p>
            );
          },
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-3 space-y-1 text-sm text-foreground/90">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm text-foreground/90">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/70 pl-3.5 py-1.5 my-3 bg-muted/40 rounded-r text-sm italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a 
              href={href} 
              className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
              target="_blank" 
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/70 font-semibold text-foreground">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/50 bg-card">
              {children}
            </tbody>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs uppercase tracking-wider">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-foreground/90">
              {children}
            </td>
          ),
          hr: () => (
            <hr className="my-4 border-border/60" />
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-foreground/80">
              {children}
            </em>
          ),
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
};

export default EnhancedMessageRenderer;
