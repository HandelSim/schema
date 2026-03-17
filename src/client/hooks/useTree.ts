/**
 * useTree - Manages the full tree state with real-time SSE updates.
 * Central state management for the agent tree graph.
 * Uses file-based project.json storage via REST API.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { TreeNode, ContractRecord, Project, NodeStatus, LogEntry } from '../types';
import { useSSE } from './useSSE';

interface TreeState {
  project: Project | null;
  nodes: TreeNode[];
  contracts: ContractRecord[];
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
    if (!projectId) {
      setState({ project: null, nodes: [], contracts: [], loading: false, error: null });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(`/api/projects/${projectId}/tree`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { project: Project; nodes: TreeNode[]; contracts: ContractRecord[] };
      setState({
        project: data.project,
        nodes: data.nodes || [],
        contracts: data.contracts || [],
        loading: false,
        error: null,
      });
      // Auto-select root node if nothing is selected yet
      setSelectedNodeId(prev => {
        if (prev) return prev;
        const rootNode = (data.nodes || []).find(n => !n.parent_id);
        return rootNode ? rootNode.id : null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tree';
      setState(prev => ({ ...prev, loading: false, error: message }));
    }
  }, [projectId]);

  useEffect(() => {
    fetchTree();
    setSelectedNodeId(null);
  }, [fetchTree, projectId]);

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
          message: `Node status → ${status}`,
          timestamp: new Date().toISOString(),
          type: 'system',
        });
      } else if (event === 'node:created') {
        const newNode = d['node'] as TreeNode;
        setState(prev => {
          // Avoid duplicates
          if (prev.nodes.some(n => n.id === newNode.id)) return prev;
          return { ...prev, nodes: [...prev.nodes, newNode] };
        });
        addLog({
          message: `New node: ${newNode.name}`,
          timestamp: new Date().toISOString(),
          type: 'system',
        });
      } else if (event === 'node:updated') {
        const updated = d['node'] as TreeNode;
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
      } else if (event === 'project:updated') {
        const project = d['project'] as Project;
        setState(prev => {
          if (prev.project?.id !== project.id) return prev;
          return { ...prev, project };
        });
      } else if (event === 'blacksmith:text') {
        const { content } = d as { content: string };
        if (content) {
          addLog({
            message: `Blacksmith: ${content.slice(0, 120)}`,
            timestamp: new Date().toISOString(),
            type: 'output',
          });
        }
      } else if (event === 'blacksmith:decomposed') {
        // Refresh tree after decomposition
        setTimeout(fetchTree, 500);
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
  const approveNode = useCallback(async (nodeId: string, _decompose = true) => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}/nodes/${nodeId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
    addLog({
      message: `Approved node ${nodeId}`,
      timestamp: new Date().toISOString(),
      type: 'system',
    });
    setTimeout(fetchTree, 1000);
  }, [projectId, addLog, fetchTree]);

  const updateNode = useCallback(async (nodeId: string, updates: Partial<TreeNode>) => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const err = await response.json() as { error: string };
      throw new Error(err.error);
    }
  }, [projectId]);

  const deleteNode = useCallback(async (nodeId: string) => {
    if (!projectId) return;
    // Remove node and all descendants from state
    setState(prev => {
      // Find all descendant IDs
      const toRemove = new Set<string>();
      const queue = [nodeId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        toRemove.add(id);
        prev.nodes.filter(n => n.parent_id === id).forEach(n => queue.push(n.id));
      }
      return { ...prev, nodes: prev.nodes.filter(n => !toRemove.has(n.id)) };
    });
  }, [projectId]);

  return {
    ...state,
    selectedNodeId,
    setSelectedNodeId,
    logs,
    addLog,
    clearLogs,
    refreshTree: fetchTree,
    approveNode,
    updateNode,
    deleteNode,
  };
}
