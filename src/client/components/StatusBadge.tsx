/**
 * StatusBadge - Visual indicator for node execution status.
 * Color-coded with appropriate icons for quick scanning.
 */
import React from 'react';
import { NodeStatus, NodeType } from '../types';

interface StatusBadgeProps {
  status: NodeStatus;
  size?: 'sm' | 'md';
  testId?: string;
}

const STATUS_CONFIG: Record<NodeStatus, { label: string; classes: string; dot: string }> = {
  pending:     { label: 'Awaiting Approval', classes: 'bg-gray-800 text-gray-300 border-gray-600',     dot: 'bg-gray-500' },
  approved:    { label: 'Approved',     classes: 'bg-blue-950 text-blue-300 border-blue-700',           dot: 'bg-blue-400' },
  decomposing: { label: 'Decomposing',  classes: 'bg-yellow-950 text-yellow-300 border-yellow-700',     dot: 'bg-yellow-400 animate-pulse' },
  running:     { label: 'Running',      classes: 'bg-emerald-950 text-emerald-300 border-emerald-700',  dot: 'bg-emerald-400 animate-pulse' },
  completed:   { label: 'Completed',    classes: 'bg-green-950 text-green-300 border-green-700',        dot: 'bg-green-400' },
  failed:      { label: 'Failed',       classes: 'bg-red-950 text-red-300 border-red-700',              dot: 'bg-red-400' },
  rejected:    { label: 'Rejected',     classes: 'bg-orange-950 text-orange-300 border-orange-700',     dot: 'bg-orange-400' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md', testId }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const sizeClasses = size === 'sm'
    ? 'text-xs px-1.5 py-0.5 gap-1'
    : 'text-xs px-2 py-1 gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${sizeClasses} ${config.classes}`}
      {...(testId ? { 'data-testid': testId, 'data-status': status } : {})}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  );
};

interface TypeBadgeProps {
  type: NodeType;
}

const TYPE_CONFIG: Record<NodeType, { label: string; classes: string }> = {
  orchestrator: { label: 'Composite', classes: 'bg-violet-950 text-violet-300 border-violet-700' },
  leaf:         { label: 'Leaf',         classes: 'bg-sky-950 text-sky-300 border-sky-700' },
  test:         { label: 'Test',         classes: 'bg-amber-950 text-amber-300 border-amber-700' },
};

export const TypeBadge: React.FC<TypeBadgeProps> = ({ type }) => {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.leaf;
  return (
    <span className={`inline-flex items-center rounded border text-xs px-1.5 py-0.5 font-medium ${config.classes}`}>
      {config.label}
    </span>
  );
};
