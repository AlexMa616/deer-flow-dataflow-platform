import type { BaseMessage } from "@langchain/core/messages";
import type { Message, ThreadState } from "@langchain/langgraph-sdk";

import type { AgentThread } from "./types";
import type { AgentThreadState } from "./types";

export function pathOfThread(threadId: string) {
  return `/workspace/chats/${threadId}`;
}

const CHINESE_TEXT_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;

export function textOfMessage(message: BaseMessage) {
  if (typeof message.content === "string") {
    return message.content;
  } else if (Array.isArray(message.content)) {
    return message.content.find((part) => part.type === "text" && part.text)
      ?.text as string;
  }
  return null;
}

export function titleOfThread(thread: AgentThread) {
  if (thread.values && "title" in thread.values) {
    return thread.values.title;
  }
  return "Untitled";
}

export function containsChineseText(value: string | null | undefined) {
  return Boolean(value && CHINESE_TEXT_RE.test(value));
}

function getMessageDedupKey(
  message: Message,
  stateIndex: number,
  messageIndex: number,
) {
  if (message.id) {
    return `id:${message.id}`;
  }
  if (message.type === "tool" && message.tool_call_id) {
    return `tool:${message.tool_call_id}:${message.name ?? ""}`;
  }
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content ?? null);
  return `fallback:${message.type}:${message.name ?? ""}:${content}:${stateIndex}:${messageIndex}`;
}

export function buildVisibleMessagesFromHistory(
  history: ThreadState<AgentThreadState>[] | undefined,
  currentMessages: Message[],
) {
  const merged: Message[] = [];
  const seen = new Set<string>();

  const appendMessages = (
    messages: Message[] | undefined,
    stateIndex: number,
  ) => {
    for (const [messageIndex, message] of (messages ?? []).entries()) {
      const key = getMessageDedupKey(message, stateIndex, messageIndex);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(message);
    }
  };

  for (const [stateIndex, state] of (history ?? []).entries()) {
    appendMessages(state.values.messages as Message[] | undefined, stateIndex);
  }

  appendMessages(currentMessages, history?.length ?? 0);
  return merged;
}

function collectErrorParts(error: unknown): string[] {
  if (!error) return [];
  if (typeof error === "string") return [error];
  if (error instanceof Error) {
    return [error.name, error.message].filter(Boolean);
  }
  if (typeof error === "object") {
    const parts: string[] = [];
    for (const key of ["message", "detail", "error", "name", "statusText"]) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        parts.push(value.trim());
      }
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        parts.push(serialized);
      }
    } catch {
      // Ignore non-serializable values.
    }
    return parts;
  }
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return [String(error)];
  }
  if (typeof error === "symbol") {
    return [error.description ?? "Symbol error"];
  }
  return ["未知错误"];
}

export type ThreadErrorDisplay = {
  kind:
    | "thread_not_found"
    | "upstream_blocked"
    | "concurrency"
    | "payload_too_large"
    | "generic";
  title: string;
  message: string;
  raw: string;
};

function isThreadNotFoundRaw(raw: string) {
  return (
    /thread with id .* not found|thread .* not found/i.test(raw) ||
    /notfounderror|404[^\d]|not found/i.test(raw)
  );
}

export function getThreadErrorDisplay(error: unknown): ThreadErrorDisplay {
  const raw = collectErrorParts(error).join(" ").trim();

  if (isThreadNotFoundRaw(raw)) {
    return {
      kind: "thread_not_found",
      title: "当前线程不存在或已失效",
      message:
        "这个线程在当前 LangGraph 运行时里不存在。通常是本地服务重启后，内存中的旧线程状态被清空了。页面会自动尝试恢复同一个 thread_id；如果仍失败，刷新后再试一次即可。",
      raw,
    };
  }

  if (
    /error code:\s*1010|permissiondeniederror|your request was blocked/i.test(
      raw,
    )
  ) {
    return {
      kind: "upstream_blocked",
      title: "当前模型请求被上游接口拦截",
      message:
        "当前配置的上游模型服务拦截了这次请求。按当前配置看，这个接口会屏蔽中文提示词或中文文档内容，请改用支持中文的模型接口后再试。",
      raw,
    };
  }

  if (/concurrency limit exceeded/i.test(raw)) {
    return {
      kind: "concurrency",
      title: "当前账号并发额度已满",
      message:
        "当前账号并发额度已满。请稍等片刻再试，或先关闭其他正在运行的任务。",
      raw,
    };
  }

  if (/request entity too large|payload too large|413/i.test(raw)) {
    return {
      kind: "payload_too_large",
      title: "这次请求内容过大",
      message: "这次请求内容过大。请缩小附件内容、减少上下文，或拆成几次发送。",
      raw,
    };
  }

  return {
    kind: "generic",
    title: "本次运行失败",
    message: raw || "本次运行失败，请稍后重试。",
    raw,
  };
}

export function describeThreadError(error: unknown): string {
  return getThreadErrorDisplay(error).message;
}
