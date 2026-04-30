import { requestJSON } from "@/core/api";

import { getBackendBaseURL } from "../config";

import type {
  WorkflowFeedback,
  WorkflowFeedbackCreatePayload,
  WorkflowRun,
  WorkflowRunCreatePayload,
  WorkflowRunsResponse,
  WorkflowRunUpdatePayload,
  WorkflowStats,
  WorkflowThreadsResponse,
} from "./types";

function workflowRunsURL(threadId: string, runId?: string) {
  const base = `${getBackendBaseURL()}/api/threads/${threadId}/workflow-runs`;
  return runId ? `${base}/${runId}` : base;
}

export async function fetchWorkflowRuns(threadId: string) {
  return requestJSON<WorkflowRunsResponse>(workflowRunsURL(threadId), {
    timeoutMs: 20_000,
  });
}

export async function createWorkflowRun(
  threadId: string,
  payload: WorkflowRunCreatePayload,
) {
  return requestJSON<WorkflowRun>(workflowRunsURL(threadId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  });
}

export async function updateWorkflowRun(
  threadId: string,
  runId: string,
  payload: WorkflowRunUpdatePayload,
) {
  return requestJSON<WorkflowRun>(workflowRunsURL(threadId, runId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  });
}

export async function fetchWorkflowStats(threadId: string) {
  return requestJSON<WorkflowStats>(`${workflowRunsURL(threadId)}/stats`, {
    timeoutMs: 20_000,
  });
}

export async function createWorkflowFeedback(
  threadId: string,
  payload: WorkflowFeedbackCreatePayload,
) {
  return requestJSON<WorkflowFeedback>(`${workflowRunsURL(threadId)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  });
}

export async function fetchWorkflowThreads(userId?: string) {
  const params = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return requestJSON<WorkflowThreadsResponse>(
    `${getBackendBaseURL()}/api/workflow-threads${params}`,
    { timeoutMs: 20_000 },
  );
}
