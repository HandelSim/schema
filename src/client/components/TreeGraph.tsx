/**
 * TreeGraph - Interactive React Flow visualization of the agent tree.
 *
 * Layout strategy: Simple top-down hierarchical layout computed client-side.
 * We don't use a library like dagre here to keep the bundle lean.
 * The layout positions nodes in a breadth-first manner with configurable spacing.
 */
import React, { useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  NodeProps,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { TreeNode } from '../types';
import { StatusBadge, TypeBadge } from './StatusBadge';

// Node dimensions for layout calculation
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const H_SPACING = 40;
const V_SPACING = 60;

// Status colors for minimap dots and node backgrounds
const STATUS_NODE_STYLES: Record<string, { bg: string; border: string; ring: string }> = {
  pending:     { bg: 'bg-gray-800',    border: 'border-gray-600',   ring: 'ring-gray-500' },
  approved:    { bg: 'bg-blue-950',    border: 'border-blue-600',   ring: 'ring-blue-500' },
  decomposing: { bg: 'bg-yellow-950',  border: 'border-yellow-600', ring: 'ring-yellow-500' },
  running:     { bg: 'bg-emerald-950', border: 'border-emerald-600',ring: 'ring-emerald-500' },
  completed:   { bg: 'bg-green-950',   border: 'border-green-600',  ring: 'ring-green-500' },
  failed:      { bg: 'bg-red-950',     border: 'border-red-600',    ring: 'ring-red-500' },
  rejected:    { bg: 'bg-orange-950',  border: 'border-orange-600', ring: 'ring-orange-500' },
};

const STATUS_MINIMAP_COLORS: Record<string, string> = {
  pending:     '#9ca3af',
  approved:    '#3b82f6',
  decomposing: '#eab308',
  running:     '#10b981',
  completed:   '#22c55e',
  failed:      '#ef4444',
  rejected:    '#f97316',
};

/**
 * Custom React Flow node component.
 * Renders node name, role, status badge, and type badge.
 */
const AgentNode: React.FC<NodeProps> = ({ data }) => {
  const { node, selected, onSelect } = data as {
    node: TreeNode;
    selected: boolean;
    onSelect: (id: string) => void;
  };

  const style = STATUS_NODE_STYLES[node.status] || STATUS_NODE_STYLES['pending'];

  return (
    <div
      onClick={() => onSelect(node.id)}
      data-testid="tree-node"
      data-node-id={node.id}
      className={`
        relative w-[200px] rounded-lg border-2 p-2.5 cursor-pointer transition-all
        ${style.bg} ${style.border}
        ${selected ? `ring-2 ring-offset-1 ${style.ring} shadow-lg scale-105` : 'hover:shadow-md hover:scale-102'}
        ${node.status === 'running' || node.status === 'decomposing' ? 'animate-pulse-slow' : ''}
      `}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-gray-400" />

      <div className="space-y-1">
        <div className="font-semibold text-xs text-gray-100 truncate leading-tight" title={node.name}>
          {node.name}
        </div>
        {node.role && (
          <div className="text-xs text-gray-400 truncate" title={node.role}>
            {node.role}
          </div>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          <StatusBadge status={node.status} size="sm" />
          <TypeBadge type={node.node_type} />
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-gray-400" />
    </div>
  );
};

const nodeTypes = { agentNode: AgentNode };

/**
 * Compute a hierarchical tree layout.
 * Groups nodes by depth, distributes horizontally with equal spacing.
 */
function computeTreeLayout(nodes: TreeNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  // Group by depth
  const byDepth = new Map<number, TreeNode[]>();
  for (const node of nodes) {
    const level = byDepth.get(node.depth) || [];
    level.push(node);
    byDepth.set(node.depth, level);
  }

  const maxDepth = Math.max(...byDepth.keys());

  // Bottom-up layout: compute subtree widths and position accordingly
  // Simple approach: divide horizontal space evenly per depth level
  for (let depth = 0; depth <= maxDepth; depth++) {
    const levelNodes = byDepth.get(depth) || [];
    const totalWidth = levelNodes.length * (NODE_WIDTH + H_SPACING) - H_SPACING;
    const startX = -totalWidth / 2;

    levelNodes.forEach((node, i) => {
      positions.set(node.id, {
        x: startX + i * (NODE_WIDTH + H_SPACING),
        y: depth * (NODE_HEIGHT + V_SPACING),
      });
    });
  }

  return positions;
}

interface TreeGraphProps {
  nodes: TreeNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

export const TreeGraph: React.FC<TreeGraphProps> = ({
  nodes,
  selectedNodeId,
  onSelectNode,
}) => {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState([]);

  // Build React Flow nodes and edges from tree data
  const { rfNodes, rfEdges } = useMemo(() => {
    const positions = computeTreeLayout(nodes);

    const rfNodes: Node[] = nodes.map(node => {
      const pos = positions.get(node.id) || { x: 0, y: 0 };
      return {
        id: node.id,
        type: 'agentNode',
        position: pos,
        data: {
          node,
          selected: node.id === selectedNodeId,
          onSelect: onSelectNode,
        },
        style: { width: NODE_WIDTH },
      };
    });

    const rfEdges: Edge[] = [];

    for (const node of nodes) {
      // Parent-child edges (solid)
      if (node.parent_id) {
        rfEdges.push({
          id: `parent-${node.id}`,
          source: node.parent_id,
          target: node.id,
          type: 'smoothstep',
          style: { stroke: '#94a3b8', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
        });
      }

      // Dependency edges (dashed)
      const deps: string[] = node.dependencies || [];
      for (const depName of deps) {
        const depNode = nodes.find(n => n.name === depName && n.parent_id === node.parent_id);
        if (depNode) {
          rfEdges.push({
            id: `dep-${node.id}-${depNode.id}`,
            source: depNode.id,
            target: node.id,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#a78bfa', strokeWidth: 1.5, strokeDasharray: '5,5' },
            markerEnd: { type: MarkerType.Arrow, color: '#a78bfa' },
            label: 'depends',
            labelStyle: { fontSize: 9, fill: '#a78bfa' },
          });
        }
      }
    }

    return { rfNodes, rfEdges };
  }, [nodes, selectedNodeId, onSelectNode]);

  // Update flow state when nodes change
  useEffect(() => {
    setFlowNodes(rfNodes);
  }, [rfNodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(rfEdges);
  }, [rfEdges, setFlowEdges]);

  const getMinimapNodeColor = useCallback((node: Node) => {
    const treeNode = nodes.find(n => n.id === node.id);
    return STATUS_MINIMAP_COLORS[treeNode?.status || 'pending'] || '#9ca3af';
  }, [nodes]);

  return (
    <div className="w-full h-full bg-gray-950" data-testid="tree-canvas">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        <Controls />
        <MiniMap
          nodeColor={getMinimapNodeColor}
          nodeStrokeWidth={2}
          zoomable
          pannable
          style={{ background: '#111827', border: '1px solid #374151' }}
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-12 left-2 bg-gray-900 border border-gray-700 rounded-lg p-2 shadow-sm text-xs space-y-1 pointer-events-none">
        <div className="font-medium text-gray-400 mb-1">Legend</div>
        {Object.entries(STATUS_MINIMAP_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="capitalize text-gray-400">{status}</span>
          </div>
        ))}
        <div className="border-t border-gray-700 pt-1 mt-1">
          <div className="flex items-center gap-1.5">
            <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#94a3b8" strokeWidth="2"/></svg>
            <span className="text-gray-400">parent-child</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="3,3"/></svg>
            <span className="text-gray-400">dependency</span>
          </div>
        </div>
      </div>
    </div>
  );
};
