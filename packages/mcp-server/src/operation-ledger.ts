type OperationStatus = 'running' | 'succeeded' | 'failed';

export type OperationRecord = {
  id: string;
  tool: string;
  startedAt: string;
  finishedAt?: string;
  status: OperationStatus;
  argsPreview: Record<string, unknown>;
  durationMs?: number;
  error?: string;
  steps: string[];
};

const operations = new Map<string, OperationRecord>();

function newOperationId(): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `op_${Date.now().toString(36)}_${rnd}`;
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k.toLowerCase().includes('password') || k.toLowerCase().includes('privatekey') || k.toLowerCase().includes('mnemonic')) {
      out[k] = '[redacted]';
      continue;
    }
    if (typeof v === 'string' && v.length > 160) {
      out[k] = `${v.slice(0, 157)}...`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function startOperation(tool: string, args: Record<string, unknown>): OperationRecord {
  const rec: OperationRecord = {
    id: newOperationId(),
    tool,
    startedAt: new Date().toISOString(),
    status: 'running',
    argsPreview: sanitizeArgs(args),
    steps: [],
  };
  operations.set(rec.id, rec);
  return rec;
}

export function addOperationStep(id: string, step: string): void {
  const rec = operations.get(id);
  if (!rec) return;
  rec.steps.push(step);
}

export function finishOperation(id: string, status: Exclude<OperationStatus, 'running'>, error?: string): void {
  const rec = operations.get(id);
  if (!rec) return;
  rec.status = status;
  rec.finishedAt = new Date().toISOString();
  const startMs = Date.parse(rec.startedAt);
  const endMs = Date.parse(rec.finishedAt);
  rec.durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : undefined;
  if (error) rec.error = error;
}

export function getOperation(id: string): OperationRecord | null {
  return operations.get(id) ?? null;
}

export function listOperations(limit = 20): OperationRecord[] {
  return [...operations.values()]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, Math.max(1, limit));
}
