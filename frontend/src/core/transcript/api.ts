import { requestJSON } from "../api";
import { getBackendBaseURL } from "../config";

import type { TranscriptResponse } from "./types";

export async function fetchThreadTranscript(threadId: string) {
  return requestJSON<TranscriptResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/transcript`,
  );
}
