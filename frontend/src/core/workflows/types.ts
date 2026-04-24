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
}

export interface WorkflowRunUpdatePayload {
  status?: WorkflowRunStatus;
  steps?: WorkflowStep[];
  outputs?: string[];
  summary?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}
