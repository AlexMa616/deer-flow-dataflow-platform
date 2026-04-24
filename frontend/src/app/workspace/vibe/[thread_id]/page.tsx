"use client";

import type { Message } from "@langchain/langgraph-sdk";
import type { UseStream } from "@langchain/langgraph-sdk/react";
import {
  CheckCircleIcon,
  Code2Icon,
  CopyIcon,
  EyeIcon,
  FileCodeIcon,
  SearchIcon,
  SparklesIcon,
  SquareArrowOutUpRightIcon,
  SquareTerminalIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArtifactsProvider,
  useArtifacts,
} from "@/components/workspace/artifacts";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
import { getAPIClient } from "@/core/api";
import { useArtifactContent } from "@/core/artifacts/hooks";
import {
  loadArtifactContent,
  loadArtifactContentFromToolCall,
} from "@/core/artifacts/loader";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractReasoningContentFromMessage,
  findToolCallResult,
} from "@/core/messages/utils";
import { useModels } from "@/core/models/hooks";
import { useLocalSettings } from "@/core/settings";
import { fetchSystemOverview, useSystemOverview } from "@/core/system";
import { useTerminalSession } from "@/core/terminal/hooks";
import { type AgentThreadState } from "@/core/threads";
import { useSubmitThread, useThreadStream } from "@/core/threads/hooks";
import {
  containsChineseText,
  getThreadErrorDisplay,
  pathOfThread,
  textOfMessage,
} from "@/core/threads/utils";
import { explainToolCall } from "@/core/tools/utils";
import { getFileName, checkCodeFile } from "@/core/utils/files";
import { uuid } from "@/core/utils/uuid";
import {
  useCreateWorkflowRun,
  useUpdateWorkflowRun,
  useWorkflowRuns,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowRunType,
} from "@/core/workflows";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import {
  useVibeCheckpoints,
  type VibeCheckpoint,
} from "./use-vibe-checkpoints";
import { useVibeWorkspacePrefs } from "./use-vibe-workspace-prefs";
import {
  VibeCommandPalette,
  type VibePaletteGroup,
} from "./vibe-command-palette";
import { VibeErrorBoundary } from "./vibe-error-boundary";
import {
  type ActivityItem,
  type AgentCommandItem,
  type ConsoleTab,
  type QuickAction,
  type RuntimeEventItem,
  buildDiffLines,
  buildRuntimeEventItem,
  buildUnifiedPatch,
  isWriteFileArtifact,
  normalizeArtifactPath,
  sameArtifacts,
} from "./vibe-utils";

const MAX_OPEN_TABS = 8;
const MAX_RECENT_COMMANDS = 8;
const MAX_LOCAL_CHECKPOINTS = 8;
const MAX_LOCAL_CHECKPOINT_FILES = 24;
const MAX_LOCAL_CHECKPOINT_CHARS = 240_000;
const WORKFLOW_TYPES: WorkflowRunType[] = [
  "project",
  "research",
  "library",
  "design",
  "skills",
  "automation",
];

function formatWorkflowStatusLabel(
  status: WorkflowRunStatus,
  isChinese: boolean,
) {
  if (status === "queued") {
    return isChinese ? "排队中" : "Queued";
  }
  if (status === "running") {
    return isChinese ? "运行中" : "Running";
  }
  if (status === "waiting_approval") {
    return isChinese ? "待确认" : "Waiting";
  }
  if (status === "completed") {
    return isChinese ? "已完成" : "Completed";
  }
  if (status === "failed") {
    return isChinese ? "失败" : "Failed";
  }
  return isChinese ? "已取消" : "Cancelled";
}

function sameCheckpointFiles(
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

function summarizeCheckpointSummary(
  value: string | null | undefined,
  limit = 88,
) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function buildCheckpointLabel({
  index,
  isChinese,
  source,
}: {
  index: number;
  isChinese: boolean;
  source: VibeCheckpoint["source"];
}) {
  if (source === "manual") {
    return isChinese ? `手动快照 ${index}` : `Manual checkpoint ${index}`;
  }
  return isChinese ? `版本快照 ${index}` : `Checkpoint ${index}`;
}

function buildCheckpointRestorePrompt({
  checkpoint,
  isChinese,
}: {
  checkpoint: VibeCheckpoint;
  isChinese: boolean;
}) {
  const fileBlocks = Object.entries(checkpoint.files)
    .map(
      ([path, content]) =>
        `<checkpoint-file path="${path}">\n${content}\n</checkpoint-file>`,
    )
    .join("\n\n");

  if (isChinese) {
    return `请把当前项目回退到本地 checkpoint "${checkpoint.label}" 记录的版本。只修改下面列出的文件，使它们与对应内容完全一致；未列出的文件不要改动。完成后给我一句简短说明。\n\n${fileBlocks}`;
  }

  return `Restore the current project to the local checkpoint "${checkpoint.label}". Update only the files listed below so they match the checkpoint content exactly, and leave every other file unchanged. Finish with a short summary.\n\n${fileBlocks}`;
}

function buildCheckpointFileRestorePrompt({
  checkpoint,
  isChinese,
  path,
}: {
  checkpoint: VibeCheckpoint;
  isChinese: boolean;
  path: string;
}) {
  const content = checkpoint.files[path];
  if (content === undefined) {
    return null;
  }

  if (isChinese) {
    return `请把当前项目中的文件 "${path}" 回退到本地 checkpoint "${checkpoint.label}" 记录的版本。只修改这个文件，使它与下面的内容完全一致。完成后给我一句简短说明。\n\n<checkpoint-file path="${path}">\n${content}\n</checkpoint-file>`;
  }

  return `Restore the file "${path}" to the version stored in the local checkpoint "${checkpoint.label}". Update only this file so it matches the content below exactly, then finish with a short summary.\n\n<checkpoint-file path="${path}">\n${content}\n</checkpoint-file>`;
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"]',
    ),
  );
}

type ApprovalMode = "default" | "accept_edits" | "plan" | "full_auto";

type HookToggleKey = "compactMemory" | "guardCommands" | "summarizeChanges";

type PendingCommandApproval = {
  command: string;
  createdAt: string;
  id: string;
  label?: string;
  reason: string;
};

type SessionStreamItem = {
  body: string;
  id: string;
  kind:
    | "assistant"
    | "policy"
    | "reasoning"
    | "runtime"
    | "tool_result"
    | "tool_use"
    | "user";
  label: string;
  meta?: string;
};

type SlashActionEntry = {
  argsHint?: string;
  command: string;
  description: string;
  example?: string;
  label: string;
  onSelect: () => void;
  usage?: string;
};

type WorkspaceViewEntry = {
  description: string;
  label: string;
  onSelect: () => void;
  value: string;
};

type WorkspaceDomainCard = {
  description: string;
  label: string;
  metric: string;
  onSelect: () => void;
};

function parseSlashCommand(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const body = trimmed.slice(1);
  const firstSpace = body.indexOf(" ");
  const command = (firstSpace === -1 ? body : body.slice(0, firstSpace))
    .trim()
    .toLowerCase();
  const args = firstSpace === -1 ? "" : body.slice(firstSpace + 1).trim();

  return {
    args,
    command,
  };
}

function truncateForStream(value: string | null | undefined, limit = 420) {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function summarizeToolArgs(args: Record<string, unknown> | undefined) {
  if (!args) {
    return "";
  }

  if (typeof args.command === "string") {
    return args.command;
  }
  if (typeof args.query === "string") {
    return args.query;
  }
  if (typeof args.path === "string") {
    return args.path;
  }
  if (typeof args.filepath === "string") {
    return args.filepath;
  }
  if (typeof args.image_path === "string") {
    return args.image_path;
  }
  if (typeof args.url === "string") {
    return args.url;
  }
  if (typeof args.prompt === "string") {
    return args.prompt;
  }
  if (typeof args.description === "string") {
    return args.description;
  }
  if (Array.isArray(args.filepaths)) {
    return args.filepaths
      .filter((item): item is string => typeof item === "string")
      .slice(0, 3)
      .join(", ");
  }

  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return "";
  }
}

function buildApprovalModePrelude({
  isChinese,
  mode,
}: {
  isChinese: boolean;
  mode: ApprovalMode;
}) {
  if (mode === "accept_edits") {
    return isChinese
      ? "Approval mode: 接受编辑。默认直接实施代码修改，但遇到高风险、删除、迁移或破坏性操作时先说明风险再继续。"
      : "Approval mode: accept edits. Apply code changes directly by default, but call out risk before destructive or high-impact operations.";
  }

  if (mode === "plan") {
    return isChinese
      ? "Approval mode: 计划优先。先分析、列步骤、解释风险，不要直接修改代码，除非我在当前请求里明确要求开始实施。"
      : "Approval mode: plan first. Analyze, outline steps, and explain risks before editing code unless I explicitly ask you to implement in this request.";
  }

  if (mode === "full_auto") {
    return isChinese
      ? "Approval mode: 全自动。默认连续推进实现、验证与修复，尽量减少确认，但仍需在高风险操作前说明。"
      : "Approval mode: full auto. Keep implementing, verifying, and fixing with minimal interruptions, while still flagging high-risk operations first.";
  }

  return "";
}

function buildHookPrelude({
  compactNote,
  hooks,
  isChinese,
}: {
  compactNote?: string | null;
  hooks: {
    compactMemory: boolean;
    guardCommands: boolean;
    summarizeChanges: boolean;
  };
  isChinese: boolean;
}) {
  const parts: string[] = [];

  if (hooks.guardCommands) {
    parts.push(
      isChinese
        ? "Hook: 在执行可能破坏性的 shell、文件删除、重置或不可逆操作前，先用一句话说明意图与风险。"
        : "Hook: Before destructive shell, delete, reset, or irreversible actions, briefly state intent and risk first.",
    );
  }

  if (hooks.summarizeChanges) {
    parts.push(
      isChinese
        ? "Hook: 完成后给出精简变更总结，包含改动点、验证结果，以及未完成的风险。"
        : "Hook: Finish with a concise change summary that includes what changed, what was verified, and any remaining risk.",
    );
  }

  if (hooks.compactMemory && compactNote) {
    parts.push(
      isChinese
        ? `Compact memory:\n${compactNote}`
        : `Compact memory:\n${compactNote}`,
    );
  }

  return parts.join("\n\n");
}

function getCommandGuardReason(command: string, isChinese: boolean) {
  const normalized = command.trim().toLowerCase();
  const rules = [
    {
      match: /\brm\b|\brmdir\b|\bdel\b|\bunlink\b/,
      reason: isChinese
        ? "命令包含删除操作，可能移除文件或目录。"
        : "This command includes a delete operation and can remove files or directories.",
    },
    {
      match:
        /git\s+reset\s+--hard|git\s+clean\b[^\n]*\b-f\b|git\s+checkout\s+--|git\s+restore\b[^\n]*\b--source\b/,
      reason: isChinese
        ? "命令会丢弃或覆盖本地 Git 改动。"
        : "This command can discard or overwrite local Git changes.",
    },
    {
      match: /\bsudo\b|\bchmod\b[^\n]*\s-r\b|\bchown\b[^\n]*\s-r\b/,
      reason: isChinese
        ? "命令涉及提权或递归权限修改。"
        : "This command requests elevated access or recursively changes permissions.",
    },
    {
      match:
        /\b(docker|podman)\b[^\n]*\b(prune|rm)\b|\bkubectl\b[^\n]*\bdelete\b|\bterraform\b[^\n]*\bdestroy\b/,
      reason: isChinese
        ? "命令可能删除容器、集群资源或基础设施。"
        : "This command can delete containers, cluster resources, or infrastructure.",
    },
    {
      match: /\b(npm|pnpm|yarn)\s+publish\b|\bvercel\b[^\n]*\b--prod\b/,
      reason: isChinese
        ? "命令会把变更发布到外部环境。"
        : "This command can publish changes to an external environment.",
    },
  ];

  return rules.find((rule) => rule.match.test(normalized))?.reason ?? null;
}

function formatRuntimeToneLabel(
  tone: RuntimeEventItem["tone"],
  isChinese: boolean,
) {
  if (tone === "running") {
    return isChinese ? "进行中" : "running";
  }
  if (tone === "success") {
    return isChinese ? "已完成" : "completed";
  }
  if (tone === "error") {
    return isChinese ? "失败" : "failed";
  }
  return isChinese ? "系统" : "system";
}

function formatExecutionStageLabel(
  kind: SessionStreamItem["kind"],
  isChinese: boolean,
) {
  if (kind === "tool_use") {
    return isChinese ? "已调度" : "queued";
  }
  if (kind === "tool_result") {
    return isChinese ? "已返回" : "result";
  }
  if (kind === "runtime") {
    return isChinese ? "运行时" : "runtime";
  }
  if (kind === "policy") {
    return isChinese ? "待审批" : "approval";
  }
  if (kind === "reasoning") {
    return isChinese ? "推理" : "thinking";
  }
  return isChinese ? "消息" : "message";
}

function buildSlashCompletion(
  action: SlashActionEntry,
  raw: string,
  fallbackToExample = false,
) {
  const normalizedRaw = raw.trimStart();
  const parsed = parseSlashCommand(normalizedRaw);
  if (parsed?.args) {
    return normalizedRaw;
  }

  if (fallbackToExample && action.example) {
    return action.example;
  }

  return action.argsHint ? `${action.command} ` : action.command;
}

const LazyVibeEditorSurface = dynamic(
  () => import("./vibe-editor-surface").then((mod) => mod.VibeEditorSurface),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center px-8 text-sm text-slate-500">
        Loading editor...
      </div>
    ),
  },
);

const LazyVibeTerminalTab = dynamic(
  () => import("./vibe-terminal-tab").then((mod) => mod.VibeTerminalTab),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center px-8 text-sm text-slate-500">
        Loading terminal...
      </div>
    ),
  },
);

function VibeCodingWorkbench() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const [settings, setSettings] = useLocalSettings();
  const { models } = useModels();
  const {
    artifacts,
    selectedArtifact,
    select: selectArtifact,
    deselect,
    setArtifacts,
  } = useArtifacts();
  const isChinese = t.locale.localName === "中文";
  const copy = useMemo(
    () =>
      isChinese
        ? {
            activityEmpty: "暂无动态",
            activityTitle: "线程动态",
            activeFile: "当前文件",
            agentCommands: "活动日志",
            agentIdle: "就绪",
            agentRunning: "执行中",
            applyAction: "应用修改",
            applyQueued: "已把确认后的改动继续交给 agent",
            buildPage: "规划项目",
            changesHint: "先确认版本差异，再决定是否继续让 agent 应用。",
            changesReady: "已生成可确认的版本变更",
            changesTab: "版本",
            checkpointBaseline: "对比基线",
            checkpointCompareCurrent: "当前版本",
            checkpointEmpty: "暂无快照",
            checkpointFiles: "个文件",
            checkpointIncomplete: "这个快照是精简版，只能回退已保存的文件。",
            checkpointMissingFile:
              "选中的快照里不包含当前文件，先切换到对应文件或换一个快照。",
            checkpointNoChanges: "当前内容和最近快照一致，没有新增快照。",
            checkpointRestoreFile: "回退当前文件",
            checkpointRestoreFileQueued: "已把当前文件回退请求交给 agent",
            checkpointRestoreRound: "回退这一轮",
            checkpointRestoreRoundQueued: "已把整轮回退请求交给 agent",
            checkpointSave: "保存快照",
            checkpointSaved: "本地快照已保存",
            checkpointsTitle: "版本快照",
            commandPlaceholder: "描述你的任务或工作流需求",
            composerHint: "从这里继续你的任务。",
            copiedPatch: "补丁已复制",
            createdBy: "Created by Deerflow",
            copyCommand: "复制记录",
            copyPatch: "复制补丁",
            diffEmpty: "当前文件还没有新的差异可确认。",
            editorEmptyCaption: "生成后自动显示",
            editorEmptyBadge: "预览",
            editorEmptyChecklist: ["页面", "文档", "资源"],
            editorEmptyBody: "运行后自动显示。",
            editorEmptyTitle: "暂无预览",
            editorTitle: "Canvas",
            explorerEmpty: "暂无资产",
            explorerSearchEmpty: "没有匹配的文件，可以换个关键词再试。",
            explorerSearchPlaceholder: "搜索文件或路径",
            explorerSummary:
              "项目资产、资料、版本和运行状态都汇聚在同一个工作区。",
            explorerTitle: "资产",
            filesCount: "文件",
            exitImmersive: "返回工作区",
            heroDescription: "工作流空间",
            heroTitle: "DeerFlow",
            focusShell: "定位到日志输入",
            expandTerminal: "放大日志",
            interruptShell: "中断执行",
            hideSidebar: "收起侧栏",
            livePrompt: "stdin",
            newSession: "新建线程",
            noPreviewDetail:
              "可以切换到下方预览、版本或日志，也可以直接打开原文件查看。",
            noPreview: "这个文件暂时没有可视化预览，先查看代码内容。",
            previewLoading: "正在加载内容...",
            previewTab: "预览",
            promptBadge: "任务",
            paletteCommands: "模板",
            paletteDescription: "搜索资产、视图和工作流。",
            paletteEmpty: "没有匹配结果",
            paletteFiles: "文件",
            paletteInputPlaceholder: "搜索文件、视图或工作流",
            paletteNavigation: "导航",
            paletteOpenTabs: "打开的标签",
            palettePrompts: "工作区视图",
            paletteRecentCommands: "版本快照",
            paletteTitle: "工作台面板",
            paletteTrigger: "工作台面板",
            quickActions: [
              {
                description: "目标、阶段、交付",
                icon: FileCodeIcon,
                label: "项目规划",
                prompt:
                  "请把当前需求整理成一个清晰的项目工作流：明确目标、阶段、关键页面或模块、优先级和下一步，并输出适合继续执行的结构化计划。",
              },
              {
                description: "问题、来源、结论",
                icon: SearchIcon,
                label: "研究线程",
                prompt:
                  "请开启一个研究线程，梳理当前主题的背景、关键问题、结论和待验证点，并给出下一步研究建议。",
              },
              {
                description: "文件、页面、资料",
                icon: EyeIcon,
                label: "资源库",
                prompt:
                  "请把当前工作区整理成清晰的资源库视角：区分页面、组件、文档、数据和素材，并指出还缺哪些关键资产。",
              },
              {
                description: "视觉、组件、交互",
                icon: SparklesIcon,
                label: "设计系统",
                prompt:
                  "请基于当前工作区整理一套设计系统方向：视觉基调、版式、组件层级、交互原则和需要统一的设计决策。",
              },
              {
                description: "skills、plugins、模块",
                icon: Code2Icon,
                label: "能力扩展",
                prompt:
                  "请从 skills、plugins 和工具扩展的角度审视当前工作区，梳理哪些能力应该沉淀为可复用模块，以及它们的职责和接入方式。",
              },
              {
                description: "触发、执行、通知",
                icon: CheckCircleIcon,
                label: "自动化",
                prompt:
                  "请基于当前工作区设计可执行的自动化流程，包括触发条件、执行动作、输出结果和异常处理。",
              },
            ] satisfies QuickAction[],
            quickStart: "工作流",
            resultSummary: "最近输出",
            reconnectShell: "重新连接",
            restoreTerminal: "还原日志",
            rerunCommand: "重新运行",
            runCommand: "运行",
            modelLabel: "模型",
            runtimeEmpty: "暂无运行事件",
            runtimeTitle: "运行与自动化",
            sessionTitle: "线程主线",
            shellDisconnected: "运行环境未连接",
            shellNotStarted: "运行环境未启动",
            shellReady: "运行环境已连接",
            shellStarting: "正在连接运行环境...",
            shellStopped: "运行环境已停止",
            shellStatus: "运行环境状态",
            startShell: "启动环境",
            statusTitle: "工作区状态",
            stopAgent: "停止 Agent",
            stopShell: "停止环境",
            surfaceHint: "拖动分隔线调整下方面板，在日志、预览和版本之间切换。",
            taskEmpty: "暂无待办",
            tasksTitle: "当前待办",
            terminalEmpty: "日志面板已就绪，可以查看运行输出。",
            terminalNotStartedHint: "运行未启动",
            terminalTab: "日志",
            threadLabel: "线程",
            untitled: "未命名会话",
            closeTab: "关闭标签",
            showSidebar: "展开侧栏",
            waitingInstruction: "等待下一条指令",
            waitingForOutput: "等待产出",
            workspaceTitle: "Studio",
          }
        : {
            activityEmpty:
              "This lane records thread activity, runtime output, and key actions.",
            activityTitle: "Thread Activity",
            activeFile: "Active file",
            agentCommands: "Activity Log",
            agentIdle: "Ready",
            agentRunning: "Running",
            applyAction: "Apply changes",
            applyQueued: "Reviewed changes have been sent back to the agent",
            buildPage: "Plan project",
            changesHint:
              "Review the version diff first, then decide whether to keep pushing the agent forward.",
            changesReady: "Fresh versions ready to review",
            changesTab: "Versions",
            checkpointBaseline: "Compare against",
            checkpointCompareCurrent: "Current version",
            checkpointEmpty:
              "No local checkpoints yet. A snapshot will be saved after each completed round, and you can also create one manually.",
            checkpointFiles: "files",
            checkpointIncomplete:
              "This checkpoint is partial, so only saved files can be restored.",
            checkpointMissingFile:
              "The selected checkpoint does not include the current file. Switch files or choose a different checkpoint.",
            checkpointNoChanges:
              "The current workspace matches the latest checkpoint, so no new snapshot was created.",
            checkpointRestoreFile: "Restore file",
            checkpointRestoreFileQueued:
              "The current file restore request has been sent to the agent",
            checkpointRestoreRound: "Restore round",
            checkpointRestoreRoundQueued:
              "The checkpoint restore request has been sent to the agent",
            checkpointSave: "Save checkpoint",
            checkpointSaved: "Local checkpoint saved",
            checkpointsTitle: "Snapshots",
            commandPlaceholder:
              "Describe the task or workflow you want to continue",
            composerHint: "Continue the task from here.",
            copiedPatch: "Patch copied",
            createdBy: "Created by Deerflow",
            copyCommand: "Copy log",
            copyPatch: "Copy patch",
            diffEmpty: "No fresh diff is available for this file yet.",
            editorEmptyCaption: "Auto preview after generation",
            editorEmptyBadge: "Preview",
            editorEmptyChecklist: ["Pages", "Docs", "Assets"],
            editorEmptyBody: "Generated output appears here.",
            editorEmptyTitle: "No preview yet",
            editorTitle: "Canvas",
            explorerEmpty:
              "No project assets have been generated yet. Start with research, a design system pass, or an automation flow.",
            explorerSearchEmpty:
              "No files match that search yet. Try a different keyword.",
            explorerSearchPlaceholder: "Search files or paths",
            explorerSummary:
              "Keep project assets, references, versions, and runtime state together in one workspace.",
            explorerTitle: "Assets",
            filesCount: "files",
            exitImmersive: "Back to workspace",
            heroDescription:
              "A browser workspace organized around threads, project assets, research, design systems, and automation.",
            heroTitle: "DeerFlow",
            focusShell: "Focus log input",
            expandTerminal: "Expand log",
            interruptShell: "Interrupt run",
            hideSidebar: "Hide sidebar",
            livePrompt: "stdin",
            newSession: "New thread",
            noPreviewDetail:
              "Switch to Preview, Versions, or Logs below, or open the raw file in a new tab for more context.",
            noPreview:
              "This file does not have a visual preview yet. Inspect the code above instead.",
            previewLoading: "Loading content...",
            previewTab: "Preview",
            promptBadge: "Task",
            paletteCommands: "Workflow Starters",
            paletteDescription:
              "Quickly search project assets, workspace views, and workflow modules.",
            paletteEmpty: "No matching results",
            paletteFiles: "Files",
            paletteInputPlaceholder: "Search files, views, or workflows",
            paletteNavigation: "Navigation",
            paletteOpenTabs: "Open Tabs",
            palettePrompts: "Workspace Views",
            paletteRecentCommands: "Snapshots",
            paletteTitle: "Workspace Palette",
            paletteTrigger: "Workspace Palette",
            quickActions: [
              {
                description:
                  "Clarify goals, scope, phases, and delivery structure",
                icon: FileCodeIcon,
                label: "Project Planning",
                prompt:
                  "Turn the current request into a clear project workflow: define goals, phases, key pages or modules, priorities, and the next step in a structured plan.",
              },
              {
                description:
                  "Organize questions, sources, conclusions, and open issues",
                icon: SearchIcon,
                label: "Research Thread",
                prompt:
                  "Open a research thread for the current topic: summarize the background, key questions, conclusions, unresolved points, and recommended next research steps.",
              },
              {
                description:
                  "Structure pages, documents, data, and reusable assets",
                icon: EyeIcon,
                label: "Resource Library",
                prompt:
                  "Reframe the current workspace as a resource library: separate pages, components, documents, data, and assets, then identify what is still missing.",
              },
              {
                description:
                  "Define visual language, interaction rules, and design decisions",
                icon: SparklesIcon,
                label: "Design System",
                prompt:
                  "Turn the current workspace into a design-system review: clarify the visual direction, layout rules, component hierarchy, interaction principles, and decisions that should be standardized.",
              },
              {
                description:
                  "Plan skills, plugins, and reusable capability modules",
                icon: Code2Icon,
                label: "Extensions",
                prompt:
                  "Review this workspace from a skills, plugins, and capability-modules perspective. Identify which capabilities should become reusable extensions and define their responsibilities and integration points.",
              },
              {
                description:
                  "Design recurring tasks, notifications, and automation flows",
                icon: CheckCircleIcon,
                label: "Automation",
                prompt:
                  "Design an automation flow for this workspace: define triggers, actions, outputs, dependencies, and failure handling.",
              },
            ] satisfies QuickAction[],
            quickStart: "Workflow Modules",
            resultSummary: "Recent Output",
            reconnectShell: "Reconnect",
            restoreTerminal: "Restore logs",
            rerunCommand: "Run again",
            runCommand: "Run",
            modelLabel: "Model",
            runtimeEmpty:
              "Runtime events, automation records, and approvals will collect here.",
            runtimeTitle: "Runtime & Automation",
            sessionTitle: "Thread Mainline",
            shellDisconnected: "Runtime offline",
            shellNotStarted: "Runtime not started",
            shellReady: "Runtime connected",
            shellStarting: "Connecting runtime...",
            shellStopped: "Runtime stopped",
            shellStatus: "Runtime Status",
            startShell: "Start runtime",
            statusTitle: "Workspace Status",
            stopAgent: "Stop Agent",
            stopShell: "Stop runtime",
            surfaceHint:
              "Drag the divider to resize the lower dock, or jump between Logs, Preview, and Versions.",
            taskEmpty: "No tasks yet",
            tasksTitle: "Current tasks",
            terminalEmpty:
              "The log panel is ready. Activity output will appear here.",
            terminalNotStartedHint:
              "The runtime has not been started yet. Use Start runtime to inspect execution logs.",
            terminalTab: "Logs",
            threadLabel: "Thread",
            untitled: "Untitled session",
            closeTab: "Close tab",
            showSidebar: "Show sidebar",
            waitingInstruction: "waiting for the next instruction",
            waitingForOutput: "Waiting for output",
            workspaceTitle: "Studio",
          },
    [isChinese],
  );

  const isNewThread = threadIdFromPath === "new";
  const returnToParam = searchParams.get("returnTo");
  const safeReturnTo = returnToParam?.startsWith("/workspace/")
    ? returnToParam
    : null;
  const [threadId, setThreadId] = useState<string | null>(null);
  const [finalState, setFinalState] = useState<AgentThreadState | null>(null);
  const [composerSeed, setComposerSeed] = useState(0);
  const [composerDraft, setComposerDraft] = useState("");
  const [slashAssistIndex, setSlashAssistIndex] = useState(0);
  const [activeWorkflowIndex, setActiveWorkflowIndex] = useState(0);
  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>();
  const [bottomTab, setBottomTab] = useState<ConsoleTab>("terminal");
  const [rightPaneMode, setRightPaneMode] = useState<"workspace" | "inspector">(
    "workspace",
  );
  const [openArtifacts, setOpenArtifacts] = useState<string[]>([]);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<
    string | null
  >(null);
  const [autoCheckpointTick, setAutoCheckpointTick] = useState(0);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEventItem[]>([]);
  const [pendingCommandApproval, setPendingCommandApproval] =
    useState<PendingCommandApproval | null>(null);
  const [reviewSnapshots, setReviewSnapshots] = useState<
    Record<string, string>
  >({});
  const threadBootstrapRequestRef = useRef(0);
  const knownArtifactsRef = useRef<Set<string>>(new Set());
  const artifactsBootstrappedRef = useRef(false);
  const checkpointCaptureInFlightRef = useRef(false);
  const checkpointInitialCapturedRef = useRef(false);
  const lastAutoCheckpointTickRef = useRef(0);
  const terminalInputQueueRef = useRef("");
  const terminalFlushTimerRef = useRef<number | null>(null);
  const terminalSendChainRef = useRef(Promise.resolve());
  const terminalResizeDebounceRef = useRef<number | null>(null);
  const pendingTerminalSizeRef = useRef<{ cols: number; rows: number } | null>(
    null,
  );
  const activeWorkflowRunIdRef = useRef<string | null>(null);
  const lastTerminalSizeRef = useRef({ cols: 0, rows: 0 });
  const terminalAutoBootedRef = useRef(false);
  const {
    checkpoints,
    loaded: checkpointsLoaded,
    setCheckpoints,
  } = useVibeCheckpoints(threadId);
  const {
    loaded: workspacePrefsLoaded,
    prefs: workspacePrefs,
    setPrefs: setWorkspacePrefs,
  } = useVibeWorkspacePrefs(threadId);
  const workflowRunsQuery = useWorkflowRuns(threadId, {
    enabled: Boolean(threadId),
  });
  const createWorkflowRun = useCreateWorkflowRun(threadId);
  const updateWorkflowRun = useUpdateWorkflowRun(threadId);
  const { data: systemOverview } = useSystemOverview();
  const approvalMode = workspacePrefs.approvalMode as ApprovalMode;
  const hookToggles = workspacePrefs.hookToggles;
  const compactNotes = workspacePrefs.compactNotes;

  useEffect(() => {
    let cancelled = false;
    const requestId = threadBootstrapRequestRef.current + 1;
    threadBootstrapRequestRef.current = requestId;

    const prepareThread = async () => {
      setFinalState(null);

      if (threadIdFromPath === "new") {
        setThreadId(uuid());
        return;
      }

      setThreadId(null);
      try {
        await getAPIClient().threads.create({
          threadId: threadIdFromPath,
          ifExists: "do_nothing",
        });

        if (cancelled || threadBootstrapRequestRef.current !== requestId) {
          return;
        }

        setThreadId(threadIdFromPath);
      } catch (error) {
        if (cancelled || threadBootstrapRequestRef.current !== requestId) {
          return;
        }

        setThreadId(threadIdFromPath);
        toast.error(getThreadErrorDisplay(error).message);
      }
    };

    void prepareThread();

    return () => {
      cancelled = true;
    };
  }, [threadIdFromPath]);

  const finishActiveWorkflowRun = useCallback(
    (
      status: Extract<WorkflowRunStatus, "completed" | "failed" | "cancelled">,
      state?: AgentThreadState,
      error?: unknown,
    ) => {
      const runId = activeWorkflowRunIdRef.current;
      if (!runId || !threadId) {
        return;
      }

      const latestAssistantMessage = [...(state?.messages ?? [])]
        .reverse()
        .find((message) => message.type === "ai");
      const summary = latestAssistantMessage
        ? summarizeCheckpointSummary(textOfMessage(latestAssistantMessage), 900)
        : undefined;

      activeWorkflowRunIdRef.current = null;

      void updateWorkflowRun
        .mutateAsync({
          runId,
          payload: {
            error:
              status === "failed"
                ? getThreadErrorDisplay(error).message
                : undefined,
            outputs: state?.artifacts ?? undefined,
            status,
            summary,
          },
        })
        .catch((updateError) => {
          console.error("Failed to update workflow run", updateError);
        });
    },
    [threadId, updateWorkflowRun],
  );

  const thread = useThreadStream({
    isNewThread,
    threadId,
    onCustomEvent(event) {
      const runtimeEvent = buildRuntimeEventItem(event, isChinese);
      if (!runtimeEvent) {
        return;
      }
      setRuntimeEvents((current) => [runtimeEvent, ...current].slice(0, 8));
    },
    onFinish(state) {
      setFinalState(state);
      setAutoCheckpointTick((current) => current + 1);
      finishActiveWorkflowRun("completed", state);
    },
    onError(error) {
      finishActiveWorkflowRun("failed", undefined, error);
      toast.error(getThreadErrorDisplay(error).message);
    },
  }) as unknown as UseStream<AgentThreadState>;

  const handleSubmit = useSubmitThread({
    isNewThread,
    threadId,
    thread,
    threadContext: {
      ...settings.context,
      thinking_enabled: settings.context.mode !== "flash",
      is_plan_mode:
        settings.context.mode === "pro" ||
        (settings.context.mode === "ultra" &&
          (models.find((model) => model.name === settings.context.model_name)
            ?.ultra_uses_plan_mode ??
            true)),
      subagent_enabled: settings.context.mode === "ultra",
      max_concurrent_subagents:
        settings.context.mode === "ultra" ? 1 : undefined,
    },
    afterSubmit() {
      const nextHref = safeReturnTo
        ? `/workspace/vibe/${threadId}?returnTo=${encodeURIComponent(
            safeReturnTo,
          )}`
        : `/workspace/vibe/${threadId}`;
      router.replace(nextHref);
    },
  });
  const submitAgentMessage = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      const compactMemory =
        hookToggles.compactMemory && compactNotes.length > 0
          ? compactNotes[0]?.summary
          : null;
      const policyPrelude = [
        buildApprovalModePrelude({ isChinese, mode: approvalMode }),
        buildHookPrelude({
          compactNote: compactMemory,
          hooks: hookToggles,
          isChinese,
        }),
      ]
        .filter(Boolean)
        .join("\n\n");
      const nextMessage = {
        ...message,
        text: policyPrelude
          ? `${policyPrelude}\n\n${isChinese ? "当前请求" : "Current request"}:\n${text}`
          : text,
      };

      const requestGuardrails =
        systemOverview?.request_guardrails ??
        (await fetchSystemOverview()
          .then((data) => data.request_guardrails)
          .catch(() => null));
      const selectedModelName =
        typeof settings.context.model_name === "string"
          ? settings.context.model_name
          : null;
      const blocksChineseContent = Boolean(
        selectedModelName &&
        requestGuardrails?.blocked_chinese_model_names.includes(
          selectedModelName,
        ),
      );
      const hasChineseContent =
        containsChineseText(nextMessage.text) ||
        Boolean(
          nextMessage.files?.some((file) => containsChineseText(file.filename)),
        );

      if (blocksChineseContent && hasChineseContent) {
        toast(
          requestGuardrails?.message ??
            "当前配置的上游模型接口对中文内容支持不稳定，本次将继续尝试发送；如果失败可稍后重试。",
        );
      }

      await handleSubmit(nextMessage);
    },
    [
      approvalMode,
      compactNotes,
      handleSubmit,
      hookToggles,
      isChinese,
      settings.context.model_name,
      systemOverview?.request_guardrails,
    ],
  );

  const handleStopAgent = useCallback(async () => {
    await thread.stop();
    finishActiveWorkflowRun("cancelled");
  }, [finishActiveWorkflowRun, thread]);

  const terminal = useTerminalSession(threadId ?? "", {
    enabled: Boolean(threadId),
    autoStart: false,
  });

  useEffect(() => {
    document.title = `${copy.heroTitle} - ${t.pages.appName}`;
  }, [copy.heroTitle, t.pages.appName]);

  useEffect(() => {
    setRuntimeEvents([]);
    setPendingCommandApproval(null);
    setComposerDraft("");
    setSlashAssistIndex(0);
  }, [threadId]);

  useEffect(() => {
    checkpointCaptureInFlightRef.current = false;
    checkpointInitialCapturedRef.current = false;
    lastAutoCheckpointTickRef.current = 0;
    setAutoCheckpointTick(0);
    setSelectedCheckpointId(null);
  }, [threadId]);

  useEffect(() => {
    if (!workspacePrefsLoaded) {
      return;
    }
    setBottomTab((current) =>
      current === workspacePrefs.bottomTab ? current : workspacePrefs.bottomTab,
    );
    setOpenArtifacts((current) =>
      sameArtifacts(current, workspacePrefs.openArtifacts)
        ? current
        : workspacePrefs.openArtifacts,
    );
    setRecentCommands((current) =>
      sameArtifacts(current, workspacePrefs.recentCommands)
        ? current
        : workspacePrefs.recentCommands,
    );
  }, [
    workspacePrefs.bottomTab,
    workspacePrefs.openArtifacts,
    workspacePrefs.recentCommands,
    workspacePrefsLoaded,
  ]);

  const threadArtifacts = useMemo(
    () => thread.values.artifacts ?? [],
    [thread.values.artifacts],
  );
  const threadArtifactsSignature = useMemo(
    () => threadArtifacts.join("::"),
    [threadArtifacts],
  );

  useEffect(() => {
    if (!workspacePrefsLoaded) {
      return;
    }
    setWorkspacePrefs({
      bottomTab,
      openArtifacts,
      recentCommands,
      selectedArtifact:
        selectedArtifact ??
        (threadArtifacts.length > 0 ? workspacePrefs.selectedArtifact : null),
    });
  }, [
    bottomTab,
    openArtifacts,
    recentCommands,
    selectedArtifact,
    setWorkspacePrefs,
    threadArtifacts.length,
    workspacePrefs.selectedArtifact,
    workspacePrefsLoaded,
  ]);

  useEffect(() => {
    const nextArtifacts = threadArtifacts;
    if (!sameArtifacts(artifacts, nextArtifacts)) {
      setArtifacts(nextArtifacts);
    }
    if (nextArtifacts.length === 0) {
      if (selectedArtifact) {
        deselect();
      }
      return;
    }
    const preferredArtifact =
      selectedArtifact && nextArtifacts.includes(selectedArtifact)
        ? selectedArtifact
        : workspacePrefs.selectedArtifact &&
            nextArtifacts.includes(workspacePrefs.selectedArtifact)
          ? workspacePrefs.selectedArtifact
          : nextArtifacts[nextArtifacts.length - 1]!;
    if (preferredArtifact !== selectedArtifact) {
      selectArtifact(preferredArtifact, true);
      setOpenArtifacts((current) =>
        [
          preferredArtifact,
          ...current.filter((item) => item !== preferredArtifact),
        ].slice(0, MAX_OPEN_TABS),
      );
    }
  }, [
    artifacts,
    deselect,
    selectArtifact,
    selectedArtifact,
    setArtifacts,
    threadArtifacts,
    threadArtifactsSignature,
    workspacePrefs.selectedArtifact,
  ]);

  const messages = useMemo(
    () => finalState?.messages ?? thread.values.messages ?? [],
    [finalState?.messages, thread.values.messages],
  );

  const latestAssistantSummary = useMemo(() => {
    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.type === "ai");
    return summarizeCheckpointSummary(
      latestAssistantMessage ? textOfMessage(latestAssistantMessage) : "",
    );
  }, [messages]);

  useEffect(() => {
    const nextArtifacts = new Set(threadArtifacts);
    if (!artifactsBootstrappedRef.current) {
      knownArtifactsRef.current = nextArtifacts;
      artifactsBootstrappedRef.current = true;
      return;
    }

    const addedArtifacts = threadArtifacts.filter(
      (artifact) => !knownArtifactsRef.current.has(artifact),
    );
    if (addedArtifacts.length > 0) {
      setReviewSnapshots((current) => {
        const next = { ...current };
        let changed = false;
        addedArtifacts.forEach((artifact) => {
          if (next[artifact] === undefined) {
            next[artifact] = "";
            changed = true;
          }
        });
        return changed ? next : current;
      });
    }

    knownArtifactsRef.current = nextArtifacts;
  }, [threadArtifacts, threadArtifactsSignature]);

  const todos = useMemo(() => thread.values.todos ?? [], [thread.values.todos]);
  const fileItems = useMemo(() => [...artifacts].reverse(), [artifacts]);
  const openTabs = useMemo(
    () =>
      openArtifacts
        .filter((artifact) => fileItems.includes(artifact))
        .slice(0, MAX_OPEN_TABS),
    [fileItems, openArtifacts],
  );
  const sessionTitle = isNewThread
    ? copy.newSession
    : thread.values.title || copy.untitled;
  const approvalModeLabel = useMemo(() => {
    if (approvalMode === "accept_edits") {
      return isChinese ? "接受编辑" : "Accept edits";
    }
    if (approvalMode === "plan") {
      return isChinese ? "计划优先" : "Plan first";
    }
    if (approvalMode === "full_auto") {
      return isChinese ? "全自动" : "Full auto";
    }
    return isChinese ? "默认确认" : "Default";
  }, [approvalMode, isChinese]);
  const checkpointTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(isChinese ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      }),
    [isChinese],
  );
  const openChatHref = isNewThread
    ? "/workspace/chats/new"
    : pathOfThread(threadId ?? "new");
  const exitHref = safeReturnTo ?? openChatHref;
  const newSessionHref = safeReturnTo
    ? `/workspace/vibe/new?returnTo=${encodeURIComponent(safeReturnTo)}`
    : "/workspace/vibe/new";
  const transcriptChars = useMemo(
    () =>
      messages.reduce(
        (total, message) => total + (textOfMessage(message)?.length ?? 0),
        0,
      ),
    [messages],
  );
  const compactStateLabel =
    transcriptChars > 14_000 || messages.length > 16
      ? isChinese
        ? "建议 compact"
        : "Compact recommended"
      : isChinese
        ? "上下文稳定"
        : "Context stable";

  const rememberOpenArtifact = useCallback((artifact: string) => {
    setOpenArtifacts((current) =>
      [artifact, ...current.filter((item) => item !== artifact)].slice(
        0,
        MAX_OPEN_TABS,
      ),
    );
  }, []);

  const rememberRecentCommand = useCallback((command: string) => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      return;
    }
    setRecentCommands((current) =>
      [
        trimmedCommand,
        ...current.filter((item) => item !== trimmedCommand),
      ].slice(0, MAX_RECENT_COMMANDS),
    );
  }, []);

  const handleSelectArtifact = useCallback(
    (artifact: string) => {
      selectArtifact(artifact);
      rememberOpenArtifact(artifact);
    },
    [rememberOpenArtifact, selectArtifact],
  );

  const cycleOpenTabs = useCallback(
    (direction: 1 | -1) => {
      if (openTabs.length < 2) {
        return;
      }
      const currentIndex = selectedArtifact
        ? openTabs.indexOf(selectedArtifact)
        : -1;
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (safeIndex + direction + openTabs.length) % openTabs.length;
      const nextArtifact = openTabs[nextIndex];
      if (nextArtifact) {
        handleSelectArtifact(nextArtifact);
      }
    },
    [handleSelectArtifact, openTabs, selectedArtifact],
  );

  useEffect(() => {
    setOpenArtifacts((current) => {
      const filtered = current.filter((artifact) =>
        fileItems.includes(artifact),
      );
      if (!selectedArtifact || !fileItems.includes(selectedArtifact)) {
        return filtered;
      }
      const next = [
        selectedArtifact,
        ...filtered.filter((artifact) => artifact !== selectedArtifact),
      ].slice(0, MAX_OPEN_TABS);
      const unchanged =
        next.length === current.length &&
        next.every((artifact, index) => artifact === current[index]);
      return unchanged ? current : next;
    });
  }, [fileItems, selectedArtifact]);

  const selectedArtifactMeta = useMemo(() => {
    if (!selectedArtifact) {
      return null;
    }
    const normalizedPath = normalizeArtifactPath(selectedArtifact);
    const isWriteFile = isWriteFileArtifact(selectedArtifact);
    const { isCodeFile, language } = checkCodeFile(normalizedPath);
    return {
      normalizedPath,
      isWriteFile,
      isCodeFile,
      language,
      previewable:
        language === "markdown" || (!isWriteFile && language === "html"),
    };
  }, [selectedArtifact]);

  const {
    content: selectedArtifactContent,
    isLoading: selectedArtifactLoading,
  } = useArtifactContent({
    filepath: selectedArtifact ?? "",
    threadId: threadId ?? "",
    enabled: Boolean(
      selectedArtifact &&
      selectedArtifactMeta?.isCodeFile &&
      !selectedArtifactMeta?.isWriteFile,
    ),
    thread,
  });

  useEffect(() => {
    if (
      !selectedArtifact ||
      !selectedArtifactMeta?.isCodeFile ||
      selectedArtifactContent === undefined
    ) {
      return;
    }
    setReviewSnapshots((current) => {
      if (current[selectedArtifact] !== undefined) {
        return current;
      }
      return {
        ...current,
        [selectedArtifact]: selectedArtifactContent,
      };
    });
  }, [
    selectedArtifact,
    selectedArtifactContent,
    selectedArtifactMeta?.isCodeFile,
  ]);

  const selectedCheckpoint = useMemo(
    () =>
      selectedCheckpointId
        ? (checkpoints.find(
            (checkpoint) => checkpoint.id === selectedCheckpointId,
          ) ?? null)
        : null,
    [checkpoints, selectedCheckpointId],
  );

  const selectedCheckpointContent =
    selectedArtifactMeta?.normalizedPath && selectedCheckpoint
      ? selectedCheckpoint.files[selectedArtifactMeta.normalizedPath]
      : undefined;

  const selectedReviewSnapshot = selectedArtifact
    ? selectedCheckpoint
      ? selectedCheckpointContent
      : reviewSnapshots[selectedArtifact]
    : undefined;

  const selectedCheckpointMissingFile = Boolean(
    selectedCheckpoint &&
    selectedArtifactMeta?.isCodeFile &&
    selectedArtifactMeta.normalizedPath &&
    selectedCheckpointContent === undefined,
  );

  const selectedDiff = useMemo(() => {
    if (
      !selectedArtifact ||
      !selectedArtifactMeta?.isCodeFile ||
      selectedArtifactContent === undefined ||
      selectedReviewSnapshot === undefined
    ) {
      return null;
    }
    const diffLines = buildDiffLines(
      selectedReviewSnapshot,
      selectedArtifactContent,
    );
    const additions = diffLines.filter((line) => line.kind === "add").length;
    const deletions = diffLines.filter((line) => line.kind === "remove").length;
    const hasChanges = selectedReviewSnapshot !== selectedArtifactContent;
    return {
      additions,
      deletions,
      diffLines,
      hasChanges,
      patch: buildUnifiedPatch(
        selectedArtifact,
        selectedReviewSnapshot,
        selectedArtifactContent,
        diffLines,
      ),
    };
  }, [
    selectedArtifact,
    selectedArtifactContent,
    selectedArtifactMeta?.isCodeFile,
    selectedReviewSnapshot,
  ]);

  const activityItems = useMemo(() => {
    return messages
      .map((message, index) => {
        if (message.type !== "human" && message.type !== "ai") {
          return null;
        }
        const text =
          textOfMessage(message) ??
          (message.type === "ai"
            ? thread.isLoading
              ? copy.agentRunning
              : copy.agentIdle
            : "");
        if (!text) {
          return null;
        }
        return {
          id: message.id ?? `${message.type}-${index}`,
          role: message.type === "human" ? "user" : "assistant",
          text,
        } satisfies ActivityItem;
      })
      .filter((item): item is ActivityItem => item !== null)
      .slice(-10);
  }, [copy.agentIdle, copy.agentRunning, messages, thread.isLoading]);

  const agentCommandItems = useMemo(() => {
    const streamMessages = messages as unknown as Message[];
    const items: AgentCommandItem[] = [];

    streamMessages.forEach((message, messageIndex) => {
      if (message.type !== "ai") {
        return;
      }

      message.tool_calls?.forEach((toolCall, toolIndex) => {
        if (toolCall.name !== "bash") {
          return;
        }
        const args = toolCall.args as
          | { description?: string; command?: string }
          | undefined;
        if (!args?.command) {
          return;
        }
        items.push({
          id:
            toolCall.id ??
            `${message.id ?? `message-${messageIndex}`}-${toolIndex}`,
          description: args.description ?? copy.livePrompt,
          command: args.command,
          result: toolCall.id
            ? findToolCallResult(toolCall.id, streamMessages)
            : undefined,
        });
      });
    });

    return items.slice(-8).reverse();
  }, [copy.livePrompt, messages]);
  const sessionStreamItems = useMemo<SessionStreamItem[]>(() => {
    const messageItems: SessionStreamItem[] = [];
    const streamMessages = messages as unknown as Message[];

    streamMessages.forEach((message, messageIndex) => {
      if (message.type === "human") {
        const text = truncateForStream(
          textOfMessage(message as Parameters<typeof textOfMessage>[0]),
          900,
        );
        if (!text) {
          return;
        }
        messageItems.push({
          body: text,
          id: message.id ?? `human-${messageIndex}`,
          kind: "user",
          label: "you",
        });
        return;
      }

      if (message.type !== "ai") {
        return;
      }

      const reasoning = truncateForStream(
        extractReasoningContentFromMessage(
          message as Parameters<typeof extractReasoningContentFromMessage>[0],
        ),
        320,
      );
      if (reasoning) {
        messageItems.push({
          body: reasoning,
          id: `${message.id ?? `ai-${messageIndex}`}-reasoning`,
          kind: "reasoning",
          label: isChinese ? "thinking" : "thinking",
          meta: isChinese ? "推理片段" : "reasoning excerpt",
        });
      }

      const text = truncateForStream(
        textOfMessage(message as Parameters<typeof textOfMessage>[0]),
        900,
      );
      if (text) {
        messageItems.push({
          body: text,
          id: `${message.id ?? `ai-${messageIndex}`}-text`,
          kind: "assistant",
          label: "flow",
        });
      }

      message.tool_calls?.forEach((toolCall, toolIndex) => {
        const rawArgs =
          typeof toolCall.args === "object" && toolCall.args !== null
            ? (toolCall.args as Record<string, unknown>)
            : undefined;
        const toolSummary = truncateForStream(
          summarizeToolArgs(rawArgs),
          toolCall.name === "bash" ? 320 : 180,
        );

        messageItems.push({
          body:
            toolSummary ||
            (toolCall.name === "task"
              ? isChinese
                ? "创建子任务"
                : "Create subtask"
              : isChinese
                ? "执行工具调用"
                : "Execute tool call"),
          id:
            toolCall.id ??
            `${message.id ?? `ai-${messageIndex}`}-tool-${toolIndex}`,
          kind: "tool_use",
          label: toolCall.name,
          meta: explainToolCall(toolCall, t),
        });

        if (!toolCall.id) {
          return;
        }

        const result = truncateForStream(
          findToolCallResult(toolCall.id, streamMessages),
          260,
        );
        if (!result) {
          return;
        }

        messageItems.push({
          body: result,
          id: `${toolCall.id}-result`,
          kind: "tool_result",
          label: `${toolCall.name}.result`,
          meta: isChinese ? "工具返回" : "tool result",
        });
      });
    });

    const runtimeItems = runtimeEvents
      .slice()
      .reverse()
      .map(
        (event) =>
          ({
            body: event.detail,
            id: event.id,
            kind: "runtime",
            label: event.title.toLowerCase(),
            meta: `${formatRuntimeToneLabel(event.tone, isChinese)} · ${checkpointTimeFormatter.format(new Date(event.createdAt))}`,
          }) satisfies SessionStreamItem,
      );

    const policyItems = pendingCommandApproval
      ? [
          {
            body: `$ ${pendingCommandApproval.command}\n\n${pendingCommandApproval.reason}`,
            id: pendingCommandApproval.id,
            kind: "policy",
            label: isChinese ? "approval" : "approval",
            meta: isChinese ? "等待确认" : "awaiting approval",
          } satisfies SessionStreamItem,
        ]
      : [];

    return [...messageItems, ...runtimeItems, ...policyItems].slice(-32);
  }, [
    checkpointTimeFormatter,
    isChinese,
    messages,
    pendingCommandApproval,
    runtimeEvents,
    t,
  ]);

  const selectedCodeValue = useMemo(() => {
    if (!selectedArtifactMeta?.isCodeFile) {
      return "";
    }
    return selectedArtifactContent ?? "";
  }, [selectedArtifactContent, selectedArtifactMeta?.isCodeFile]);

  const pushRuntimeEvent = useCallback(
    (
      title: string,
      detail: string,
      tone: RuntimeEventItem["tone"] = "info",
    ) => {
      setRuntimeEvents((current) =>
        [
          {
            createdAt: new Date().toISOString(),
            id: uuid(),
            title,
            detail,
            tone,
          },
          ...current,
        ].slice(0, 8),
      );
    },
    [],
  );

  const handleSetApprovalMode = useCallback(
    (mode: ApprovalMode) => {
      setWorkspacePrefs({ approvalMode: mode });
      pushRuntimeEvent(
        isChinese ? "Approval mode" : "Approval mode",
        isChinese
          ? `已切换到 ${mode === "accept_edits" ? "接受编辑" : mode === "plan" ? "计划优先" : mode === "full_auto" ? "全自动" : "默认确认"}`
          : `Switched to ${mode === "accept_edits" ? "accept edits" : mode === "plan" ? "plan first" : mode === "full_auto" ? "full auto" : "default"} mode`,
        "info",
      );
    },
    [isChinese, pushRuntimeEvent, setWorkspacePrefs],
  );

  const handleToggleHook = useCallback(
    (key: HookToggleKey) => {
      const nextValue = !hookToggles[key];
      setWorkspacePrefs({
        hookToggles: {
          ...hookToggles,
          [key]: nextValue,
        },
      });

      const label =
        key === "guardCommands"
          ? isChinese
            ? "命令保护"
            : "command guard"
          : key === "summarizeChanges"
            ? isChinese
              ? "变更总结"
              : "change summary"
            : isChinese
              ? "compact 记忆"
              : "compact memory";

      pushRuntimeEvent(
        isChinese ? "Hook toggled" : "Hook toggled",
        isChinese
          ? `${label}${nextValue ? "已启用" : "已关闭"}`
          : `${label} ${nextValue ? "enabled" : "disabled"}`,
        "info",
      );
    },
    [hookToggles, isChinese, pushRuntimeEvent, setWorkspacePrefs],
  );

  const handleCreateCompactNote = useCallback(
    (scope?: string) => {
      const summaryParts = [
        `${isChinese ? "会话" : "Session"}: ${sessionTitle}`,
        `${isChinese ? "状态" : "Status"}: ${thread.isLoading ? copy.agentRunning : copy.agentIdle}`,
        `${isChinese ? "最近总结" : "Latest summary"}: ${latestAssistantSummary || copy.waitingInstruction}`,
        `${isChinese ? "活动文件" : "Active file"}: ${
          selectedArtifact
            ? normalizeArtifactPath(selectedArtifact)
            : copy.waitingForOutput
        }`,
      ];

      if (todos.length > 0) {
        summaryParts.push(
          `${isChinese ? "待办" : "Tasks"}: ${todos
            .slice(0, 5)
            .map(
              (todo) =>
                `${todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[~]" : "[ ]"} ${todo.content}`,
            )
            .join(" | ")}`,
        );
      }

      if (recentCommands.length > 0) {
        summaryParts.push(
          `${isChinese ? "最近命令" : "Recent commands"}: ${recentCommands
            .slice(0, 4)
            .join(" | ")}`,
        );
      }

      if (scope) {
        summaryParts.push(`${isChinese ? "聚焦范围" : "Focus"}: ${scope}`);
      }

      const summary = summaryParts.join("\n");
      const note = {
        createdAt: new Date().toISOString(),
        id: uuid(),
        scope: scope ?? "",
        summary,
      };

      setWorkspacePrefs((current) => ({
        compactNotes: [note, ...current.compactNotes].slice(0, 6),
      }));
      setRightPaneMode("workspace");
      pushRuntimeEvent(
        isChinese ? "Compact note" : "Compact note",
        scope ?? compactStateLabel,
        "success",
      );
      toast.success(isChinese ? "已生成 compact 便笺" : "Compact note created");
      return note;
    },
    [
      compactStateLabel,
      copy.agentIdle,
      copy.agentRunning,
      copy.waitingInstruction,
      copy.waitingForOutput,
      isChinese,
      latestAssistantSummary,
      pushRuntimeEvent,
      recentCommands,
      selectedArtifact,
      sessionTitle,
      setWorkspacePrefs,
      thread.isLoading,
      todos,
    ],
  );

  const captureCheckpoint = useCallback(
    async (source: VibeCheckpoint["source"]) => {
      if (
        !threadId ||
        checkpointCaptureInFlightRef.current ||
        threadArtifacts.length === 0
      ) {
        return null;
      }

      checkpointCaptureInFlightRef.current = true;

      try {
        const checkpointableArtifacts = threadArtifacts.filter((artifact) => {
          const normalizedPath = normalizeArtifactPath(artifact);
          return checkCodeFile(normalizedPath).isCodeFile;
        });

        if (checkpointableArtifacts.length === 0) {
          if (source === "manual") {
            toast.message(copy.checkpointEmpty);
          }
          return null;
        }

        const filesMap = new Map<string, string>();
        let omittedCount = 0;
        let totalChars = 0;

        for (const artifact of checkpointableArtifacts) {
          const normalizedPath = normalizeArtifactPath(artifact);
          const previousContent = filesMap.get(normalizedPath);
          let content = "";

          try {
            content = isWriteFileArtifact(artifact)
              ? (loadArtifactContentFromToolCall({ url: artifact, thread }) ??
                "")
              : await loadArtifactContent({ filepath: artifact, threadId });
          } catch (error) {
            console.error("Failed to capture checkpoint artifact:", error);
            continue;
          }

          if (!content) {
            continue;
          }

          const isNewFile = previousContent === undefined;
          const nextTotalChars =
            totalChars - (previousContent?.length ?? 0) + content.length;

          if (isNewFile && filesMap.size >= MAX_LOCAL_CHECKPOINT_FILES) {
            omittedCount += 1;
            continue;
          }

          if (isNewFile && nextTotalChars > MAX_LOCAL_CHECKPOINT_CHARS) {
            omittedCount += 1;
            continue;
          }

          filesMap.set(normalizedPath, content);
          totalChars = nextTotalChars;
        }

        const files = Object.fromEntries(
          [...filesMap.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        );

        if (Object.keys(files).length === 0) {
          if (source === "manual") {
            toast.error(copy.checkpointEmpty);
          }
          return null;
        }

        let createdCheckpoint: VibeCheckpoint | null = null;
        let previousLatestId: string | null = null;

        setCheckpoints((current) => {
          previousLatestId = current[0]?.id ?? null;
          if (current[0] && sameCheckpointFiles(current[0].files, files)) {
            return current;
          }

          createdCheckpoint = {
            createdAt: new Date().toISOString(),
            files,
            id: uuid(),
            label: buildCheckpointLabel({
              index: current.length + 1,
              isChinese,
              source,
            }),
            omittedCount,
            source,
            summary: latestAssistantSummary,
          };

          return [createdCheckpoint, ...current].slice(
            0,
            MAX_LOCAL_CHECKPOINTS,
          );
        });

        if (!createdCheckpoint) {
          if (source === "manual") {
            toast.message(copy.checkpointNoChanges);
          }
          return null;
        }

        const savedCheckpoint = createdCheckpoint as VibeCheckpoint;

        setSelectedCheckpointId(previousLatestId ?? savedCheckpoint.id);

        if (source === "manual") {
          toast.success(copy.checkpointSaved);
          pushRuntimeEvent(
            isChinese ? "版本快照" : "Checkpoint",
            savedCheckpoint.label,
            "success",
          );
        }

        return savedCheckpoint;
      } catch (error) {
        console.error(error);
        if (source === "manual") {
          toast.error(copy.checkpointEmpty);
        }
        return null;
      } finally {
        checkpointCaptureInFlightRef.current = false;
      }
    },
    [
      copy.checkpointEmpty,
      copy.checkpointNoChanges,
      copy.checkpointSaved,
      isChinese,
      latestAssistantSummary,
      pushRuntimeEvent,
      setCheckpoints,
      thread,
      threadArtifacts,
      threadId,
    ],
  );

  const queuePrompt = useCallback((prompt: string) => {
    setComposerDraft(prompt);
    setSlashAssistIndex(0);
    setPrefillPrompt(prompt);
    setComposerSeed((current) => current + 1);
  }, []);
  const handleComposerDraftChange = useCallback((value: string) => {
    setComposerDraft(value);
    setSlashAssistIndex(0);
  }, []);

  const openInspectorTab = useCallback((tab: ConsoleTab) => {
    setRightPaneMode("inspector");
    setBottomTab(tab);
  }, []);

  const workspaceViews = useMemo<WorkspaceViewEntry[]>(
    () => [
      {
        description: isChinese
          ? "回到主线程，查看项目上下文与推进记录"
          : "Return to the main thread and review project progress",
        label: isChinese ? "线程动态" : "Thread Activity",
        onSelect: () => setRightPaneMode("workspace"),
        value: isChinese ? "主线" : "Mainline",
      },
      {
        description: isChinese
          ? "打开预览画布，查看页面与文档内容"
          : "Open the preview canvas for pages and documents",
        label: isChinese ? "预览画布" : "Preview Canvas",
        onSelect: () => openInspectorTab("preview"),
        value: copy.previewTab,
      },
      {
        description: isChinese
          ? "切到版本视图，查看变更和快照"
          : "Switch to the versions view for diffs and snapshots",
        label: isChinese ? "版本回看" : "Version Review",
        onSelect: () => openInspectorTab("changes"),
        value: copy.changesTab,
      },
      {
        description: isChinese
          ? "打开日志面板，查看运行输出和系统状态"
          : "Open the logs panel for runtime output and system state",
        label: isChinese ? "活动日志" : "Activity Log",
        onSelect: () => {
          openInspectorTab("terminal");
          void terminal.start().catch((error) => {
            console.error(error);
          });
        },
        value: copy.terminalTab,
      },
    ],
    [
      copy.changesTab,
      copy.previewTab,
      copy.terminalTab,
      isChinese,
      openInspectorTab,
      terminal,
    ],
  );

  const slashActionEntries = useMemo<SlashActionEntry[]>(
    () => [
      {
        argsHint: isChinese ? "项目范围" : "project scope",
        command: "/project",
        description: copy.quickActions[0]?.description ?? "",
        example: isChinese
          ? "/project 规划当前工作区下一阶段的目标和交付"
          : "/project define the next phase and deliverables for this workspace",
        label: copy.quickActions[0]?.label ?? "",
        onSelect: () => {
          const prompt = copy.quickActions[0]?.prompt;
          if (prompt) {
            queuePrompt(prompt);
          }
        },
        usage: "/project <scope>",
      },
      {
        argsHint: isChinese ? "研究主题" : "research topic",
        command: "/research",
        description: copy.quickActions[1]?.description ?? "",
        example: isChinese
          ? "/research 梳理这个方向的背景、问题和结论"
          : "/research map the background, questions, and findings",
        label: copy.quickActions[1]?.label ?? "",
        onSelect: () => {
          const prompt = copy.quickActions[1]?.prompt;
          if (prompt) {
            queuePrompt(prompt);
          }
        },
        usage: "/research <topic>",
      },
      {
        argsHint: isChinese ? "资产范围" : "library scope",
        command: "/library",
        description: copy.quickActions[2]?.description ?? "",
        example: isChinese
          ? "/library 整理当前页面、资料和组件资产"
          : "/library organize the current pages, docs, and reusable assets",
        label: copy.quickActions[2]?.label ?? "",
        onSelect: () => {
          const prompt = copy.quickActions[2]?.prompt;
          if (prompt) {
            queuePrompt(prompt);
          }
        },
        usage: "/library <scope>",
      },
      {
        argsHint: isChinese ? "设计目标" : "design focus",
        command: "/design",
        description: copy.quickActions[3]?.description ?? "",
        example: isChinese
          ? "/design 统一当前产品的视觉语言和组件规则"
          : "/design align the visual language and component rules",
        label: copy.quickActions[3]?.label ?? "",
        onSelect: () => {
          const prompt = copy.quickActions[3]?.prompt;
          if (prompt) {
            queuePrompt(prompt);
          }
        },
        usage: "/design <focus>",
      },
      {
        argsHint: isChinese ? "能力方向" : "extension focus",
        command: "/skills",
        description: copy.quickActions[4]?.description ?? "",
        example: isChinese
          ? "/skills 规划需要沉淀的 skills 和 plugins"
          : "/skills define the skills and plugins this workspace needs",
        label: copy.quickActions[4]?.label ?? "",
        onSelect: () => {
          const prompt = copy.quickActions[4]?.prompt;
          if (prompt) {
            queuePrompt(prompt);
          }
        },
        usage: "/skills <focus>",
      },
      {
        argsHint: isChinese ? "自动化范围" : "automation scope",
        command: "/automation",
        description: copy.quickActions[5]?.description ?? "",
        example: isChinese
          ? "/automation 设计这一块的触发器和自动推进机制"
          : "/automation design triggers and recurring automations",
        label: copy.quickActions[5]?.label ?? "",
        onSelect: () => {
          const prompt = copy.quickActions[5]?.prompt;
          if (prompt) {
            queuePrompt(prompt);
          }
        },
        usage: "/automation <scope>",
      },
      {
        argsHint: isChinese ? "摘要范围" : "summary scope",
        command: "/summary",
        description: isChinese
          ? "为当前线程生成一份可继续协作的摘要"
          : "Generate a handoff-style summary for the current thread",
        example: isChinese
          ? "/summary 当前工作区进展"
          : "/summary current workspace progress",
        label: isChinese ? "线程摘要" : "Thread Summary",
        onSelect: () => queuePrompt("/summary "),
        usage: "/summary [scope]",
      },
      {
        command: "/snapshot",
        description: isChinese
          ? "保存当前线程和资产状态，方便后续回看"
          : "Save the current thread and asset state for later review",
        example: "/snapshot",
        label: isChinese ? "保存快照" : "Save Snapshot",
        onSelect: () => queuePrompt("/snapshot"),
        usage: "/snapshot",
      },
    ],
    [copy.quickActions, isChinese, queuePrompt],
  );
  const slashAssistState = useMemo(() => {
    const trimmedDraft = composerDraft.trimStart();
    if (!trimmedDraft.startsWith("/")) {
      return null;
    }

    const loweredDraft = trimmedDraft.toLowerCase();
    const parsed = parseSlashCommand(trimmedDraft);
    const commandToken = parsed?.command ?? "";
    const commandPrefix = commandToken ? `/${commandToken}` : "/";
    const matches = slashActionEntries
      .filter((action) => {
        const command = action.command.toLowerCase();
        const usage = action.usage?.toLowerCase() ?? "";
        const example = action.example?.toLowerCase() ?? "";

        return (
          command.startsWith(loweredDraft) ||
          usage.startsWith(loweredDraft) ||
          example.startsWith(loweredDraft) ||
          loweredDraft.startsWith(command) ||
          command.startsWith(commandPrefix)
        );
      })
      .slice(0, 5);

    const active =
      matches.find((action) => loweredDraft.startsWith(action.command)) ??
      matches[0] ??
      null;

    return {
      active:
        matches[Math.min(slashAssistIndex, Math.max(matches.length - 1, 0))] ??
        active,
      args: parsed?.args ?? "",
      matches,
      raw: trimmedDraft,
    };
  }, [composerDraft, slashActionEntries, slashAssistIndex]);
  useEffect(() => {
    if (!slashAssistState) {
      if (slashAssistIndex !== 0) {
        setSlashAssistIndex(0);
      }
      return;
    }

    if (slashAssistIndex > slashAssistState.matches.length - 1) {
      setSlashAssistIndex(0);
    }
  }, [slashAssistIndex, slashAssistState]);
  const applySlashAssistSelection = useCallback(
    (action: SlashActionEntry, fallbackToExample = false) => {
      queuePrompt(
        buildSlashCompletion(action, composerDraft, fallbackToExample),
      );
    },
    [composerDraft, queuePrompt],
  );
  const handleComposerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (!slashAssistState || slashAssistState.matches.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashAssistIndex(
          (current) => (current + 1) % slashAssistState.matches.length,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashAssistIndex(
          (current) =>
            (current - 1 + slashAssistState.matches.length) %
            slashAssistState.matches.length,
        );
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (slashAssistState.active) {
          applySlashAssistSelection(slashAssistState.active);
        }
        return;
      }

      if (event.key === "Escape") {
        setSlashAssistIndex(0);
      }
    },
    [applySlashAssistSelection, slashAssistState],
  );
  const executionLaneItems = useMemo(
    () =>
      sessionStreamItems
        .filter((item) =>
          ["tool_use", "tool_result", "runtime", "policy"].includes(item.kind),
        )
        .slice(-8)
        .map((item) => ({
          ...item,
          stage: formatExecutionStageLabel(item.kind, isChinese),
        })),
    [isChinese, sessionStreamItems],
  );
  const currentExecutionStage = executionLaneItems.at(-1) ?? null;

  const workspaceDomains = useMemo<WorkspaceDomainCard[]>(
    () => [
      {
        description: isChinese
          ? "聚焦目标、阶段和交付结构"
          : "Shape goals, phases, and deliverables",
        label: isChinese ? "项目" : "Projects",
        metric: `${isChinese ? "线程" : "threads"} ${systemOverview?.threads.count ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[0]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "整理问题、结论和待验证点"
          : "Organize questions, findings, and open issues",
        label: isChinese ? "研究" : "Research",
        metric: `${isChinese ? "资料" : "docs"} ${systemOverview?.vector.documents ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[1]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "统一页面、文档和可复用资产"
          : "Structure pages, docs, and reusable assets",
        label: isChinese ? "资源库" : "Library",
        metric: `${isChinese ? "资产" : "assets"} ${fileItems.length}`,
        onSelect: () => queuePrompt(copy.quickActions[2]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "提炼视觉语言和设计决策"
          : "Refine visual language and design decisions",
        label: isChinese ? "设计系统" : "Design",
        metric: `${isChinese ? "快照" : "snapshots"} ${checkpoints.length}`,
        onSelect: () => queuePrompt(copy.quickActions[3]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "沉淀可复用的 skills 能力"
          : "Turn repeatable workflows into reusable skills",
        label: "Skills",
        metric: `${isChinese ? "启用" : "enabled"} ${systemOverview?.extensions.skills_enabled ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[4]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "管理插件、集成和外部扩展"
          : "Manage integrations and external extensions",
        label: isChinese ? "插件" : "Plugins",
        metric: `${isChinese ? "接入" : "connected"} ${systemOverview?.extensions.mcp_enabled ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[4]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "规划触发器、通知和自动推进机制"
          : "Design triggers, notifications, and recurring flows",
        label: isChinese ? "自动化" : "Automation",
        metric: `${isChinese ? "已启用" : "enabled"} ${Object.values(hookToggles).filter(Boolean).length}`,
        onSelect: () => queuePrompt(copy.quickActions[5]?.prompt ?? ""),
      },
    ],
    [
      checkpoints.length,
      copy.quickActions,
      fileItems.length,
      hookToggles,
      isChinese,
      queuePrompt,
      systemOverview?.extensions.mcp_enabled,
      systemOverview?.extensions.skills_enabled,
      systemOverview?.threads.count,
      systemOverview?.vector.documents,
    ],
  );
  const activeWorkflow = copy.quickActions[activeWorkflowIndex] ?? null;
  const workflowGuideItems = useMemo(
    () =>
      isChinese
        ? [
            ["目标与范围", "阶段拆分", "交付清单"],
            ["研究问题", "信息来源", "结论整理"],
            ["资产盘点", "结构整理", "缺口补齐"],
            ["视觉基调", "组件规则", "交互规范"],
            ["Skills 设计", "插件接入", "能力复用"],
            ["触发条件", "执行动作", "通知回路"],
          ]
        : [
            ["Goal", "Phases", "Deliverables"],
            ["Questions", "Sources", "Findings"],
            ["Inventory", "Structure", "Gaps"],
            ["Visual tone", "Components", "Interaction"],
            ["Skills", "Plugins", "Reuse"],
            ["Triggers", "Actions", "Loops"],
          ],
    [isChinese],
  );
  const activeWorkflowGuide = useMemo(
    () =>
      workflowGuideItems[activeWorkflowIndex] ?? workflowGuideItems[0] ?? [],
    [activeWorkflowIndex, workflowGuideItems],
  );
  const workflowProductDetails = useMemo(
    () =>
      isChinese
        ? [
            {
              abilities: ["拆解目标", "规划阶段", "定义交付"],
              outputs: ["路线图", "优先级", "下一步"],
              purpose: "把模糊需求整理成可执行项目。",
              useCases: ["目标规划", "阶段拆解", "交付推进"],
            },
            {
              abilities: ["梳理问题", "整合来源", "沉淀结论"],
              outputs: ["研究摘要", "证据列表", "待验证点"],
              purpose: "把资料和问题组织成研究线程。",
              useCases: ["问题定义", "资料归纳", "结论沉淀"],
            },
            {
              abilities: ["资产归档", "结构分层", "缺口识别"],
              outputs: ["资源地图", "文件目录", "复用清单"],
              purpose: "把页面、文档和素材变成资源库。",
              useCases: ["资产归类", "结构整理", "复用沉淀"],
            },
            {
              abilities: ["提炼视觉", "统一组件", "定义交互"],
              outputs: ["设计规则", "组件清单", "体验原则"],
              purpose: "把零散界面收束成设计系统。",
              useCases: ["视觉统一", "组件规范", "交互一致"],
            },
            {
              abilities: ["抽象技能", "设计插件", "沉淀流程"],
              outputs: ["Skill 方案", "插件边界", "复用模块"],
              purpose: "把重复工作变成可复用能力。",
              useCases: ["能力抽象", "流程复用", "插件接入"],
            },
            {
              abilities: ["设计触发", "编排动作", "处理异常"],
              outputs: ["触发器", "执行链路", "通知策略"],
              purpose: "把周期性任务设计成自动化流程。",
              useCases: ["触发设计", "自动执行", "状态通知"],
            },
          ]
        : [
            {
              abilities: ["Split goals", "Plan phases", "Define delivery"],
              outputs: ["Roadmap", "Priorities", "Next step"],
              purpose: "Turn vague requests into executable project work.",
              useCases: [
                "Feature kickoff",
                "Refactor planning",
                "Delivery plan",
              ],
            },
            {
              abilities: [
                "Frame questions",
                "Merge sources",
                "Capture findings",
              ],
              outputs: ["Research brief", "Evidence list", "Open issues"],
              purpose: "Organize sources and questions into a research thread.",
              useCases: ["Market review", "Tech research", "Background study"],
            },
            {
              abilities: ["Archive assets", "Layer structure", "Find gaps"],
              outputs: ["Asset map", "File index", "Reuse list"],
              purpose: "Turn pages, docs, and files into a usable library.",
              useCases: ["Handoff", "Component cleanup", "Knowledge base"],
            },
            {
              abilities: [
                "Extract style",
                "Unify components",
                "Set interaction",
              ],
              outputs: ["Design rules", "Component list", "UX principles"],
              purpose: "Turn scattered screens into a design system.",
              useCases: ["UI redesign", "Brand alignment", "Component rules"],
            },
            {
              abilities: ["Shape skills", "Plan plugins", "Package workflows"],
              outputs: ["Skill plan", "Plugin scope", "Reusable module"],
              purpose: "Turn repeated work into reusable capabilities.",
              useCases: [
                "Team workflow",
                "Reusable process",
                "Extension design",
              ],
            },
            {
              abilities: [
                "Define triggers",
                "Orchestrate actions",
                "Handle failures",
              ],
              outputs: ["Trigger plan", "Run chain", "Notification policy"],
              purpose: "Design recurring tasks as automation flows.",
              useCases: ["Scheduled checks", "Auto summaries", "Status alerts"],
            },
          ],
    [isChinese],
  );
  const activeWorkflowDetail =
    workflowProductDetails[activeWorkflowIndex] ??
    workflowProductDetails[0] ??
    null;
  const ActiveWorkflowIcon = activeWorkflow?.icon ?? SparklesIcon;
  const workflowRuns = useMemo(
    () => workflowRunsQuery.data?.runs ?? [],
    [workflowRunsQuery.data?.runs],
  );
  const latestWorkflowRun = workflowRuns[0] ?? null;
  const activePersistedWorkflowRun =
    workflowRuns.find((run) =>
      ["queued", "running", "waiting_approval"].includes(run.status),
    ) ?? latestWorkflowRun;
  useEffect(() => {
    if (
      activeWorkflowRunIdRef.current ||
      !activePersistedWorkflowRun ||
      !["queued", "running", "waiting_approval"].includes(
        activePersistedWorkflowRun.status,
      )
    ) {
      return;
    }
    activeWorkflowRunIdRef.current = activePersistedWorkflowRun.id;
  }, [activePersistedWorkflowRun]);
  const capabilityCards = useMemo(
    () => workspaceDomains.slice(4, 7),
    [workspaceDomains],
  );
  const workspacePath =
    terminal.state?.cwd ?? "/Users/mahanting/Desktop/deer-flow";
  const focusLabel = selectedArtifact
    ? normalizeArtifactPath(selectedArtifact)
    : copy.waitingForOutput;

  const startWorkflowRun = useCallback(
    async (
      action: QuickAction,
      index: number,
      taskDetails?: string,
    ): Promise<WorkflowRun | null> => {
      if (!threadId) {
        return null;
      }

      const workflowType = WORKFLOW_TYPES[index] ?? "custom";
      const detail = workflowProductDetails[index] ?? activeWorkflowDetail;
      const guideItems = workflowGuideItems[index] ?? activeWorkflowGuide;
      const prompt = taskDetails
        ? `${action.prompt}\n\n${isChinese ? "任务补充" : "Task details"}:\n${taskDetails}`
        : action.prompt;

      try {
        const run = await createWorkflowRun.mutateAsync({
          metadata: {
            expected_outputs: detail?.outputs ?? [],
            purpose: detail?.purpose ?? action.description,
            source: "workflow-workspace",
            use_cases: detail?.useCases ?? [],
          },
          outputs: detail?.outputs ?? [],
          prompt,
          steps: guideItems.map((label, stepIndex) => ({
            id: `${workflowType}-${stepIndex + 1}`,
            label,
            status: "pending",
          })),
          title: action.label,
          workflow_type: workflowType,
        });

        activeWorkflowRunIdRef.current = run.id;
        pushRuntimeEvent(
          isChinese ? "工作流已创建" : "Workflow created",
          `${action.label} · ${run.id.slice(0, 8)}`,
          "running",
        );

        await updateWorkflowRun.mutateAsync({
          runId: run.id,
          payload: { status: "running" },
        });

        await submitAgentMessage({
          files: [],
          text: [
            `<workflow_run id="${run.id}" type="${workflowType}" title="${action.label}">`,
            prompt,
            "</workflow_run>",
          ].join("\n"),
        });

        return run;
      } catch (error) {
        const runId = activeWorkflowRunIdRef.current;
        if (runId) {
          activeWorkflowRunIdRef.current = null;
          await updateWorkflowRun
            .mutateAsync({
              runId,
              payload: {
                error: getThreadErrorDisplay(error).message,
                status: "failed",
              },
            })
            .catch((updateError) => {
              console.error(
                "Failed to mark workflow run as failed",
                updateError,
              );
            });
        }
        toast.error(getThreadErrorDisplay(error).message);
        return null;
      }
    },
    [
      activeWorkflowDetail,
      activeWorkflowGuide,
      createWorkflowRun,
      isChinese,
      pushRuntimeEvent,
      submitAgentMessage,
      threadId,
      updateWorkflowRun,
      workflowGuideItems,
      workflowProductDetails,
    ],
  );

  const executeTerminalCommand = useCallback(
    async (command: string, label?: string) => {
      rememberRecentCommand(command);
      openInspectorTab("terminal");
      pushRuntimeEvent(
        isChinese ? "终端命令" : "Terminal command",
        label ? `${label}: ${command}` : command,
        "running",
      );
      try {
        await terminal.runCommand(command);
      } catch (error) {
        console.error(error);
        toast.error("Failed to run terminal command");
        pushRuntimeEvent(
          isChinese ? "命令执行失败" : "Command failed",
          command,
          "error",
        );
      }
    },
    [
      isChinese,
      openInspectorTab,
      pushRuntimeEvent,
      rememberRecentCommand,
      terminal,
    ],
  );

  const handleRunTerminalCommand = useCallback(
    async (command: string, label?: string) => {
      const guardReason = hookToggles.guardCommands
        ? getCommandGuardReason(command, isChinese)
        : null;

      if (guardReason && approvalMode !== "full_auto") {
        setPendingCommandApproval({
          command,
          createdAt: new Date().toISOString(),
          id: uuid(),
          label,
          reason: guardReason,
        });
        openInspectorTab("terminal");
        pushRuntimeEvent(
          isChinese ? "等待命令确认" : "Approval required",
          `${command} · ${guardReason}`,
          "info",
        );
        toast.message(
          isChinese
            ? "该命令需要先确认风险后再执行"
            : "This command needs approval before it runs",
        );
        return;
      }

      setPendingCommandApproval(null);
      await executeTerminalCommand(command, label);
    },
    [
      approvalMode,
      executeTerminalCommand,
      hookToggles.guardCommands,
      isChinese,
      openInspectorTab,
      pushRuntimeEvent,
    ],
  );

  const handleApprovePendingCommand = useCallback(async () => {
    if (!pendingCommandApproval) {
      return;
    }

    const nextCommand = pendingCommandApproval.command;
    const nextLabel = pendingCommandApproval.label;

    setPendingCommandApproval(null);
    pushRuntimeEvent(
      isChinese ? "命令已批准" : "Command approved",
      nextCommand,
      "success",
    );
    await executeTerminalCommand(nextCommand, nextLabel);
  }, [
    executeTerminalCommand,
    isChinese,
    pendingCommandApproval,
    pushRuntimeEvent,
  ]);

  const handleRejectPendingCommand = useCallback(() => {
    if (!pendingCommandApproval) {
      return;
    }

    pushRuntimeEvent(
      isChinese ? "命令已取消" : "Command canceled",
      pendingCommandApproval.command,
      "info",
    );
    setPendingCommandApproval(null);
  }, [isChinese, pendingCommandApproval, pushRuntimeEvent]);

  const handleCopyPatch = useCallback(async () => {
    if (!selectedDiff?.patch) {
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedDiff.patch);
      toast.success(copy.copiedPatch);
    } catch (error) {
      console.error(error);
      toast.error("Failed to copy patch");
    }
  }, [copy.copiedPatch, selectedDiff?.patch]);

  const handleApplyReviewedChange = useCallback(async () => {
    if (
      !selectedArtifact ||
      selectedArtifactContent === undefined ||
      !selectedArtifactMeta?.normalizedPath ||
      thread.isLoading
    ) {
      return;
    }
    const applyPrompt = isChinese
      ? `请把这个线程里最新确认的产物 "${selectedArtifactMeta.normalizedPath}" 作为正式修改应用到当前项目中，保持与该产物内容一致；如果还需要同步关联文件，也一并完成，并在结束后给我一个简短变更说明。`
      : `Apply the latest reviewed artifact "${selectedArtifactMeta.normalizedPath}" to the current project as the approved version. Keep the implementation aligned with that artifact, update any dependent files if needed, and finish with a short change summary.`;

    try {
      await handleSubmit({ text: applyPrompt, files: [] });
      setReviewSnapshots((current) => ({
        ...current,
        [selectedArtifact]: selectedArtifactContent,
      }));
      openInspectorTab("terminal");
      toast.success(copy.applyQueued);
    } catch (error) {
      console.error(error);
      toast.error("Failed to queue apply request");
    }
  }, [
    copy.applyQueued,
    handleSubmit,
    isChinese,
    openInspectorTab,
    selectedArtifact,
    selectedArtifactContent,
    selectedArtifactMeta?.normalizedPath,
    thread.isLoading,
  ]);

  const handleSaveCheckpoint = useCallback(async () => {
    await captureCheckpoint("manual");
  }, [captureCheckpoint]);

  const handleSlashCommand = useCallback(
    async (message: PromptInputMessage) => {
      const parsed = parseSlashCommand(message.text);
      if (!parsed) {
        return false;
      }

      const { args, command } = parsed;

      if (command === "console" || command === "terminal") {
        openInspectorTab("terminal");
        void terminal.start().catch((error) => {
          console.error(error);
        });
        return true;
      }

      if (command === "preview") {
        openInspectorTab("preview");
        return true;
      }

      if (command === "changes" || command === "diff") {
        openInspectorTab("changes");
        return true;
      }

      if (command === "workspace") {
        setRightPaneMode("workspace");
        return true;
      }

      if (command === "run") {
        if (!args) {
          toast.message(
            isChinese ? "请输入要执行的命令" : "Provide a command to run",
          );
          return true;
        }
        await handleRunTerminalCommand(args);
        return true;
      }

      if (command === "checkpoint" || command === "snapshot") {
        await handleSaveCheckpoint();
        return true;
      }

      if (command === "compact" || command === "summary") {
        handleCreateCompactNote(args);
        return true;
      }

      if (command === "hooks") {
        if (args) {
          const hookArg = args.toLowerCase();
          if (hookArg.includes("guard")) {
            handleToggleHook("guardCommands");
            return true;
          }
          if (hookArg.includes("summary")) {
            handleToggleHook("summarizeChanges");
            return true;
          }
          if (hookArg.includes("compact")) {
            handleToggleHook("compactMemory");
            return true;
          }
        }
        setRightPaneMode("workspace");
        return true;
      }

      if (command === "permissions" || command === "approval") {
        if (!args) {
          setRightPaneMode("workspace");
          return true;
        }

        const [modeToken, ...restTokens] = args.split(/\s+/);
        if (!modeToken) {
          return true;
        }
        const restText = restTokens.join(" ").trim();
        const normalizedMode = modeToken.toLowerCase();
        const nextMode: ApprovalMode | null =
          normalizedMode === "default"
            ? "default"
            : normalizedMode === "accept" ||
                normalizedMode === "accept-edits" ||
                normalizedMode === "accept_edits"
              ? "accept_edits"
              : normalizedMode === "plan"
                ? "plan"
                : normalizedMode === "auto" ||
                    normalizedMode === "full-auto" ||
                    normalizedMode === "full_auto"
                  ? "full_auto"
                  : null;

        if (!nextMode) {
          toast.message(
            isChinese
              ? "可用模式：default / accept-edits / plan / auto"
              : "Available modes: default / accept-edits / plan / auto",
          );
          return true;
        }

        handleSetApprovalMode(nextMode);
        if (restText) {
          await submitAgentMessage({ ...message, text: restText });
        }
        return true;
      }

      if (command === "plan") {
        handleSetApprovalMode("plan");
        setSettings("context", {
          ...settings.context,
          mode: "pro",
        });
        if (args) {
          await submitAgentMessage({ ...message, text: args });
        }
        return true;
      }

      if (
        command === "project" ||
        command === "research" ||
        command === "library" ||
        command === "design" ||
        command === "skills" ||
        command === "automation" ||
        command === "scaffold" ||
        command === "refactor" ||
        command === "fix"
      ) {
        const actionIndex =
          command === "project" || command === "scaffold"
            ? 0
            : command === "research" || command === "refactor"
              ? 1
              : command === "library" || command === "fix"
                ? 2
                : command === "design"
                  ? 3
                  : command === "skills"
                    ? 4
                    : 5;
        const action = copy.quickActions[actionIndex];

        if (!action) {
          return true;
        }

        await startWorkflowRun(action, actionIndex, args || undefined);
        return true;
      }

      if (command === "help") {
        pushRuntimeEvent(
          isChinese ? "Slash commands" : "Slash commands",
          "/project /research /library /design /skills /automation /summary /snapshot",
          "info",
        );
        setRightPaneMode("workspace");
        return true;
      }

      return false;
    },
    [
      copy.quickActions,
      handleCreateCompactNote,
      handleRunTerminalCommand,
      handleSaveCheckpoint,
      handleSetApprovalMode,
      handleToggleHook,
      isChinese,
      openInspectorTab,
      pushRuntimeEvent,
      setSettings,
      settings.context,
      startWorkflowRun,
      submitAgentMessage,
      terminal,
    ],
  );

  const guardedHandleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (await handleSlashCommand(message)) {
        setComposerDraft("");
        return;
      }

      await submitAgentMessage(message);
      setComposerDraft("");
    },
    [handleSlashCommand, submitAgentMessage],
  );

  const handleRestoreCheckpointFile = useCallback(async () => {
    if (
      !selectedCheckpoint ||
      !selectedArtifactMeta?.normalizedPath ||
      thread.isLoading
    ) {
      return;
    }

    const restorePrompt = buildCheckpointFileRestorePrompt({
      checkpoint: selectedCheckpoint,
      isChinese,
      path: selectedArtifactMeta.normalizedPath,
    });

    if (!restorePrompt) {
      toast.message(copy.checkpointMissingFile);
      return;
    }

    try {
      await handleSubmit({ text: restorePrompt, files: [] });
      openInspectorTab("terminal");
      toast.success(copy.checkpointRestoreFileQueued);
      pushRuntimeEvent(
        isChinese ? "回退当前文件" : "Restore file",
        selectedArtifactMeta.normalizedPath,
        "running",
      );
    } catch (error) {
      console.error(error);
      toast.error("Failed to queue file restore");
    }
  }, [
    copy.checkpointMissingFile,
    copy.checkpointRestoreFileQueued,
    handleSubmit,
    isChinese,
    openInspectorTab,
    pushRuntimeEvent,
    selectedArtifactMeta?.normalizedPath,
    selectedCheckpoint,
    thread.isLoading,
  ]);

  const handleRestoreCheckpointRound = useCallback(async () => {
    if (
      !selectedCheckpoint ||
      selectedCheckpoint.omittedCount > 0 ||
      thread.isLoading
    ) {
      return;
    }

    try {
      await handleSubmit({
        text: buildCheckpointRestorePrompt({
          checkpoint: selectedCheckpoint,
          isChinese,
        }),
        files: [],
      });
      openInspectorTab("terminal");
      toast.success(copy.checkpointRestoreRoundQueued);
      pushRuntimeEvent(
        isChinese ? "回退版本快照" : "Restore checkpoint",
        selectedCheckpoint.label,
        "running",
      );
    } catch (error) {
      console.error(error);
      toast.error("Failed to queue checkpoint restore");
    }
  }, [
    copy.checkpointRestoreRoundQueued,
    handleSubmit,
    isChinese,
    openInspectorTab,
    pushRuntimeEvent,
    selectedCheckpoint,
    thread.isLoading,
  ]);

  const flushTerminalQueue = useCallback(async () => {
    const nextChunk = terminalInputQueueRef.current;
    if (!nextChunk) {
      return;
    }
    terminalInputQueueRef.current = "";
    terminalSendChainRef.current = terminalSendChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await terminal.sendInput(nextChunk);
        } catch (error) {
          console.error(error);
          toast.error("Failed to send terminal input");
        }
      });
    await terminalSendChainRef.current;
  }, [terminal]);

  const queueTerminalInput = useCallback(
    (chunk: string) => {
      terminalInputQueueRef.current += chunk;
      if (terminalFlushTimerRef.current !== null) {
        return;
      }
      terminalFlushTimerRef.current = window.setTimeout(() => {
        terminalFlushTimerRef.current = null;
        void flushTerminalQueue();
      }, 16);
    },
    [flushTerminalQueue],
  );

  useEffect(() => {
    return () => {
      if (terminalFlushTimerRef.current !== null) {
        window.clearTimeout(terminalFlushTimerRef.current);
        terminalFlushTimerRef.current = null;
      }
      if (terminalResizeDebounceRef.current !== null) {
        window.clearTimeout(terminalResizeDebounceRef.current);
        terminalResizeDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    terminalAutoBootedRef.current = false;
  }, [threadId]);

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      if (cols < 2 || rows < 1) {
        return;
      }
      if (!terminal.state?.session_id || terminal.state.status === "stopped") {
        return;
      }
      if (
        cols === lastTerminalSizeRef.current.cols &&
        rows === lastTerminalSizeRef.current.rows
      ) {
        return;
      }
      pendingTerminalSizeRef.current = { cols, rows };
      if (terminalResizeDebounceRef.current !== null) {
        window.clearTimeout(terminalResizeDebounceRef.current);
      }
      terminalResizeDebounceRef.current = window.setTimeout(() => {
        terminalResizeDebounceRef.current = null;
        const nextSize = pendingTerminalSizeRef.current;
        if (!nextSize) {
          return;
        }
        pendingTerminalSizeRef.current = null;
        lastTerminalSizeRef.current = nextSize;
        void terminal.resize(nextSize.cols, nextSize.rows).catch((error) => {
          console.error(error);
        });
      }, 90);
    },
    [terminal],
  );

  useEffect(() => {
    if (
      rightPaneMode !== "inspector" ||
      bottomTab !== "terminal" ||
      terminalAutoBootedRef.current
    ) {
      return;
    }
    terminalAutoBootedRef.current = true;
    void terminal.start().catch((error) => {
      console.error(error);
      terminalAutoBootedRef.current = false;
    });
  }, [bottomTab, rightPaneMode, terminal, threadId]);

  const terminalStatusLabel = useMemo(() => {
    if (terminal.isConnecting) {
      return copy.shellStarting;
    }
    if (terminal.state?.status === "stopping") {
      return copy.stopShell;
    }
    if (!terminal.state?.session_id || terminal.state?.status === "stopped") {
      return copy.shellNotStarted;
    }
    if (!terminal.isConnected) {
      return copy.shellDisconnected;
    }
    return copy.shellReady;
  }, [
    copy.shellDisconnected,
    copy.shellNotStarted,
    copy.shellReady,
    copy.shellStarting,
    copy.stopShell,
    terminal.isConnected,
    terminal.isConnecting,
    terminal.state?.session_id,
    terminal.state?.status,
  ]);

  useEffect(() => {
    if (!checkpointsLoaded) {
      return;
    }
    setSelectedCheckpointId((current) => {
      if (
        current &&
        checkpoints.some((checkpoint) => checkpoint.id === current)
      ) {
        return current;
      }
      return checkpoints[1]?.id ?? checkpoints[0]?.id ?? null;
    });
  }, [checkpoints, checkpointsLoaded]);

  useEffect(() => {
    if (
      !checkpointsLoaded ||
      !threadId ||
      thread.isLoading ||
      threadArtifacts.length === 0
    ) {
      return;
    }

    if (!checkpointInitialCapturedRef.current && checkpoints.length === 0) {
      checkpointInitialCapturedRef.current = true;
      void captureCheckpoint("auto");
    }
  }, [
    captureCheckpoint,
    checkpoints.length,
    checkpointsLoaded,
    thread.isLoading,
    threadArtifacts.length,
    threadId,
  ]);

  useEffect(() => {
    if (
      !checkpointsLoaded ||
      !threadId ||
      autoCheckpointTick === 0 ||
      thread.isLoading ||
      threadArtifacts.length === 0 ||
      lastAutoCheckpointTickRef.current === autoCheckpointTick
    ) {
      return;
    }

    lastAutoCheckpointTickRef.current = autoCheckpointTick;
    void captureCheckpoint("auto");
  }, [
    autoCheckpointTick,
    captureCheckpoint,
    checkpointsLoaded,
    thread.isLoading,
    threadArtifacts.length,
    threadId,
  ]);

  const paletteGroups = useMemo<VibePaletteGroup[]>(
    () => [
      {
        heading: copy.paletteNavigation,
        items: [
          {
            id: "open-terminal",
            icon: SquareTerminalIcon,
            label: copy.terminalTab,
            onSelect: () => {
              openInspectorTab("terminal");
              void terminal.start().catch((error) => {
                console.error(error);
              });
            },
            shortcut: "⌘J",
            subtitle: copy.runtimeTitle,
          },
          {
            id: "open-preview",
            icon: EyeIcon,
            label: copy.previewTab,
            onSelect: () => openInspectorTab("preview"),
            subtitle: copy.editorTitle,
          },
          {
            id: "open-changes",
            icon: Code2Icon,
            label: copy.changesTab,
            onSelect: () => openInspectorTab("changes"),
            subtitle: copy.editorTitle,
          },
          {
            id: "save-checkpoint",
            icon: CheckCircleIcon,
            label: copy.checkpointSave,
            onSelect: () => {
              void handleSaveCheckpoint();
            },
            subtitle: copy.checkpointsTitle,
          },
          {
            id: "new-session",
            icon: Code2Icon,
            label: copy.newSession,
            onSelect: () => router.push(newSessionHref),
            subtitle: copy.sessionTitle,
          },
          {
            id: "return-workspace",
            icon: SquareArrowOutUpRightIcon,
            label: copy.exitImmersive,
            onSelect: () => router.push(exitHref),
            subtitle: copy.workspaceTitle,
          },
        ],
      },
      {
        heading: copy.paletteCommands,
        items: copy.quickActions.map((action, index) => ({
          id: `workflow-${index}`,
          icon: action.icon,
          label: action.label,
          onSelect: () => queuePrompt(action.prompt),
          subtitle: action.description,
        })),
      },
      {
        heading: copy.paletteRecentCommands,
        items: checkpoints.map((checkpoint) => ({
          id: `checkpoint-${checkpoint.id}`,
          icon: CheckCircleIcon,
          label: checkpoint.label,
          onSelect: () => {
            setSelectedCheckpointId(checkpoint.id);
            openInspectorTab("changes");
          },
          subtitle:
            checkpoint.summary ??
            (isChinese ? "本地保存的工作区快照" : "Saved workspace snapshot"),
        })),
      },
      {
        heading: copy.palettePrompts,
        items: workspaceViews.map((view) => ({
          id: `workspace-view-${view.label}`,
          icon:
            view.label === (isChinese ? "预览画布" : "Preview Canvas")
              ? EyeIcon
              : view.label === (isChinese ? "版本回看" : "Version Review")
                ? CopyIcon
                : view.label === (isChinese ? "活动日志" : "Activity Log")
                  ? SquareTerminalIcon
                  : FileCodeIcon,
          label: view.label,
          onSelect: view.onSelect,
          subtitle: view.description,
        })),
      },
      {
        heading: copy.paletteOpenTabs,
        items: openTabs.map((artifact) => ({
          id: `open-tab-${artifact}`,
          icon: FileCodeIcon,
          label: getFileName(artifact),
          onSelect: () => handleSelectArtifact(artifact),
          subtitle: normalizeArtifactPath(artifact),
          keywords: [artifact, getFileName(artifact)],
        })),
      },
      {
        heading: copy.paletteFiles,
        items: fileItems.slice(0, 40).map((artifact) => ({
          id: `file-${artifact}`,
          icon: FileCodeIcon,
          label: getFileName(artifact),
          onSelect: () => handleSelectArtifact(artifact),
          subtitle: normalizeArtifactPath(artifact),
          keywords: [artifact],
        })),
      },
    ],
    [
      checkpoints,
      copy.changesTab,
      copy.checkpointSave,
      copy.checkpointsTitle,
      copy.editorTitle,
      copy.exitImmersive,
      copy.newSession,
      copy.paletteCommands,
      copy.paletteFiles,
      copy.paletteNavigation,
      copy.paletteOpenTabs,
      copy.palettePrompts,
      copy.paletteRecentCommands,
      copy.previewTab,
      copy.quickActions,
      copy.runtimeTitle,
      copy.sessionTitle,
      copy.terminalTab,
      copy.workspaceTitle,
      exitHref,
      fileItems,
      handleSaveCheckpoint,
      handleSelectArtifact,
      isChinese,
      newSessionHref,
      openInspectorTab,
      openTabs,
      queuePrompt,
      router,
      terminal,
      workspaceViews,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }

      if (event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey) {
        const altShiftKey = event.key.toLowerCase();

        if (altShiftKey === "t") {
          event.preventDefault();
          openInspectorTab("terminal");
          void terminal.start().catch((error) => {
            console.error(error);
          });
          return;
        }

        if (altShiftKey === "p") {
          event.preventDefault();
          openInspectorTab("preview");
          return;
        }

        if (altShiftKey === "c") {
          event.preventDefault();
          openInspectorTab("changes");
          return;
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          cycleOpenTabs(-1);
          return;
        }

        if (event.key === "ArrowRight") {
          event.preventDefault();
          cycleOpenTabs(1);
          return;
        }
      }

      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) {
        return;
      }
      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        setIsPaletteOpen(true);
        return;
      }

      if (key === "j") {
        event.preventDefault();
        openInspectorTab("terminal");
        void terminal.start().catch((error) => {
          console.error(error);
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cycleOpenTabs, openInspectorTab, terminal]);

  if (!threadId || !workspacePrefsLoaded || !checkpointsLoaded) {
    return null;
  }

  return (
    <ThreadContext.Provider value={{ threadId, thread }}>
      <div className="relative flex h-screen w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#eef3f8] text-[#142033]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.1),transparent_24%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_22%),radial-gradient(circle_at_bottom,rgba(99,102,241,0.08),transparent_26%)]" />

        <header className="relative z-10 shrink-0 border-b border-[#dbe4ef] bg-white/92 backdrop-blur-xl">
          <div className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-7">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d9e3ef] bg-white px-3 py-1 text-[11px] font-semibold tracking-[0.22em] text-[#6d7f97] uppercase shadow-sm">
                <span className="size-2 rounded-full bg-[#2563eb]" />
                DeerFlow
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-[23px] font-semibold tracking-[-0.04em] text-[#142033]">
                  {sessionTitle}
                </span>
                <span className="rounded-full border border-[#dbe4ef] bg-[#f8fbff] px-3 py-1 text-[11px] font-medium text-[#60748b]">
                  {thread.isLoading ? copy.agentRunning : copy.agentIdle}
                </span>
                {currentExecutionStage ? (
                  <span className="rounded-full border border-[#dbe4ef] bg-white px-3 py-1 text-[11px] font-medium text-[#60748b]">
                    {currentExecutionStage.stage}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 max-w-3xl text-sm text-[#61748c]">
                {latestAssistantSummary || copy.waitingInstruction}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
                onClick={() => setIsPaletteOpen(true)}
              >
                <SearchIcon className="size-4" />
                {isChinese ? "搜索" : "Search"}
                <span className="rounded border border-[#dce5ef] bg-[#f8fbff] px-1.5 py-0.5 text-[10px] text-[#7a8da4]">
                  ⌘K
                </span>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
              >
                <Link href={exitHref}>
                  <SquareArrowOutUpRightIcon className="size-4" />
                  {copy.exitImmersive}
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="rounded-full bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
              >
                <Link href={newSessionHref}>
                  <Code2Icon className="size-4" />
                  {copy.newSession}
                </Link>
              </Button>
            </div>
          </div>
        </header>

        <main className="relative z-10 grid h-[calc(100vh-98px)] w-full min-w-0 flex-1 items-stretch gap-4 overflow-hidden p-4 lg:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(500px,34vw)] 2xl:grid-cols-[minmax(0,1fr)_580px]">
          <section className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 pb-2">
            <div className="hidden overflow-hidden rounded-[30px] border border-[#dbe4ef] bg-white/94 px-5 py-5 shadow-[0_18px_46px_rgba(15,23,42,0.06)]">
              <div className="flex flex-wrap items-end justify-between gap-5">
                <div className="max-w-3xl min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#dbe7f5] bg-[#f8fbff] px-3 py-1 text-[11px] font-semibold tracking-[0.2em] text-[#6d7f97] uppercase">
                    <span className="size-1.5 rounded-full bg-[#2563eb]" />
                    {isChinese ? "工作流" : "workflow"}
                  </div>
                  <div className="mt-4 text-[34px] leading-tight font-semibold tracking-[-0.045em] text-[#142033]">
                    {isChinese
                      ? "选择能力，直接开始。"
                      : "Choose a capability and start."}
                  </div>
                  <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#61748c]">
                    {latestAssistantSummary ||
                      (isChinese
                        ? "工作流会把你的输入转成计划、研究、资产、设计系统、能力扩展或自动化。"
                        : "Workflows turn your input into plans, research, assets, design systems, extensions, or automation.")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 rounded-[24px] border border-[#e2eaf3] bg-[#f8fbff] p-2">
                  {[
                    [isChinese ? "动态" : "Updates", activityItems.length],
                    [isChinese ? "资产" : "Assets", fileItems.length],
                    [isChinese ? "快照" : "Snapshots", checkpoints.length],
                    [isChinese ? "待办" : "Tasks", todos.length],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="min-w-20 rounded-[18px] bg-white px-4 py-3 text-center shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
                    >
                      <div className="text-lg font-semibold text-[#142033]">
                        {value}
                      </div>
                      <div className="mt-0.5 text-[11px] font-medium text-[#7a8da4]">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-[#dbe4ef] bg-white px-5 py-5 shadow-[0_18px_46px_rgba(15,23,42,0.06)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold tracking-[0.2em] text-[#6d7f97] uppercase">
                    {isChinese ? "能力模块" : "modules"}
                  </div>
                  <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[#142033]">
                    {isChinese ? "选择工作流" : "Choose workflow"}
                  </div>
                </div>
                {activeWorkflow ? (
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                    disabled={thread.isLoading || createWorkflowRun.isPending}
                    onClick={() =>
                      void startWorkflowRun(activeWorkflow, activeWorkflowIndex)
                    }
                  >
                    {createWorkflowRun.isPending
                      ? isChinese
                        ? "创建中"
                        : "Creating"
                      : isChinese
                        ? "开始"
                        : "Start"}
                  </Button>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {copy.quickActions.map((action, index) => {
                  const Icon = action.icon;
                  const active = index === activeWorkflowIndex;
                  const detail = workflowProductDetails[index];
                  return (
                    <button
                      key={`${action.label}-${index}`}
                      type="button"
                      onClick={() => setActiveWorkflowIndex(index)}
                      className={cn(
                        "group rounded-[24px] border px-5 py-4 text-left transition",
                        active
                          ? "border-[#9bc2ff] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_100%)] text-[#142033] shadow-[0_16px_38px_rgba(37,99,235,0.10)]"
                          : "border-[#e2eaf3] bg-[#fbfdff] text-[#61748c] hover:border-[#c8d9eb] hover:bg-white",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "grid size-11 place-items-center rounded-[18px] border transition",
                              active
                                ? "border-[#bfdbfe] bg-white text-[#2563eb]"
                                : "border-[#e2eaf3] bg-white text-[#60748b] group-hover:text-[#2563eb]",
                            )}
                          >
                            <Icon className="size-4" />
                          </span>
                          <div>
                            <div className="text-base font-semibold text-[#142033]">
                              {action.label}
                            </div>
                            <div className="mt-1 text-sm text-[#7a8da4]">
                              {action.description}
                            </div>
                          </div>
                        </div>
                        <span className="rounded-full border border-[#dbe4ef] bg-white px-2 py-0.5 text-[10px] font-medium text-[#8aa0b6]">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {(detail?.outputs ?? []).slice(0, 2).map((item) => (
                          <span
                            key={item}
                            className="rounded-full bg-white px-3 py-1.5 text-xs text-[#60748b] ring-1 ring-[#e2eaf3]"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <div className="rounded-[28px] border border-[#cfe0f5] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_62%,#f7fbff_100%)] p-5">
                  {activeWorkflow && activeWorkflowDetail ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 text-sm font-semibold text-[#142033]">
                          <span className="grid size-10 place-items-center rounded-2xl bg-[#2563eb] text-white shadow-[0_14px_30px_rgba(37,99,235,0.24)]">
                            <ActiveWorkflowIcon className="size-4" />
                          </span>
                          <div>
                            <div>{activeWorkflow.label}</div>
                            <div className="mt-1 text-xs font-medium text-[#6d7f97]">
                              {activeWorkflowDetail.purpose}
                            </div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-full bg-[#142033] text-white hover:bg-[#22344b]"
                          onClick={() => queuePrompt(activeWorkflow.prompt)}
                        >
                          {isChinese ? "写入输入区" : "Send to composer"}
                        </Button>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <div className="rounded-[22px] border border-white bg-white/82 p-5">
                          <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                            {isChinese ? "能做" : "Can do"}
                          </div>
                          <div className="mt-3 space-y-2">
                            {activeWorkflowDetail.abilities.map((item) => (
                              <div
                                key={item}
                                className="text-sm font-medium text-[#31475f]"
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-[22px] border border-white bg-white/82 p-5">
                          <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                            {isChinese ? "应用" : "Use for"}
                          </div>
                          <div className="mt-3 space-y-2">
                            {activeWorkflowDetail.useCases.map((item) => (
                              <div
                                key={item}
                                className="text-sm font-medium text-[#31475f]"
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-[22px] border border-white bg-white/82 p-5">
                          <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                            {isChinese ? "产出" : "Output"}
                          </div>
                          <div className="mt-3 space-y-2">
                            {activeWorkflowDetail.outputs.map((item) => (
                              <div
                                key={item}
                                className="text-sm font-medium text-[#31475f]"
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {activeWorkflowGuide.map((item) => (
                          <div
                            key={item}
                            className="rounded-full border border-[#dbe4ef] bg-white px-3 py-1.5 text-xs font-medium text-[#31475f]"
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  {capabilityCards.map((domain, index) => (
                    <button
                      key={domain.label}
                      type="button"
                      onClick={() => {
                        setActiveWorkflowIndex(index === 2 ? 5 : 4);
                        domain.onSelect();
                      }}
                      className="rounded-[22px] border border-[#e7edf5] bg-[#fbfdff] px-4 py-4 text-left transition hover:border-[#c8d9eb] hover:bg-white hover:shadow-[0_14px_32px_rgba(15,23,42,0.06)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-[#142033]">
                          <span
                            className={cn(
                              "size-2.5 rounded-full",
                              index === 0 && "bg-[#38bdf8]",
                              index === 1 && "bg-[#8b5cf6]",
                              index === 2 && "bg-[#f59e0b]",
                            )}
                          />
                          {domain.label}
                        </div>
                        <span className="rounded-full border border-[#dbe4ef] bg-white px-2.5 py-0.5 text-[10px] font-medium text-[#60748b]">
                          {domain.metric}
                        </span>
                      </div>
                      <div className="mt-2 text-xs leading-6 text-[#6d7f97]">
                        {domain.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-[760px] flex-1">
              <section className="grid h-full min-h-[760px] grid-rows-[minmax(240px,0.78fr)_minmax(430px,1.22fr)] overflow-hidden rounded-[28px] border border-[#dbe4ef] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
                <div className="flex min-h-0 flex-col">
                  <div className="flex items-center justify-between gap-3 border-b border-[#e7edf5] px-5 py-4">
                    <div className="text-sm font-semibold text-[#142033]">
                      {isChinese ? "当前线程" : "Current thread"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#60748b]">
                      <span className="rounded-full border border-[#dbe4ef] bg-[#f8fbff] px-3 py-1">
                        {thread.isLoading ? copy.agentRunning : copy.agentIdle}
                      </span>
                      {currentExecutionStage ? (
                        <span className="rounded-full border border-[#dbe4ef] bg-[#f8fbff] px-3 py-1">
                          {currentExecutionStage.stage}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-4 px-5 py-5">
                      {sessionStreamItems.length === 0 ? (
                        <div className="rounded-[22px] border border-dashed border-[#dbe4ef] bg-[#f8fbff] px-4 py-5 text-sm leading-7 text-[#6d7f97]">
                          {isChinese
                            ? "选择工作流，或直接输入任务。"
                            : "Choose a workflow, or type a task."}
                        </div>
                      ) : (
                        sessionStreamItems.slice(-18).map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-[92px_minmax(0,1fr)] gap-4 rounded-[22px] border border-[#e7edf5] bg-[#fbfdff] px-4 py-4"
                          >
                            <div className="pt-0.5">
                              <div
                                className={cn(
                                  "inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.18em] uppercase",
                                  item.kind === "user" &&
                                    "border-[#bfd4f1] bg-[#eef5ff] text-[#2d5d97]",
                                  item.kind === "assistant" &&
                                    "border-[#d7dee8] bg-white text-[#40556f]",
                                  item.kind === "reasoning" &&
                                    "border-[#dac7f6] bg-[#f6f0ff] text-[#7054b6]",
                                  item.kind === "tool_use" &&
                                    "border-[#f6d5b1] bg-[#fff7ed] text-[#b05d11]",
                                  item.kind === "tool_result" &&
                                    "border-[#c5e7d0] bg-[#f2fbf5] text-[#1d7a3c]",
                                  item.kind === "runtime" &&
                                    "border-[#d7dee8] bg-white text-[#5c7088]",
                                  item.kind === "policy" &&
                                    "border-[#f4c7c7] bg-[#fff4f4] text-[#b04343]",
                                )}
                              >
                                {item.label}
                              </div>
                              {item.meta ? (
                                <div className="mt-2 text-[10px] leading-5 text-[#8ca0b6]">
                                  {item.meta}
                                </div>
                              ) : null}
                            </div>
                            <pre className="min-w-0 font-mono text-[13px] leading-7 break-words whitespace-pre-wrap text-[#17324d]">
                              {item.body}
                            </pre>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <Tabs
                  value={
                    rightPaneMode === "workspace" ? "workspace" : bottomTab
                  }
                  onValueChange={(value) => {
                    if (value === "workspace") {
                      setRightPaneMode("workspace");
                      return;
                    }
                    openInspectorTab(value as ConsoleTab);
                  }}
                  className="flex min-h-0 flex-col border-t border-[#e7edf5]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                    <div className="text-sm font-semibold text-[#142033]">
                      {isChinese ? "产出" : "Output"}
                    </div>
                    <TabsList className="grid h-auto grid-cols-4 rounded-full border border-[#d8e2ee] bg-[#f7fbff] p-1">
                      <TabsTrigger
                        value="workspace"
                        className="rounded-full px-3 py-1.5 text-xs text-[#6d7f97] data-[state=active]:bg-[#2563eb] data-[state=active]:text-white"
                      >
                        {isChinese ? "线程" : "Thread"}
                      </TabsTrigger>
                      <TabsTrigger
                        value="terminal"
                        className="rounded-full px-3 py-1.5 text-xs text-[#6d7f97] data-[state=active]:bg-[#2563eb] data-[state=active]:text-white"
                      >
                        {copy.terminalTab}
                      </TabsTrigger>
                      <TabsTrigger
                        value="preview"
                        className="rounded-full px-3 py-1.5 text-xs text-[#6d7f97] data-[state=active]:bg-[#2563eb] data-[state=active]:text-white"
                      >
                        {copy.previewTab}
                      </TabsTrigger>
                      <TabsTrigger
                        value="changes"
                        className="rounded-full px-3 py-1.5 text-xs text-[#6d7f97] data-[state=active]:bg-[#2563eb] data-[state=active]:text-white"
                      >
                        {copy.changesTab}
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent
                    value="workspace"
                    className="m-0 min-h-0 flex-1 overflow-hidden p-4"
                  >
                    <ScrollArea className="h-full min-h-0">
                      <div className="grid gap-4 pb-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)]">
                        <section className="min-h-[220px] rounded-[24px] border border-[#e7edf5] bg-[#fbfdff] px-4 py-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-[#142033]">
                              {copy.runtimeTitle}
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full border-[#d8e2ee] bg-white text-[#6d7f97]"
                            >
                              {runtimeEvents.length}
                            </Badge>
                          </div>
                          {runtimeEvents.length === 0 ? (
                            <div className="rounded-[18px] border border-dashed border-[#dbe4ef] bg-white px-4 py-5 text-sm text-[#6d7f97]">
                              {copy.runtimeEmpty}
                            </div>
                          ) : (
                            <div className="grid gap-2">
                              {runtimeEvents.slice(0, 6).map((event) => (
                                <div
                                  key={event.id}
                                  className={cn(
                                    "rounded-[18px] border px-3 py-3",
                                    event.tone === "running" &&
                                      "border-[#dbeafe] bg-[#f3f8ff]",
                                    event.tone === "success" &&
                                      "border-[#cfe4d5] bg-[#f6fbf7]",
                                    event.tone === "error" &&
                                      "border-[#f1d5d5] bg-[#fff6f6]",
                                    event.tone === "info" &&
                                      "border-[#e7edf5] bg-white",
                                  )}
                                >
                                  <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                                    {event.title}
                                  </div>
                                  <div className="mt-1 text-sm leading-6 text-[#31475f]">
                                    {event.detail}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="min-h-[220px] rounded-[24px] border border-[#e7edf5] bg-[#fbfdff] px-4 py-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-[#142033]">
                              {copy.checkpointsTitle}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
                              onClick={() => void handleSaveCheckpoint()}
                            >
                              {copy.checkpointSave}
                            </Button>
                          </div>
                          {checkpoints.length === 0 ? (
                            <div className="rounded-[18px] border border-dashed border-[#dbe4ef] bg-white px-4 py-5 text-sm text-[#6d7f97]">
                              {copy.checkpointEmpty}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {checkpoints.slice(0, 4).map((checkpoint) => (
                                <button
                                  key={checkpoint.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCheckpointId(checkpoint.id);
                                    openInspectorTab("changes");
                                  }}
                                  className={cn(
                                    "w-full rounded-[18px] border px-3 py-3 text-left transition",
                                    checkpoint.id === selectedCheckpointId
                                      ? "border-[#9bc2ff] bg-[#edf5ff]"
                                      : "border-[#e7edf5] bg-white hover:border-[#c8d9eb] hover:bg-[#fafdff]",
                                  )}
                                >
                                  <div className="text-sm font-semibold text-[#142033]">
                                    {checkpoint.label}
                                  </div>
                                  <div className="mt-1 text-xs text-[#7a8da4]">
                                    {checkpointTimeFormatter.format(
                                      new Date(checkpoint.createdAt),
                                    )}
                                  </div>
                                  {checkpoint.summary ? (
                                    <div className="mt-2 text-sm leading-6 text-[#51657d]">
                                      {checkpoint.summary}
                                    </div>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="rounded-[24px] border border-[#e7edf5] bg-[#fbfdff] px-4 py-4 xl:col-span-2">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-[#142033]">
                              {copy.tasksTitle}
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full border-[#d8e2ee] bg-white text-[#6d7f97]"
                            >
                              {todos.length}
                            </Badge>
                          </div>
                          {todos.length === 0 ? (
                            <div className="rounded-[18px] border border-dashed border-[#dbe4ef] bg-white px-4 py-5 text-sm text-[#6d7f97]">
                              {copy.taskEmpty}
                            </div>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                              {todos.map((todo, index) => {
                                const completed = todo.status === "completed";
                                return (
                                  <div
                                    key={`${todo.content}-${index}`}
                                    className="rounded-[18px] border border-[#e7edf5] bg-white px-3 py-3"
                                  >
                                    <div className="flex items-start gap-3">
                                      <CheckCircleIcon
                                        className={cn(
                                          "mt-0.5 size-4 shrink-0",
                                          completed
                                            ? "text-emerald-500"
                                            : todo.status === "in_progress"
                                              ? "text-amber-500"
                                              : "text-[#8ba0b5]",
                                        )}
                                      />
                                      <div
                                        className={cn(
                                          "text-sm leading-6",
                                          completed
                                            ? "text-[#8ba0b5] line-through"
                                            : "text-[#31475f]",
                                        )}
                                      >
                                        {todo.content}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </section>
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent
                    value="preview"
                    className="m-0 min-h-0 flex-1 overflow-hidden p-4"
                  >
                    <div className="h-full min-h-[360px] overflow-hidden rounded-[22px] border border-[#e7edf5] bg-white">
                      <VibeErrorBoundary
                        title="Preview unavailable"
                        description="The preview surface hit an unexpected state. Retry will remount this preview panel."
                      >
                        <LazyVibeEditorSurface
                          editorEmptyBadge={copy.editorEmptyBadge}
                          editorEmptyCaption={copy.editorEmptyCaption}
                          editorEmptyChecklist={copy.editorEmptyChecklist}
                          editorEmptyBody={copy.editorEmptyBody}
                          editorEmptyTitle={copy.editorEmptyTitle}
                          noPreviewDetail={copy.noPreviewDetail}
                          noPreview={copy.noPreview}
                          previewLoading={copy.previewLoading}
                          selectedArtifact={selectedArtifact}
                          selectedArtifactLoading={selectedArtifactLoading}
                          selectedArtifactMeta={selectedArtifactMeta}
                          selectedCodeValue={selectedCodeValue}
                          threadId={threadId}
                        />
                      </VibeErrorBoundary>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="changes"
                    className="m-0 min-h-0 flex-1 p-4"
                  >
                    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-[#e7edf5] bg-white">
                      <VibeErrorBoundary
                        title="Changes unavailable"
                        description="The diff surface ran into an unexpected state. Retry will remount just this review panel."
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7edf5] px-4 py-4">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#142033]">
                              {copy.changesTab}
                            </div>
                            <div className="mt-1 text-xs text-[#6d7f97]">
                              {selectedDiff?.hasChanges
                                ? copy.changesReady
                                : copy.changesHint}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {selectedDiff?.hasChanges ? (
                              <Badge
                                variant="outline"
                                className="rounded-full border-[#d8e2ee] bg-[#f7fbff] text-[#6d7f97]"
                              >
                                +{selectedDiff.additions} / -
                                {selectedDiff.deletions}
                              </Badge>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
                              onClick={() => void handleSaveCheckpoint()}
                            >
                              {copy.checkpointSave}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
                              disabled={
                                !selectedCheckpoint ||
                                !selectedArtifactMeta?.normalizedPath ||
                                selectedCheckpointContent === undefined ||
                                thread.isLoading
                              }
                              onClick={() => void handleRestoreCheckpointFile()}
                            >
                              {copy.checkpointRestoreFile}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
                              disabled={
                                !selectedCheckpoint ||
                                selectedCheckpoint.omittedCount > 0 ||
                                thread.isLoading
                              }
                              onClick={() =>
                                void handleRestoreCheckpointRound()
                              }
                            >
                              {copy.checkpointRestoreRound}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
                              disabled={!selectedDiff?.hasChanges}
                              onClick={handleCopyPatch}
                            >
                              <CopyIcon className="size-4" />
                              {copy.copyPatch}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-full bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                              disabled={
                                !selectedDiff?.hasChanges || thread.isLoading
                              }
                              onClick={handleApplyReviewedChange}
                            >
                              <CheckCircleIcon className="size-4" />
                              {copy.applyAction}
                            </Button>
                          </div>
                        </div>
                        <ScrollArea className="min-h-0 flex-1">
                          {!selectedArtifact ? (
                            <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-[#6d7f97]">
                              {copy.waitingForOutput}
                            </div>
                          ) : selectedArtifactLoading ? (
                            <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-[#6d7f97]">
                              {copy.previewLoading}
                            </div>
                          ) : !selectedArtifactMeta?.isCodeFile ? (
                            <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-[#6d7f97]">
                              {copy.noPreview}
                            </div>
                          ) : selectedCheckpointMissingFile ? (
                            <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-[#6d7f97]">
                              {copy.checkpointMissingFile}
                            </div>
                          ) : selectedDiff?.hasChanges ? (
                            <div className="font-mono text-xs">
                              {selectedDiff.diffLines.map((line, index) => (
                                <div
                                  key={`${line.kind}-${line.oldLineNumber}-${line.newLineNumber}-${index}`}
                                  className={cn(
                                    "grid grid-cols-[52px_52px_minmax(0,1fr)] gap-3 px-4 py-1.5",
                                    line.kind === "add" &&
                                      "bg-[#f4fbf5] text-[#1e6b2f]",
                                    line.kind === "remove" &&
                                      "bg-[#fff5f5] text-[#9b3f3f]",
                                    line.kind === "context" && "text-[#53453a]",
                                  )}
                                >
                                  <span className="text-right text-[#9eb1c6]">
                                    {line.oldLineNumber ?? ""}
                                  </span>
                                  <span className="text-right text-[#9eb1c6]">
                                    {line.newLineNumber ?? ""}
                                  </span>
                                  <span className="break-all whitespace-pre-wrap">
                                    {line.kind === "add"
                                      ? "+"
                                      : line.kind === "remove"
                                        ? "-"
                                        : " "}
                                    {line.text || " "}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-[#6d7f97]">
                              {copy.diffEmpty}
                            </div>
                          )}
                        </ScrollArea>
                      </VibeErrorBoundary>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="terminal"
                    className="m-0 min-h-0 flex-1 overflow-hidden p-4"
                  >
                    <LazyVibeTerminalTab
                      activityEmpty={copy.activityEmpty}
                      agentCommandItems={agentCommandItems}
                      agentCommandsTitle={copy.agentCommands}
                      copyCommandLabel={copy.copyCommand}
                      defaultLayout={workspacePrefs.terminalLayout}
                      output={terminal.output}
                      rerunCommandLabel={copy.rerunCommand}
                      resultSummary={copy.resultSummary}
                      state={terminal.state}
                      statusLabel={terminalStatusLabel}
                      terminalNotStartedHint={copy.terminalNotStartedHint}
                      onLayoutChanged={(layout) =>
                        setWorkspacePrefs({ terminalLayout: layout })
                      }
                      onResize={handleTerminalResize}
                      onRunCommand={handleRunTerminalCommand}
                      onSendInput={queueTerminalInput}
                      onStart={terminal.start}
                    />
                  </TabsContent>
                </Tabs>
              </section>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 pb-2">
            <section className="shrink-0 rounded-[30px] border border-[#cfe0f5] bg-white px-5 py-5 shadow-[0_18px_46px_rgba(15,23,42,0.07)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-[#142033]">
                    {isChinese ? "启动工作流" : "Launch workflow"}
                  </div>
                  <div className="mt-1 text-xs text-[#6d7f97]">
                    {activeWorkflow
                      ? activeWorkflow.label
                      : copy.commandPlaceholder}
                  </div>
                </div>
                {activeWorkflow ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full border-[#d8e2ee] bg-[#f7fbff] text-[#142033] hover:bg-white"
                      onClick={() => queuePrompt(activeWorkflow.prompt)}
                    >
                      {isChinese ? "填入" : "Fill"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                      disabled={thread.isLoading || createWorkflowRun.isPending}
                      onClick={() =>
                        void startWorkflowRun(
                          activeWorkflow,
                          activeWorkflowIndex,
                          composerDraft || undefined,
                        )
                      }
                    >
                      {isChinese ? "运行" : "Run"}
                    </Button>
                  </div>
                ) : null}
              </div>

              {activeWorkflow && activeWorkflowDetail ? (
                <div className="mb-4 rounded-[26px] border border-[#dbeafe] bg-[linear-gradient(135deg,#eef6ff_0%,#ffffff_100%)] p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-[18px] bg-[#2563eb] text-white shadow-[0_14px_30px_rgba(37,99,235,0.24)]">
                      <ActiveWorkflowIcon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold tracking-[-0.02em] text-[#142033]">
                        {activeWorkflow.label}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-[#60748b]">
                        {activeWorkflowDetail.purpose}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {activeWorkflowDetail.outputs.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-[#dbe4ef] bg-white px-3 py-1.5 text-xs font-medium text-[#51657d]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <InputBox
                key={`${threadId}-${composerSeed}`}
                appearance="default"
                className="h-[320px] w-full [&_[data-slot='input-group']]:h-full [&_[data-slot='input-group']]:min-h-[320px] [&_[data-slot='input-group-control']]:min-h-[230px]"
                autoFocus
                status={thread.isLoading ? "streaming" : "ready"}
                context={settings.context}
                disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                initialValue={prefillPrompt}
                onDraftChange={handleComposerDraftChange}
                onDraftKeyDown={handleComposerKeyDown}
                showInlineSuggestions={false}
                onContextChange={(context) => setSettings("context", context)}
                onSubmit={guardedHandleSubmit}
                onStop={handleStopAgent}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6d7f97]">
                <span>{copy.composerHint}</span>
                <span>
                  {isChinese
                    ? "Enter 发送 / Shift Enter 换行"
                    : "Enter to send / Shift Enter for newline"}
                </span>
              </div>
            </section>

            <section className="shrink-0 rounded-[30px] border border-[#dbe4ef] bg-[linear-gradient(135deg,#f0f6ff_0%,#ffffff_100%)] px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[#142033]">
                  {isChinese ? "工作区状态" : "Workspace"}
                </div>
                {currentExecutionStage ? (
                  <span className="rounded-full border border-[#d9e3ef] bg-white px-3 py-1 text-[11px] font-medium text-[#51657d]">
                    {currentExecutionStage.stage}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <div className="rounded-[20px] border border-[#dbe4ef] bg-white px-4 py-3">
                  <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                    {isChinese ? "项目" : "Project"}
                  </div>
                  <div className="mt-2 truncate text-sm text-[#142033]">
                    {workspacePath}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[#dbe4ef] bg-white px-4 py-3">
                  <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                    {isChinese ? "焦点" : "Focus"}
                  </div>
                  <div className="mt-2 truncate text-sm text-[#142033]">
                    {focusLabel}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[#dbe4ef] bg-white px-4 py-3">
                  <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                    {isChinese ? "确认" : "Approval"}
                  </div>
                  <div className="mt-2 text-sm text-[#142033]">
                    {approvalModeLabel}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[#dbe4ef] bg-white px-4 py-3">
                  <div className="text-[11px] font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                    {isChinese ? "运行" : "Runtime"}
                  </div>
                  <div className="mt-2 text-sm text-[#142033]">
                    {terminalStatusLabel}
                  </div>
                </div>
              </div>

              {activePersistedWorkflowRun ? (
                <div className="mt-4 rounded-[22px] border border-[#dbeafe] bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold tracking-[0.18em] text-[#2563eb] uppercase">
                        {isChinese ? "当前工作流" : "Current workflow"}
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold text-[#142033]">
                        {activePersistedWorkflowRun.title}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-medium",
                        activePersistedWorkflowRun.status === "completed" &&
                          "border-emerald-200 bg-emerald-50 text-emerald-700",
                        activePersistedWorkflowRun.status === "failed" &&
                          "border-red-200 bg-red-50 text-red-700",
                        ["queued", "running", "waiting_approval"].includes(
                          activePersistedWorkflowRun.status,
                        ) && "border-blue-200 bg-blue-50 text-blue-700",
                      )}
                    >
                      {formatWorkflowStatusLabel(
                        activePersistedWorkflowRun.status,
                        isChinese,
                      )}
                    </span>
                  </div>
                  {activePersistedWorkflowRun.steps.length > 0 ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {activePersistedWorkflowRun.steps
                        .slice(0, 3)
                        .map((step, index) => (
                          <div
                            key={step.id}
                            className="rounded-[16px] border border-[#e7edf5] bg-[#f8fbff] px-3 py-3"
                          >
                            <div className="text-[11px] font-semibold text-[#8aa0b6]">
                              {index + 1}
                            </div>
                            <div className="mt-1 truncate text-xs font-medium text-[#31475f]">
                              {step.label}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="min-h-[320px] shrink-0 overflow-hidden rounded-[30px] border border-[#dbe4ef] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
              <ScrollArea className="h-[320px]">
                <div className="space-y-4 px-5 py-5">
                  {pendingCommandApproval ? (
                    <div className="rounded-[22px] border border-[#f2c6c6] bg-[#fff6f6] px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold tracking-[0.18em] text-[#b04343] uppercase">
                            {isChinese ? "待确认操作" : "pending approval"}
                          </div>
                          <div className="mt-2 text-sm font-medium text-[#142033]">
                            {pendingCommandApproval.label ??
                              pendingCommandApproval.command}
                          </div>
                          <p className="mt-2 text-xs leading-6 text-[#7e5b5b]">
                            {pendingCommandApproval.reason}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="rounded-full bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                            onClick={() => void handleApprovePendingCommand()}
                          >
                            {isChinese ? "批准" : "Approve"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-full border-[#d8e2ee] bg-white text-[#142033] hover:bg-[#f7fbff]"
                            onClick={handleRejectPendingCommand}
                          >
                            {isChinese ? "取消" : "Cancel"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-[22px] border border-[#dbe4ef] bg-[#fbfdff] px-4 py-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#142033]">
                        {copy.runtimeTitle}
                      </div>
                      <span className="rounded-full border border-[#d8e2ee] bg-white px-3 py-1 text-[11px] font-medium text-[#60748b]">
                        {executionLaneItems.length}
                      </span>
                    </div>
                    {executionLaneItems.length === 0 ? (
                      <div className="rounded-[18px] border border-dashed border-[#dbe4ef] bg-white px-4 py-7 text-sm leading-6 text-[#6d7f97]">
                        {isChinese
                          ? "运行、工具调用和审批会显示在这里。"
                          : "Runs, tool calls, and approvals will appear here."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {executionLaneItems.map((item) => (
                          <div
                            key={item.id}
                            className={cn(
                              "rounded-[18px] border px-3 py-3",
                              item.kind === "policy" &&
                                "border-[#f2c6c6] bg-[#fff6f6]",
                              item.kind === "tool_result" &&
                                "border-[#cfe4d5] bg-[#f6fbf7]",
                              (item.kind === "runtime" ||
                                item.kind === "tool_use") &&
                                "border-[#dbeafe] bg-[#f3f8ff]",
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-[#142033]">
                                {item.stage}
                              </div>
                              <span className="text-[11px] text-[#7a8da4]">
                                {item.meta}
                              </span>
                            </div>
                            <div className="mt-2 text-sm leading-6 text-[#51657d]">
                              {item.body}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[22px] border border-[#dbe4ef] bg-[#fbfdff] px-4 py-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#142033]">
                        {copy.tasksTitle}
                      </div>
                      <Badge
                        variant="outline"
                        className="rounded-full border-[#d8e2ee] bg-white text-[#6d7f97]"
                      >
                        {todos.length}
                      </Badge>
                    </div>
                    {todos.length === 0 ? (
                      <div className="grid gap-2">
                        {(activeWorkflowDetail?.abilities ?? []).map(
                          (item, index) => (
                            <div
                              key={item}
                              className="flex items-center gap-3 rounded-[18px] border border-[#e7edf5] bg-white px-3 py-3"
                            >
                              <span
                                className={cn(
                                  "size-2.5 rounded-full",
                                  index === 0 && "bg-[#2563eb]",
                                  index === 1 && "bg-[#38bdf8]",
                                  index === 2 && "bg-[#99f6e4]",
                                )}
                              />
                              <span className="text-sm font-medium text-[#31475f]">
                                {item}
                              </span>
                            </div>
                          ),
                        )}
                        <div className="rounded-[18px] border border-dashed border-[#dbe4ef] bg-white px-4 py-4 text-sm text-[#6d7f97]">
                          {copy.taskEmpty}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {todos.slice(0, 6).map((todo, index) => (
                          <div
                            key={`${todo.content}-${index}`}
                            className="rounded-[18px] border border-[#e7edf5] bg-white px-3 py-3 text-sm leading-6 text-[#31475f]"
                          >
                            {todo.content}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </section>
          </aside>
        </main>

        <VibeCommandPalette
          open={isPaletteOpen}
          onOpenChange={setIsPaletteOpen}
          title={copy.paletteTitle}
          description={copy.paletteDescription}
          inputPlaceholder={copy.paletteInputPlaceholder}
          emptyLabel={copy.paletteEmpty}
          groups={paletteGroups}
        />
      </div>
    </ThreadContext.Provider>
  );
}

export default function VibeCodingPage() {
  return (
    <ArtifactsProvider>
      <VibeCodingWorkbench />
    </ArtifactsProvider>
  );
}
