/**
 * Shared TypeScript type definitions for the SCHEMA frontend.
 * These mirror the project.json schema and API response shapes.
 */

export type NodeStatus =
  | 'pending'
  | 'approved'
  | 'decomposing'
  | 'executing'
  | 'completed'
  | 'failed';

export type ProjectStatus =
  | 'building'
  | 'tree_approved'
  | 'contexts_generated'
  | 'executing'
  | 'completed';

export type ModelType = 'sonnet' | 'haiku' | 'opus';

export interface HookCommand {
  type: 'command';
  command: string;
}

export interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}

export interface HookConfig {
  PreToolUse?: HookMatcher[];
  PostToolUse?: HookMatcher[];
}

export interface MCPTool {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface TreeNode {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  status: NodeStatus;
  is_leaf: boolean;
  prompt: string;
  model: ModelType;
  hooks: Record<string, any>;
  mcp_servers: Record<string, any>;
  subagents: Record<string, any>;
  acceptance_criteria: string;
  contracts_provided: string[];
  contracts_consumed: string[];
  session_id: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface ContractRecord {
  name: string;
  type: 'typescript' | 'openapi' | 'graphql';
  provider: string;
  consumers: string[];
  content: string;
  version: number;
  status: 'draft' | 'locked';
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  steps: {
    action: string;
    target: string;
    value?: string;
    expected: string;
  }[];
  approved: boolean;
  stakeholder_feedback: string | null;
  timestamp: string;
}

export interface StakeholderData {
  clarifications: { question: string; answer: string; timestamp: string }[];
  mockup_path: string | null;
  mockup_feedback: { feedback: string; resolution: string; timestamp: string }[];
  workflows: WorkflowRecord[];
  decisions: { topic: string; decision: string; reasoning: string; timestamp: string }[];
}

export interface ProjectFile {
  project: {
    id: string;
    name: string;
    prompt: string;
    status: ProjectStatus;
    created_at: string;
    updated_at: string;
  };
  nodes: TreeNode[];
  contracts: ContractRecord[];
  stakeholder: StakeholderData;
}

export interface Project {
  id: string;
  name: string;
  prompt: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Contract {
  name: string;
  type: 'typescript' | 'openapi' | 'graphql';
  provider: string;
  consumers: string[];
  content: string;
  version: number;
  status: 'draft' | 'locked';
}

export interface TreeData {
  project: Project;
  nodes: TreeNode[];
  contracts: ContractRecord[];
}

// Blacksmith message types
export interface BlacksmithMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  trigger?: string;
  tool_uses?: { tool: string; input: string; output: string }[];
  decomposition_result?: boolean;
}

export type BlacksmithStatus = 'idle' | 'thinking' | 'decomposing';

export interface BlacksmithEvent {
  type: 'text' | 'tool_use' | 'done' | 'error';
  content?: string;
  tool?: string;
  error?: string;
}

// For React Flow graph nodes
export interface FlowNodeData {
  node: TreeNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}

// SSE event payloads
export type SSEEvent =
  | { type: 'node:status'; nodeId: string; status: NodeStatus }
  | { type: 'node:created'; node: TreeNode }
  | { type: 'node:updated'; node: TreeNode }
  | { type: 'node:deleted'; nodeId: string }
  | { type: 'log:output'; message: string; timestamp: string }
  | { type: 'log:error'; message: string; timestamp: string }
  | { type: 'log:complete'; status: string; exitCode?: number }
  | { type: 'log:history'; message: string }
  | { type: 'connected'; clientId: string }
  | { type: 'project:created'; project: Project }
  | { type: 'project:updated'; project: Project }
  | { type: 'blacksmith:text'; content: string }
  | { type: 'blacksmith:tool_use'; tool: string }
  | { type: 'blacksmith:done' }
  | { type: 'blacksmith:error'; error: string };

export interface LogEntry {
  id: string;
  message: string;
  timestamp: string;
  type: 'output' | 'error' | 'system' | 'history';
}
