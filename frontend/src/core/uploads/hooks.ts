/**
 * React hooks for file uploads
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { getBackendBaseURL } from "../config";

import {
  cancelUploadJob,
  deleteUploadedFile,
  fetchUploadStatus,
  listUploadedFiles,
  retryUploadJob,
  uploadFiles,
  type UploadControlResponse,
  type UploadedFileInfo,
  type UploadProcessingStatus,
  type UploadResponse,
} from "./api";

/**
 * Hook to upload files
 */
export function useUploadFiles(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation<UploadResponse, Error, File[]>({
    mutationFn: (files: File[]) => uploadFiles(threadId, files),
    onSuccess: () => {
      // Invalidate the uploaded files list
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "list", threadId],
      });
    },
  });
}

/**
 * Hook to list uploaded files
 */
export function useUploadedFiles(threadId: string) {
  return useQuery({
    queryKey: ["uploads", "list", threadId],
    queryFn: () => listUploadedFiles(threadId),
    enabled: !!threadId,
  });
}

/**
 * Hook to delete an uploaded file
 */
export function useDeleteUploadedFile(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filename: string) => deleteUploadedFile(threadId, filename),
    onSuccess: () => {
      // Invalidate the uploaded files list
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "list", threadId],
      });
    },
  });
}

/**
 * Hook to fetch upload processing status
 */
export function useUploadStatus(threadId: string, filename: string) {
  return useQuery<UploadProcessingStatus | null>({
    queryKey: ["uploads", "status", threadId, filename],
    queryFn: () => fetchUploadStatus(threadId, filename),
    enabled: !!threadId && !!filename,
  });
}

/**
 * Stream upload processing status via SSE and update cache.
 */
export function useUploadStatusStream(
  threadId: string,
  filename?: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    if (!threadId) return;
    if (typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;

    const baseUrl = getBackendBaseURL() || window.location.origin;
    const url = new URL(`${baseUrl}/api/threads/${threadId}/uploads/stream`);
    if (filename) {
      url.searchParams.set("filename", filename);
    }
    const source = new EventSource(url.toString());

    source.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          filename?: string;
          data?: UploadProcessingStatus;
        };
        const status = payload.data;
        const targetFilename =
          payload.filename ?? status?.filename ?? filename ?? "";
        if (!status || !targetFilename) return;
        const normalized = { ...status, filename: targetFilename };
        queryClient.setQueryData(
          ["uploads", "status", threadId, targetFilename],
          normalized,
        );
      } catch {
        return;
      }
    };

    source.onerror = () => {
      // Let EventSource handle retries internally
    };

    return () => {
      source.close();
    };
  }, [enabled, threadId, filename, queryClient]);
}

/**
 * Hook to cancel an upload processing job
 */
export function useCancelUploadJob(threadId: string, filename: string) {
  const queryClient = useQueryClient();

  return useMutation<UploadControlResponse, Error, void>({
    mutationFn: () => cancelUploadJob(threadId, filename),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "status", threadId, filename],
      });
    },
  });
}

/**
 * Hook to retry an upload processing job
 */
export function useRetryUploadJob(threadId: string, filename: string) {
  const queryClient = useQueryClient();

  return useMutation<UploadControlResponse, Error, void>({
    mutationFn: () => retryUploadJob(threadId, filename),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "status", threadId, filename],
      });
    },
  });
}

/**
 * Hook to handle file uploads in submit flow
 * Returns a function that uploads files and returns their info
 */
export function useUploadFilesOnSubmit(threadId: string) {
  const uploadMutation = useUploadFiles(threadId);

  return useCallback(
    async (files: File[]): Promise<UploadedFileInfo[]> => {
      if (files.length === 0) {
        return [];
      }

      const result = await uploadMutation.mutateAsync(files);
      return result.files;
    },
    [uploadMutation],
  );
}
