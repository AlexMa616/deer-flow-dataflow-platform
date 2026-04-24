import type { UseStream } from "@langchain/langgraph-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { useContext, useMemo } from "react";

import { ThreadContext } from "@/components/workspace/messages/context";

import type { AgentThreadState } from "../threads";

import { loadArtifactContent, loadArtifactContentFromToolCall } from "./loader";

export function useArtifactContent({
  filepath,
  threadId,
  enabled,
  thread: providedThread,
}: {
  filepath: string;
  threadId: string;
  enabled?: boolean;
  thread?: UseStream<AgentThreadState>;
}) {
  const isWriteFile = useMemo(() => {
    return filepath.startsWith("write-file:");
  }, [filepath]);
  const threadContext = useContext(ThreadContext);
  const thread = providedThread ?? threadContext?.thread;
  const content = useMemo(() => {
    if (isWriteFile && thread) {
      return loadArtifactContentFromToolCall({ url: filepath, thread });
    }
    return null;
  }, [filepath, isWriteFile, thread]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["artifact", filepath, threadId],
    queryFn: () => {
      return loadArtifactContent({ filepath, threadId });
    },
    enabled: Boolean(enabled && !isWriteFile),
    // Cache artifact content for 5 minutes to avoid repeated fetches (especially for .skill ZIP extraction)
    staleTime: 5 * 60 * 1000,
  });
  return { content: isWriteFile ? content : data, isLoading, error };
}
