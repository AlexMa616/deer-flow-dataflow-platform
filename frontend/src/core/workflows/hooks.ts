import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createWorkflowFeedback,
  createWorkflowRun,
  fetchWorkflowRuns,
  fetchWorkflowStats,
  fetchWorkflowThreads,
  updateWorkflowRun,
} from "./api";
import type {
  WorkflowFeedbackCreatePayload,
  WorkflowRunCreatePayload,
  WorkflowRunUpdatePayload,
} from "./types";

const workflowRunsKey = (threadId: string | null | undefined) => [
  "workflow-runs",
  threadId ?? "",
];
const workflowStatsKey = (threadId: string | null | undefined) => [
  "workflow-stats",
  threadId ?? "",
];
const workflowThreadsKey = (userId?: string | null) => [
  "workflow-threads",
  userId ?? "",
];

export function useWorkflowRuns(
  threadId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: workflowRunsKey(threadId),
    queryFn: () => fetchWorkflowRuns(threadId!),
    enabled: Boolean(threadId) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateWorkflowRun(threadId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WorkflowRunCreatePayload) =>
      createWorkflowRun(threadId!, payload),
    onSuccess() {
      void queryClient.invalidateQueries({
        queryKey: workflowRunsKey(threadId),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowStatsKey(threadId),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowThreadsKey(),
      });
    },
  });
}

export function useUpdateWorkflowRun(threadId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      runId,
      payload,
    }: {
      runId: string;
      payload: WorkflowRunUpdatePayload;
    }) => updateWorkflowRun(threadId!, runId, payload),
    onSuccess() {
      void queryClient.invalidateQueries({
        queryKey: workflowRunsKey(threadId),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowStatsKey(threadId),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowThreadsKey(),
      });
    },
  });
}

export function useWorkflowStats(
  threadId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: workflowStatsKey(threadId),
    queryFn: () => fetchWorkflowStats(threadId!),
    enabled: Boolean(threadId) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useWorkflowThreads(userId?: string | null) {
  return useQuery({
    queryKey: workflowThreadsKey(userId),
    queryFn: () => fetchWorkflowThreads(userId ?? undefined),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateWorkflowFeedback(threadId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WorkflowFeedbackCreatePayload) =>
      createWorkflowFeedback(threadId!, payload),
    onSuccess() {
      void queryClient.invalidateQueries({
        queryKey: workflowStatsKey(threadId),
      });
    },
  });
}
