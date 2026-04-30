"use client";

import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getLangGraphBaseURL } from "../config";

const SUPPORTED_STREAM_MODES = new Set([
  "values",
  "messages",
  "messages-tuple",
  "tasks",
  "checkpoints",
  "updates",
  "events",
  "debug",
  "custom",
]);

let _singleton: LangGraphClient | null = null;

function sanitizeStreamMode(streamMode: unknown): unknown {
  const requestedModes =
    typeof streamMode === "string"
      ? [streamMode]
      : Array.isArray(streamMode)
        ? streamMode
        : null;

  if (!requestedModes) {
    return streamMode;
  }

  const supportedModes = requestedModes.filter(
    (mode): mode is string =>
      typeof mode === "string" && SUPPORTED_STREAM_MODES.has(mode),
  );

  // langgraph-api 0.6.x rejects array stream_mode payloads. Use one stable
  // mode instead of forwarding SDK-added multi-mode requests.
  return supportedModes[0] ?? "values";
}

function parseStreamModeParam(param: string): unknown {
  try {
    return JSON.parse(param) as unknown;
  } catch {
    return param;
  }
}

function sanitizeStreamModeSearchParam(url: URL) {
  const params = url.searchParams.getAll("stream_mode");
  if (params.length === 0) {
    return;
  }

  const parsedMode =
    params.length === 1 ? parseStreamModeParam(params[0]!) : params;
  const nextMode = sanitizeStreamMode(parsedMode);
  url.searchParams.delete("stream_mode");
  url.searchParams.set(
    "stream_mode",
    typeof nextMode === "string" ? nextMode : JSON.stringify(nextMode),
  );
}

function sanitizeLangGraphRequest(url: URL, init: RequestInit): RequestInit {
  sanitizeStreamModeSearchParam(url);

  if (typeof init.body !== "string" || !init.body.includes("stream_mode")) {
    return init;
  }

  try {
    const body = JSON.parse(init.body) as { stream_mode?: unknown };
    if (body.stream_mode === undefined) {
      return init;
    }

    const nextBody = {
      ...body,
      stream_mode: sanitizeStreamMode(body.stream_mode),
    };

    return {
      ...init,
      body: JSON.stringify(nextBody),
    };
  } catch {
    return init;
  }
}

export function getAPIClient(): LangGraphClient {
  _singleton ??= new LangGraphClient({
    apiUrl: getLangGraphBaseURL(),
    onRequest: sanitizeLangGraphRequest,
  });
  return _singleton;
}
