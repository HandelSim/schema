/**
 * ExecutionLog - Real-time scrolling log viewer for node execution output.
 * Displays colored output/error/system messages with auto-scroll.
 */
import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface ExecutionLogProps {
  logs: LogEntry[];
  onClear: () => void;
  title?: string;
}

const LOG_COLORS: Record<LogEntry['type'], string> = {
  output:  'text-gray-300',
  error:   'text-red-400',
  system:  'text-sky-400',
  history: 'text-gray-500',
};

export const ExecutionLog: React.FC<ExecutionLogProps> = ({ logs, onClear, title = 'Execution Log' }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to bottom when new logs arrive (unless user scrolled up)
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = isAtBottom;
  };

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg overflow-hidden border border-gray-800" data-testid="execution-log">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          </div>
          <span className="text-xs font-mono text-gray-400">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{logs.length} lines</span>
          <button
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-800"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5 min-h-0"
      >
        {logs.length === 0 ? (
          <div className="text-gray-600 italic">No log output yet...</div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className={`flex gap-2 leading-relaxed ${LOG_COLORS[entry.type]}`}>
              <span className="text-gray-700 flex-shrink-0 select-none">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span className="break-all whitespace-pre-wrap">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll indicator */}
      {!autoScrollRef.current && (
        <div className="px-3 py-1 bg-gray-900 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={() => {
              autoScrollRef.current = true;
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            ↓ Jump to bottom
          </button>
        </div>
      )}
    </div>
  );
};
