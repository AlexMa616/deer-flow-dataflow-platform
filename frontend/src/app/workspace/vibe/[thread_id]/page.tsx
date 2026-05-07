"use client";

import type { Message } from "@langchain/langgraph-sdk";
import type { UseStream } from "@langchain/langgraph-sdk/react";
import {
  BotIcon,
  CheckCircleIcon,
  ClockIcon,
  Code2Icon,
  CopyIcon,
  EyeIcon,
  FileCodeIcon,
  FolderIcon,
  GitBranchIcon,
  Layers3Icon,
  LogOutIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  SquareArrowOutUpRightIcon,
  SquareTerminalIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  WorkflowIcon,
  UserCircleIcon,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArtifactsProvider,
  useArtifacts,
} from "@/components/workspace/artifacts";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
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
import {
  ensureThreadExists,
  useSubmitThread,
  useThreadStream,
} from "@/core/threads/hooks";
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
  useWorkflowStats,
  useWorkflowThreads,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowThreadMapping,
  type WorkflowRunType,
} from "@/core/workflows";
import { env } from "@/env";
import { fetchMe, getUser, logout, type User } from "@/lib/auth";
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
const DEFAULT_WORKFLOW_PROJECT_ID = "deer-flow";
const WORKFLOW_PROJECTS_STORAGE_KEY = "deerflow.workflow-studio.projects";
const WORKFLOW_ACTIVE_PROJECT_STORAGE_KEY =
  "deerflow.workflow-studio.active-project";

type StudioMode = "flash" | "thinking" | "pro" | "ultra";

type WorkflowProjectState = {
  id: string;
  name: string;
  description?: string;
  defaultModel?: string;
  threadIds: string[];
  createdAt: string;
  updatedAt: string;
};

function createDefaultWorkflowProject(
  isChinese: boolean,
  modelName?: string,
): WorkflowProjectState {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_WORKFLOW_PROJECT_ID,
    name: "deer-flow",
    description: isChinese ? "当前工作区项目" : "Current workspace project",
    defaultModel: modelName,
    threadIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getThreadLabel(
  thread: Pick<WorkflowThreadMapping, "thread_id" | "title">,
  isChinese: boolean,
) {
  const title = thread.title?.trim();
  if (title !== undefined && title.length > 0) {
    return title;
  }
  return isChinese ? "未命名线程" : "Untitled thread";
}

function getModeLabel(mode: StudioMode | undefined, isChinese: boolean) {
  if (mode === "flash") {
    return isChinese ? "快速" : "Fast";
  }
  if (mode === "pro") {
    return isChinese ? "深度" : "Deep";
  }
  if (mode === "ultra") {
    return isChinese ? "超高" : "Ultra";
  }
  return isChinese ? "思考" : "Think";
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
            commandPlaceholder: "输入目标，或使用 /project 创建结构化运行",
            composerHint:
              "发送后会创建运行记录，并把步骤、结果和资产同步到当前线程。",
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
            explorerSummary: "产出会沉淀为资产、快照和运行记录，方便继续推进。",
            explorerTitle: "资产",
            filesCount: "文件",
            exitImmersive: "返回工作区",
            heroDescription: "把一个目标拆给线程、模型和 agent 协作推进。",
            heroTitle: "协作工作台",
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
            paletteCommands: "命令",
            paletteDescription: "搜索资产、视图和命令。",
            paletteEmpty: "没有匹配结果",
            paletteFiles: "文件",
            paletteInputPlaceholder: "搜索文件、视图或命令",
            paletteNavigation: "导航",
            paletteOpenTabs: "打开的标签",
            palettePrompts: "工作区视图",
            paletteRecentCommands: "版本快照",
            paletteTitle: "工作台面板",
            paletteTrigger: "工作台面板",
            quickActions: [
              {
                description: "目标、范围、阶段、交付",
                icon: FileCodeIcon,
                label: "做项目计划",
                prompt:
                  "请把当前需求整理成可执行项目计划：明确目标、范围、阶段、关键模块、优先级、交付物和下一步行动。",
              },
              {
                description: "问题、证据、结论、缺口",
                icon: SearchIcon,
                label: "做资料研究",
                prompt:
                  "请围绕当前主题建立研究线程：整理背景、关键问题、证据来源、阶段结论、风险和待验证点。",
              },
              {
                description: "文件、页面、文档、素材",
                icon: EyeIcon,
                label: "整理资源库",
                prompt:
                  "请把当前工作区整理成资源库：分类页面、组件、文档、数据和素材，标记可复用资产与缺失内容。",
              },
              {
                description: "视觉、组件、交互、规范",
                icon: SparklesIcon,
                label: "统一设计规范",
                prompt:
                  "请基于当前工作区梳理设计规范：视觉基调、版式节奏、组件层级、交互原则和需要统一的设计决策。",
              },
              {
                description: "Skills、插件、工具模块",
                icon: Code2Icon,
                label: "沉淀复用能力",
                prompt:
                  "请从 skills、plugins、MCP 工具和可复用模块角度审视当前工作区，规划可沉淀能力、职责边界和接入方式。",
              },
              {
                description: "触发、执行、审批、通知",
                icon: CheckCircleIcon,
                label: "创建自动化",
                prompt:
                  "请基于当前工作区设计可落地的自动化流程：定义触发条件、执行动作、审批节点、输出结果和异常处理。",
              },
            ] satisfies QuickAction[],
            quickStart: "开始",
            resultSummary: "最近输出",
            reconnectShell: "重新连接",
            restoreTerminal: "还原日志",
            rerunCommand: "重新运行",
            runCommand: "运行",
            modelLabel: "模型",
            runtimeEmpty: "运行、工具调用和审批会显示在这里。",
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
            taskEmpty: "结构化运行开始后会生成待办。",
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
            workspaceTitle: "协作工作台",
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
              "Type a goal, or use /project for a structured run",
            composerHint:
              "Sending creates a run record and syncs steps, output, and assets into this thread.",
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
              "Outputs become assets, snapshots, and run records you can continue from.",
            explorerTitle: "Assets",
            filesCount: "files",
            exitImmersive: "Back to workspace",
            heroDescription:
              "Turn one request into steps, runtime progress, and reviewable output.",
            heroTitle: "Agent Studio",
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
            paletteCommands: "Commands",
            paletteDescription:
              "Quickly search project assets, workspace views, and commands.",
            paletteEmpty: "No matching results",
            paletteFiles: "Files",
            paletteInputPlaceholder: "Search files, views, or commands",
            paletteNavigation: "Navigation",
            paletteOpenTabs: "Open Tabs",
            palettePrompts: "Workspace Views",
            paletteRecentCommands: "Snapshots",
            paletteTitle: "Workspace Palette",
            paletteTrigger: "Workspace Palette",
            quickActions: [
              {
                description: "Goals, scope, phases, and deliverables",
                icon: FileCodeIcon,
                label: "Plan a Project",
                prompt:
                  "Turn the current request into an executable project plan: define goals, scope, phases, key modules, priorities, deliverables, and the next action.",
              },
              {
                description: "Questions, evidence, findings, and gaps",
                icon: SearchIcon,
                label: "Research a Topic",
                prompt:
                  "Create a research thread for the current topic: organize background, key questions, evidence, interim findings, risks, and validation gaps.",
              },
              {
                description: "Files, pages, docs, and reusable assets",
                icon: EyeIcon,
                label: "Organize Library",
                prompt:
                  "Organize the current workspace as a resource library: classify pages, components, documents, data, and assets, then mark reusable items and missing pieces.",
              },
              {
                description: "Visuals, components, interaction, and rules",
                icon: SparklesIcon,
                label: "Align Design Rules",
                prompt:
                  "Review the current workspace as a design system: clarify visual direction, layout rhythm, component hierarchy, interaction principles, and decisions to standardize.",
              },
              {
                description: "Skills, plugins, and tool modules",
                icon: Code2Icon,
                label: "Package Capabilities",
                prompt:
                  "Review this workspace through skills, plugins, MCP tools, and reusable modules. Identify capabilities to package, their boundaries, and integration points.",
              },
              {
                description: "Triggers, actions, approvals, and alerts",
                icon: CheckCircleIcon,
                label: "Create Automation",
                prompt:
                  "Design an automation flow for this workspace: define triggers, actions, approval points, outputs, dependencies, and failure handling.",
              },
            ] satisfies QuickAction[],
            quickStart: "Start",
            resultSummary: "Recent Output",
            reconnectShell: "Reconnect",
            restoreTerminal: "Restore logs",
            rerunCommand: "Run again",
            runCommand: "Run",
            modelLabel: "Model",
            runtimeEmpty: "Runs, tool calls, and approvals will appear here.",
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
            taskEmpty: "Tasks will appear after a structured run starts.",
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
            workspaceTitle: "Agent Studio",
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
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workflowProjects, setWorkflowProjects] = useState<
    WorkflowProjectState[]
  >([]);
  const [activeProjectId, setActiveProjectId] = useState(
    DEFAULT_WORKFLOW_PROJECT_ID,
  );
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
  const workflowStatsQuery = useWorkflowStats(threadId, {
    enabled: Boolean(threadId),
  });
  const workflowThreadsQuery = useWorkflowThreads(
    currentUser?.id ? String(currentUser.id) : undefined,
  );
  const createWorkflowRun = useCreateWorkflowRun(threadId);
  const updateWorkflowRun = useUpdateWorkflowRun(threadId);
  const { data: systemOverview } = useSystemOverview();
  const approvalMode = workspacePrefs.approvalMode as ApprovalMode;
  const hookToggles = workspacePrefs.hookToggles;
  const compactNotes = workspacePrefs.compactNotes;

  useEffect(() => {
    let active = true;
    const localUser = getUser();
    if (localUser) {
      setCurrentUser(localUser);
    }

    void fetchMe()
      .then((user) => {
        if (active) {
          setCurrentUser(user as User);
        }
      })
      .catch(() => {
        if (active && !localUser) {
          setCurrentUser(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const currentModelName =
    typeof settings.context.model_name === "string"
      ? settings.context.model_name
      : undefined;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let nextProjects: WorkflowProjectState[] = [];
    try {
      const rawProjects = window.localStorage.getItem(
        WORKFLOW_PROJECTS_STORAGE_KEY,
      );
      if (rawProjects) {
        const parsed = JSON.parse(rawProjects) as WorkflowProjectState[];
        if (Array.isArray(parsed)) {
          nextProjects = parsed.filter(
            (project) =>
              typeof project.id === "string" &&
              typeof project.name === "string",
          );
        }
      }
    } catch {
      nextProjects = [];
    }

    if (nextProjects.length === 0) {
      nextProjects = [
        createDefaultWorkflowProject(isChinese, currentModelName),
      ];
    }

    setWorkflowProjects(nextProjects);

    const storedActiveProject = window.localStorage.getItem(
      WORKFLOW_ACTIVE_PROJECT_STORAGE_KEY,
    );
    if (
      storedActiveProject &&
      nextProjects.some((project) => project.id === storedActiveProject)
    ) {
      setActiveProjectId(storedActiveProject);
    } else {
      setActiveProjectId(nextProjects[0]?.id ?? DEFAULT_WORKFLOW_PROJECT_ID);
    }
  }, [currentModelName, isChinese]);

  useEffect(() => {
    if (typeof window === "undefined" || workflowProjects.length === 0) {
      return;
    }

    window.localStorage.setItem(
      WORKFLOW_PROJECTS_STORAGE_KEY,
      JSON.stringify(workflowProjects),
    );
  }, [workflowProjects]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      WORKFLOW_ACTIVE_PROJECT_STORAGE_KEY,
      activeProjectId,
    );
  }, [activeProjectId]);

  const userDisplayName = currentUser?.username?.trim() ?? "DeerFlow";
  const userInitials = userDisplayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    let cancelled = false;
    const requestId = threadBootstrapRequestRef.current + 1;
    threadBootstrapRequestRef.current = requestId;

    const prepareThread = async () => {
      setFinalState(null);

      if (threadIdFromPath === "new") {
        const nextThreadId = uuid();
        try {
          await ensureThreadExists(nextThreadId);
        } catch (error) {
          if (cancelled || threadBootstrapRequestRef.current !== requestId) {
            return;
          }

          setThreadId(nextThreadId);
          toast.error(getThreadErrorDisplay(error).message);
          return;
        }

        if (cancelled || threadBootstrapRequestRef.current !== requestId) {
          return;
        }

        setThreadId(nextThreadId);
        return;
      }

      setThreadId(null);
      try {
        await ensureThreadExists(threadIdFromPath);

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
      const currentRun = workflowRunsQuery.data?.runs?.find(
        (run) => run.id === runId,
      );
      const steps = currentRun?.steps.map((step) => {
        if (status === "completed") {
          return {
            ...step,
            detail: step.detail ?? (isChinese ? "已完成" : "Completed"),
            status: "completed" as const,
          };
        }
        if (status === "failed") {
          return {
            ...step,
            detail: step.detail ?? getThreadErrorDisplay(error).message,
            status:
              step.status === "completed"
                ? ("completed" as const)
                : ("failed" as const),
          };
        }
        return {
          ...step,
          detail: step.detail ?? (isChinese ? "已取消" : "Cancelled"),
          status:
            step.status === "completed"
              ? ("completed" as const)
              : ("skipped" as const),
        };
      });

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
            steps,
            status,
            summary,
          },
        })
        .catch((updateError) => {
          console.error("Failed to update workflow run", updateError);
        });
    },
    [isChinese, threadId, updateWorkflowRun, workflowRunsQuery.data?.runs],
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
    threadId,
    thread,
    threadContext: {
      ...settings.context,
      thinking_enabled: settings.context.mode !== "flash",
      is_plan_mode:
        settings.context.mode === "pro" ||
        (settings.context.mode === "ultra" &&
          (models.find((model) => model.name === currentModelName)
            ?.ultra_uses_plan_mode ??
            true)),
      subagent_enabled: settings.context.mode === "ultra",
      max_concurrent_subagents:
        settings.context.mode === "ultra" ? 3 : undefined,
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
      const selectedModelName = currentModelName ?? null;
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
      currentModelName,
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
  const selectedModel = useMemo(
    () =>
      models.find((model) => model.name === currentModelName) ??
      models[0] ??
      null,
    [currentModelName, models],
  );
  const selectedMode = (settings.context.mode ?? "thinking") as StudioMode;
  const availableStudioModes = useMemo(() => {
    const options: StudioMode[] = ["flash"];
    const supportsWorkflowThinking =
      Boolean(selectedModel?.supports_thinking) ||
      Boolean(selectedModel?.supports_workflow_modes);
    if (supportsWorkflowThinking) {
      options.push("thinking");
    }
    if (
      supportsWorkflowThinking &&
      selectedModel?.supports_plan_mode !== false
    ) {
      options.push("pro");
    }
    if (
      supportsWorkflowThinking &&
      selectedModel?.supports_plan_mode !== false &&
      selectedModel?.supports_subagents !== false
    ) {
      options.push("ultra");
    }
    return options;
  }, [selectedModel]);
  const safeSelectedMode = availableStudioModes.includes(selectedMode)
    ? selectedMode
    : (availableStudioModes[0] ?? "flash");

  const handleStudioModelChange = useCallback(
    (modelName: string) => {
      const nextModel = models.find((model) => model.name === modelName);
      let nextMode = settings.context.mode;
      if (nextModel?.supports_subagents === false && nextMode === "ultra") {
        nextMode = nextModel.supports_plan_mode === false ? "thinking" : "pro";
      }
      if (nextModel?.supports_plan_mode === false && nextMode === "pro") {
        nextMode = "thinking";
      }
      if (
        !nextModel?.supports_thinking &&
        !nextModel?.supports_workflow_modes
      ) {
        nextMode = "flash";
      }
      setSettings("context", {
        model_name: modelName,
        mode: nextMode ?? "thinking",
      });
      setWorkflowProjects((current) =>
        current.map((project) =>
          project.id === activeProjectId
            ? {
                ...project,
                defaultModel: modelName,
                updatedAt: new Date().toISOString(),
              }
            : project,
        ),
      );
    },
    [activeProjectId, models, setSettings, settings.context.mode],
  );

  const handleStudioModeChange = useCallback(
    (mode: StudioMode) => {
      setSettings("context", { mode });
    },
    [setSettings],
  );
  const handleStudioWebSearchChange = useCallback(
    (checked: boolean) => {
      setSettings("context", { web_search_enabled: checked });
    },
    [setSettings],
  );

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
          ? "把需求拆成路线图、阶段和任务"
          : "Turn requests into roadmap, phases, and tasks",
        label: isChinese ? "项目计划" : "Project Plans",
        metric: `${isChinese ? "线程" : "threads"} ${systemOverview?.threads.count ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[0]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "整理问题、证据、结论和缺口"
          : "Organize questions, evidence, findings, and gaps",
        label: isChinese ? "研究记录" : "Research Notes",
        metric: `${isChinese ? "资料" : "docs"} ${systemOverview?.vector.documents ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[1]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "分类页面、文档、组件和素材"
          : "Classify pages, docs, components, and assets",
        label: isChinese ? "资源库" : "Library",
        metric: `${isChinese ? "资产" : "assets"} ${fileItems.length}`,
        onSelect: () => queuePrompt(copy.quickActions[2]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "统一视觉、组件和交互规则"
          : "Align visuals, components, and interaction rules",
        label: isChinese ? "设计规范" : "Design Rules",
        metric: `${isChinese ? "快照" : "snapshots"} ${checkpoints.length}`,
        onSelect: () => queuePrompt(copy.quickActions[3]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "把高频动作沉淀为可复用 Skill"
          : "Turn repeatable actions into reusable skills",
        label: "Skills",
        metric: `${isChinese ? "启用" : "enabled"} ${systemOverview?.extensions.skills_enabled ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[4]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "管理 MCP、插件和外部集成"
          : "Manage MCP, plugins, and external integrations",
        label: isChinese ? "插件" : "Plugins",
        metric: `${isChinese ? "接入" : "connected"} ${systemOverview?.extensions.mcp_enabled ?? 0}`,
        onSelect: () => queuePrompt(copy.quickActions[4]?.prompt ?? ""),
      },
      {
        description: isChinese
          ? "设计触发器、审批和执行链路"
          : "Design triggers, approvals, and execution chains",
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
  const workflowGuideItems = useMemo(
    () =>
      isChinese
        ? [
            ["输入目标", "拆步骤", "生成路线图"],
            ["提出问题", "整理证据", "输出结论"],
            ["扫描资产", "分类归档", "标记缺口"],
            ["识别风格", "统一规则", "生成规范"],
            ["发现重复", "封装 Skill", "定义接入"],
            ["定义触发", "编排动作", "记录结果"],
          ]
        : [
            ["Input goal", "Split steps", "Create roadmap"],
            ["Ask questions", "Gather evidence", "Ship findings"],
            ["Scan assets", "Classify library", "Mark gaps"],
            ["Read style", "Align rules", "Create spec"],
            ["Find repeats", "Package skill", "Define access"],
            ["Define trigger", "Run actions", "Record result"],
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
              abilities: ["拆目标", "定范围", "排阶段"],
              outputs: ["路线图", "任务清单", "下一步"],
              purpose: "把一句需求变成可以继续执行的项目计划。",
              useCases: ["新功能启动", "重构规划", "项目推进"],
            },
            {
              abilities: ["定问题", "整理证据", "提结论"],
              outputs: ["研究摘要", "证据列表", "待验证点"],
              purpose: "把零散资料整理成可追踪的研究记录。",
              useCases: ["背景梳理", "技术调研", "方案对比"],
            },
            {
              abilities: ["分类资产", "建立目录", "识别缺口"],
              outputs: ["资源地图", "文件目录", "复用清单"],
              purpose: "把页面、文档和素材整理成可复用资源库。",
              useCases: ["文件归类", "页面沉淀", "资料整理"],
            },
            {
              abilities: ["识别风格", "统一组件", "定义交互"],
              outputs: ["设计规范", "组件清单", "体验原则"],
              purpose: "把零散界面收束成一致的产品体验。",
              useCases: ["界面优化", "组件规范", "体验统一"],
            },
            {
              abilities: ["发现重复", "封装 Skill", "规划插件"],
              outputs: ["Skill 方案", "插件边界", "接入清单"],
              purpose: "把高频操作沉淀成可复用的工作能力。",
              useCases: ["流程复用", "工具接入", "团队能力"],
            },
            {
              abilities: ["定义触发", "编排动作", "处理异常"],
              outputs: ["触发器", "执行链路", "通知策略"],
              purpose: "把重复任务设计成可追踪的自动化流程。",
              useCases: ["定时任务", "自动检查", "状态通知"],
            },
          ]
        : [
            {
              abilities: ["Split goals", "Scope work", "Plan phases"],
              outputs: ["Roadmap", "Priorities", "Next step"],
              purpose: "Turn one request into a project plan you can execute.",
              useCases: [
                "Feature kickoff",
                "Refactor planning",
                "Delivery plan",
              ],
            },
            {
              abilities: [
                "Frame questions",
                "Organize evidence",
                "Capture findings",
              ],
              outputs: ["Research brief", "Evidence list", "Open issues"],
              purpose: "Turn scattered sources into traceable research notes.",
              useCases: ["Market review", "Tech research", "Background study"],
            },
            {
              abilities: ["Classify assets", "Create index", "Find gaps"],
              outputs: ["Asset map", "File index", "Reuse list"],
              purpose: "Turn pages, docs, and files into a reusable library.",
              useCases: ["Handoff", "Component cleanup", "Knowledge base"],
            },
            {
              abilities: ["Read style", "Unify components", "Set interaction"],
              outputs: ["Design rules", "Component list", "UX principles"],
              purpose: "Turn scattered screens into a consistent product UX.",
              useCases: ["UI redesign", "Brand alignment", "Component rules"],
            },
            {
              abilities: ["Find repeats", "Package skills", "Plan plugins"],
              outputs: ["Skill plan", "Plugin scope", "Integration list"],
              purpose: "Turn frequent actions into reusable capabilities.",
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
              purpose: "Design repeated tasks as traceable automation flows.",
              useCases: ["Scheduled checks", "Auto summaries", "Status alerts"],
            },
          ],
    [isChinese],
  );
  const activeWorkflowDetail =
    workflowProductDetails[activeWorkflowIndex] ??
    workflowProductDetails[0] ??
    null;
  const workflowRuns = useMemo(
    () => workflowRunsQuery.data?.runs ?? [],
    [workflowRunsQuery.data?.runs],
  );
  const workflowStats = workflowStatsQuery.data;
  const activeWorkflowRunCount =
    (workflowStats?.status_counts.queued ?? 0) +
    (workflowStats?.status_counts.running ?? 0) +
    (workflowStats?.status_counts.waiting_approval ?? 0);
  const latestWorkflowRun = workflowRuns[0] ?? null;
  const activePersistedWorkflowRun =
    workflowRuns.find((run) =>
      ["queued", "running", "waiting_approval"].includes(run.status),
    ) ?? latestWorkflowRun;
  const workflowThreadMappings = useMemo(
    () => workflowThreadsQuery.data?.threads ?? [],
    [workflowThreadsQuery.data?.threads],
  );
  const activeProject = useMemo(() => {
    return (
      workflowProjects.find((project) => project.id === activeProjectId) ??
      workflowProjects[0] ??
      createDefaultWorkflowProject(isChinese, currentModelName)
    );
  }, [activeProjectId, currentModelName, isChinese, workflowProjects]);
  const workflowProjectCards = useMemo(() => {
    const projects =
      workflowProjects.length > 0
        ? workflowProjects
        : [createDefaultWorkflowProject(isChinese, currentModelName)];
    const currentThreadMapping: WorkflowThreadMapping | null = threadId
      ? {
          created_at: new Date().toISOString(),
          last_status: activePersistedWorkflowRun?.status ?? null,
          last_workflow_type: activePersistedWorkflowRun?.workflow_type ?? null,
          model_name: selectedModel?.name ?? null,
          project_id: activeProjectId,
          project_name: activeProject.name,
          thread_id: threadId,
          title: sessionTitle,
          updated_at: new Date().toISOString(),
          user_id: currentUser?.id ? String(currentUser.id) : "local",
        }
      : null;

    return projects.map((project) => {
      const explicitThreadIds = new Set(project.threadIds);
      const projectThreads = workflowThreadMappings.filter((mapping) => {
        const mappingProjectId =
          mapping.project_id ?? DEFAULT_WORKFLOW_PROJECT_ID;
        return (
          mappingProjectId === project.id ||
          explicitThreadIds.has(mapping.thread_id)
        );
      });

      const threadMap = new Map<string, WorkflowThreadMapping>();
      projectThreads.forEach((mapping) => {
        threadMap.set(mapping.thread_id, mapping);
      });
      if (
        currentThreadMapping &&
        (project.id === activeProjectId ||
          explicitThreadIds.has(currentThreadMapping.thread_id))
      ) {
        threadMap.set(currentThreadMapping.thread_id, currentThreadMapping);
      }

      const threads = Array.from(threadMap.values()).sort(
        (left, right) =>
          new Date(right.updated_at).getTime() -
          new Date(left.updated_at).getTime(),
      );

      return {
        ...project,
        threads,
      };
    });
  }, [
    activePersistedWorkflowRun?.status,
    activePersistedWorkflowRun?.workflow_type,
    activeProject.name,
    activeProjectId,
    currentUser?.id,
    isChinese,
    selectedModel?.name,
    sessionTitle,
    currentModelName,
    threadId,
    workflowProjects,
    workflowThreadMappings,
  ]);
  const activeProjectCard =
    workflowProjectCards.find((project) => project.id === activeProject.id) ??
    workflowProjectCards[0] ??
    null;
  const handleCreateWorkflowProject = useCallback(() => {
    const now = new Date().toISOString();
    const nextIndex = workflowProjects.length + 1;
    const project: WorkflowProjectState = {
      id: `project-${Date.now().toString(36)}`,
      name: isChinese ? `项目 ${nextIndex}` : `Project ${nextIndex}`,
      description: isChinese ? "新的工作项目" : "New work project",
      defaultModel: selectedModel?.name,
      threadIds: [],
      createdAt: now,
      updatedAt: now,
    };
    setWorkflowProjects((current) => [...current, project]);
    setActiveProjectId(project.id);
  }, [isChinese, selectedModel?.name, workflowProjects.length]);

  useEffect(() => {
    if (!threadId || workflowProjects.length === 0) {
      return;
    }
    setWorkflowProjects((current) => {
      let changed = false;
      const next = current.map((project) => {
        if (project.id !== activeProjectId) {
          return project;
        }
        const hasThread = project.threadIds.includes(threadId);
        const nextModelName = selectedModel?.name ?? project.defaultModel;
        if (hasThread && project.defaultModel === nextModelName) {
          return project;
        }
        changed = true;
        return {
          ...project,
          defaultModel: nextModelName,
          threadIds: hasThread
            ? project.threadIds
            : [threadId, ...project.threadIds].slice(0, 80),
          updatedAt: new Date().toISOString(),
        };
      });
      return changed ? next : current;
    });
  }, [activeProjectId, selectedModel?.name, threadId, workflowProjects.length]);
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

  const startWorkflowRun = useCallback(
    async (
      action: QuickAction,
      index: number,
      taskDetails?: string,
      files?: PromptInputMessage["files"],
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
            agent_mode: selectedMode,
            model_name: selectedModel?.name ?? currentModelName,
            expected_outputs: detail?.outputs ?? [],
            project_id: activeProject.id,
            project_name: activeProject.name,
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
          user_id: currentUser?.id ? String(currentUser.id) : undefined,
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
          files: files ?? [],
          text: [
            `<workflow_run id="${run.id}" type="${workflowType}" title="${action.label}">`,
            `<project id="${activeProject.id}" name="${activeProject.name}" model="${selectedModel?.name ?? currentModelName ?? ""}" mode="${selectedMode}">`,
            prompt,
            "</project>",
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
      activeProject.id,
      activeProject.name,
      createWorkflowRun,
      currentUser?.id,
      isChinese,
      pushRuntimeEvent,
      selectedMode,
      selectedModel?.name,
      currentModelName,
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
        command === "automation"
      ) {
        const actionIndex =
          command === "project"
            ? 0
            : command === "research"
              ? 1
              : command === "library"
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
      try {
        if (await handleSlashCommand(message)) {
          setComposerDraft("");
          return;
        }
        await submitAgentMessage(message);
        setComposerDraft("");
      } catch (error) {
        console.error(error);
        toast.error(getThreadErrorDisplay(error).message);
      }
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
      const nextCols = Math.min(400, Math.max(2, Math.floor(cols)));
      const nextRows = Math.min(200, Math.max(1, Math.floor(rows)));
      if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) {
        return;
      }
      if (!terminal.state?.session_id || terminal.state.status === "stopped") {
        return;
      }
      if (
        nextCols === lastTerminalSizeRef.current.cols &&
        nextRows === lastTerminalSizeRef.current.rows
      ) {
        return;
      }
      pendingTerminalSizeRef.current = { cols: nextCols, rows: nextRows };
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
              <div className="flex items-center gap-2 rounded-full border border-[#d8e2ee] bg-white px-2.5 py-1.5 text-[#142033] shadow-sm">
                <span className="grid size-7 place-items-center rounded-full bg-[#eef5ff] text-[#2563eb]">
                  <UserCircleIcon className="size-4" />
                </span>
                <span className="max-w-28 truncate text-xs font-semibold">
                  {currentUser?.username ?? (isChinese ? "账号" : "Account")}
                </span>
              </div>
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full border-[#d8e2ee] bg-white text-[#b42318] hover:border-[#fecaca] hover:bg-[#fff5f5] hover:text-[#b42318]"
                onClick={logout}
              >
                <LogOutIcon className="size-4" />
                {isChinese ? "退出" : "Sign out"}
              </Button>
            </div>
          </div>
        </header>

        <main className="relative z-10 grid h-[calc(100vh-98px)] w-full min-w-0 flex-1 grid-cols-1 overflow-hidden bg-[linear-gradient(135deg,#f6f9fd_0%,#eef6ff_44%,#f8fafc_100%)] xl:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col border-r border-[#dce6f2] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(244,249,255,0.9)_100%)] px-5 py-5 shadow-[14px_0_38px_rgba(15,23,42,0.05)] backdrop-blur-xl xl:flex">
            <div className="space-y-2">
              {[
                {
                  icon: MessageSquareIcon,
                  label: copy.newSession,
                  href: newSessionHref,
                },
                {
                  icon: SearchIcon,
                  label: isChinese ? "搜索" : "Search",
                  onClick: () => setIsPaletteOpen(true),
                },
                {
                  icon: Layers3Icon,
                  label: isChinese ? "插件" : "Plugins",
                  onClick: () =>
                    queuePrompt(copy.quickActions[4]?.prompt ?? ""),
                },
                {
                  icon: ClockIcon,
                  label: isChinese ? "自动化" : "Automation",
                  onClick: () =>
                    queuePrompt(copy.quickActions[5]?.prompt ?? ""),
                },
              ].map((item) => {
                const Icon = item.icon;
                const body = (
                  <span className="flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left text-[15px] font-semibold text-[#263447] transition hover:bg-[#eef5ff] hover:text-[#2563eb]">
                    <Icon className="size-5 text-[#67788f]" />
                    {item.label}
                  </span>
                );
                return item.href ? (
                  <Link key={item.label} href={item.href}>
                    {body}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.onClick}
                    className="w-full"
                  >
                    {body}
                  </button>
                );
              })}
            </div>

            <div className="mt-8 flex items-center justify-between gap-3 px-1">
              <div className="text-[13px] font-semibold tracking-[0.14em] text-[#8a98aa] uppercase">
                {isChinese ? "项目" : "Projects"}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-full text-[#7a8899] transition hover:bg-[#eef5ff] hover:text-[#2563eb]"
                  onClick={() => setIsPaletteOpen(true)}
                  title={isChinese ? "筛选" : "Filter"}
                >
                  <SlidersHorizontalIcon className="size-4" />
                </button>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-full text-[#7a8899] transition hover:bg-[#eef5ff] hover:text-[#2563eb]"
                  onClick={handleCreateWorkflowProject}
                  title={isChinese ? "新建项目" : "New project"}
                >
                  <PlusIcon className="size-4" />
                </button>
              </div>
            </div>

            <ScrollArea className="mt-4 min-h-0 flex-1 pr-2">
              <div className="space-y-3 pb-6">
                {workflowProjectCards.map((project) => {
                  const active = project.id === activeProject.id;
                  return (
                    <div
                      key={project.id}
                      className={cn(
                        "rounded-[22px] border p-2.5 transition",
                        active
                          ? "border-[#c7d9f4] bg-[linear-gradient(135deg,#edf5ff_0%,#f8fbff_100%)] shadow-[0_18px_38px_rgba(37,99,235,0.1)]"
                          : "border-[#e4ebf4] bg-white/72 hover:border-[#cfdaea] hover:bg-white",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveProjectId(project.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-[17px] px-3.5 py-3 text-left transition",
                          active
                            ? "bg-white/68 text-[#1f3b66]"
                            : "text-[#60748b] hover:bg-[#f3f7fb] hover:text-[#263447]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-10 shrink-0 place-items-center rounded-[15px]",
                            active
                              ? "bg-[#dfeeff] text-[#1f5fd1]"
                              : "bg-[#f1f5f9] text-[#6d7f97]",
                          )}
                        >
                          <FolderIcon className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[16px] font-semibold">
                            {project.name}
                          </div>
                          <div className="mt-1 text-xs text-[#8292a6]">
                            {project.threads.length}{" "}
                            {isChinese ? "个线程" : "threads"}
                          </div>
                        </div>
                      </button>

                      <div className="mt-2 space-y-1.5 border-t border-[#dfe8f4]/80 pt-2">
                        {project.threads.slice(0, 6).map((mapping) => {
                          const threadActive = mapping.thread_id === threadId;
                          const href = safeReturnTo
                            ? `/workspace/vibe/${mapping.thread_id}?returnTo=${encodeURIComponent(safeReturnTo)}`
                            : `/workspace/vibe/${mapping.thread_id}`;
                          return (
                            <Link
                              key={mapping.thread_id}
                              href={href}
                              className={cn(
                                "group flex items-center justify-between gap-3 rounded-[14px] px-3 py-2.5 text-sm transition",
                                threadActive
                                  ? "bg-white text-[#142033] shadow-[0_8px_18px_rgba(15,23,42,0.07)]"
                                  : "text-[#68778a] hover:bg-white/86 hover:text-[#142033]",
                              )}
                            >
                              <span className="truncate">
                                {getThreadLabel(mapping, isChinese)}
                              </span>
                              <span className="max-w-[42%] shrink-0 truncate text-[11px] text-[#9aa7b6]">
                                {mapping.model_name ??
                                  project.defaultModel ??
                                  ""}
                              </span>
                            </Link>
                          );
                        })}
                        {project.threads.length === 0 ? (
                          <div className="rounded-[14px] border border-dashed border-[#d7e2ef] bg-white/55 px-3 py-3 text-xs leading-5 text-[#8a98aa]">
                            {isChinese
                              ? "新建线程后会归入这里。"
                              : "New threads will appear here."}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          <section className="min-h-0 overflow-y-auto px-5 py-6 lg:px-8">
            <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col gap-5">
              <section className="rounded-[26px] border border-[#dfe8f4] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-4 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)] sm:px-5 sm:py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#dbe4ef] bg-[#f8fbff] px-3 py-1.5 text-[12px] font-semibold text-[#52657d]">
                    <span className="size-2 rounded-full bg-[#2563eb]" />
                    {copy.heroTitle}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#dbe4ef] bg-white px-3 py-1.5 text-xs font-semibold text-[#52657d] shadow-sm">
                      <GitBranchIcon className="size-3.5 text-[#2563eb]" />
                      {activeProject.name}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#dbe4ef] bg-white px-3 py-1.5 text-xs font-semibold text-[#52657d] shadow-sm">
                      <WorkflowIcon className="size-3.5 text-[#2563eb]" />
                      {thread.isLoading ? copy.agentRunning : copy.agentIdle}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
                  <div className="min-w-0">
                    <div className="mb-3">
                      <h1 className="text-[26px] leading-tight font-semibold text-[#141922] sm:text-[32px]">
                        {isChinese ? "开始任务" : "Start a task"}
                      </h1>
                      <p className="mt-2 text-sm leading-6 text-[#66758a]">
                        {isChinese
                          ? "描述目标、贴上上下文，DeerFlow 会在当前线程里推进；需要拆分时再新建线程或切换 Ultra。"
                          : "Describe the goal and context. DeerFlow will continue in this thread; split work into threads or use Ultra when needed."}
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-[#d8dee8] bg-[#f7f8fa] p-2 shadow-[0_16px_46px_rgba(15,23,42,0.07)]">
                      <InputBox
                        key={`${threadId}-${composerSeed}`}
                        appearance="default"
                        className="h-[180px] w-full [&_[data-slot='input-group']]:h-full [&_[data-slot='input-group']]:min-h-[180px] [&_[data-slot='input-group-control']]:min-h-[92px]"
                        autoFocus
                        status={thread.isLoading ? "streaming" : "ready"}
                        context={settings.context}
                        disabled={
                          env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
                        }
                        initialValue={prefillPrompt}
                        onDraftChange={handleComposerDraftChange}
                        onDraftKeyDown={handleComposerKeyDown}
                        showInlineSuggestions={false}
                        onContextChange={(context) =>
                          setSettings("context", context)
                        }
                        onSubmit={guardedHandleSubmit}
                        onStop={handleStopAgent}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        {
                          icon: GitBranchIcon,
                          text: isChinese
                            ? "检查最近改动的风险"
                            : "Review recent changes",
                          workflow: 0,
                        },
                        {
                          icon: FolderIcon,
                          text: isChinese
                            ? "拆分项目推进线程"
                            : "Split project threads",
                          workflow: 0,
                        },
                        {
                          icon: Layers3Icon,
                          text: isChinese
                            ? "整理可复用能力"
                            : "Package reusable capabilities",
                          workflow: 4,
                        },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.text}
                            type="button"
                            onClick={() => {
                              setActiveWorkflowIndex(item.workflow);
                              queuePrompt(item.text);
                            }}
                            className="inline-flex items-center gap-2 rounded-full border border-[#dbe4ef] bg-white px-3 py-2 text-sm font-semibold text-[#60748b] shadow-sm transition hover:border-[#b8c7da] hover:text-[#263447]"
                          >
                            <Icon className="size-4 text-[#8a98aa]" />
                            {item.text}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid content-start gap-4 rounded-[24px] border border-[#d4e1f0] bg-[linear-gradient(180deg,#f7fbff_0%,#edf5ff_100%)] p-4 shadow-[0_16px_38px_rgba(31,59,102,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#142033]">
                        <SettingsIcon className="size-4 text-[#2563eb]" />
                        {isChinese ? "本次运行设置" : "Run settings"}
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cfe0f4] bg-white/78 px-2.5 py-1 text-[11px] font-semibold text-[#52657d]">
                        <BotIcon className="size-3.5 text-[#2563eb]" />
                        {isChinese ? "Agent 配置" : "Agent setup"}
                      </span>
                    </div>
                    <div className="grid gap-2.5">
                      <label
                        className="sr-only"
                        htmlFor="workflow-model-select"
                      >
                        {copy.modelLabel}
                      </label>
                      <select
                        id="workflow-model-select"
                        value={selectedModel?.name ?? ""}
                        onChange={(event) =>
                          handleStudioModelChange(event.target.value)
                        }
                        className="h-11 rounded-[16px] border border-[#cfddec] bg-white px-3 text-sm font-semibold text-[#263447] shadow-[0_8px_18px_rgba(31,59,102,0.07)] transition outline-none hover:border-[#b8c7da] focus:border-[#2563eb]"
                      >
                        {models.map((model) => (
                          <option key={model.name} value={model.name}>
                            {model.display_name ?? model.name}
                          </option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor="workflow-mode-select">
                        {isChinese ? "模式" : "Mode"}
                      </label>
                      <select
                        id="workflow-mode-select"
                        value={safeSelectedMode}
                        onChange={(event) =>
                          handleStudioModeChange(
                            event.target.value as StudioMode,
                          )
                        }
                        className="h-11 rounded-[16px] border border-[#cfddec] bg-white px-3 text-sm font-semibold text-[#263447] shadow-[0_8px_18px_rgba(31,59,102,0.07)] transition outline-none hover:border-[#b8c7da] focus:border-[#2563eb]"
                      >
                        {availableStudioModes.map((mode) => (
                          <option key={mode} value={mode}>
                            {getModeLabel(mode, isChinese)}
                          </option>
                        ))}
                      </select>
                      <div className="flex h-11 items-center justify-between gap-2 rounded-[16px] border border-[#cfddec] bg-white px-3 text-sm font-semibold text-[#263447] shadow-[0_8px_18px_rgba(31,59,102,0.07)]">
                        <span className="inline-flex items-center gap-2 text-[#60748b]">
                          <BotIcon className="size-4 text-[#2563eb]" />
                          {isChinese ? "上下文" : "Context"}
                        </span>
                        <span className="truncate text-[#142033]">
                          {compactStateLabel}
                        </span>
                      </div>
                      <label className="flex h-11 items-center justify-between gap-2 rounded-[16px] border border-[#cfddec] bg-white px-3 text-sm font-semibold text-[#263447] shadow-[0_8px_18px_rgba(31,59,102,0.07)]">
                        <span className="inline-flex items-center gap-2">
                          <SearchIcon className="size-4 text-[#2563eb]" />
                          {isChinese ? "联网搜索" : "Web search"}
                        </span>
                        <Switch
                          checked={
                            settings.context.web_search_enabled !== false
                          }
                          className="h-4 w-7 data-[state=checked]:bg-[#2563eb]"
                          onCheckedChange={handleStudioWebSearchChange}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      <div className="rounded-[16px] border border-white/70 bg-white/74 px-3 py-3 text-[#60748b] shadow-[0_8px_18px_rgba(31,59,102,0.05)]">
                        <div>{isChinese ? "线程" : "Threads"}</div>
                        <div className="mt-1 text-lg font-semibold text-[#142033]">
                          {activeProjectCard?.threads.length ?? 0}
                        </div>
                      </div>
                      <div className="rounded-[16px] border border-white/70 bg-white/74 px-3 py-3 text-[#60748b] shadow-[0_8px_18px_rgba(31,59,102,0.05)]">
                        <div>{isChinese ? "Agent" : "Agents"}</div>
                        <div className="mt-1 text-lg font-semibold text-[#142033]">
                          {safeSelectedMode === "ultra" ? "3" : "1"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-3 lg:grid-cols-4">
                {[
                  {
                    icon: MessageSquareIcon,
                    label: isChinese ? "当前线程" : "Thread",
                    value: thread.isLoading
                      ? copy.agentRunning
                      : copy.agentIdle,
                  },
                  {
                    icon: GitBranchIcon,
                    label: isChinese ? "项目线程" : "Project threads",
                    value: `${activeProjectCard?.threads.length ?? 0}`,
                  },
                  {
                    icon: BotIcon,
                    label: isChinese ? "Agent 并发" : "Agent lanes",
                    value: safeSelectedMode === "ultra" ? "3" : "1",
                  },
                  {
                    icon: CheckCircleIcon,
                    label: isChinese ? "运行记录" : "Runs",
                    value: `${workflowStats?.run_count ?? workflowRuns.length}`,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 rounded-[20px] border border-[#e1e7ef] bg-white px-4 py-3 shadow-[0_10px_32px_rgba(15,23,42,0.04)]"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-[14px] bg-[#eef5ff] text-[#2563eb]">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs text-[#7a8798]">
                          {item.label}
                        </div>
                        <div className="mt-0.5 truncate text-sm font-semibold text-[#142033]">
                          {item.value}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>

              <section className="min-h-[560px] overflow-hidden rounded-[28px] border border-[#e1e7ef] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
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
                  className="flex h-full min-h-[560px] flex-col"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7edf5] px-5 py-4">
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
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
                        <section className="rounded-[24px] border border-[#e7edf5] bg-[#fbfdff] p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-[#142033]">
                              {copy.sessionTitle}
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full bg-white"
                            >
                              {messages.length}
                            </Badge>
                          </div>
                          {sessionStreamItems.length === 0 ? (
                            <div className="rounded-[18px] border border-dashed border-[#dbe4ef] bg-white px-4 py-8 text-sm text-[#6d7f97]">
                              {copy.waitingForOutput}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {sessionStreamItems.slice(-8).map((item) => (
                                <div
                                  key={item.id}
                                  className="rounded-[18px] border border-[#e7edf5] bg-white px-4 py-3"
                                >
                                  <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold tracking-[0.16em] text-[#8a98aa] uppercase">
                                    <span>{item.label}</span>
                                    {item.meta ? (
                                      <span className="tracking-normal">
                                        {item.meta}
                                      </span>
                                    ) : null}
                                  </div>
                                  <pre className="font-mono text-[13px] leading-6 break-words whitespace-pre-wrap text-[#17324d]">
                                    {item.body}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="grid gap-4">
                          <div className="rounded-[24px] border border-[#e7edf5] bg-[#fbfdff] p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-[#142033]">
                                {copy.runtimeTitle}
                              </div>
                              <Badge
                                variant="outline"
                                className="rounded-full bg-white"
                              >
                                {runtimeEvents.length}
                              </Badge>
                            </div>
                            {runtimeEvents.length === 0 ? (
                              <div className="rounded-[18px] border border-dashed border-[#dbe4ef] bg-white px-4 py-5 text-sm text-[#6d7f97]">
                                {copy.runtimeEmpty}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {runtimeEvents.slice(0, 5).map((event) => (
                                  <div
                                    key={event.id}
                                    className="rounded-[16px] border border-[#e7edf5] bg-white px-3 py-3"
                                  >
                                    <div className="text-xs font-semibold text-[#142033]">
                                      {event.title}
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-[#60748b]">
                                      {event.detail}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            <div className="rounded-[24px] border border-[#e7edf5] bg-[#fbfdff] p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-[#142033]">
                                  {copy.checkpointsTitle}
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full bg-white"
                                  onClick={() => void handleSaveCheckpoint()}
                                >
                                  {copy.checkpointSave}
                                </Button>
                              </div>
                              <div className="text-sm text-[#6d7f97]">
                                {checkpoints.length === 0
                                  ? copy.checkpointEmpty
                                  : `${checkpoints.length} ${copy.checkpointFiles}`}
                              </div>
                            </div>
                            <div className="rounded-[24px] border border-[#e7edf5] bg-[#fbfdff] p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-[#142033]">
                                  {copy.tasksTitle}
                                </div>
                                <Badge
                                  variant="outline"
                                  className="rounded-full bg-white"
                                >
                                  {todos.length}
                                </Badge>
                              </div>
                              {todos.length === 0 ? (
                                <div className="text-sm text-[#6d7f97]">
                                  {copy.taskEmpty}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {todos.slice(0, 5).map((todo, index) => (
                                    <div
                                      key={`${todo.content}-${index}`}
                                      className="rounded-[14px] bg-white px-3 py-2 text-sm text-[#31475f]"
                                    >
                                      {todo.content}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </section>
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent
                    value="preview"
                    className="m-0 min-h-0 flex-1 overflow-hidden p-4"
                  >
                    <div className="h-full min-h-[430px] overflow-hidden rounded-[22px] border border-[#e7edf5] bg-white">
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
                    className="m-0 min-h-0 flex-1 overflow-hidden p-4"
                  >
                    <div className="flex h-full min-h-[430px] flex-col overflow-hidden rounded-[22px] border border-[#e7edf5] bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7edf5] px-4 py-4">
                        <div>
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
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-full bg-white"
                            onClick={() => void handleSaveCheckpoint()}
                          >
                            {copy.checkpointSave}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-full bg-white"
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
