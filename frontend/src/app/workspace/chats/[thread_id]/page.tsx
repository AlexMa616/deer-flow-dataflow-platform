"use client";

import type { Message } from "@langchain/langgraph-sdk";
import type { UseStream } from "@langchain/langgraph-sdk/react";
import { AlertTriangleIcon, FilesIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { AlexMark } from "@/components/brand/alex-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useSidebar } from "@/components/ui/sidebar";
import {
  ArtifactFileDetail,
  ArtifactFileList,
  useArtifacts,
} from "@/components/workspace/artifacts";
import { FullTranscriptSheet } from "@/components/workspace/full-transcript-sheet";
import {
  InputBox,
  PromptSuggestionList,
} from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Tooltip } from "@/components/workspace/tooltip";
import { Welcome } from "@/components/workspace/welcome";
import { getAPIClient } from "@/core/api";
import { useI18n } from "@/core/i18n/hooks";
import { parseUploadedFiles } from "@/core/messages/utils";
import { useModels } from "@/core/models/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { fetchSystemOverview, useSystemOverview } from "@/core/system";
import { type AgentThread, type AgentThreadState } from "@/core/threads";
import { useSubmitThread, useThreadStream } from "@/core/threads/hooks";
import {
  containsChineseText,
  getThreadErrorDisplay,
  pathOfThread,
  textOfMessage,
  titleOfThread,
} from "@/core/threads/utils";
import { useUploadStatusStream } from "@/core/uploads/hooks";
import { uuid } from "@/core/utils/uuid";
import { env } from "@/env";
import { fetchMe, getUser, type User } from "@/lib/auth";
import { cn } from "@/lib/utils";

const SemanticSearchFloating = dynamic(
  () =>
    import("@/components/workspace/semantic/semantic-search-floating").then(
      (module) => ({
        default: module.SemanticSearchFloating,
      }),
    ),
  {
    ssr: false,
    loading: () => null,
  },
);

export default function ChatPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [settings, setSettings] = useLocalSettings();
  const { models } = useModels();
  const { data: systemOverview } = useSystemOverview();
  const { setOpen: setSidebarOpen } = useSidebar();
  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    select: selectArtifact,
    selectedArtifact,
  } = useArtifacts();
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const searchParams = useSearchParams();
  const isSkillMode = searchParams.get("mode") === "skill";
  const promptInputController = usePromptInputController();
  const inputInitialValue = useMemo(() => {
    if (threadIdFromPath !== "new" || !isSkillMode) {
      return undefined;
    }
    return t.inputBox.createSkillPrompt;
  }, [threadIdFromPath, isSkillMode, t.inputBox.createSkillPrompt]);
  const lastInitialValueRef = useRef<string | undefined>(undefined);
  const setInputRef = useRef(promptInputController.textInput.setInput);
  setInputRef.current = promptInputController.textInput.setInput;
  useEffect(() => {
    if (
      inputInitialValue &&
      inputInitialValue !== lastInitialValueRef.current
    ) {
      lastInitialValueRef.current = inputInitialValue;
      setTimeout(() => {
        setInputRef.current(inputInitialValue);
        const textarea = document.querySelector("textarea");
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.value.length;
          textarea.selectionEnd = textarea.value.length;
        }
      }, 100);
    }
  }, [inputInitialValue]);
  const isNewThread = useMemo(
    () => threadIdFromPath === "new",
    [threadIdFromPath],
  );
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [newThreadSubmitted, setNewThreadSubmitted] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const threadBootstrapRequestRef = useRef(0);

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

  const userDisplayName = currentUser?.username?.trim() ?? "DeerFlow";
  const userInitials = userDisplayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    setNewThreadSubmitted(false);

    let cancelled = false;
    const requestId = threadBootstrapRequestRef.current + 1;
    threadBootstrapRequestRef.current = requestId;

    const prepareThread = async () => {
      setFinalState(null);
      setStreamError(null);

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
        setStreamError(getThreadErrorDisplay(error));
      }
    };

    void prepareThread();

    return () => {
      cancelled = true;
    };
  }, [threadIdFromPath]);

  const { showNotification } = useNotification();
  const [finalState, setFinalState] = useState<AgentThreadState | null>(null);
  const [streamError, setStreamError] = useState<ReturnType<
    typeof getThreadErrorDisplay
  > | null>(null);
  const thread = useThreadStream({
    isNewThread,
    threadId,
    onFinish: (state) => {
      setFinalState(state);
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            if (textContent.length > 200) {
              body = textContent.substring(0, 200) + "...";
            } else {
              body = textContent;
            }
          }
        }
        showNotification(state.title, {
          body,
        });
      }
    },
    onError: (error) => {
      setStreamError(getThreadErrorDisplay(error));
    },
  }) as unknown as UseStream<AgentThreadState>;
  const selectedModel = useMemo(
    () => models.find((model) => model.name === settings.context.model_name),
    [models, settings.context.model_name],
  );
  const ultraUsesPlanMode = selectedModel?.ultra_uses_plan_mode ?? true;
  const shouldWatchUploadStatus = useMemo(() => {
    const messages = thread.values.messages ?? [];
    return messages.some((message) => {
      if (typeof message.content !== "string") {
        return false;
      }
      return parseUploadedFiles(message.content).files.length > 0;
    });
  }, [thread.values.messages]);
  useUploadStatusStream(threadId ?? "", undefined, {
    enabled: shouldWatchUploadStatus,
  });
  useEffect(() => {
    if (thread.isLoading) {
      setFinalState(null);
      setStreamError(null);
    }
  }, [thread.isLoading]);

  useEffect(() => {
    setStreamError(null);
  }, [threadId]);

  const showNewThreadLanding =
    isNewThread && !newThreadSubmitted && !thread.isLoading;

  const title = useMemo(() => {
    let result = isNewThread
      ? ""
      : titleOfThread(thread as unknown as AgentThread);
    if (result === "Untitled") {
      result = "";
    }
    return result;
  }, [thread, isNewThread]);

  useEffect(() => {
    const pageTitle = isNewThread
      ? t.pages.newChat
      : thread.values?.title && thread.values.title !== "Untitled"
        ? thread.values.title
        : t.pages.untitled;
    if (thread.isThreadLoading) {
      document.title = `Loading... - ${t.pages.appName}`;
    } else {
      document.title = `${pageTitle} - ${t.pages.appName}`;
    }
  }, [
    isNewThread,
    t.pages.newChat,
    t.pages.untitled,
    t.pages.appName,
    thread.values.title,
    thread.isThreadLoading,
  ]);

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  useEffect(() => {
    setArtifacts(thread.values.artifacts);
    if (
      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" &&
      autoSelectFirstArtifact
    ) {
      if (thread?.values?.artifacts?.length > 0) {
        setAutoSelectFirstArtifact(false);
        selectArtifact(thread.values.artifacts[0]!);
      }
    }
  }, [
    autoSelectFirstArtifact,
    selectArtifact,
    setArtifacts,
    thread.values.artifacts,
  ]);

  const artifactPanelOpen = useMemo(() => {
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true") {
      return artifactsOpen && artifacts?.length > 0;
    }
    return artifactsOpen;
  }, [artifactsOpen, artifacts]);

  const [todoListCollapsed, setTodoListCollapsed] = useState(true);
  const [semanticReady, setSemanticReady] = useState(false);
  const showWelcome = useMemo(() => {
    if (showNewThreadLanding) return true;
    if (isNewThread) return false;
    const messages = (thread.values.messages ?? []) as Message[];
    const hasConversation = messages.some((message) => {
      const role =
        (message as { type?: string; role?: string }).type ??
        (message as { type?: string; role?: string }).role;
      if (
        role !== "human" &&
        role !== "ai" &&
        role !== "user" &&
        role !== "assistant"
      ) {
        return false;
      }
      const content = (message as { content?: unknown }).content;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((item) => {
            if (typeof item === "string") return item;
            if (
              typeof item === "object" &&
              item !== null &&
              "text" in item &&
              typeof (item as { text?: unknown }).text === "string"
            ) {
              return (item as { text: string }).text;
            }
            return "";
          })
          .join(" ");
      }
      text = text.trim();
      return text.length > 0;
    });
    return !hasConversation;
  }, [isNewThread, showNewThreadLanding, thread.values.messages]);
  const shouldShowSemanticSearch =
    semanticReady && !isNewThread && !showWelcome;

  useEffect(() => {
    setSemanticReady(false);
    const timer = window.setTimeout(() => setSemanticReady(true), 420);
    return () => window.clearTimeout(timer);
  }, [threadId]);

  const handleSubmit = useSubmitThread({
    isNewThread,
    threadId,
    thread,
    threadContext: {
      ...settings.context,
      thinking_enabled: settings.context.mode !== "flash",
      is_plan_mode:
        settings.context.mode === "pro" ||
        (settings.context.mode === "ultra" && ultraUsesPlanMode),
      subagent_enabled: settings.context.mode === "ultra",
      max_concurrent_subagents:
        settings.context.mode === "ultra" ? 3 : undefined,
    },
    afterSubmit() {
      router.push(pathOfThread(threadId!));
    },
  });
  const guardedHandleSubmit = useCallback(
    async (message: Parameters<typeof handleSubmit>[0]) => {
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
        containsChineseText(message.text) ||
        Boolean(
          message.files?.some((file) => containsChineseText(file.filename)),
        );

      if (blocksChineseContent && hasChineseContent) {
        toast(
          requestGuardrails?.message ??
            "当前配置的上游模型接口对中文内容支持不稳定，本次将继续尝试发送；如果失败可稍后重试。",
        );
      }

      setStreamError(null);
      if (isNewThread) {
        setNewThreadSubmitted(true);
      }
      try {
        await handleSubmit(message);
      } catch (error) {
        const display = getThreadErrorDisplay(error);
        setStreamError(display);
        toast.error(display.message);
        if (isNewThread) {
          setNewThreadSubmitted(false);
        }
      }
    },
    [
      handleSubmit,
      isNewThread,
      settings.context.model_name,
      systemOverview?.request_guardrails,
    ],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  if (!threadId) {
    return null;
  }

  return (
    <ThreadContext.Provider value={{ threadId, thread }}>
      <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
        <ResizablePanel
          className="relative"
          defaultSize={artifactPanelOpen ? 46 : 100}
          minSize={artifactPanelOpen ? 30 : 100}
        >
          <div className="relative flex size-full min-h-0 justify-between overflow-hidden">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_8%_4%,rgba(34,211,238,0.22),transparent_40%),radial-gradient(circle_at_92%_2%,rgba(129,140,248,0.2),transparent_42%),radial-gradient(circle_at_50%_100%,rgba(45,212,191,0.12),transparent_48%),linear-gradient(180deg,#fbfdff,#eef4ff_56%,#f9fbff)]" />
              <div className="absolute -top-24 right-16 h-72 w-72 rounded-full bg-sky-200/45 blur-3xl" />
              <div className="absolute -bottom-32 left-10 h-80 w-80 rounded-full bg-indigo-200/35 blur-3xl" />
            </div>
            <header
              className={cn(
                "absolute top-0 right-0 left-0 z-30 flex h-12 shrink-0 items-center px-4",
                showNewThreadLanding
                  ? "bg-background/0 backdrop-blur-none"
                  : "border-b border-slate-200/70 bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,0.04)] backdrop-blur",
              )}
            >
              {showNewThreadLanding ? (
                <div className="flex w-full items-center justify-between">
                  <div className="inline-flex items-center gap-2.5">
                    <AlexMark
                      compact
                      label={userInitials}
                      className="h-8 w-8 rounded-lg"
                    />
                    <span className="text-2xl font-medium tracking-tight text-slate-800">
                      {userDisplayName}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <span className="rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-xs font-semibold tracking-[0.12em] text-slate-700">
                      PRO
                    </span>
                    <AlexMark
                      compact
                      label={userInitials}
                      className="h-8 w-8 rounded-full"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex w-full items-center text-sm font-medium">
                    {title !== "Untitled" && (
                      <ThreadTitle threadId={threadId} threadTitle={title} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <Tooltip content="Open the archived raw transcript for this conversation">
                        <FullTranscriptSheet threadId={threadId} />
                      </Tooltip>
                      {artifacts?.length > 0 && !artifactsOpen && (
                        <Tooltip content="Show artifacts of this conversation">
                          <Button
                            className="text-muted-foreground hover:text-foreground"
                            variant="ghost"
                            onClick={() => {
                              setArtifactsOpen(true);
                              setSidebarOpen(false);
                            }}
                          >
                            <FilesIcon />
                            {t.common.artifacts}
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </>
              )}
            </header>
            <main className="flex min-h-0 max-w-full grow flex-col overflow-hidden">
              {streamError && (
                <div className="pointer-events-none absolute inset-x-0 top-12 z-20 flex justify-center px-4 pt-3 md:px-6">
                  <Alert
                    variant="destructive"
                    className="pointer-events-auto relative w-full max-w-(--container-width-lg) border-rose-200/80 bg-rose-50/96 pr-12 shadow-[0_18px_40px_rgba(190,24,93,0.08)] backdrop-blur"
                  >
                    <AlertTriangleIcon className="size-4" />
                    <AlertTitle>{streamError.title}</AlertTitle>
                    <AlertDescription>{streamError.message}</AlertDescription>
                    <Button
                      className="absolute top-2 right-2 text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                      size="icon"
                      type="button"
                      variant="ghost"
                      onClick={() => setStreamError(null)}
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </Alert>
                </div>
              )}
              <div className="flex min-h-0 flex-1 justify-center">
                <MessageList
                  className={cn(
                    streamError ? "pt-28" : !showNewThreadLanding && "pt-10",
                  )}
                  threadId={threadId}
                  thread={thread}
                  messagesOverride={
                    !thread.isLoading && finalState?.messages
                      ? (finalState.messages as Message[])
                      : undefined
                  }
                  paddingBottom={todoListCollapsed ? 160 : 280}
                />
              </div>
              {shouldShowSemanticSearch && (
                <SemanticSearchFloating threadId={threadId} />
              )}
              <div
                className={cn(
                  "absolute inset-x-0 z-30 flex justify-center px-3 md:px-4",
                  showNewThreadLanding
                    ? "top-[46%] bottom-auto -translate-y-1/2"
                    : "bottom-0",
                )}
              >
                <div
                  className={cn(
                    "relative w-full",
                    showNewThreadLanding
                      ? "max-w-(--container-width-md)"
                      : "max-w-(--container-width-lg)",
                  )}
                >
                  <div className="absolute -top-4 right-0 left-0 z-0">
                    <div className="absolute right-0 bottom-0 left-0">
                      <TodoList
                        className="border border-sky-200/70 bg-white/82 shadow-[0_10px_28px_rgba(15,23,42,0.08)] backdrop-blur"
                        todos={thread.values.todos ?? []}
                        collapsed={todoListCollapsed}
                        hidden={
                          !thread.values.todos ||
                          thread.values.todos.length === 0
                        }
                        onToggle={() =>
                          setTodoListCollapsed(!todoListCollapsed)
                        }
                      />
                    </div>
                  </div>
                  <div className="relative">
                    {showWelcome && (
                      <div className="mb-3">
                        <Welcome mode={settings.context.mode} />
                      </div>
                    )}
                    <InputBox
                      className={cn(
                        "w-full border border-slate-200/85 bg-white/92 text-slate-900 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl",
                        !showNewThreadLanding && "-translate-y-4",
                      )}
                      isNewThread={showWelcome}
                      showInlineSuggestions={false}
                      autoFocus={false}
                      status={thread.isLoading ? "streaming" : "ready"}
                      context={settings.context}
                      disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                      onContextChange={(context) =>
                        setSettings("context", context)
                      }
                      onSubmit={guardedHandleSubmit}
                      onStop={handleStop}
                    />
                    {showWelcome && !isSkillMode && (
                      <div className="mt-4 px-1">
                        <PromptSuggestionList className="mx-auto max-w-(--container-width-md)" />
                      </div>
                    )}
                  </div>
                  {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                    <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                      {t.common.notAvailableInDemoMode}
                    </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            "opacity-33 hover:opacity-100",
            !artifactPanelOpen && "pointer-events-none opacity-0",
          )}
        />
        <ResizablePanel
          className={cn(
            "transition-all duration-300 ease-in-out",
            !artifactsOpen && "opacity-0",
          )}
          defaultSize={artifactPanelOpen ? 64 : 0}
          minSize={0}
          maxSize={artifactPanelOpen ? undefined : 0}
        >
          <div
            className={cn(
              "h-full p-4 transition-transform duration-300 ease-in-out",
              artifactPanelOpen ? "translate-x-0" : "translate-x-full",
            )}
          >
            {selectedArtifact ? (
              <ArtifactFileDetail
                className="size-full"
                filepath={selectedArtifact}
                threadId={threadId}
              />
            ) : (
              <div className="relative flex size-full justify-center">
                <div className="absolute top-1 right-1 z-30">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      setArtifactsOpen(false);
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
                {thread.values.artifacts?.length === 0 ? (
                  <ConversationEmptyState
                    icon={<FilesIcon />}
                    title="No artifact selected"
                    description="Select an artifact to view its details"
                  />
                ) : (
                  <div className="flex size-full max-w-(--container-width-sm) flex-col justify-center p-4 pt-8">
                    <header className="shrink-0">
                      <h2 className="text-lg font-medium">Artifacts</h2>
                    </header>
                    <main className="min-h-0 grow">
                      <ArtifactFileList
                        className="max-w-(--container-width-sm) p-4 pt-12"
                        files={thread.values.artifacts ?? []}
                        threadId={threadId}
                      />
                    </main>
                  </div>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </ThreadContext.Provider>
  );
}
