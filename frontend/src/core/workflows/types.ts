export type WorkflowRunType =
  | "project"
  | "research"
  | "library"
  | "design"
  | "skills"
  | "automation"
  | "custom";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface WorkflowStep {
  id: string;
  label: string;
  status: WorkflowStepStatus;
  detail?: string | null;
}

export interface WorkflowRun {
  id: string;
  thread_id: string;
  workflow_type: WorkflowRunType;
  title: string;
  prompt: string;
  status: WorkflowRunStatus;
  steps: WorkflowStep[];
  outputs: string[];
  summary?: string | null;
  error?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface WorkflowRunsResponse {
  runs: WorkflowRun[];
}

export interface WorkflowRunCreatePayload {
  workflow_type: WorkflowRunType;
  title: string;
  prompt: string;
  steps?: WorkflowStep[];
  outputs?: string[];
  metadata?: Record<string, unknown>;
  user_id?: string | null;
}

export interface WorkflowRunUpdatePayload {
  status?: WorkflowRunStatus;
  steps?: WorkflowStep[];
  outputs?: string[];
  summary?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
  user_id?: string | null;
}

export interface WorkflowFeedback {
  id: string;
  thread_id: string;
  run_id?: string | null;
  rating?: number | null;
  sentiment?: "positive" | "neutral" | "negative" | null;
  comment?: string | null;
  model_name?: string | null;
  usage: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowFeedbackCreatePayload {
  run_id?: string | null;
  rating?: number | null;
  sentiment?: "positive" | "neutral" | "negative" | null;
  comment?: string | null;
  model_name?: string | null;
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  user_id?: string | null;
}

export interface WorkflowStats {
  thread_id: string;
  run_count: number;
  status_counts: Record<string, number>;
  feedback_count: number;
  average_rating?: number | null;
  model_usage: Record<string, number>;
  last_activity_at?: string | null;
}

export interface WorkflowThreadMapping {
  thread_id: string;
  user_id: string;
  project_id?: string | null;
  project_name?: string | null;
  model_name?: string | null;
  title?: string | null;
  last_workflow_type?: WorkflowRunType | null;
  last_status?: WorkflowRunStatus | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowThreadsResponse {
  threads: WorkflowThreadMapping[];
}
