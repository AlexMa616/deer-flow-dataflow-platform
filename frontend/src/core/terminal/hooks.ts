import { useCallback, useEffect, useRef, useState } from "react";

import { getBackendBaseURL } from "../config";

import {
  ensureTerminalSession,
  getTerminalSessionState,
  interruptTerminal,
  resizeTerminal,
  sendTerminalInput,
  stopTerminal,
  type TerminalState,
  type TerminalSnapshot,
} from "./api";

type TerminalEvent =
  | {
      type: "snapshot";
      state: TerminalState;
      history: string;
    }
  | {
      type: "status";
      state: TerminalState;
    }
  | {
      type: "output";
      data: string;
      timestamp?: number;
    };

const MAX_OUTPUT_CHARS = 200_000;

function trimOutput(output: string) {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return output.slice(-MAX_OUTPUT_CHARS);
}

export function useTerminalSession(
  threadId: string,
  {
    enabled = true,
    autoStart = false,
  }: {
    enabled?: boolean;
    autoStart?: boolean;
  } = {},
) {
  const [state, setState] = useState<TerminalState | null>(null);
  const [output, setOutput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const activeSessionIdRef = useRef("");
  const isDisposedRef = useRef(false);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    activeSessionIdRef.current = "";
    if (!isDisposedRef.current) {
      setIsConnected(false);
    }
  }, []);

  const applySnapshot = useCallback((snapshot: TerminalSnapshot) => {
    setState(snapshot.state);
    setOutput(trimOutput(snapshot.history));
  }, []);

  const connectStream = useCallback(
    (sessionId: string) => {
      if (!threadId) {
        return;
      }
      if (typeof window === "undefined" || typeof EventSource === "undefined") {
        return;
      }
      if (sourceRef.current && activeSessionIdRef.current === sessionId) {
        return;
      }

      sourceRef.current?.close();

      const baseUrl = getBackendBaseURL() || window.location.origin;
      const url = new URL(`${baseUrl}/api/threads/${threadId}/terminal/stream`);
      const source = new EventSource(url.toString());

      activeSessionIdRef.current = sessionId;
      sourceRef.current = source;

      source.onopen = () => {
        if (isDisposedRef.current) {
          return;
        }
        setIsConnected(true);
        setIsConnecting(false);
      };

      source.onmessage = (event) => {
        if (!event.data || isDisposedRef.current) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as TerminalEvent;
          if (payload.type === "snapshot") {
            setState(payload.state);
            setOutput(trimOutput(payload.history));
            if (payload.state.session_id) {
              activeSessionIdRef.current = payload.state.session_id;
            }
            if (payload.state.status === "stopped") {
              closeStream();
              setIsConnecting(false);
            }
            return;
          }
          if (payload.type === "status") {
            setState(payload.state);
            if (payload.state.status === "stopped") {
              closeStream();
              setIsConnecting(false);
            }
            return;
          }
          if (payload.type === "output") {
            setOutput((current) => trimOutput(current + payload.data));
          }
        } catch {
          return;
        }
      };

      source.onerror = () => {
        if (isDisposedRef.current) {
          return;
        }
        setIsConnected(false);
        setIsConnecting(false);
      };
    },
    [closeStream, threadId],
  );

  const hydrateSession = useCallback(
    async ({ forceStart = false }: { forceStart?: boolean } = {}) => {
      if (!threadId) {
        return null;
      }

      try {
        if (forceStart || autoStart) {
          setIsConnecting(true);
        }

        const snapshot =
          forceStart || autoStart
            ? await ensureTerminalSession(threadId)
            : await getTerminalSessionState(threadId);

        if (isDisposedRef.current) {
          return snapshot;
        }

        applySnapshot(snapshot);

        if (
          snapshot.state.status === "running" ||
          snapshot.state.status === "starting"
        ) {
          connectStream(snapshot.state.session_id);
        } else {
          closeStream();
          setIsConnecting(false);
        }

        return snapshot;
      } catch (error) {
        if (isDisposedRef.current) {
          return null;
        }
        setIsConnecting(false);
        setIsConnected(false);
        throw error;
      }
    },
    [applySnapshot, autoStart, closeStream, connectStream, threadId],
  );

  useEffect(() => {
    if (!enabled || !threadId) {
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    isDisposedRef.current = false;
    void hydrateSession({ forceStart: autoStart }).catch((error) => {
      console.error("Failed to initialize terminal session", error);
    });

    return () => {
      isDisposedRef.current = true;
      closeStream();
    };
  }, [autoStart, closeStream, enabled, hydrateSession, threadId]);

  const runCommand = useCallback(
    async (command: string, { addNewline = true }: { addNewline?: boolean } = {}) => {
      if (!threadId) {
        throw new Error("Thread ID is required to send terminal input");
      }
      if (
        !state?.session_id ||
        state.status === "stopped" ||
        !sourceRef.current
      ) {
        await hydrateSession({ forceStart: true });
      }
      const response = await sendTerminalInput(threadId, {
        data: command,
        add_newline: addNewline,
      });
      setState(response.state);
      if (response.state.session_id) {
        connectStream(response.state.session_id);
      }
      return response;
    },
    [connectStream, hydrateSession, state?.session_id, state?.status, threadId],
  );

  const sendInput = useCallback(
    async (data: string) => {
      if (!threadId) {
        throw new Error("Thread ID is required to send terminal input");
      }
      if (
        !state?.session_id ||
        state.status === "stopped" ||
        !sourceRef.current
      ) {
        await hydrateSession({ forceStart: true });
      }
      const response = await sendTerminalInput(threadId, {
        data,
        add_newline: false,
      });
      setState(response.state);
      if (response.state.session_id) {
        connectStream(response.state.session_id);
      }
      return response;
    },
    [connectStream, hydrateSession, state?.session_id, state?.status, threadId],
  );

  const interrupt = useCallback(async () => {
    const response = await interruptTerminal(threadId);
    setState(response.state);
    return response;
  }, [threadId]);

  const resize = useCallback(
    async (cols: number, rows: number) => {
      if (!threadId) {
        throw new Error("Thread ID is required to resize terminal");
      }
      if (
        !state?.session_id ||
        state.status === "stopped" ||
        !sourceRef.current
      ) {
        await hydrateSession({ forceStart: true });
      }
      const response = await resizeTerminal(threadId, { cols, rows });
      setState(response.state);
      if (response.state.session_id) {
        connectStream(response.state.session_id);
      }
      return response;
    },
    [connectStream, hydrateSession, state?.session_id, state?.status, threadId],
  );

  const stop = useCallback(async () => {
    const response = await stopTerminal(threadId);
    setState(response.state);
    closeStream();
    setIsConnecting(false);
    return response;
  }, [closeStream, threadId]);

  const start = useCallback(async () => {
    const snapshot = await hydrateSession({ forceStart: true });
    return snapshot;
  }, [hydrateSession]);

  return {
    state,
    output,
    isConnecting,
    isConnected,
    start,
    sendInput,
    runCommand,
    resize,
    interrupt,
    stop,
    restart: start,
  };
}
