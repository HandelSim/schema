/**
 * Project Store Service
 * File-based project storage. Each project lives at:
 *   {WORKSPACE_DIR}/{project-id}/project.json
 *
 * Uses proper-lockfile to prevent concurrent write races.
 * Uses chokidar to watch for changes and broadcast SSE updates.
 */
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import lockfile from 'proper-lockfile';
import { broadcastGlobal } from '../utils/sse';

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');

// Ensure workspace directory exists
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NodeRecord {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  status: 'pending' | 'approved' | 'decomposing' | 'executing' | 'completed' | 'failed';
  is_leaf: boolean;
  prompt: string;
  model: string;
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

export interface ProjectData {
  id: string;
  name: string;
  prompt: string;
  status: 'building' | 'tree_approved' | 'contexts_generated' | 'executing' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  project: ProjectData;
  nodes: NodeRecord[];
  contracts: ContractRecord[];
  stakeholder: StakeholderData;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function getProjectDir(projectId: string): string {
  return path.join(WORKSPACE_DIR, projectId);
}

export function getProjectFilePath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'project.json');
}

function defaultProjectFile(projectId: string, name: string, prompt: string): ProjectFile {
  const now = new Date().toISOString();
  const rootNodeId = uuidv4();
  return {
    project: {
      id: projectId,
      name,
      prompt,
      status: 'building',
      created_at: now,
      updated_at: now,
    },
    nodes: [{
      id: rootNodeId,
      parent_id: null,
      name,
      depth: 0,
      status: 'pending',
      is_leaf: false,
      prompt,
      model: (process.env.SCHEMA_MODEL as any) || 'sonnet',
      hooks: {},
      mcp_servers: {},
      subagents: {},
      acceptance_criteria: '',
      contracts_provided: [],
      contracts_consumed: [],
      session_id: null,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      started_at: null,
      completed_at: null,
    }],
    contracts: [],
    stakeholder: {
      clarifications: [],
      mockup_path: null,
      mockup_feedback: [],
      workflows: [],
      decisions: [],
    },
  };
}

// ─── Read / Write ──────────────────────────────────────────────────────────

export function readProjectFile(projectId: string): ProjectFile {
  const filePath = getProjectFilePath(projectId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Project ${projectId} not found`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ProjectFile;
}

export function writeProjectFile(projectId: string, data: ProjectFile): void {
  const filePath = getProjectFilePath(projectId);
  data.project.updated_at = new Date().toISOString();
  const content = JSON.stringify(data, null, 2);

  // Atomic write: write to temp file then rename
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);

  // Broadcast update to SSE clients
  broadcastGlobal('project:updated', { project: data.project });
}

/**
 * Update project.json with a lock to prevent concurrent write races.
 */
export async function updateProjectFile(
  projectId: string,
  updater: (data: ProjectFile) => ProjectFile
): Promise<ProjectFile> {
  const filePath = getProjectFilePath(projectId);
  let release: (() => Promise<void>) | null = null;

  try {
    release = await lockfile.lock(filePath, { retries: { retries: 5, minTimeout: 100 } });
    const data = readProjectFile(projectId);
    const updated = updater(data);
    writeProjectFile(projectId, updated);
    return updated;
  } finally {
    if (release) {
      await release().catch(() => {});
    }
  }
}

// ─── Project CRUD ──────────────────────────────────────────────────────────

export function listProjects(): ProjectData[] {
  if (!fs.existsSync(WORKSPACE_DIR)) return [];

  const entries = fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true });
  const projects: ProjectData[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(WORKSPACE_DIR, entry.name, 'project.json');
    if (!fs.existsSync(filePath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ProjectFile;
      projects.push(data.project);
    } catch {
      // Skip malformed project files
    }
  }

  // Sort by created_at descending
  return projects.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function createProject(name: string, prompt: string): ProjectFile {
  const projectId = uuidv4();
  const projectDir = getProjectDir(projectId);

  fs.mkdirSync(projectDir, { recursive: true });

  const data = defaultProjectFile(projectId, name, prompt);
  writeProjectFile(projectId, data);

  // Write the Blacksmith's CLAUDE.md
  writeBlacksmithClaudeMd(projectId, name, prompt);

  // Initialize session files
  const sessionFile = path.join(projectDir, 'blacksmith-session.json');
  const sessionData: BlacksmithSession = {
    session_id: null,
    project_id: projectId,
    last_resumed_at: new Date().toISOString(),
    total_cost_usd: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
  };
  fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf-8');

  const historyFile = path.join(projectDir, 'blacksmith-history.json');
  const historyData: BlacksmithHistory = {
    project_id: projectId,
    created_at: new Date().toISOString(),
    messages: [],
  };
  fs.writeFileSync(historyFile, JSON.stringify(historyData, null, 2), 'utf-8');

  broadcastGlobal('project:created', { project: data.project });
  return data;
}

export function getProject(projectId: string): ProjectFile {
  return readProjectFile(projectId);
}

export function deleteProject(projectId: string): void {
  const projectDir = getProjectDir(projectId);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  broadcastGlobal('project:deleted', { projectId });
}

// ─── Node Operations ───────────────────────────────────────────────────────

export function getNode(projectId: string, nodeId: string): NodeRecord | undefined {
  const data = readProjectFile(projectId);
  return data.nodes.find(n => n.id === nodeId);
}

export function createNode(projectId: string, node: NodeRecord): NodeRecord {
  const data = readProjectFile(projectId);
  data.nodes.push(node);
  writeProjectFile(projectId, data);
  broadcastGlobal('node:created', { node });
  return node;
}

export async function updateNode(
  projectId: string,
  nodeId: string,
  updates: Partial<NodeRecord>
): Promise<NodeRecord> {
  const updated = await updateProjectFile(projectId, (data) => {
    const idx = data.nodes.findIndex(n => n.id === nodeId);
    if (idx === -1) throw new Error(`Node ${nodeId} not found in project ${projectId}`);
    data.nodes[idx] = { ...data.nodes[idx], ...updates };
    return data;
  });
  const node = updated.nodes.find(n => n.id === nodeId)!;
  broadcastGlobal('node:updated', { node });
  return node;
}

export async function setNodeStatus(
  projectId: string,
  nodeId: string,
  status: NodeRecord['status']
): Promise<NodeRecord> {
  return updateNode(projectId, nodeId, { status });
}

// ─── Tree Query ────────────────────────────────────────────────────────────

export function getProjectTree(projectId: string): {
  project: ProjectData;
  nodes: NodeRecord[];
  contracts: ContractRecord[];
  mockup_path: string | null;
} {
  const data = readProjectFile(projectId);
  return {
    project: data.project,
    nodes: data.nodes,
    contracts: data.contracts,
    mockup_path: data.stakeholder?.mockup_path || null,
  };
}

// ─── Blacksmith History ────────────────────────────────────────────────────

export interface BlacksmithMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  trigger?: string;
  tool_uses?: { tool: string; input: string; output: string }[];
  decomposition_result?: boolean;
}

export interface BlacksmithHistory {
  project_id: string;
  created_at: string;
  messages: BlacksmithMessage[];
}

export interface BlacksmithSession {
  session_id: string | null;
  project_id: string;
  last_resumed_at: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export function readBlacksmithHistory(projectId: string): BlacksmithHistory {
  const filePath = path.join(getProjectDir(projectId), 'blacksmith-history.json');
  if (!fs.existsSync(filePath)) {
    return { project_id: projectId, created_at: new Date().toISOString(), messages: [] };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BlacksmithHistory;
}

export function appendBlacksmithMessage(projectId: string, message: Omit<BlacksmithMessage, 'id'>): BlacksmithMessage {
  const filePath = path.join(getProjectDir(projectId), 'blacksmith-history.json');
  let history: BlacksmithHistory;
  if (fs.existsSync(filePath)) {
    history = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BlacksmithHistory;
  } else {
    history = { project_id: projectId, created_at: new Date().toISOString(), messages: [] };
  }
  const msg: BlacksmithMessage = { ...message, id: uuidv4() };
  history.messages.push(msg);
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
  return msg;
}

export function readBlacksmithSession(projectId: string): BlacksmithSession {
  const filePath = path.join(getProjectDir(projectId), 'blacksmith-session.json');
  if (!fs.existsSync(filePath)) {
    return {
      session_id: null,
      project_id: projectId,
      last_resumed_at: new Date().toISOString(),
      total_cost_usd: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BlacksmithSession;
}

export function writeBlacksmithSession(projectId: string, session: BlacksmithSession): void {
  const filePath = path.join(getProjectDir(projectId), 'blacksmith-session.json');
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

// ─── Blacksmith CLAUDE.md ──────────────────────────────────────────────────

export function writeBlacksmithClaudeMd(projectId: string, projectName: string, prompt: string): void {
  const projectDir = getProjectDir(projectId);
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');

  const content = `# Blacksmith — Lead Project Architect

You are Blacksmith, the lead architect for the SCHEMA project management system.
Your role is to interview stakeholders, understand their vision, and decompose
projects into executable agent trees.

## Current Project
- **Name:** ${projectName}
- **ID:** ${projectId}
- **Location:** ${projectDir}

## Your Operating Instructions

### Phase 1: Stakeholder Interview
When a new project is created, conduct a thorough stakeholder interview:
1. Introduce yourself briefly
2. Ask 3-5 clarifying questions about:
   - Target users and their needs
   - Core features and MVP scope
   - Tech stack preferences (or offer recommendations)
   - Performance/scale requirements
   - Known constraints or non-starters
3. Record answers by updating \`project.json\` stakeholder.clarifications

### Phase 2: Mockup Generation
After gathering requirements:
1. Generate an HTML mockup of the main UI/UX
2. Save it as \`${projectDir}/mockup.html\`
3. Update \`project.json\` stakeholder.mockup_path to \`"${projectDir}/mockup.html"\`
4. Ask for feedback: "Does this capture your vision? What would you change?"

### Phase 3: Mockup Feedback
1. Address feedback and update mockup.html if needed
2. Record the exchange in stakeholder.mockup_feedback

### Phase 4: Workflow Documentation
Document the key user workflows:
1. List the primary user journeys (3-5 workflows)
2. For each workflow, break into steps with: action, target element, expected result
3. Ask stakeholder to confirm each workflow
4. Record approved workflows in stakeholder.workflows

### Phase 5: Root Decomposition
When the stakeholder approves the workflows, decompose the root node:
1. Design the top-level architecture (5-8 components maximum)
2. Output a JSON decomposition block (see format below)
3. The server will parse this and create child nodes

## project.json Schema

The full project file lives at \`${projectDir}/project.json\`.
You can read and write it directly.

\`\`\`typescript
interface ProjectFile {
  project: {
    id: string;          // "${projectId}"
    name: string;        // "${projectName}"
    prompt: string;      // original user request
    status: "building" | "tree_approved" | "contexts_generated" | "executing" | "completed";
    created_at: string;
    updated_at: string;
  };
  nodes: NodeRecord[];
  contracts: ContractRecord[];
  stakeholder: {
    clarifications: { question: string; answer: string; timestamp: string; }[];
    mockup_path: string | null;
    mockup_feedback: { feedback: string; resolution: string; timestamp: string; }[];
    workflows: WorkflowRecord[];
    decisions: { topic: string; decision: string; reasoning: string; timestamp: string; }[];
  };
}

interface NodeRecord {
  id: string;
  parent_id: string | null;
  name: string;          // lowercase-with-hyphens (becomes folder name)
  depth: number;
  status: "pending" | "approved" | "decomposing" | "executing" | "completed" | "failed";
  is_leaf: boolean;
  prompt: string;
  model: string;         // "sonnet" | "haiku" | "opus"
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

interface ContractRecord {
  name: string;
  type: "typescript" | "openapi" | "graphql";
  provider: string;
  consumers: string[];
  content: string;
  version: number;
  status: "draft" | "locked";
}
\`\`\`

## Node Naming Convention
- Node names MUST be lowercase-with-hyphens (e.g., "api-server", "auth-service")
- They become directory names in the project workspace
- Children of a node live inside that node's folder

## Decomposition JSON Format
When you decompose a node, output a JSON block wrapped in \`\`\`json markers:

\`\`\`json
{
  "decomposition": {
    "parent_node_id": "<the node ID being decomposed>",
    "components": {
      "component-name": {
        "prompt": "Detailed task description",
        "is_leaf": true,
        "model": "sonnet",
        "acceptance_criteria": "Measurable completion criteria",
        "contracts_provided": ["ContractName"],
        "contracts_consumed": ["OtherContract"]
      }
    },
    "contracts": {
      "ContractName": {
        "type": "typescript",
        "provider": "component-name",
        "consumers": ["other-component"],
        "content": "export interface ContractName { ... }"
      }
    }
  }
}
\`\`\`

## Non-Root Decompositions
When asked to decompose a non-root node (not the root):
1. Ask 1-2 focused questions about that specific component
2. Decompose it immediately (don't do the full interview)
3. Create 3-5 focused child nodes

## Workspace
Your workspace is \`${projectDir}/\`. Focus your work here.
`;

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
}

// ─── Mockup ────────────────────────────────────────────────────────────────

export function getMockupPath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'mockup.html');
}

export function readMockup(projectId: string): string | null {
  const mockupPath = getMockupPath(projectId);
  if (!fs.existsSync(mockupPath)) return null;
  return fs.readFileSync(mockupPath, 'utf-8');
}
