import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createWorkflowRun, fetchWorkflowRuns, updateWorkflowRun } from "./api";
import type {
  WorkflowRunCreatePayload,
  WorkflowRunUpdatePayload,
} from "./types";

const workflowRunsKey = (threadId: string | null | undefined) => [
  "workflow-runs",
  threadId ?? "",
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
    },
  });
}
