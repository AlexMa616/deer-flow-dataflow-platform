"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type VibeCheckpoint = {
  createdAt: string;
  files: Record<string, string>;
  id: string;
  label: string;
  omittedCount: number;
  source: "auto" | "manual";
  summary: string;
};

function getStorageKey(threadId: string) {
  return `deerflow.vibe.checkpoints:${threadId}`;
}

function areCheckpointFilesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => right[key] === left[key])
  );
}

function areCheckpointsEqual(left: VibeCheckpoint[], right: VibeCheckpoint[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      if (!other) {
        return false;
      }
      return (
        item.id === other.id &&
        item.createdAt === other.createdAt &&
        item.label === other.label &&
        item.omittedCount === other.omittedCount &&
        item.source === other.source &&
        item.summary === other.summary &&
        areCheckpointFilesEqual(item.files, other.files)
      );
    })
  );
}

export function useVibeCheckpoints(threadId: string | null) {
  const [checkpoints, setCheckpointsState] = useState<VibeCheckpoint[]>([]);
  const [loaded, setLoaded] = useState(false);
  const loadedThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    loadedThreadIdRef.current = null;
    setLoaded(false);

    if (!threadId || typeof window === "undefined") {
      setCheckpointsState([]);
      loadedThreadIdRef.current = threadId;
      setLoaded(Boolean(threadId));
      return;
    }

    try {
      const raw = window.localStorage.getItem(getStorageKey(threadId));
      if (!raw) {
        setCheckpointsState([]);
      } else {
        const parsed = JSON.parse(raw) as VibeCheckpoint[];
        setCheckpointsState(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setCheckpointsState([]);
    }

    loadedThreadIdRef.current = threadId;
    setLoaded(true);
  }, [threadId]);

  useEffect(() => {
    if (
      !threadId ||
      !loaded ||
      loadedThreadIdRef.current !== threadId ||
      typeof window === "undefined"
    ) {
      return;
    }
    window.localStorage.setItem(
      getStorageKey(threadId),
      JSON.stringify(checkpoints),
    );
  }, [checkpoints, loaded, threadId]);

  const setCheckpoints = useCallback(
    (
      next:
        | VibeCheckpoint[]
        | ((current: VibeCheckpoint[]) => VibeCheckpoint[]),
    ) => {
      setCheckpointsState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        return areCheckpointsEqual(current, resolved) ? current : resolved;
      });
    },
    [],
  );

  return useMemo(
    () => ({
      checkpoints,
      loaded,
      setCheckpoints,
    }),
    [checkpoints, loaded, setCheckpoints],
  );
}
