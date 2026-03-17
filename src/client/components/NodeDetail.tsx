/**
 * NodeDetail - The panel for viewing and editing a selected node.
 * Shows simplified node properties matching the new NodeRecord schema.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { TreeNode, ContractRecord } from '../types';
import { StatusBadge } from './StatusBadge';

interface NodeDetailProps {
  node: TreeNode;
  allNodes: TreeNode[];
  contracts: ContractRecord[];
  onApprove: (nodeId: string, decompose: boolean) => Promise<void>;
  onUpdate: (nodeId: string, updates: Partial<TreeNode>) => Promise<void>;
  onDelete: (nodeId: string) => Promise<void>;
}

export const NodeDetail: React.FC<NodeDetailProps> = ({
  node,
  allNodes,
  contracts,
  onApprove,
  onUpdate,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [draftNode, setDraftNode] = useState<TreeNode>(node);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'prompt' | 'contracts' | 'children'>('prompt');

  useEffect(() => {
    setDraftNode(node);
    setEditing(false);
  }, [node.id, node]);

  const children = allNodes.filter(n => n.parent_id === node.id);

  const handleAction = useCallback(async (action: string, fn: () => Promise<void>) => {
    setActionLoading(action);
    try {
      await fn();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(node.id, draftNode);
      setEditing(false);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (updates: Partial<TreeNode>) => {
    setDraftNode(prev => ({ ...prev, ...updates }));
  };

  const isRunning = node.status === 'executing' || node.status === 'decomposing';
  const canApprove = ['pending', 'failed'].includes(node.status);
  const canEdit = ['pending', 'approved', 'failed'].includes(node.status);

  const displayNode = editing ? draftNode : node;

  return (
    <div className="h-full flex flex-col bg-gray-800 overflow-hidden" data-testid="node-detail-panel">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-100 truncate" data-testid="node-name">
              {node.name}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={node.status} testId="node-status" />
              <span className={`text-xs px-1.5 py-0.5 rounded ${node.is_leaf ? 'bg-emerald-900 text-emerald-300' : 'bg-blue-900 text-blue-300'}`}>
                {node.is_leaf ? 'leaf' : 'orchestrator'}
              </span>
              <span className="text-xs text-gray-500" data-testid="node-depth">Depth: {node.depth}</span>
              <span className="text-xs text-gray-500">Model: {node.model}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {canEdit && !editing && (
              <button
                onClick={() => setEditing(true)}
                data-testid="edit-button"
                className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="save-button"
                  className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setDraftNode(node); setEditing(false); }}
                  data-testid="cancel-button"
                  className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {/* Timing info */}
        {(node.started_at || node.completed_at) && (
          <div className="text-xs text-gray-500 mt-1 flex gap-3">
            {node.started_at && <span>Started: {new Date(node.started_at).toLocaleString()}</span>}
            {node.completed_at && <span>Completed: {new Date(node.completed_at).toLocaleString()}</span>}
          </div>
        )}

        {/* Cost info */}
        {node.cost_usd > 0 && (
          <div className="text-xs text-gray-500 mt-1">
            Cost: ${node.cost_usd.toFixed(4)} · {node.input_tokens + node.output_tokens} tokens
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 py-2 border-b border-gray-700 flex gap-2 flex-wrap flex-shrink-0 bg-gray-900">
        {canApprove && (
          <button
            onClick={() => handleAction('approve', () => onApprove(node.id, !node.is_leaf))}
            disabled={!!actionLoading || isRunning}
            data-testid="approve-button"
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {actionLoading === 'approve'
              ? '...'
              : node.is_leaf
                ? '✓ Approve'
                : '🔱 Approve & Decompose'}
          </button>
        )}

        {isRunning && (
          <span data-testid="decomposing-indicator" className="text-xs px-3 py-1.5 text-yellow-300 bg-yellow-950 rounded font-medium animate-pulse">
            ⏳ {node.status === 'decomposing' ? 'Decomposing...' : 'Executing...'}
          </span>
        )}

        <button
          onClick={() => {
            if (confirm(`Delete node "${node.name}" and all its children?`)) {
              handleAction('delete', () => onDelete(node.id));
            }
          }}
          disabled={!!actionLoading || isRunning}
          className="ml-auto text-xs px-2 py-1.5 rounded border border-gray-700 text-gray-500 hover:bg-red-950 hover:text-red-400 hover:border-red-800 disabled:opacity-50"
        >
          🗑
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-4">
          {(['prompt', 'contracts', 'children'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-testid={`config-tab-${tab}`}
              className={`px-3 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab === 'contracts' ? `contracts (${(contracts || []).filter(c => c.provider === node.name || (c.consumers || []).includes(node.name)).length})` : tab}
              {tab === 'children' && ` (${children.length})`}
            </button>
          ))}
        </div>

        <div className="px-4 py-3" data-testid="tab-content">
          {activeTab === 'prompt' && (
            <div className="space-y-4">
              {/* Prompt */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Task Prompt</label>
                {editing ? (
                  <textarea
                    value={displayNode.prompt}
                    onChange={e => updateDraft({ prompt: e.target.value })}
                    rows={6}
                    className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono resize-y"
                  />
                ) : (
                  <div
                    className="text-sm text-gray-300 bg-gray-900 rounded px-3 py-2 whitespace-pre-wrap font-mono min-h-[4rem]"
                    data-testid="node-prompt"
                  >
                    {node.prompt || <span className="text-gray-600 italic">No prompt set</span>}
                  </div>
                )}
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Model</label>
                {editing ? (
                  <select
                    value={displayNode.model}
                    onChange={e => updateDraft({ model: e.target.value as TreeNode['model'] })}
                    className="text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="sonnet">sonnet</option>
                    <option value="haiku">haiku</option>
                    <option value="opus">opus</option>
                  </select>
                ) : (
                  <span className="text-sm text-gray-300">{node.model}</span>
                )}
              </div>

              {/* Acceptance Criteria */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Acceptance Criteria</label>
                {editing ? (
                  <textarea
                    value={displayNode.acceptance_criteria}
                    onChange={e => updateDraft({ acceptance_criteria: e.target.value })}
                    rows={3}
                    className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
                  />
                ) : (
                  <div className="text-sm text-gray-300 bg-gray-900 rounded px-2 py-1.5 whitespace-pre-wrap">
                    {node.acceptance_criteria || <span className="text-gray-600 italic">None set</span>}
                  </div>
                )}
              </div>

              {/* Leaf toggle */}
              {editing && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-400">Is Leaf Node</label>
                  <input
                    type="checkbox"
                    checked={displayNode.is_leaf}
                    onChange={e => updateDraft({ is_leaf: e.target.checked })}
                    className="rounded"
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'contracts' && (
            <div className="space-y-3">
              {/* Contracts provided */}
              <div>
                <label className="block text-xs font-medium text-green-400 mb-1">Contracts Provided</label>
                {editing ? (
                  <input
                    type="text"
                    value={displayNode.contracts_provided.join(', ')}
                    onChange={e => updateDraft({ contracts_provided: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="ContractA, ContractB"
                    className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {node.contracts_provided.length > 0
                      ? node.contracts_provided.map(c => (
                          <span key={c} className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded">{c}</span>
                        ))
                      : <span className="text-xs text-gray-600 italic">None</span>
                    }
                  </div>
                )}
              </div>

              {/* Contracts consumed */}
              <div>
                <label className="block text-xs font-medium text-blue-400 mb-1">Contracts Consumed</label>
                {editing ? (
                  <input
                    type="text"
                    value={displayNode.contracts_consumed.join(', ')}
                    onChange={e => updateDraft({ contracts_consumed: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="ContractA, ContractB"
                    className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {node.contracts_consumed.length > 0
                      ? node.contracts_consumed.map(c => (
                          <span key={c} className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded">{c}</span>
                        ))
                      : <span className="text-xs text-gray-600 italic">None</span>
                    }
                  </div>
                )}
              </div>

              {/* Project-level contracts */}
              {contracts && contracts.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-medium text-gray-400 mb-2">All Project Contracts</h4>
                  {contracts.map((c, i) => (
                    <div key={i} className="bg-gray-900 rounded p-2 mb-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-200">{c.name}</span>
                        <span className="text-xs text-gray-500">{c.type}</span>
                        <span className={`text-xs px-1 rounded ${c.status === 'locked' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-400'}`}>{c.status}</span>
                      </div>
                      {c.content && (
                        <pre className="text-xs text-gray-500 font-mono overflow-hidden max-h-12">
                          {c.content.slice(0, 150)}{c.content.length > 150 ? '...' : ''}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'children' && (
            <div className="space-y-2">
              {children.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  {!node.is_leaf && node.status === 'pending'
                    ? 'Approve & Decompose to generate children.'
                    : 'No child nodes.'}
                </p>
              ) : (
                children.map(child => (
                  <div
                    key={child.id}
                    className="flex items-center justify-between p-2 rounded border border-gray-700 text-sm"
                  >
                    <div>
                      <span className="font-medium text-gray-200">{child.name}</span>
                      <span className="ml-2 text-xs text-gray-500">{child.is_leaf ? 'leaf' : 'orchestrator'}</span>
                    </div>
                    <StatusBadge status={child.status} size="sm" />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
