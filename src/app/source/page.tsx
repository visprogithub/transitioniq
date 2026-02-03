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
  Clock,
  ShieldOff,
  FileCode,
  FileJson,
  FileType,
  GitCommitHorizontal,
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

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface Manifest {
  generatedAt: string;
  fileCount: number;
  files: FileEntry[];
  gitHistory: GitCommit[];
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
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('README.md');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ type: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

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

  // --- Auto-fetch manifest on mount ---
  useEffect(() => {
    async function fetchManifest() {
      try {
        const res = await fetch('/api/source');
        const data = await res.json();

        if (!res.ok) {
          setError({ type: data.error, message: data.message });
          return;
        }

        setManifest(data);

        // Auto-expand top-level directories
        const topDirs = new Set<string>();
        (data.files as FileEntry[]).forEach((f: FileEntry) => {
          const firstSlash = f.path.indexOf('/');
          if (firstSlash !== -1) topDirs.add(f.path.slice(0, firstSlash));
        });
        setExpandedDirs(topDirs);
      } catch {
        setError({ type: 'network', message: 'Failed to load source code. Please try again.' });
      } finally {
        setLoading(false);
      }
    }
    fetchManifest();
  }, []);

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

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800 mb-6 animate-pulse">
            <FileCode size={32} className="text-blue-400" />
          </div>
          <p className="text-zinc-400 text-sm">Loading source code...</p>
        </div>
      </div>
    );
  }

  /* ---- Expired / Disabled states ---- */
  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800 mb-6">
            {error.type === 'expired' ? (
              <Clock size={32} className="text-zinc-500" />
            ) : error.type === 'disabled' ? (
              <ShieldOff size={32} className="text-zinc-500" />
            ) : (
              <FileText size={32} className="text-zinc-500" />
            )}
          </div>
          <h1 className="text-xl font-semibold text-zinc-200 mb-2">
            {error.type === 'expired'
              ? 'Access Expired'
              : error.type === 'disabled'
                ? 'Viewer Disabled'
                : 'Unable to Load'}
          </h1>
          <p className="text-zinc-500">{error.message}</p>
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
          {/* Git History entry */}
          <button
            onClick={() => setSelectedFile('__GIT_HISTORY__')}
            className={`w-full flex items-center gap-1.5 py-1.5 px-3 text-sm rounded transition-colors text-left mb-1 ${
              selectedFile === '__GIT_HISTORY__'
                ? 'bg-blue-600/20 text-blue-300'
                : 'hover:bg-white/5 text-zinc-400'
            }`}
          >
            <GitCommitHorizontal size={14} className={`shrink-0 ${selectedFile === '__GIT_HISTORY__' ? 'text-blue-400' : 'text-zinc-500'}`} />
            <span>Git History</span>
            {manifest?.gitHistory && (
              <span className="ml-auto text-xs text-zinc-600">{manifest.gitHistory.length}</span>
            )}
          </button>
          <div className="border-b border-zinc-800 mb-1" />

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
          {selectedFile === '__GIT_HISTORY__' ? (
            <div>
              <div className="sticky top-0 bg-zinc-900/90 backdrop-blur border-b border-zinc-800 px-4 py-2 flex items-center justify-between z-10">
                <span className="text-zinc-300 text-sm font-mono flex items-center gap-2">
                  <GitCommitHorizontal size={14} />
                  Git History
                </span>
                <span className="text-zinc-600 text-xs">
                  {manifest?.gitHistory?.length || 0} commits
                </span>
              </div>
              <div
                className="select-none p-4"
                style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                onCopy={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
              >
                <div className="max-w-3xl space-y-0">
                  {manifest?.gitHistory?.map((commit, i) => (
                    <div key={commit.hash + i} className="flex items-start gap-4 group">
                      {/* Timeline line + dot */}
                      <div className="flex flex-col items-center shrink-0 pt-1">
                        <div className={`w-2.5 h-2.5 rounded-full border-2 ${
                          i === 0 ? 'border-blue-400 bg-blue-400/30' : 'border-zinc-600 bg-zinc-800'
                        }`} />
                        {i < (manifest?.gitHistory?.length ?? 0) - 1 && (
                          <div className="w-px h-full min-h-8 bg-zinc-800" />
                        )}
                      </div>
                      {/* Commit info */}
                      <div className="pb-6 min-w-0">
                        <p className="text-zinc-200 text-sm leading-snug break-words">{commit.message}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                          <code className="text-amber-400/80 bg-zinc-800/80 px-1.5 py-0.5 rounded font-mono text-xs">{commit.hash}</code>
                          <span>{commit.author}</span>
                          <span>{commit.date}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : currentFile ? (
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
