/**
 * useNode - Fetches and manages a single node's state and execution logs.
 * Subscribes to SSE for live log streaming.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { TreeNode, LogEntry } from '../types';
import { useSSE } from './useSSE';

interface UseNodeReturn {
  node: TreeNode | null;
  loading: boolean;
  error: string | null;
  logs: LogEntry[];
  clearLogs: () => void;
  refresh: () => void;
}

export function useNode(nodeId: string | null): UseNodeReturn {
  const [node, setNode] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logId = useRef(0);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'output') => {
    setLogs(prev => [...prev.slice(-1000), {
      id: String(logId.current++),
      message: msg,
      timestamp: new Date().toISOString(),
      type,
    }]);
  }, []);

  const fetchNode = useCallback(async () => {
    if (!nodeId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/nodes/${nodeId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { node: Record<string, unknown> };
      // Parse JSON string fields from SQLite
      const raw = data.node;
      setNode({
        ...raw as unknown as TreeNode,
        hooks: typeof raw['hooks'] === 'string' ? JSON.parse(raw['hooks'] as string || 'null') : raw['hooks'] as TreeNode['hooks'],
        mcp_tools: typeof raw['mcp_tools'] === 'string' ? JSON.parse(raw['mcp_tools'] as string || '[]') : raw['mcp_tools'] as TreeNode['mcp_tools'],
        allowed_tools: typeof raw['allowed_tools'] === 'string' ? JSON.parse(raw['allowed_tools'] as string || '[]') : raw['allowed_tools'] as string[],
        allowed_paths: typeof raw['allowed_paths'] === 'string' ? JSON.parse(raw['allowed_paths'] as string || '[]') : raw['allowed_paths'] as string[],
        dependencies: typeof raw['dependencies'] === 'string' ? JSON.parse(raw['dependencies'] as string || '[]') : raw['dependencies'] as string[],
        context_files: typeof raw['context_files'] === 'string' ? JSON.parse(raw['context_files'] as string || '[]') : raw['context_files'] as string[],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load node');
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    fetchNode();
    setLogs([]);
  }, [fetchNode, nodeId]);

  // Subscribe to execution log stream for this node
  useSSE(nodeId ? `/api/nodes/${nodeId}/logs` : '', {
    onMessage: (event, data) => {
      const d = data as { message?: string; status?: string; exitCode?: number };
      if (event === 'log:output' || event === 'log:history') {
        addLog(d.message || String(data), 'output');
      } else if (event === 'log:error') {
        addLog(d.message || String(data), 'error');
      } else if (event === 'log:complete') {
        addLog(`Execution ${d.status || 'complete'} (exit ${d.exitCode ?? 0})`, 'system');
        // Refresh node to get updated status
        setTimeout(fetchNode, 500);
      } else if (event === 'node:status') {
        // Refresh node data when status changes
        setTimeout(fetchNode, 200);
      }
    },
  });

  return {
    node,
    loading,
    error,
    logs,
    clearLogs: () => setLogs([]),
    refresh: fetchNode,
  };
}
