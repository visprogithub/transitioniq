'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Lock,
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Clock,
  ShieldOff,
  FileCode,
  FileJson,
  FileType,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FileEntry {
  path: string;
  content: string;
  language: string;
  size: number;
}

interface Manifest {
  generatedAt: string;
  fileCount: number;
  files: FileEntry[];
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
  language?: string;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === name);

      if (!existing) {
        existing = {
          name,
          path,
          type: isFile ? 'file' : 'directory',
          ...(isFile ? { language: file.language } : { children: [] }),
        };
        current.push(existing);
      }

      if (!isFile && existing.children) {
        current = existing.children;
      }
    }
  }

  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortTree(node.children);
    }
  }
  sortTree(root);

  return root;
}

const LANG_MAP: Record<string, string> = {
  typescript: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  markdown: 'markdown',
  text: 'text',
};

function fileIcon(language?: string) {
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'jsx':
      return <FileCode size={14} className="shrink-0 text-blue-400" />;
    case 'json':
      return <FileJson size={14} className="shrink-0 text-yellow-400" />;
    case 'markdown':
      return <FileType size={14} className="shrink-0 text-green-400" />;
    case 'css':
      return <FileCode size={14} className="shrink-0 text-purple-400" />;
    default:
      return <FileText size={14} className="shrink-0 text-zinc-500" />;
  }
}

/* ------------------------------------------------------------------ */
/*  File Tree                                                          */
/* ------------------------------------------------------------------ */

function FileTreeNode({
  node,
  selectedPath,
  onSelect,
  expandedDirs,
  onToggleDir,
  depth = 0,
}: {
  node: TreeNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  depth?: number;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = node.path === selectedPath;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => onToggleDir(node.path)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-sm hover:bg-white/5 rounded transition-colors text-left"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-zinc-500 shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen size={14} className="text-amber-400 shrink-0" />
          ) : (
            <Folder size={14} className="text-amber-400 shrink-0" />
          )}
          <span className="text-zinc-300 truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`w-full flex items-center gap-1.5 py-1 px-2 text-sm rounded transition-colors text-left ${
        isSelected
          ? 'bg-blue-600/20 text-blue-300'
          : 'hover:bg-white/5 text-zinc-400'
      }`}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
      {fileIcon(node.language)}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown components (custom renderers for react-markdown)          */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
const markdownComponents: Record<string, React.ComponentType<any>> = {
  // Unwrap <pre> so SyntaxHighlighter doesn't nest inside a prose <pre>
  pre: ({ children }: any) => (
    <div className="not-prose my-4 rounded-lg overflow-hidden">{children}</div>
  ),
  code: ({ children, className }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    if (match) {
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          customStyle={{ margin: 0, padding: '1rem', fontSize: '0.8125rem', borderRadius: '0.5rem' }}
          showLineNumbers
          lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#4a4a5a', userSelect: 'none' }}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      );
    }
    // Block code without language
    if (String(children).includes('\n')) {
      return (
        <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
          <code className="text-sm text-zinc-300">{children}</code>
        </pre>
      );
    }
    // Inline code
    return (
      <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-sm text-blue-300">
        {children}
      </code>
    );
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function SourceViewerPage() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('README.md');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ type: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  // --- Anti-copy friction: disable right-click on protected areas ---
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-protected]')) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // --- Anti-copy friction: block Ctrl+C / Cmd+C / Ctrl+A / Ctrl+U / Ctrl+S ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-protected]') || document.querySelector('[data-protected]')) {
        if ((e.ctrlKey || e.metaKey) && ['c', 'a', 'u', 's'].includes(e.key.toLowerCase())) {
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();

        if (!res.ok) {
          setError({ type: data.error, message: data.message });
          return;
        }

        setManifest(data);
        setAuthenticated(true);

        // Auto-expand top-level directories
        const topDirs = new Set<string>();
        (data.files as FileEntry[]).forEach((f) => {
          const firstSlash = f.path.indexOf('/');
          if (firstSlash !== -1) topDirs.add(f.path.slice(0, firstSlash));
        });
        setExpandedDirs(topDirs);
      } catch {
        setError({ type: 'network', message: 'Failed to connect. Please try again.' });
      } finally {
        setLoading(false);
      }
    },
    [password],
  );

  const tree = useMemo(() => {
    if (!manifest) return [];
    return buildTree(manifest.files);
  }, [manifest]);

  const currentFile = useMemo(() => {
    if (!manifest) return null;
    return manifest.files.find((f) => f.path === selectedFile) || null;
  }, [manifest, selectedFile]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /* ---- Expired / Disabled states ---- */
  if (error && (error.type === 'expired' || error.type === 'disabled')) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800 mb-6">
            {error.type === 'expired' ? (
              <Clock size={32} className="text-zinc-500" />
            ) : (
              <ShieldOff size={32} className="text-zinc-500" />
            )}
          </div>
          <h1 className="text-xl font-semibold text-zinc-200 mb-2">
            {error.type === 'expired' ? 'Access Expired' : 'Viewer Disabled'}
          </h1>
          <p className="text-zinc-500">{error.message}</p>
        </div>
      </div>
    );
  }

  /* ---- Password gate ---- */
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="max-w-sm w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800 mb-6">
              <Lock size={32} className="text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100 mb-1">TransitionIQ</h1>
            <p className="text-zinc-500 text-sm">Source Code Viewer</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm text-zinc-400 mb-1.5">
                Access Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 pr-10"
                  placeholder="Enter password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (error.type === 'unauthorized' || error.type === 'network') && (
              <p className="text-red-400 text-sm">{error.message}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              {loading ? 'Verifying...' : 'View Source Code'}
            </button>
          </form>

          <p className="text-center text-zinc-600 text-xs mt-6">
            Access expires February 19, 2026
          </p>
        </div>
      </div>
    );
  }

  /* ---- Main viewer ---- */
  return (
    <div className="h-screen bg-zinc-950 flex flex-col" data-protected>
      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-zinc-200 font-semibold">TransitionIQ</h1>
          <span className="text-zinc-600 text-sm">Source Code</span>
          <span className="text-zinc-600 text-sm">&middot;</span>
          <span className="text-zinc-600 text-sm">{manifest?.fileCount} files</span>
        </div>
        <div className="flex items-center gap-2 text-zinc-600 text-xs">
          <Lock size={12} />
          <span>Read-only viewer</span>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: file tree */}
        <aside className="w-72 bg-zinc-900/50 border-r border-zinc-800 overflow-y-auto shrink-0 py-2">
          {tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              selectedPath={selectedFile}
              onSelect={setSelectedFile}
              expandedDirs={expandedDirs}
              onToggleDir={toggleDir}
            />
          ))}
        </aside>

        {/* Main: file content */}
        <main className="flex-1 overflow-y-auto">
          {currentFile ? (
            <div>
              {/* File header bar */}
              <div className="sticky top-0 bg-zinc-900/90 backdrop-blur border-b border-zinc-800 px-4 py-2 flex items-center justify-between z-10">
                <span className="text-zinc-300 text-sm font-mono">{currentFile.path}</span>
                <span className="text-zinc-600 text-xs">
                  {currentFile.language} &middot; {(currentFile.size / 1024).toFixed(1)} KB
                </span>
              </div>

              {/* File content — select-none + copy prevention */}
              <div
                className="select-none"
                style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                onCopy={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
              >
                {currentFile.language === 'markdown' ? (
                  <div className="p-6 max-w-4xl prose prose-invert prose-zinc prose-sm prose-headings:text-zinc-200 prose-p:text-zinc-400 prose-a:text-blue-400 prose-strong:text-zinc-300 prose-code:text-blue-300 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-th:text-zinc-300 prose-td:text-zinc-400 prose-li:text-zinc-400 prose-hr:border-zinc-800 prose-blockquote:text-zinc-500 prose-blockquote:border-zinc-700 prose-img:rounded-lg">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {currentFile.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <SyntaxHighlighter
                    language={LANG_MAP[currentFile.language] || 'text'}
                    style={oneDark}
                    showLineNumbers
                    wrapLines
                    customStyle={{
                      margin: 0,
                      borderRadius: 0,
                      background: 'transparent',
                      fontSize: '0.8125rem',
                    }}
                    lineNumberStyle={{
                      minWidth: '3.5em',
                      paddingRight: '1em',
                      color: '#4a4a5a',
                      userSelect: 'none',
                    }}
                  >
                    {currentFile.content}
                  </SyntaxHighlighter>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-600">
              Select a file to view
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
