"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConsoleTab } from "./vibe-utils";

type PanelLayout = Record<string, number>;

type VibeApprovalMode = "default" | "accept_edits" | "plan" | "full_auto";

type VibeHookToggles = {
  compactMemory: boolean;
  guardCommands: boolean;
  summarizeChanges: boolean;
};

type VibeCompactNote = {
  createdAt: string;
  id: string;
  scope: string;
  summary: string;
};

type VibeWorkspacePrefs = {
  approvalMode: VibeApprovalMode;
  bottomDockHeight: number;
  bottomTab: ConsoleTab;
  compactNotes: VibeCompactNote[];
  explorerCollapsed: boolean;
  hookToggles: VibeHookToggles;
  mainLayout: PanelLayout;
  openArtifacts: string[];
  recentCommands: string[];
  selectedArtifact: string | null;
  terminalLayout: PanelLayout;
};

const DEFAULT_PREFS: VibeWorkspacePrefs = {
  approvalMode: "default",
  bottomDockHeight: 320,
  bottomTab: "terminal",
  compactNotes: [],
  explorerCollapsed: false,
  hookToggles: {
    compactMemory: true,
    guardCommands: true,
    summarizeChanges: true,
  },
  mainLayout: {
    explorer: 21,
    editor: 55,
    session: 24,
  },
  openArtifacts: [],
  recentCommands: [],
  selectedArtifact: null,
  terminalLayout: {
    terminal: 74,
    activity: 26,
  },
};

function getStorageKey(threadId: string) {
  return `deerflow.vibe.workspace:${threadId}`;
}

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function arePanelLayoutsEqual(left: PanelLayout, right: PanelLayout) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => right[key] === left[key])
  );
}

function areObjectsEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSamePrefValue<K extends keyof VibeWorkspacePrefs>(
  key: K,
  left: VibeWorkspacePrefs[K],
  right: VibeWorkspacePrefs[K],
) {
  if (key === "openArtifacts" || key === "recentCommands") {
    return areStringArraysEqual(left as string[], right as string[]);
  }

  if (key === "mainLayout" || key === "terminalLayout") {
    return arePanelLayoutsEqual(left as PanelLayout, right as PanelLayout);
  }

  if (key === "hookToggles" || key === "compactNotes") {
    return areObjectsEqual(left, right);
  }

  return Object.is(left, right);
}

export function useVibeWorkspacePrefs(threadId: string | null) {
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefsState] = useState<VibeWorkspacePrefs>(DEFAULT_PREFS);
  const loadedThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    loadedThreadIdRef.current = null;
    setLoaded(false);

    if (!threadId || typeof window === "undefined") {
      setPrefsState(DEFAULT_PREFS);
      loadedThreadIdRef.current = threadId;
      setLoaded(Boolean(threadId));
      return;
    }

    try {
      const raw = window.localStorage.getItem(getStorageKey(threadId));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<VibeWorkspacePrefs>;
        setPrefsState({
          ...DEFAULT_PREFS,
          ...parsed,
        });
      } else {
        setPrefsState(DEFAULT_PREFS);
      }
    } catch {
      setPrefsState(DEFAULT_PREFS);
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
    window.localStorage.setItem(getStorageKey(threadId), JSON.stringify(prefs));
  }, [loaded, prefs, threadId]);

  const setPrefs = useCallback(
    (
      next:
        | Partial<VibeWorkspacePrefs>
        | ((current: VibeWorkspacePrefs) => Partial<VibeWorkspacePrefs>),
    ) => {
      setPrefsState((current) => {
        const patch = typeof next === "function" ? next(current) : next;
        const keys = Object.keys(patch) as (keyof VibeWorkspacePrefs)[];

        if (keys.length === 0) {
          return current;
        }

        let changed = false;
        const merged = { ...current };
        const mergedRecord = merged as Record<
          keyof VibeWorkspacePrefs,
          VibeWorkspacePrefs[keyof VibeWorkspacePrefs]
        >;

        keys.forEach((key) => {
          const value = patch[key];
          if (value === undefined) {
            return;
          }
          if (isSamePrefValue(key, current[key], value)) {
            return;
          }
          changed = true;
          mergedRecord[key] = value;
        });

        return changed ? merged : current;
      });
    },
    [],
  );

  return useMemo(
    () => ({
      loaded,
      prefs,
      setPrefs,
    }),
    [loaded, prefs, setPrefs],
  );
}
