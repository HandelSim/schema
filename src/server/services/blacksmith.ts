/**
 * Blacksmith Service
 * Persistent Claude Agent SDK architect that manages one active project session.
 * Handles stakeholder interviews, mockup generation, and node decomposition.
 */
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  readProjectFile,
  writeProjectFile,
  readBlacksmithHistory,
  appendBlacksmithMessage,
  readBlacksmithSession,
  writeBlacksmithSession,
  getProjectDir,
  updateProjectFile,
  NodeRecord,
  ContractRecord,
  BlacksmithSession,
} from './project-store';
import { broadcastGlobal } from '../utils/sse';

// Import the Claude Agent SDK query function.
// Must use new Function to prevent TypeScript from compiling dynamic import()
// to require(), which fails for ESM-only packages like claude-agent-sdk.
let queryFn: any = null;
async function getQuery() {
  if (!queryFn) {
    try {
      const dynamicImport = new Function('m', 'return import(m)');
      const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
      queryFn = sdk.query;
      console.log('[Blacksmith] Claude Agent SDK loaded, model:', process.env.SCHEMA_MODEL || 'sonnet');
    } catch (e) {
      console.warn('[Blacksmith] Claude Agent SDK not available:', (e as Error).message);
    }
  }
  return queryFn;
}

export type BlacksmithStatus = 'idle' | 'thinking' | 'decomposing';

export interface BlacksmithEvent {
  type: 'text' | 'tool_use' | 'done' | 'error';
  content?: string;
  tool?: string;
  error?: string;
}

/**
 * Main Blacksmith service — manages one active Claude Agent SDK session per project.
 */
class BlacksmithService {
  private currentProjectId: string | null = null;
  private currentProjectPath: string | null = null;
  private sessionId: string | null = null;
  private status: BlacksmithStatus = 'idle';

  getStatus(): BlacksmithStatus {
    return this.status;
  }

  getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  async switchProject(projectId: string): Promise<void> {
    const projectPath = getProjectDir(projectId);
    this.currentProjectId = projectId;
    this.currentProjectPath = projectPath;

    // Load existing session if available
    const session = readBlacksmithSession(projectId);
    this.sessionId = session.session_id;

    console.log(`[Blacksmith] Switched to project ${projectId}, session: ${this.sessionId || 'new'}`);
  }

  async *sendMessage(
    message: string,
    projectId?: string
  ): AsyncGenerator<BlacksmithEvent> {
    const pid = projectId || this.currentProjectId;
    if (!pid) {
      yield { type: 'error', error: 'No active project' };
      return;
    }

    if (pid !== this.currentProjectId) {
      await this.switchProject(pid);
    }

    const projectPath = this.currentProjectPath || getProjectDir(pid);

    // Record user message in history
    appendBlacksmithMessage(pid, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    this.status = 'thinking';
    broadcastGlobal('blacksmith:status', { status: 'thinking' });

    const model = process.env.SCHEMA_MODEL || 'sonnet';

    let responseText = '';
    let toolUses: { tool: string; input: string; output: string }[] = [];

    try {
      const query = await getQuery();
      if (!query) {
        // Fallback for when SDK is not available
        const fallbackText = `I'm the Blacksmith architect. I'm ready to help design your project "${pid}". Unfortunately the Claude Agent SDK is not configured. Please ensure ANTHROPIC_API_KEY is set.`;
        responseText = fallbackText;
        yield { type: 'text', content: fallbackText };
        yield { type: 'done' };
        return;
      }

      const queryOptions: Record<string, any> = {
        model,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
        permissionMode: 'bypassPermissions',
        maxTurns: 50,
        cwd: projectPath,
      };

      if (this.sessionId) {
        queryOptions['resume'] = this.sessionId;
      }

      for await (const msg of query({ prompt: message, options: queryOptions })) {
        if (msg.type === 'system' && msg.session_id) {
          this.sessionId = msg.session_id;
          this.saveSession(pid);
        }

        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if ('text' in block) {
              responseText += block.text;
              yield { type: 'text', content: block.text };
            }
          }
        }

        if (msg.type === 'tool_use') {
          toolUses.push({
            tool: msg.tool || '',
            input: JSON.stringify(msg.input || {}).slice(0, 200),
            output: '',
          });
          yield { type: 'tool_use', tool: msg.tool || '' };
        }

        if (msg.type === 'result') {
          yield { type: 'done' };
        }
      }

      // Check if the response contains a decomposition JSON block
      const decompositionResult = this.parseDecompositionFromResponse(responseText);
      let hasDecomposition = false;

      if (decompositionResult) {
        hasDecomposition = true;
        this.status = 'decomposing';
        broadcastGlobal('blacksmith:status', { status: 'decomposing' });

        try {
          await this.applyDecomposition(pid, decompositionResult);
          broadcastGlobal('blacksmith:decomposed', {
            projectId: pid,
            nodeCount: Object.keys(decompositionResult.components || {}).length,
          });
        } catch (err) {
          console.error('[Blacksmith] Decomposition apply failed:', err);
        }
      }

      // Record assistant response
      appendBlacksmithMessage(pid, {
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        tool_uses: toolUses,
        decomposition_result: hasDecomposition,
      });

      // Check if mockup.html was written
      const mockupPath = path.join(projectPath, 'mockup.html');
      if (fs.existsSync(mockupPath)) {
        // Update stakeholder.mockup_path if not set
        await updateProjectFile(pid, (data) => {
          if (!data.stakeholder.mockup_path) {
            data.stakeholder.mockup_path = mockupPath;
          }
          return data;
        });
        broadcastGlobal('blacksmith:mockup', { projectId: pid, path: mockupPath });
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Blacksmith] Error:', errorMsg);
      yield { type: 'error', error: errorMsg };
    } finally {
      this.status = 'idle';
      broadcastGlobal('blacksmith:status', { status: 'idle' });
    }
  }

  async *decompose(nodeId: string, projectId?: string): AsyncGenerator<BlacksmithEvent> {
    const pid = projectId || this.currentProjectId;
    if (!pid) {
      yield { type: 'error', error: 'No active project' };
      return;
    }

    if (pid !== this.currentProjectId) {
      await this.switchProject(pid);
    }

    // Get the node info
    const data = readProjectFile(pid);
    const node = data.nodes.find(n => n.id === nodeId);
    if (!node) {
      yield { type: 'error', error: `Node ${nodeId} not found` };
      return;
    }

    const isRoot = node.parent_id === null;
    let prompt: string;

    if (isRoot) {
      prompt = `Please begin the stakeholder interview for this project. Start by introducing yourself briefly and asking your first set of clarifying questions about the project requirements.

Project: ${data.project.name}
Description: ${data.project.prompt}`;
    } else {
      const parentNode = data.nodes.find(n => n.id === node.parent_id);
      prompt = `Please decompose the following component into 3-5 focused child nodes.

Component to decompose:
- Name: ${node.name}
- Prompt: ${node.prompt}
- Parent: ${parentNode?.name || 'root'}

Ask 1-2 quick clarifying questions if needed, then output the decomposition JSON block.`;
    }

    yield* this.sendMessage(prompt, pid);
  }

  private parseDecompositionFromResponse(text: string): DecompositionResult | null {
    // Look for ```json blocks containing "decomposition" key
    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonBlockMatch) return null;

    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (parsed.decomposition && parsed.decomposition.components) {
        return parsed.decomposition as DecompositionResult;
      }
    } catch {
      // Not valid JSON
    }
    return null;
  }

  private async applyDecomposition(projectId: string, result: DecompositionResult): Promise<void> {
    const data = readProjectFile(projectId);
    const parentNode = data.nodes.find(n => n.id === result.parent_node_id);

    if (!parentNode && result.parent_node_id) {
      console.warn(`[Blacksmith] Parent node ${result.parent_node_id} not found, using root`);
    }

    // Find the parent: either specified or the root node
    const parent = parentNode || data.nodes.find(n => n.parent_id === null);
    const parentId = parent?.id || null;
    const parentDepth = parent?.depth ?? 0;

    const newNodes: NodeRecord[] = [];

    for (const [compName, comp] of Object.entries(result.components)) {
      const childId = uuidv4();
      const node: NodeRecord = {
        id: childId,
        parent_id: parentId,
        name: compName,
        depth: parentDepth + 1,
        status: 'pending',
        is_leaf: comp.is_leaf ?? true,
        prompt: comp.prompt || '',
        model: comp.model || process.env.SCHEMA_MODEL || 'sonnet',
        hooks: comp.hooks || {},
        mcp_servers: comp.mcp_servers || {},
        subagents: comp.subagents || {},
        acceptance_criteria: comp.acceptance_criteria || '',
        contracts_provided: comp.contracts_provided || [],
        contracts_consumed: comp.contracts_consumed || [],
        session_id: null,
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        started_at: null,
        completed_at: null,
      };
      newNodes.push(node);
    }

    const newContracts: ContractRecord[] = [];
    for (const [contractName, contract] of Object.entries(result.contracts || {})) {
      newContracts.push({
        name: contractName,
        type: contract.type || 'typescript',
        provider: contract.provider || '',
        consumers: contract.consumers || [],
        content: contract.content || '',
        version: 1,
        status: 'draft',
      });
    }

    await updateProjectFile(projectId, (fileData) => {
      // Mark parent as approved (no longer pending)
      if (parentId) {
        const idx = fileData.nodes.findIndex(n => n.id === parentId);
        if (idx !== -1) {
          fileData.nodes[idx] = {
            ...fileData.nodes[idx],
            status: 'approved',
            is_leaf: false,
          };
        }
      }
      fileData.nodes.push(...newNodes);
      fileData.contracts.push(...newContracts);
      return fileData;
    });

    // Broadcast new nodes
    for (const node of newNodes) {
      broadcastGlobal('node:created', { node });
    }
    if (parentId) {
      const updatedData = readProjectFile(projectId);
      const updatedParent = updatedData.nodes.find(n => n.id === parentId);
      if (updatedParent) {
        broadcastGlobal('node:updated', { node: updatedParent });
      }
    }
  }

  private saveSession(projectId: string): void {
    const existing = readBlacksmithSession(projectId);
    const session: BlacksmithSession = {
      ...existing,
      session_id: this.sessionId,
      project_id: projectId,
      last_resumed_at: new Date().toISOString(),
    };
    writeBlacksmithSession(projectId, session);
  }

  getHistory(projectId: string) {
    return readBlacksmithHistory(projectId);
  }
}

// Decomposition result types from Claude's JSON output
interface DecompositionResult {
  parent_node_id?: string;
  components: Record<string, {
    prompt: string;
    is_leaf?: boolean;
    model?: string;
    acceptance_criteria?: string;
    contracts_provided?: string[];
    contracts_consumed?: string[];
    hooks?: Record<string, any>;
    mcp_servers?: Record<string, any>;
    subagents?: Record<string, any>;
  }>;
  contracts?: Record<string, {
    type?: 'typescript' | 'openapi' | 'graphql';
    provider?: string;
    consumers?: string[];
    content?: string;
  }>;
}

// Singleton instance
export const blacksmith = new BlacksmithService();
