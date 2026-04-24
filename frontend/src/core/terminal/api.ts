import { requestJSON } from "@/core/api";

import { getBackendBaseURL } from "../config";

export type TerminalStatus = "starting" | "running" | "stopping" | "stopped";

export interface TerminalState {
  thread_id: string;
  session_id: string;
  status: TerminalStatus;
  cwd: string;
  started_at?: number | null;
  updated_at?: number | null;
  exit_code?: number | null;
}

export interface TerminalSnapshot {
  state: TerminalState;
  history: string;
}

export interface TerminalControlResponse {
  success: boolean;
  state: TerminalState;
}

export interface TerminalInputPayload {
  data: string;
  add_newline?: boolean;
}

export interface TerminalResizePayload {
  cols: number;
  rows: number;
}

export async function ensureTerminalSession(
  threadId: string,
): Promise<TerminalSnapshot> {
  return requestJSON<TerminalSnapshot>(
    `${getBackendBaseURL()}/api/threads/${threadId}/terminal/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      timeoutMs: 20_000,
    },
  );
}

export async function getTerminalSessionState(
  threadId: string,
): Promise<TerminalSnapshot> {
  return requestJSON<TerminalSnapshot>(
    `${getBackendBaseURL()}/api/threads/${threadId}/terminal/state`,
    {
      method: "GET",
      timeoutMs: 20_000,
    },
  );
}

export async function sendTerminalInput(
  threadId: string,
  payload: TerminalInputPayload,
): Promise<TerminalControlResponse> {
  return requestJSON<TerminalControlResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/terminal/input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
    },
  );
}

export async function interruptTerminal(
  threadId: string,
): Promise<TerminalControlResponse> {
  return requestJSON<TerminalControlResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/terminal/interrupt`,
    {
      method: "POST",
      timeoutMs: 20_000,
    },
  );
}

export async function resizeTerminal(
  threadId: string,
  payload: TerminalResizePayload,
): Promise<TerminalControlResponse> {
  return requestJSON<TerminalControlResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/terminal/resize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
    },
  );
}

export async function stopTerminal(
  threadId: string,
): Promise<TerminalControlResponse> {
  return requestJSON<TerminalControlResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/terminal/stop`,
    {
      method: "POST",
      timeoutMs: 20_000,
    },
  );
}
