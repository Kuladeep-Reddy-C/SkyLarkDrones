/** Types shared across the frontend (mirror of the backend contract). */

export interface ChartSpec {
  type: 'bar' | 'funnel';
  title: string;
  unit: string;
  data: { label: string; value: number }[];
}

export interface AgentMeta {
  model?: string;
  steps?: number;
  tools?: { tool: string; args: Record<string, unknown>; ok: boolean }[];
  cached?: boolean;
  degraded?: boolean;
  error?: boolean | string;
  welcome?: boolean;
}

export type Role = 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
  charts?: ChartSpec[];
  meta?: AgentMeta;
}

export type AgentEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'status'; label: string }
  | { type: 'tool'; id: string; tool: string; label: string }
  | { type: 'tool_done'; id: string; tool: string; label: string; summary: string }
  | { type: 'answer'; text: string }
  | { type: 'charts'; charts: ChartSpec[] }
  | { type: 'done'; meta: AgentMeta }
  | { type: 'error'; error: string; dataError?: string };

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unreachable';
  llm?: boolean;
  model?: string | null;
  monday?: { connected: boolean; account?: string; user?: string; tier?: string; error?: string };
}

export interface QualityReport {
  notes: string[];
  crossBoard?: { note: string };
}

export interface OverviewResponse {
  fetchedAt: string;
  ageSeconds: number | null;
  counts: { deals: number; workOrders: number };
  quality: QualityReport;
}

export interface LeadershipResponse {
  markdown: string;
  mode: string;
  model?: string;
}

export interface TraceStep {
  id: string;
  label: string;
  state: 'run' | 'done';
  summary?: string;
}
