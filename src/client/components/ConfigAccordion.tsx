/**
 * ConfigAccordion - Collapsible configuration panels for node settings.
 * Organizes the many configuration options into digestible sections.
 */
import React, { useState } from 'react';
import { TreeNode, HookConfig, ModelType } from '../types';
import { HookTemplates } from './HookTemplates';

interface AccordionSectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({ title, count, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-900 hover:bg-gray-800 text-left"
      >
        <span className="text-sm font-medium text-gray-300">{title}</span>
        <div className="flex items-center gap-2">
          {count !== undefined && (
            <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">{count}</span>
          )}
          <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <div className="p-3 border-t border-gray-700">{children}</div>}
    </div>
  );
};

interface ConfigAccordionProps {
  node: TreeNode;
  onUpdate: (updates: Partial<TreeNode>) => void;
  readOnly?: boolean;
}

export const ConfigAccordion: React.FC<ConfigAccordionProps> = ({ node, onUpdate, readOnly = false }) => {
  const handleArrayChange = (field: keyof TreeNode, value: string) => {
    try {
      const parsed = value.split('\n').map(s => s.trim()).filter(Boolean);
      onUpdate({ [field]: parsed });
    } catch {
      // ignore
    }
  };

  const handleHooksChange = (value: string) => {
    try {
      const parsed = JSON.parse(value) as HookConfig;
      onUpdate({ hooks: parsed });
    } catch {
      // Don't update if invalid JSON
    }
  };

  return (
    <div className="space-y-2">
      {/* Model selector */}
      <AccordionSection title="Model & Execution" defaultOpen>
        <div className="space-y-3">
          {/* is_leaf checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={node.node_type === 'leaf'}
              onChange={e => !readOnly && onUpdate({ node_type: e.target.checked ? 'leaf' : 'orchestrator' })}
              disabled={readOnly}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 disabled:opacity-50"
            />
            <span className="text-xs font-medium text-gray-400">
              Leaf node (executes directly, no decomposition)
            </span>
          </label>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Model</label>
            <select
              value={node.model}
              onChange={e => !readOnly && onUpdate({ model: e.target.value as ModelType })}
              disabled={readOnly}
              className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-800 disabled:text-gray-400"
            >
              <option value="sonnet">Claude Sonnet 4 (Balanced)</option>
              <option value="haiku">Claude Haiku 4.5 (Fast, Cheap)</option>
              <option value="opus">Claude Opus 4.5 (Most Capable)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Max Iterations</label>
              <input
                type="number"
                value={node.max_iterations}
                onChange={e => !readOnly && onUpdate({ max_iterations: parseInt(e.target.value) || 10 })}
                min={1} max={100}
                disabled={readOnly}
                className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-800 disabled:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Escalation Policy</label>
              <select
                value={node.escalation_policy}
                onChange={e => !readOnly && onUpdate({ escalation_policy: e.target.value as TreeNode['escalation_policy'] })}
                disabled={readOnly}
                className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-800 disabled:text-gray-400"
              >
                <option value="ask_human">Ask Human</option>
                <option value="auto_retry">Auto Retry</option>
                <option value="fail">Fail Fast</option>
              </select>
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* Acceptance Criteria */}
      <AccordionSection title="Acceptance Criteria">
        <textarea
          value={node.acceptance_criteria || ''}
          onChange={e => !readOnly && onUpdate({ acceptance_criteria: e.target.value })}
          readOnly={readOnly}
          placeholder="Define measurable completion criteria..."
          rows={4}
          className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y disabled:bg-gray-800 disabled:text-gray-400 placeholder-gray-600"
        />
      </AccordionSection>

      {/* File Boundaries */}
      <AccordionSection title="File Boundaries" count={node.allowed_paths.length}>
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-500">One path per line. Agent can only read/write these paths.</p>
          <textarea
            value={node.allowed_paths.join('\n')}
            onChange={e => !readOnly && handleArrayChange('allowed_paths', e.target.value)}
            readOnly={readOnly}
            placeholder="src/components/&#10;src/utils/&#10;tests/"
            rows={3}
            className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y disabled:bg-gray-800 disabled:text-gray-400 placeholder-gray-600"
          />
        </div>
      </AccordionSection>

      {/* Allowed Tools */}
      <AccordionSection title="Allowed Tools" count={node.allowed_tools.length}>
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-500">One tool per line.</p>
          <textarea
            value={node.allowed_tools.join('\n')}
            onChange={e => !readOnly && handleArrayChange('allowed_tools', e.target.value)}
            readOnly={readOnly}
            placeholder="Read&#10;Write&#10;Edit&#10;Bash&#10;Grep&#10;Glob"
            rows={4}
            className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y disabled:bg-gray-800 disabled:text-gray-400 placeholder-gray-600"
          />
        </div>
      </AccordionSection>

      {/* Dependencies */}
      <AccordionSection title="Dependencies" count={node.dependencies.length}>
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-500">Sibling node names this node depends on (one per line).</p>
          <textarea
            value={node.dependencies.join('\n')}
            onChange={e => !readOnly && handleArrayChange('dependencies', e.target.value)}
            readOnly={readOnly}
            placeholder="database-schema&#10;api-types"
            rows={3}
            className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y disabled:bg-gray-800 disabled:text-gray-400 placeholder-gray-600"
          />
        </div>
      </AccordionSection>

      {/* Hooks */}
      <AccordionSection title="Hooks (JSON)">
        <div className="space-y-2">
          {!readOnly && (
            <HookTemplates
              currentHooks={node.hooks}
              onApply={hooks => onUpdate({ hooks })}
            />
          )}
          <textarea
            value={JSON.stringify(node.hooks || {}, null, 2)}
            onChange={e => !readOnly && handleHooksChange(e.target.value)}
            readOnly={readOnly}
            rows={6}
            className="w-full text-xs border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y disabled:bg-gray-800 disabled:text-gray-400"
          />
        </div>
      </AccordionSection>

      {/* MCP Tools */}
      <AccordionSection title="MCP Tools" count={node.mcp_tools.length}>
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-500">MCP server configurations in JSON array format.</p>
          <textarea
            value={JSON.stringify(node.mcp_tools, null, 2)}
            onChange={e => {
              if (readOnly) return;
              try {
                const parsed = JSON.parse(e.target.value);
                onUpdate({ mcp_tools: parsed });
              } catch { /* ignore */ }
            }}
            readOnly={readOnly}
            rows={4}
            className="w-full text-xs border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y disabled:bg-gray-800 disabled:text-gray-400"
          />
        </div>
      </AccordionSection>

      {/* Context Files */}
      <AccordionSection title="Context Files" count={node.context_files.length}>
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-500">Files copied into workspace for reference (one per line).</p>
          <textarea
            value={node.context_files.join('\n')}
            onChange={e => !readOnly && handleArrayChange('context_files', e.target.value)}
            readOnly={readOnly}
            placeholder="/app/docs/api-spec.md&#10;/app/src/types.ts"
            rows={3}
            className="w-full text-sm border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y disabled:bg-gray-800 disabled:text-gray-400 placeholder-gray-600"
          />
        </div>
      </AccordionSection>
    </div>
  );
};
