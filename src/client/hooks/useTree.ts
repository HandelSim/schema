/**
 * useTree - Manages the full tree state with real-time SSE updates.
 * Central state management for the agent tree graph.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { TreeNode, Contract, Project, NodeStatus, LogEntry } from '../types';
import { useSSE } from './useSSE';

interface TreeState {
  project: Project | null;
  nodes: TreeNode[];
  contracts: Contract[];
  loading: boolean;
  error: string | null;
}

interface UseTreeReturn extends TreeState {
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  logs: LogEntry[];
  addLog: (entry: Omit<LogEntry, 'id'>) => void;
  clearLogs: () => void;
  refreshTree: () => void;
  // Node operations
  approveNode: (nodeId: string, decompose?: boolean) => Promise<void>;
  rejectNode: (nodeId: string, feedback?: string) => Promise<void>;
  executeNode: (nodeId: string) => Promise<void>;
  verifyNode: (nodeId: string) => Promise<void>;
  updateNode: (nodeId: string, updates: Partial<TreeNode>) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
}

export function useTree(projectId: string | null): UseTreeReturn {
  const [state, setState] = useState<TreeState>({
    project: null,
    nodes: [],
    contracts: [],
    loading: false,
    error: null,
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdCounter = useRef(0);

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLogs(prev => [...prev.slice(-500), { ...entry, id: String(logIdCounter.current++) }]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const fetchTree = useCallback(async () => {
    if (!projectId) return;

    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(`/api/projects/${projectId}/tree`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { project: Project; nodes: TreeNode[]; contracts: Contract[] };
      setState({
        project: data.project,
        nodes: data.nodes,
        contracts: data.contracts,
        loading: false,
        error: null,
      });
      // Auto-select root node if there's exactly one pending node and nothing is selected yet
      setSelectedNodeId(prev => {
        if (prev) return prev;
        const rootNode = data.nodes.find(n => !n.parent_id && n.status === 'pending');
        return rootNode ? rootNode.id : null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tree';
      setState(prev => ({ ...prev, loading: false, error: message }));
    }
  }, [projectId]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Parse raw node data from API (JSON fields are strings in SQLite)
  const parseNode = (raw: Record<string, unknown>): TreeNode => ({
    ...raw as unknown as TreeNode,
    hooks: typeof raw['hooks'] === 'string' ? JSON.parse(raw['hooks'] as string || 'null') : raw['hooks'],
    mcp_tools: typeof raw['mcp_tools'] === 'string' ? JSON.parse(raw['mcp_tools'] as string || '[]') : (raw['mcp_tools'] as TreeNode['mcp_tools'] || []),
    allowed_tools: typeof raw['allowed_tools'] === 'string' ? JSON.parse(raw['allowed_tools'] as string || '[]') : (raw['allowed_tools'] as string[] || []),
    allowed_paths: typeof raw['allowed_paths'] === 'string' ? JSON.parse(raw['allowed_paths'] as string || '[]') : (raw['allowed_paths'] as string[] || []),
    dependencies: typeof raw['dependencies'] === 'string' ? JSON.parse(raw['dependencies'] as string || '[]') : (raw['dependencies'] as string[] || []),
    context_files: typeof raw['context_files'] === 'string' ? JSON.parse(raw['context_files'] as string || '[]') : (raw['context_files'] as string[] || []),
  });

  // Handle SSE events for real-time updates
  useSSE('/api/events', {
    onMessage: (event, data) => {
      const d = data as Record<string, unknown>;

      if (event === 'node:status') {
        const { nodeId, status } = d as { nodeId: string; status: NodeStatus };
        setState(prev => ({
          ...prev,
          nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, status } : n),
        }));
        addLog({
          message: `Node status changed to ${status}`,
          timestamp: new Date().toISOString(),
          type: 'system',
        });
      } else if (event === 'node:created') {
        const newNode = parseNode(d['node'] as Record<string, unknown>);
        setState(prev => ({
          ...prev,
          nodes: [...prev.nodes, newNode],
        }));
        addLog({
          message: `New node created: ${newNode.name}`,
          timestamp: new Date().toISOString(),
          type: 'system',
        });
      } else if (event === 'node:updated') {
        const updated = parseNode(d['node'] as Record<string, unknown>);
        setState(prev => ({
          ...prev,
          nodes: prev.nodes.map(n => n.id === updated.id ? updated : n),
        }));
      } else if (event === 'node:deleted') {
        const { nodeId } = d as { nodeId: string };
        setState(prev => ({
          ...prev,
          nodes: prev.nodes.filter(n => n.id !== nodeId),
        }));
      } else if (event === 'contract:created' || event === 'contract:updated') {
        const contract = d['contract'] as Contract;
        setState(prev => ({
          ...prev,
          contracts: event === 'contract:created'
            ? [...prev.contracts, contract]
            : prev.contracts.map(c => c.id === contract.id ? contract : c),
        }));
      }
    },
    onOpen: () => {
      addLog({ message: 'Connected to real-time updates', timestamp: new Date().toISOString(), type: 'system' });
    },
    onError: () => {
      addLog({ message: 'Real-time connection lost, reconnecting...', timestamp: new Date().toISOString(), type: 'error' });
    },
  });

  // Node operations
  const approveNode = useCallback(async (nodeId: string, decompose = true) => {
    const response = await fetch(`/api/nodes/${nodeId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decompose }),
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
    addLog({
      message: `Approved node ${nodeId}${decompose ? ' and started decomposition' : ' as leaf'}`,
      timestamp: new Date().toISOString(),
      type: 'system',
    });
  }, [addLog]);

  const rejectNode = useCallback(async (nodeId: string, feedback?: string) => {
    const response = await fetch(`/api/nodes/${nodeId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
  }, []);

  const executeNode = useCallback(async (nodeId: string) => {
    const response = await fetch(`/api/nodes/${nodeId}/execute`, {
      method: 'POST',
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
  }, []);

  const verifyNode = useCallback(async (nodeId: string) => {
    const response = await fetch(`/api/nodes/${nodeId}/verify`, {
      method: 'POST',
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
  }, []);

  const updateNode = useCallback(async (nodeId: string, updates: Partial<TreeNode>) => {
    const response = await fetch(`/api/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
  }, []);

  const deleteNode = useCallback(async (nodeId: string) => {
    const response = await fetch(`/api/nodes/${nodeId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
  }, []);

  return {
    ...state,
    selectedNodeId,
    setSelectedNodeId,
    logs,
    addLog,
    clearLogs,
    refreshTree: fetchTree,
    approveNode,
    rejectNode,
    executeNode,
    verifyNode,
    updateNode,
    deleteNode,
  };
}
