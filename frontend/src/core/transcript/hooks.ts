import { useQuery } from "@tanstack/react-query";

import { fetchThreadTranscript } from "./api";

export function useThreadTranscript(threadId: string, enabled = true) {
  return useQuery({
    queryKey: ["threads", threadId, "transcript"],
    queryFn: () => fetchThreadTranscript(threadId),
    enabled: enabled && Boolean(threadId),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}
