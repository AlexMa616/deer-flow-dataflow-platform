import type { ComponentType } from "react";

export type QuickAction = {
  description: string;
  label: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
};

export type QuickCommand = {
  label: string;
  command: string;
};

export type ActivityItem = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

export type AgentCommandItem = {
  id: string;
  description: string;
  command: string;
  result?: string;
};

export type RuntimeEventItem = {
  createdAt: string;
  id: string;
  title: string;
  detail: string;
  tone: "info" | "running" | "success" | "error";
  eventType?: string;
  toolName?: string;
};

export type ConsoleTab = "terminal" | "preview" | "changes";

export type DiffLine = {
  kind: "context" | "add" | "remove";
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type ExplorerNode = {
  id: string;
  label: string;
  kind: "folder" | "file";
  artifact?: string;
  children?: ExplorerNode[];
};

type MutableExplorerNode = ExplorerNode & {
  childrenMap?: Map<string, MutableExplorerNode>;
};

export function sameArtifacts(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

export function isWriteFileArtifact(filepath: string) {
  return filepath.startsWith("write-file:");
}

export function normalizeArtifactPath(filepath: string) {
  if (!isWriteFileArtifact(filepath)) {
    return filepath;
  }
  try {
    const url = new URL(filepath);
    return decodeURIComponent(url.pathname);
  } catch {
    return filepath;
  }
}

function splitIntoLines(value: string) {
  return value.replace(/\r\n/g, "\n").split("\n");
}

export function summarizeConsoleText(value: string, limit = 120) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function sortExplorerNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    })
    .map((node) =>
      node.kind === "folder" && node.children
        ? {
            ...node,
            children: sortExplorerNodes(node.children),
          }
        : node,
    );
}

function finalizeExplorerTree(
  childrenMap: Map<string, MutableExplorerNode>,
): ExplorerNode[] {
  return sortExplorerNodes(
    Array.from(childrenMap.values()).map((node) => {
      if (node.kind === "file") {
        return {
          id: node.id,
          label: node.label,
          kind: "file",
          artifact: node.artifact,
        };
      }
      return {
        id: node.id,
        label: node.label,
        kind: "folder",
        children: finalizeExplorerTree(node.childrenMap ?? new Map()),
      };
    }),
  );
}

export function buildExplorerTree(artifacts: string[]) {
  const root = new Map<string, MutableExplorerNode>();

  artifacts.forEach((artifact) => {
    const normalized = normalizeArtifactPath(artifact);
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) {
      return;
    }

    let currentMap = root;
    let currentPath = "";

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let node = currentMap.get(currentPath);

      if (!node) {
        node = isLeaf
          ? {
              id: currentPath,
              label: segment,
              kind: "file",
              artifact,
            }
          : {
              id: currentPath,
              label: segment,
              kind: "folder",
              childrenMap: new Map(),
            };
        currentMap.set(currentPath, node);
      }

      if (!isLeaf) {
        node.childrenMap ??= new Map();
        currentMap = node.childrenMap;
      }
    });
  });

  return finalizeExplorerTree(root);
}

export function buildDiffLines(
  beforeText: string,
  afterText: string,
): DiffLine[] {
  const beforeLines = splitIntoLines(beforeText);
  const afterLines = splitIntoLines(afterText);
  const maxMatrixCells = 40_000;
  const diffLines: DiffLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  if (beforeLines.length * afterLines.length > maxMatrixCells) {
    beforeLines.forEach((line) => {
      diffLines.push({
        kind: "remove",
        text: line,
        oldLineNumber: oldLineNumber++,
        newLineNumber: null,
      });
    });
    afterLines.forEach((line) => {
      diffLines.push({
        kind: "add",
        text: line,
        oldLineNumber: null,
        newLineNumber: newLineNumber++,
      });
    });
    return diffLines;
  }

  const matrix = Array.from({ length: beforeLines.length + 1 }, () =>
    Array<number>(afterLines.length + 1).fill(0),
  );

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      matrix[i]![j] =
        beforeLines[i] === afterLines[j]
          ? matrix[i + 1]![j + 1]! + 1
          : Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!);
    }
  }

  let i = 0;
  let j = 0;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      diffLines.push({
        kind: "context",
        text: beforeLines[i]!,
        oldLineNumber: oldLineNumber++,
        newLineNumber: newLineNumber++,
      });
      i += 1;
      j += 1;
      continue;
    }

    if (matrix[i + 1]![j]! >= matrix[i]![j + 1]!) {
      diffLines.push({
        kind: "remove",
        text: beforeLines[i]!,
        oldLineNumber: oldLineNumber++,
        newLineNumber: null,
      });
      i += 1;
      continue;
    }

    diffLines.push({
      kind: "add",
      text: afterLines[j]!,
      oldLineNumber: null,
      newLineNumber: newLineNumber++,
    });
    j += 1;
  }

  while (i < beforeLines.length) {
    diffLines.push({
      kind: "remove",
      text: beforeLines[i]!,
      oldLineNumber: oldLineNumber++,
      newLineNumber: null,
    });
    i += 1;
  }

  while (j < afterLines.length) {
    diffLines.push({
      kind: "add",
      text: afterLines[j]!,
      oldLineNumber: null,
      newLineNumber: newLineNumber++,
    });
    j += 1;
  }

  return diffLines;
}

export function buildUnifiedPatch(
  filepath: string,
  beforeText: string,
  afterText: string,
  diffLines: DiffLine[],
) {
  if (beforeText === afterText) {
    return "";
  }
  const normalizedPath = normalizeArtifactPath(filepath);
  return [
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    "@@ review @@",
    ...diffLines.map((line) => {
      if (line.kind === "add") return `+${line.text}`;
      if (line.kind === "remove") return `-${line.text}`;
      return ` ${line.text}`;
    }),
  ].join("\n");
}

function textFromUnknown(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if ("text" in value && typeof value.text === "string") {
    return value.text;
  }
  if ("content" in value) {
    const content = value.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (
            item &&
            typeof item === "object" &&
            "text" in item &&
            typeof item.text === "string"
          ) {
            return item.text;
          }
          return "";
        })
        .filter(Boolean)
        .join(" ");
    }
  }
  return "";
}

function runtimeEventId(type: string) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stringField(event: Record<string, unknown>, key: string, limit = 120) {
  const value = event[key];
  return typeof value === "string" ? summarizeConsoleText(value, limit) : "";
}

function numberField(event: Record<string, unknown>, key: string) {
  return typeof event[key] === "number" ? event[key] : null;
}

function formatDuration(durationMs: number | null, isChinese: boolean) {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  if (durationMs < 1000) {
    return isChinese
      ? `${Math.round(durationMs)} 毫秒`
      : `${Math.round(durationMs)} ms`;
  }

  const seconds = durationMs / 1000;
  return isChinese ? `${seconds.toFixed(1)} 秒` : `${seconds.toFixed(1)} s`;
}

function joinRuntimeDetails(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");
}

function buildToolRuntimeTitle({
  type,
  toolName,
  isChinese,
}: {
  type: string;
  toolName: string;
  isChinese: boolean;
}) {
  if (type === "tool_start") {
    return isChinese ? `${toolName} 运行中` : `${toolName} running`;
  }
  if (type === "tool_result") {
    return isChinese ? `${toolName} 已完成` : `${toolName} completed`;
  }
  if (type === "tool_error") {
    return isChinese ? `${toolName} 失败` : `${toolName} failed`;
  }
  return isChinese ? "工具事件" : "Tool event";
}

export function buildRuntimeEventItem(
  event: unknown,
  isChinese: boolean,
): RuntimeEventItem | null {
  if (!event || typeof event !== "object" || !("type" in event)) {
    return null;
  }

  const payload = event as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type : "event";
  const messageText =
    "message" in payload
      ? summarizeConsoleText(textFromUnknown(payload.message), 120)
      : "";
  const summaryText = stringField(payload, "summary");
  const previewText = stringField(payload, "preview", 180);
  const commandText = stringField(payload, "command");
  const pathText = stringField(payload, "path");
  const descriptionText = stringField(payload, "description");
  const errorText = stringField(payload, "error", 180);
  const resultText =
    "result" in payload
      ? summarizeConsoleText(textFromUnknown(payload.result), 180)
      : "";
  const toolName =
    stringField(payload, "tool_name") || stringField(payload, "name");
  const durationLabel = formatDuration(
    numberField(payload, "duration_ms"),
    isChinese,
  );
  const createdAt =
    typeof payload.created_at === "string"
      ? payload.created_at
      : new Date().toISOString();

  const fallbackDetail =
    messageText ||
    summaryText ||
    previewText ||
    commandText ||
    pathText ||
    errorText ||
    (isChinese ? "收到新的运行事件" : "New runtime event received");

  switch (type) {
    case "task_started":
      return {
        createdAt,
        id: runtimeEventId(type),
        title: isChinese ? "任务已启动" : "Task started",
        detail:
          joinRuntimeDetails([descriptionText, summaryText, durationLabel]) ||
          fallbackDetail,
        tone: "info",
        eventType: type,
      };
    case "task_running":
      return {
        createdAt,
        id: runtimeEventId(type),
        title: isChinese ? "任务进行中" : "Task running",
        detail:
          joinRuntimeDetails([messageText, summaryText, durationLabel]) ||
          fallbackDetail,
        tone: "running",
        eventType: type,
      };
    case "task_completed":
      return {
        createdAt,
        id: runtimeEventId(type),
        title: isChinese ? "任务完成" : "Task completed",
        detail:
          joinRuntimeDetails([resultText, messageText, durationLabel]) ||
          fallbackDetail,
        tone: "success",
        eventType: type,
      };
    case "task_timed_out":
    case "task_failed":
      return {
        createdAt,
        id: runtimeEventId(type),
        title:
          type === "task_timed_out"
            ? isChinese
              ? "任务超时"
              : "Task timed out"
            : isChinese
              ? "任务失败"
              : "Task failed",
        detail:
          joinRuntimeDetails([errorText, messageText, durationLabel]) ||
          fallbackDetail,
        tone: "error",
        eventType: type,
      };
    case "tool_call":
      return {
        createdAt,
        id: runtimeEventId(type),
        title: isChinese ? "工具调度" : "Tool queued",
        detail:
          joinRuntimeDetails([
            summaryText,
            commandText,
            pathText,
            durationLabel,
          ]) || fallbackDetail,
        tone: "info",
        eventType: type,
        toolName: toolName || undefined,
      };
    case "tool_start":
    case "tool_result":
    case "tool_error":
      return {
        createdAt,
        id: runtimeEventId(type),
        title: buildToolRuntimeTitle({
          type,
          toolName: toolName || (isChinese ? "工具" : "Tool"),
          isChinese,
        }),
        detail:
          joinRuntimeDetails([
            summaryText,
            previewText,
            errorText,
            commandText,
            pathText,
            durationLabel,
          ]) || fallbackDetail,
        tone:
          type === "tool_start"
            ? "running"
            : type === "tool_result"
              ? "success"
              : "error",
        eventType: type,
        toolName: toolName || undefined,
      };
    default:
      return {
        createdAt,
        id: runtimeEventId(type),
        title: type.replace(/_/g, " "),
        detail: fallbackDetail,
        tone: "info",
        eventType: type,
      };
  }
}
