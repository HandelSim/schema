# SCHEMA Exploratory Test Plan

Use this plan with agent-browser for visual verification beyond the automated Playwright tests.

## Prerequisites
- SCHEMA dev server running: `npm run dev`
- API at http://localhost:3001, Frontend at http://localhost:3000

## Running Automated Tests

```bash
# All E2E tests (requires server running)
npm run test:e2e

# Individual test groups
npm run test:e2e:creation       # Project creation UI
npm run test:e2e:decomposition  # AI decomposition flow
npm run test:e2e:inspection     # Node detail panel
npm run test:e2e:approval       # Approve/reject actions
npm run test:e2e:workflow       # Full end-to-end
```

## Exploratory Visual Checks (agent-browser)

### Check 1: Landing Page Layout
```bash
agent-browser open http://localhost:3000
agent-browser screenshot landing.png
```
Verify: Left sidebar visible. Main area shows empty state. No overlapping elements.

### Check 2: Create Project Modal
```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
# Find the new-project-button and click it
agent-browser click @<button-ref>
agent-browser screenshot modal.png
```
Verify: Modal appears centered. Both fields visible. Submit button disabled initially.

### Check 3: Tree View After Decomposition
1. Create a project via the UI (or use an existing one)
2. Approve the root node to trigger decomposition
3. Wait for decomposition to complete
```bash
agent-browser open http://localhost:3000
agent-browser screenshot tree-view.png
```
Verify: Tree nodes visible with connecting edges. Status badges color-coded. Minimap in bottom right.

### Check 4: Node Detail Panel
1. Click a node in the tree or node list
```bash
agent-browser snapshot -i
# Click a node-list-item
agent-browser screenshot node-detail.png
```
Verify: Panel shows name, role, status badge, depth. Approve and Reject buttons present. Config accordion visible.

### Check 5: Config Accordion Sections
1. Select a node and view the config tab
2. Click each accordion header one at a time
```bash
agent-browser screenshot config-hooks.png
agent-browser screenshot config-mcp.png
```
Verify: Each section expands/collapses. No layout breaks. Hooks editor shows valid JSON.

### Check 6: Execution Log
```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
# Look for execution-log panel on right side
agent-browser screenshot execution-log.png
```
Verify: Log panel visible. Auto-scrolls to latest entries. "Jump to bottom" button appears when scrolled up.

## When to Use This vs Playwright Tests

| Scenario | Use |
|---|---|
| CI/CD validation | `npm run test:e2e` |
| Visual regression check | agent-browser screenshots |
| Debugging a failing test | agent-browser + snapshot |
| New feature verification | Both — automated first, then visual |
| Performance/layout issues | agent-browser screenshots |

## data-testid Reference

| testid | Element |
|---|---|
| `project-prompt` | Project description textarea in create modal |
| `project-name` | Project name input in create modal |
| `create-project` | Submit button in create modal |
| `cancel-button` | Cancel button in modal or edit mode |
| `new-project-button` | "+ New" button in sidebar |
| `project-item` | Project buttons in sidebar list |
| `empty-state` | Empty state when no projects exist |
| `tree-canvas` | React Flow canvas container |
| `tree-node` | Each node card in the graph |
| `node-list-item` | Each node in the right navigator list |
| `project-status` | Phase bar showing build/execute phases |
| `approve-tree-button` | Approve Tree button in phase bar |
| `generate-contexts-button` | Generate Contexts button in phase bar |
| `start-execution-button` | Start Execution button in phase bar |
| `node-detail-panel` | Right-side node detail container |
| `node-name` | Node name heading |
| `node-role` | Node role input field |
| `node-status` | Node status badge (has `data-status` attribute) |
| `node-depth` | "Depth: N" span |
| `node-prompt` | Prompt section container |
| `edit-button` | Edit button in node header |
| `save-button` | Save button in edit mode |
| `approve-button` | Approve / Approve & Decompose button |
| `execute-button` | Execute button (leaf/failed nodes) |
| `reject-button` | Reject button |
| `verify-button` | Verify button (completed nodes) |
| `rejection-feedback` | Textarea in reject modal |
| `rejection-confirm` | Confirm button in reject modal |
| `decomposing-indicator` | Animated "Decomposing..." / "Running..." badge |
| `execution-log` | Log panel on right side |
| `error-display` | Error display (node error_log or tree.error) |
| `loading-indicator` | Loading overlay when tree is fetching |
| `config-tab-config` | Config tab button in node detail |
| `config-tab-contracts` | Contracts tab button in node detail |
| `config-tab-children` | Children tab button in node detail |
| `config-tab-model-execution` | Model & Execution accordion header |
| `config-tab-acceptance` | Acceptance Criteria accordion header |
| `config-tab-allowed-paths` | File Boundaries accordion header |
| `config-tab-allowed-tools` | Allowed Tools accordion header |
| `config-tab-dependencies` | Dependencies accordion header |
| `config-tab-api-contracts` | API Contracts accordion header |
| `config-tab-hooks` | Hooks accordion header |
| `config-tab-mcp-tools` | MCP Tools accordion header |
| `config-tab-context-files` | Context Files accordion header |
| `hooks-editor` | Hooks JSON textarea |
| `tab-content` | Content area inside open accordion section |
