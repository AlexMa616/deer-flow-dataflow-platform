export interface TranscriptMessage {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  additional_kwargs?: Record<string, unknown> | null;
}

export interface TranscriptEntry {
  key: string;
  captured_at: string;
  phase: string;
  message: TranscriptMessage;
}

export interface TranscriptResponse {
  entries: TranscriptEntry[];
}
