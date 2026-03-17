/**
 * App - Main application shell with three-panel layout.
 * Left: project list, Center: Tree/Mockup/Node Detail tabs, Right: Blacksmith/Logs tabs.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useTree } from './hooks/useTree';
import { TreeGraph } from './components/TreeGraph';
import { NodeDetail } from './components/NodeDetail';
import { ExecutionLog } from './components/ExecutionLog';
import { BlacksmithTerminal } from './components/BlacksmithTerminal';
import { Project } from './types';

// ============================================================
// Project Creation Modal
// ============================================================
interface CreateProjectModalProps {
  onClose: () => void;
  onCreate: (name: string, prompt: string) => Promise<void>;
}

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;
    setLoading(true);
    try {
      await onCreate(name, prompt);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700">
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">Create New Project</h2>
          <p className="text-sm text-gray-400 mt-1">Define the root node — Blacksmith will help you design and decompose it.</p>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Project Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. E-commerce Platform v2"
              required
              data-testid="project-name-input"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Project Prompt *</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Be as descriptive as possible — include tech stack, constraints, and end goals."
              rows={6}
              required
              data-testid="project-prompt-input"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading || !name.trim() || !prompt.trim()}
              data-testid="create-project-submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="cancel-button"
              className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================
// Project Selector Sidebar
// ============================================================
interface ProjectSidebarProps {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({ projects, selectedId, onSelect, onCreate }) => (
  <div className="h-full flex flex-col bg-gray-900 text-white">
    <div className="px-3 py-3 border-b border-gray-700">
      <div className="flex items-center justify-between">
        <h1 className="text-xs font-bold text-white tracking-wide leading-tight">
          Project Orchestrator
        </h1>
        <button
          onClick={onCreate}
          data-testid="create-project-button"
          className="text-xs px-2 py-1 bg-blue-600 rounded hover:bg-blue-700 text-white"
        >
          + New
        </button>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto py-2" data-testid="project-list">
      {projects.length === 0 ? (
        <div className="px-3 py-4 text-center" data-testid="empty-state">
          <p className="text-xs text-gray-500">No projects yet</p>
          <button onClick={onCreate} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
            Create your first project →
          </button>
        </div>
      ) : (
        projects.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            data-testid="project-list-item"
            data-project-id={p.id}
            className={`w-full text-left px-3 py-2.5 hover:bg-gray-800 transition-colors ${
              selectedId === p.id ? 'bg-gray-800 border-l-2 border-blue-400' : ''
            }`}
          >
            <div className="text-sm font-medium text-gray-200 truncate">{p.name}</div>
            <div className="text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString()}</div>
          </button>
        ))
      )}
    </div>
  </div>
);

// ============================================================
// Main App
// ============================================================
type CenterTab = 'tree' | 'mockup' | 'node-detail';
type RightTab = 'blacksmith' | 'logs';

export default function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [centerTab, setCenterTab] = useState<CenterTab>('tree');
  const [rightTab, setRightTab] = useState<RightTab>('blacksmith');
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const [generatingContexts, setGeneratingContexts] = useState(false);

  // Load projects on mount
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data: { projects: Project[] }) => {
        setProjects(data.projects || []);
        if (data.projects?.length > 0 && !selectedProjectId) {
          setSelectedProjectId(data.projects[0].id);
        }
      })
      .catch(console.error);
  }, []);

  const tree = useTree(selectedProjectId);
  // Derive selected node directly from tree data (no extra API call needed)
  const selectedNode = tree.nodes.find(n => n.id === tree.selectedNodeId) ?? null;
  const nodeLogs = tree.logs; // reuse tree logs for execution log panel
  const clearLogs = tree.clearLogs;

  // Sync auto_mode from project data
  useEffect(() => {
    if (tree.project) {
      setAutoMode(tree.project.auto_mode ?? false);
    }
  }, [tree.project]);

  const handleSelectNode = useCallback((nodeId: string) => {
    tree.setSelectedNodeId(nodeId);
    setCenterTab('node-detail');
  }, [tree]);

  const handleApproveNode = useCallback(async (nodeId: string, decompose: boolean) => {
    await tree.approveNode(nodeId, decompose);
    if (decompose) {
      // Switch to tree so user can watch nodes appear, and show Blacksmith panel
      // so they see the decomposition conversation in real time.
      setCenterTab('tree');
      setRightTab('blacksmith');
    }
  }, [tree]);

  const handleCreateProject = useCallback(async (name: string, prompt: string) => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: prompt }),
    });
    if (!response.ok) throw new Error((await response.json() as { error: string }).error);
    const data = await response.json() as { project: Project; rootNode?: { id: string } };
    setProjects(prev => [data.project, ...prev]);
    setSelectedProjectId(data.project.id);
    setCenterTab('tree');
    setRightTab('blacksmith');
  }, []);

  const handleSelectProject = useCallback((id: string) => {
    setSelectedProjectId(id);
    tree.setSelectedNodeId(null);
    setCenterTab('tree');
    setGeneratedFiles([]);
  }, [tree]);

  const handleGenerateContexts = useCallback(async () => {
    setGeneratingContexts(true);
    try {
      const result = await tree.generateContexts();
      setGeneratedFiles(result.generatedFiles);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate contexts');
    } finally {
      setGeneratingContexts(false);
    }
  }, [tree]);

  const handleStartExecution = useCallback(async () => {
    try {
      await tree.startExecution();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start execution');
    }
  }, [tree]);

  const handleToggleAutoMode = useCallback(async () => {
    if (!selectedProjectId) return;
    const newValue = !autoMode;
    setAutoMode(newValue);
    // Persist to project
    try {
      await fetch(`/api/projects/${selectedProjectId}/auto-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_mode: newValue }),
      });
    } catch {
      // Non-critical, just track locally
    }
  }, [selectedProjectId, autoMode]);

  const allLogs = tree.logs;

  const hasMockup = tree.hasMockup;

  return (
    <div className="h-screen flex overflow-hidden bg-gray-950 font-sans">
      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateProject}
        />
      )}

      {/* Left: Project sidebar */}
      <div className="w-44 flex-shrink-0 border-r border-gray-800">
        <ProjectSidebar
          projects={projects}
          selectedId={selectedProjectId}
          onSelect={handleSelectProject}
          onCreate={() => setShowCreateModal(true)}
        />
      </div>

      {/* Center: Tabbed main panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Center tab bar */}
        <div className="h-10 flex items-center gap-0 px-0 bg-gray-900 border-b border-gray-700 flex-shrink-0">
          {tree.project && (
            <span className="text-sm font-semibold text-gray-200 truncate px-4 max-w-[180px]">
              {tree.project.name}
            </span>
          )}
          <div className="flex border-b-0 ml-auto">
            <button
              onClick={() => setCenterTab('tree')}
              data-testid="center-tab-tree"
              className={`text-xs px-4 py-2.5 border-b-2 transition-colors ${
                centerTab === 'tree'
                  ? 'border-blue-500 text-blue-400 bg-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              Tree
            </button>
            {hasMockup && (
              <button
                onClick={() => setCenterTab('mockup')}
                data-testid="center-tab-mockup"
                className={`text-xs px-4 py-2.5 border-b-2 transition-colors ${
                  centerTab === 'mockup'
                    ? 'border-blue-500 text-blue-400 bg-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                Mockup
              </button>
            )}
            <button
              onClick={() => setCenterTab('node-detail')}
              data-testid="center-tab-node-detail"
              disabled={!tree.selectedNodeId}
              className={`text-xs px-4 py-2.5 border-b-2 transition-colors disabled:opacity-40 ${
                centerTab === 'node-detail'
                  ? 'border-blue-500 text-blue-400 bg-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              Node Detail
            </button>
          </div>
          {tree.project && (
            <div className="flex items-center gap-2 px-3">
              <span className="text-xs text-gray-500">
                {tree.nodes.length} nodes · {tree.nodes.filter(n => n.status === 'completed').length} done
              </span>
              {/* Auto-mode toggle */}
              <label className="flex items-center gap-1 cursor-pointer" title="Auto Mode: automatically execute after context generation">
                <input
                  type="checkbox"
                  checked={autoMode}
                  onChange={handleToggleAutoMode}
                  data-testid="auto-mode-toggle"
                  className="w-3 h-3 accent-blue-500"
                />
                <span className="text-xs text-gray-400">Auto</span>
              </label>
              {/* Generate Contexts button */}
              {(tree.project.status === 'building' || tree.project.status === 'tree_approved') && tree.nodes.length > 0 && (
                <button
                  onClick={handleGenerateContexts}
                  disabled={generatingContexts}
                  data-testid="generate-contexts-button"
                  className="text-xs px-2 py-1 rounded bg-purple-700 text-white hover:bg-purple-600 disabled:opacity-50"
                >
                  {generatingContexts ? 'Generating...' : 'Generate Agent Contexts'}
                </button>
              )}
              {/* Start Execution button */}
              {tree.project.status === 'contexts_generated' && (
                <button
                  onClick={handleStartExecution}
                  data-testid="start-execution-button"
                  className="text-xs px-2 py-1 rounded bg-green-700 text-white hover:bg-green-600"
                >
                  Start Execution
                </button>
              )}
              <button
                onClick={tree.refreshTree}
                className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:bg-gray-800"
              >
                ↻
              </button>
            </div>
          )}
        </div>

        {/* Center content */}
        <div className="flex-1 overflow-hidden relative">
          {tree.loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10" data-testid="loading-indicator">
              <div className="text-sm text-gray-400 animate-pulse">Loading tree...</div>
            </div>
          )}

          {tree.error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-950 border border-red-800 rounded-lg p-3 z-10" data-testid="error-display">
              <p className="text-sm text-red-400">{tree.error}</p>
            </div>
          )}

          {!selectedProjectId ? (
            <div className="h-full flex items-center justify-center text-center" data-testid="empty-state">
              <div>
                <div className="text-4xl mb-4">🌳</div>
                <h3 className="text-lg font-semibold text-gray-300">Agent Tree Orchestrator</h3>
                <p className="text-sm text-gray-500 mt-2 max-w-sm">
                  Recursively decompose projects into AI agent trees.
                  Create a project to get started.
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  Create First Project
                </button>
              </div>
            </div>
          ) : centerTab === 'tree' ? (
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0 relative">
                <TreeGraph
                  nodes={tree.nodes}
                  selectedNodeId={tree.selectedNodeId}
                  onSelectNode={handleSelectNode}
                />
                {tree.nodes.length === 0 && !tree.loading && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <p className="text-sm text-gray-500">No nodes yet. Use Blacksmith to design your project.</p>
                    </div>
                  </div>
                )}
              </div>
              {/* Review Contexts Panel - shown when contexts have been generated */}
              {(generatedFiles.length > 0 || tree.project?.status === 'contexts_generated') && (
                <div
                  data-testid="review-contexts-panel"
                  className="border-t border-gray-700 bg-gray-900 p-3 max-h-40 overflow-y-auto flex-shrink-0"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-purple-400">Agent Context Files</span>
                    <span className="text-xs text-gray-500">{generatedFiles.length} files generated</span>
                  </div>
                  {generatedFiles.length > 0 && (
                    <ul data-testid="context-file-tree" className="space-y-0.5">
                      {generatedFiles.map((filePath, idx) => (
                        <li key={idx} className="text-xs text-gray-400 font-mono truncate" title={filePath}>
                          {filePath}
                        </li>
                      ))}
                    </ul>
                  )}
                  {generatedFiles.length === 0 && tree.project?.status === 'contexts_generated' && (
                    <p className="text-xs text-gray-500">Contexts previously generated. Refresh to see files.</p>
                  )}
                </div>
              )}
            </div>
          ) : centerTab === 'mockup' ? (
            <div className="h-full">
              <iframe
                src={`/api/projects/${selectedProjectId}/mockup`}
                className="w-full h-full border-0"
                title="Project Mockup"
                data-testid="mockup-iframe"
              />
            </div>
          ) : centerTab === 'node-detail' ? (
            selectedNode ? (
              <NodeDetail
                node={selectedNode}
                allNodes={tree.nodes}
                contracts={tree.contracts}
                onApprove={handleApproveNode}
                onReject={tree.rejectNode}
                onExecute={tree.executeNode}
                onVerify={tree.verifyNode}
                onUpdate={tree.updateNode}
                onDelete={tree.deleteNode}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-gray-500 animate-pulse">
                  {tree.selectedNodeId ? 'Loading node...' : 'Select a node from the tree'}
                </p>
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Right: Blacksmith / Logs tabs */}
      <div className="w-80 flex-shrink-0 border-l border-gray-800 flex flex-col">
        {/* Right tab bar */}
        <div className="h-10 flex items-center bg-gray-900 border-b border-gray-700 flex-shrink-0">
          <button
            onClick={() => setRightTab('blacksmith')}
            data-testid="right-panel-tab-blacksmith"
            className={`flex-1 text-xs py-2.5 border-b-2 transition-colors ${
              rightTab === 'blacksmith'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            Blacksmith
          </button>
          <button
            onClick={() => setRightTab('logs')}
            data-testid="right-panel-tab-logs"
            className={`flex-1 text-xs py-2.5 border-b-2 transition-colors ${
              rightTab === 'logs'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            Logs
            {allLogs.length > 0 && (
              <span className="ml-1 text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full">
                {allLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Right content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {rightTab === 'blacksmith' ? (
            <BlacksmithTerminal projectId={selectedProjectId} />
          ) : (
            <ExecutionLog
              logs={allLogs}
              onClear={() => { tree.clearLogs(); clearLogs(); }}
              title={tree.selectedNodeId ? `Logs: ${selectedNode?.name || '...'}` : 'System Logs'}
            />
          )}
        </div>
      </div>
    </div>
  );
}
