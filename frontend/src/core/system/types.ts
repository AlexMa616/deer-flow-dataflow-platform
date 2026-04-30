export type SystemRecommendationLevel = "info" | "warn" | "action";

export interface StorageStats {
  files: number;
  bytes: number;
}

export interface ThreadStats {
  count: number;
  uploads: StorageStats;
  outputs: StorageStats;
  workspace: StorageStats;
}

export interface MemorySummary {
  enabled: boolean;
  injection_enabled: boolean;
  facts: number;
  last_updated: string | null;
  storage_path: string;
  storage_backend: string;
  max_pending_contexts: number;
}

export interface ModelSummary {
  configured: number;
  supports_thinking: number;
  supports_vision: number;
}

export interface ExtensionsSummary {
  mcp_enabled: number;
  skills_enabled: number;
}

export interface VectorSummary {
  enabled: boolean;
  documents: number;
}

export interface RequestGuardrails {
  blocked_chinese_model_names: string[];
  message: string | null;
}

export interface SystemRecommendation {
  id: string;
  level: SystemRecommendationLevel;
  title: string;
  detail: string;
}

export interface SystemOverview {
  service: string;
  timestamp: string;
  uptime_seconds: number;
  sandbox_mode: string;
  threads: ThreadStats;
  memory: MemorySummary;
  models: ModelSummary;
  extensions: ExtensionsSummary;
  vector: VectorSummary;
  request_guardrails: RequestGuardrails;
  recommendations: SystemRecommendation[];
}
