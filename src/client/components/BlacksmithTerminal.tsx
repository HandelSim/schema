/**
 * BlacksmithTerminal - Chat-style interface for the Blacksmith persistent architect.
 * Streams responses via SSE and displays conversation history.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BlacksmithMessage, BlacksmithStatus } from '../types';
import { useSSE } from '../hooks/useSSE';

interface BlacksmithTerminalProps {
  projectId: string | null;
}

export const BlacksmithTerminal: React.FC<BlacksmithTerminalProps> = ({ projectId }) => {
  const [messages, setMessages] = useState<BlacksmithMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState<BlacksmithStatus>('idle');
  const [streamingContent, setStreamingContent] = useState('');
  const [toolInProgress, setToolInProgress] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load history when project changes
  const loadHistory = useCallback(() => {
    if (!projectId) {
      setMessages([]);
      return;
    }
    fetch(`/api/blacksmith/history?projectId=${projectId}`)
      .then(r => r.json())
      .then((data: { history: { messages: BlacksmithMessage[] } }) => {
        setMessages(data.history?.messages || []);
      })
      .catch(() => setMessages([]));
  }, [projectId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Track externally-triggered streaming (e.g. from approve & decompose)
  const externalStreamRef = useRef('');

  // Subscribe to global SSE events so that server-triggered decomposition
  // (from approve & decompose) is reflected live in the terminal.
  useSSE('/api/events', {
    onMessage: (event, data) => {
      const d = data as Record<string, unknown>;

      if (event === 'blacksmith:status') {
        const { status: s } = d as { status: BlacksmithStatus };
        // Only update status from SSE when we're not already handling a
        // user-initiated request (to avoid race conditions).
        setStatus(prev => {
          if (prev === 'idle' || s === 'idle') return s;
          return s; // always trust server
        });
        if (s === 'idle') {
          // Finalize any externally-accumulated streaming message
          if (externalStreamRef.current) {
            const assistantMsg: BlacksmithMessage = {
              id: Date.now().toString(),
              role: 'assistant',
              content: externalStreamRef.current,
              timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, assistantMsg]);
            externalStreamRef.current = '';
            setStreamingContent('');
          }
        }
      } else if (event === 'blacksmith:text') {
        const { content } = d as { content: string };
        if (content) {
          externalStreamRef.current += content;
          setStreamingContent(externalStreamRef.current);
          setToolInProgress(null);
        }
      } else if (event === 'blacksmith:tool_use') {
        const { tool } = d as { tool?: string };
        if (tool) setToolInProgress(tool);
      } else if (event === 'blacksmith:decomposed') {
        // After decomposition completes, reload history to show the full exchange
        externalStreamRef.current = '';
        setStreamingContent('');
        loadHistory();
      }
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !projectId || status !== 'idle') return;

    const userMsg: BlacksmithMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setStatus('thinking');
    setStreamingContent('');
    setToolInProgress(null);
    externalStreamRef.current = ''; // Clear any externally streamed content

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/blacksmith/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), projectId }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to connect to Blacksmith');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by \n\n
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          let eventType = 'message';
          let dataStr = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr) as { content?: string; tool?: string; error?: string };
            if (eventType === 'text' && data.content) {
              accumulatedText += data.content;
              setStreamingContent(accumulatedText);
              setToolInProgress(null);
            } else if (eventType === 'tool_use' && data.tool) {
              setToolInProgress(data.tool);
            } else if (eventType === 'done') {
              setToolInProgress(null);
            } else if (eventType === 'error') {
              throw new Error(data.error || 'Blacksmith error');
            }
          } catch (e) {
            if ((e as Error).message?.includes('Blacksmith error') || (e as Error).message?.includes('error')) throw e;
          }
        }
      }

      // Finalize the streamed message
      if (accumulatedText) {
        const assistantMsg: BlacksmithMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: accumulatedText,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
      setStreamingContent('');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errMsg: BlacksmithMessage = {
          id: (Date.now() + 2).toString(),
          role: 'system',
          content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errMsg]);
      }
      setStreamingContent('');
    } finally {
      setStatus('idle');
      setToolInProgress(null);
      abortControllerRef.current = null;
    }
  }, [projectId, status]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'thinking': return toolInProgress ? `Using ${toolInProgress}...` : 'Thinking...';
      case 'decomposing': return 'Decomposing...';
      default: return 'Idle';
    }
  };

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900" data-testid="blacksmith-terminal">
        <div className="text-center text-gray-600">
          <div className="text-4xl mb-3">⚒️</div>
          <div className="text-sm">Select or create a project<br/>to talk to Blacksmith</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900" data-testid="blacksmith-terminal">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 flex-shrink-0">
        <span className="text-xs font-medium text-gray-400">Blacksmith</span>
        <span
          data-testid="blacksmith-status"
          data-status={status}
          className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
            status === 'idle' ? 'bg-gray-800 text-gray-400' :
            status === 'decomposing' ? 'bg-purple-900 text-purple-300' :
            'bg-yellow-900 text-yellow-300'
          }`}
        >
          {getStatusLabel()}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !streamingContent && (
          <div className="text-center text-gray-600 text-sm mt-8">
            <div className="text-3xl mb-2">⚒️</div>
            <p>Blacksmith is ready to help design your project.</p>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            data-testid="blacksmith-message"
            data-testid-role={`blacksmith-message-${msg.role}`}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              data-testid={`blacksmith-message-${msg.role}`}
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-700 text-white ml-8'
                  : msg.role === 'system'
                    ? 'bg-red-900 text-red-300 font-mono'
                    : 'bg-gray-800 text-gray-200 mr-8'
              }`}
            >
              <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              <div className="text-xs opacity-50 mt-1">
                {new Date(msg.timestamp).toLocaleTimeString()}
                {msg.tool_uses && msg.tool_uses.length > 0 && (
                  <span className="ml-2">· {msg.tool_uses.length} tool call{msg.tool_uses.length > 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming content */}
        {streamingContent && (
          <div className="flex justify-start" data-testid="blacksmith-typing-indicator">
            <div className="max-w-[85%] rounded-xl px-4 py-3 text-sm bg-gray-800 text-gray-200 mr-8">
              <div className="whitespace-pre-wrap leading-relaxed">{streamingContent}</div>
              <div className="flex items-center gap-1 mt-2">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Tool use indicator (no content yet) */}
        {status !== 'idle' && !streamingContent && (
          <div className="flex justify-start" data-testid="blacksmith-typing-indicator">
            <div className="max-w-[85%] rounded-xl px-4 py-2 text-xs bg-gray-800 text-gray-500 mr-8">
              {toolInProgress ? `🔧 ${toolInProgress}` : '⚒️ Thinking...'}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-700 flex-shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status !== 'idle'}
            placeholder={status !== 'idle' ? 'Blacksmith is thinking...' : 'Message Blacksmith... (Enter to send, Shift+Enter for newline)'}
            data-testid="blacksmith-input"
            rows={2}
            className="flex-1 text-sm border border-gray-600 bg-gray-800 text-gray-100 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600 disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(inputText)}
            disabled={!inputText.trim() || status !== 'idle'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-end"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
};
