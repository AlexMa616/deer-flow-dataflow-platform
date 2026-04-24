"use client";

import type { ChatStatus } from "ai";
import {
  CheckIcon,
  GraduationCapIcon,
  LightbulbIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  RocketIcon,
  ZapIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type KeyboardEventHandler,
} from "react";

import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { ConfettiButton } from "@/components/ui/confetti-button";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import type { AgentThreadContext } from "@/core/threads";
import { cn } from "@/lib/utils";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../ai-elements/model-selector";
import { Suggestion } from "../ai-elements/suggestion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

import { ModeHoverGuide } from "./mode-hover-guide";
import { Tooltip } from "./tooltip";

function getDefaultModeForModel(
  model:
    | {
        supports_thinking?: boolean;
      }
    | undefined,
): "flash" | "thinking" {
  if (!model?.supports_thinking) {
    return "flash";
  }
  return "thinking";
}

function sanitizeModeForModel(
  mode: "flash" | "thinking" | "pro" | "ultra" | undefined,
  model:
    | {
        supports_thinking?: boolean;
        supports_plan_mode?: boolean;
        supports_subagents?: boolean;
      }
    | undefined,
): "flash" | "thinking" | "pro" | "ultra" | undefined {
  if (!model) {
    return mode;
  }

  if (!model.supports_thinking) {
    return "flash";
  }

  if (mode === undefined) {
    return getDefaultModeForModel(model);
  }

  if (mode === "ultra" && model.supports_subagents === false) {
    return model.supports_plan_mode === false ? "thinking" : "pro";
  }

  if (mode === "pro" && model.supports_plan_mode === false) {
    return "thinking";
  }

  return mode;
}

export function InputBox({
  appearance = "default",
  className,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  isNewThread,
  initialValue,
  onDraftChange,
  onDraftKeyDown,
  onContextChange,
  onSubmit,
  onStop,
  showInlineSuggestions = true,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  appearance?: "default" | "terminal";
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
  > & {
    mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
  };
  extraHeader?: React.ReactNode;
  isNewThread?: boolean;
  initialValue?: string;
  onDraftChange?: (value: string) => void;
  onDraftKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  showInlineSuggestions?: boolean;
  onContextChange?: (
    context: Omit<
      AgentThreadContext,
      "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
    > & {
      mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
    },
  ) => void;
  onSubmit?: (message: PromptInputMessage) => void;
  onStop?: () => void;
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const isTerminal = appearance === "terminal";
  const { models } = useModels();
  const selectedModel = useMemo(() => {
    if (!context.model_name && models.length > 0) {
      const model = models[0]!;
      setTimeout(() => {
        onContextChange?.({
          ...context,
          model_name: model.name,
          mode: getDefaultModeForModel(model),
        });
      }, 0);
      return model;
    }
    return models.find((m) => m.name === context.model_name);
  }, [context, models, onContextChange]);
  const supportThinking = useMemo(
    () => selectedModel?.supports_thinking ?? false,
    [selectedModel],
  );
  const supportsPlanMode = useMemo(
    () =>
      supportThinking && (selectedModel?.supports_plan_mode ?? supportThinking),
    [selectedModel, supportThinking],
  );
  const supportsSubagents = useMemo(
    () =>
      supportsPlanMode &&
      (selectedModel?.supports_subagents ?? supportsPlanMode),
    [selectedModel, supportsPlanMode],
  );
  const handleModelSelect = useCallback(
    (model_name: string) => {
      const nextModel = models.find((m) => m.name === model_name);
      onContextChange?.({
        ...context,
        model_name,
        mode: sanitizeModeForModel(context.mode, nextModel),
      });
      setModelDialogOpen(false);
    },
    [context, models, onContextChange],
  );
  const handleModeSelect = useCallback(
    (mode: "flash" | "thinking" | "pro" | "ultra") => {
      onContextChange?.({
        ...context,
        mode,
      });
    },
    [onContextChange, context],
  );
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (status === "streaming") {
        onStop?.();
        return;
      }
      if (!message.text) {
        return;
      }
      onSubmit?.(message);
    },
    [onSubmit, onStop, status],
  );
  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    const nextMode = sanitizeModeForModel(context.mode, selectedModel);
    if (nextMode && nextMode !== context.mode) {
      setTimeout(() => {
        onContextChange?.({
          ...context,
          mode: nextMode,
        });
      }, 0);
    }
  }, [context, onContextChange, selectedModel]);
  useEffect(() => {
    onDraftChange?.(initialValue ?? "");
  }, [initialValue, onDraftChange]);
  return (
    <PromptInput
      className={cn(
        isTerminal
          ? "rounded-[28px] border border-white/10 bg-[#080b11] text-slate-100 shadow-[0_22px_70px_rgba(2,6,23,0.38)] backdrop-blur transition-all duration-300 ease-out [&_[data-slot='input-group']]:overflow-hidden [&_[data-slot='input-group']]:rounded-[28px] [&_[data-slot='input-group']]:border-white/10 [&_[data-slot='input-group']]:bg-[#05070d] [&_[data-slot='input-group']]:focus-within:border-cyan-400/30 [&_[data-slot='input-group']]:focus-within:ring-0"
          : "rounded-[32px] border border-slate-200/80 bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur transition-all duration-300 ease-out [&_[data-slot='input-group']]:overflow-hidden [&_[data-slot='input-group']]:rounded-[32px] [&_[data-slot='input-group']]:border-slate-200/80 [&_[data-slot='input-group']]:bg-white/94 [&_[data-slot='input-group']]:focus-within:border-slate-300 [&_[data-slot='input-group']]:focus-within:ring-0",
        className,
      )}
      disabled={disabled}
      globalDrop
      multiple
      onSubmit={handleSubmit}
      {...props}
    >
      {extraHeader && (
        <div className="absolute top-0 right-0 left-0 z-10">
          <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center">
            {extraHeader}
          </div>
        </div>
      )}
      <PromptInputAttachments>
        {(attachment) => <PromptInputAttachment data={attachment} />}
      </PromptInputAttachments>
      <PromptInputBody className="absolute top-0 right-0 left-0 z-3">
        <PromptInputTextarea
          className={cn(
            "size-full text-[15px] leading-7",
            isTerminal
              ? "font-mono text-slate-100 placeholder:text-slate-500"
              : "text-slate-800 placeholder:text-slate-400",
          )}
          disabled={disabled}
          placeholder={t.inputBox.placeholder}
          autoFocus={autoFocus}
          defaultValue={initialValue}
          onChange={(event) => onDraftChange?.(event.currentTarget.value)}
          onKeyDown={onDraftKeyDown}
        />
      </PromptInputBody>
      <PromptInputFooter
        className={cn(
          "flex items-center justify-between gap-3 px-3 py-2.5",
          isTerminal
            ? "rounded-b-[28px] border-t border-white/8 bg-[#070a10]"
            : "rounded-b-[32px] border-t border-slate-200/70 bg-white/86",
        )}
      >
        <PromptInputTools
          className={cn(
            "items-center gap-1 px-1 py-1",
            isTerminal
              ? "rounded-2xl border border-white/10 bg-[#0b1020] shadow-[0_10px_24px_rgba(2,6,23,0.18)]"
              : "rounded-full border border-slate-200/85 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.05)]",
          )}
        >
          {/* TODO: Add more connectors here
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger className="px-2!" />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments
                label={t.inputBox.addAttachments}
              />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu> */}
          <AddAttachmentsButton
            className={cn(
              "px-2!",
              isTerminal
                ? "rounded-xl text-slate-400 hover:bg-white/8 hover:text-white"
                : "rounded-full text-slate-600 hover:bg-slate-100",
            )}
          />
          <PromptInputActionMenu>
            <ModeHoverGuide
              mode={
                context.mode === "flash" ||
                context.mode === "thinking" ||
                context.mode === "pro" ||
                context.mode === "ultra"
                  ? context.mode
                  : "flash"
              }
            >
              <PromptInputActionMenuTrigger
                className={cn(
                  "gap-1! px-2!",
                  isTerminal
                    ? "rounded-xl text-slate-400 hover:bg-white/8 hover:text-white"
                    : "rounded-full text-slate-600 hover:bg-slate-100",
                )}
              >
                <div>
                  {context.mode === "flash" && <ZapIcon className="size-3" />}
                  {context.mode === "thinking" && (
                    <LightbulbIcon className="size-3" />
                  )}
                  {context.mode === "pro" && (
                    <GraduationCapIcon className="size-3" />
                  )}
                  {context.mode === "ultra" && (
                    <RocketIcon className="size-3 text-[#dabb5e]" />
                  )}
                </div>
                <div
                  className={cn(
                    "text-xs font-normal",
                    isTerminal ? "text-inherit" : "",
                    context.mode === "ultra" ? "golden-text" : "",
                  )}
                >
                  {(context.mode === "flash" && t.inputBox.flashMode) ||
                    (context.mode === "thinking" && t.inputBox.reasoningMode) ||
                    (context.mode === "pro" && t.inputBox.proMode) ||
                    (context.mode === "ultra" && t.inputBox.ultraMode)}
                </div>
              </PromptInputActionMenuTrigger>
            </ModeHoverGuide>
            <PromptInputActionMenuContent className="w-80">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t.inputBox.mode}
                </DropdownMenuLabel>
                <PromptInputActionMenu>
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "flash"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("flash")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                        <ZapIcon
                          className={cn(
                            "mr-2 size-4",
                            context.mode === "flash" &&
                              "text-accent-foreground",
                          )}
                        />
                        {t.inputBox.flashMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.flashModeDescription}
                      </div>
                    </div>
                    {context.mode === "flash" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  {supportThinking && (
                    <PromptInputActionMenuItem
                      className={cn(
                        context.mode === "thinking"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("thinking")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          <LightbulbIcon
                            className={cn(
                              "mr-2 size-4",
                              context.mode === "thinking" &&
                                "text-accent-foreground",
                            )}
                          />
                          {t.inputBox.reasoningMode}
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.reasoningModeDescription}
                        </div>
                      </div>
                      {context.mode === "thinking" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                  {supportsPlanMode && (
                    <PromptInputActionMenuItem
                      className={cn(
                        context.mode === "pro"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("pro")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          <GraduationCapIcon
                            className={cn(
                              "mr-2 size-4",
                              context.mode === "pro" &&
                                "text-accent-foreground",
                            )}
                          />
                          {t.inputBox.proMode}
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.proModeDescription}
                        </div>
                      </div>
                      {context.mode === "pro" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                  {supportsSubagents && (
                    <PromptInputActionMenuItem
                      className={cn(
                        context.mode === "ultra"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("ultra")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          <RocketIcon
                            className={cn(
                              "mr-2 size-4",
                              context.mode === "ultra" && "text-[#dabb5e]",
                            )}
                          />
                          <div
                            className={cn(
                              context.mode === "ultra" && "golden-text",
                            )}
                          >
                            {t.inputBox.ultraMode}
                          </div>
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.ultraModeDescription}
                        </div>
                      </div>
                      {context.mode === "ultra" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                </PromptInputActionMenu>
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
        </PromptInputTools>
        <PromptInputTools
          className={cn(
            "items-center gap-2 px-2 py-1",
            isTerminal
              ? "rounded-2xl border border-white/10 bg-[#0b1020] shadow-[0_10px_24px_rgba(2,6,23,0.18)]"
              : "rounded-full border border-slate-200/85 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.05)]",
          )}
        >
          <ModelSelector
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
          >
            <ModelSelectorTrigger asChild>
              <PromptInputButton
                className={cn(
                  "px-3",
                  isTerminal
                    ? "rounded-xl text-slate-300 hover:bg-white/8 hover:text-white"
                    : "rounded-full text-slate-600 hover:bg-slate-100",
                )}
              >
                <ModelSelectorName className="text-xs font-normal">
                  {selectedModel?.display_name}
                </ModelSelectorName>
              </PromptInputButton>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder={t.inputBox.searchModels} />
              <ModelSelectorList>
                {models.map((m) => (
                  <ModelSelectorItem
                    key={m.name}
                    value={m.name}
                    onSelect={() => handleModelSelect(m.name)}
                  >
                    <ModelSelectorName>{m.display_name}</ModelSelectorName>
                    {m.name === context.model_name ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
          <PromptInputSubmit
            className={cn(
              isTerminal
                ? "rounded-xl border border-cyan-400/30 bg-[linear-gradient(135deg,#083344_0%,#0f172a_100%)] text-cyan-50 shadow-[0_10px_24px_rgba(8,145,178,0.18)] hover:brightness-110"
                : "rounded-full bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-[0_6px_14px_rgba(15,23,42,0.18)] hover:brightness-110",
            )}
            disabled={disabled}
            variant="default"
            status={status}
          />
        </PromptInputTools>
      </PromptInputFooter>
      {showInlineSuggestions &&
        isNewThread &&
        searchParams.get("mode") !== "skill" && (
          <div className="mt-4 flex items-center justify-center">
            <PromptSuggestionList />
          </div>
        )}
    </PromptInput>
  );
}

export function PromptSuggestionList({ className }: { className?: string }) {
  const { t } = useI18n();
  const { textInput } = usePromptInputController();
  const handleSuggestionClick = useCallback(
    (prompt: string | undefined) => {
      if (!prompt) return;
      textInput.setInput(prompt);
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          "textarea[name='message']",
        );
        if (textarea) {
          const selStart = prompt.indexOf("[");
          const selEnd = prompt.indexOf("]");
          if (selStart !== -1 && selEnd !== -1) {
            textarea.setSelectionRange(selStart, selEnd + 1);
            textarea.focus();
          }
        }
      }, 500);
    },
    [textInput],
  );
  return (
    <div
      className={cn(
        "flex max-w-full flex-wrap items-center justify-center gap-2.5",
        className,
      )}
    >
      <ConfettiButton
        className="text-muted-foreground cursor-pointer rounded-full px-4 text-xs font-normal"
        variant="outline"
        size="sm"
        onClick={() => handleSuggestionClick(t.inputBox.surpriseMePrompt)}
      >
        <SparklesIcon className="size-4" /> {t.inputBox.surpriseMe}
      </ConfettiButton>
      {t.inputBox.suggestions.map((suggestion) => (
        <Suggestion
          key={suggestion.suggestion}
          icon={suggestion.icon}
          suggestion={suggestion.suggestion}
          onClick={() => handleSuggestionClick(suggestion.prompt)}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Suggestion icon={PlusIcon} suggestion={t.common.create} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            {t.inputBox.suggestionsCreate.map((suggestion, index) =>
              "type" in suggestion && suggestion.type === "separator" ? (
                <DropdownMenuSeparator key={index} />
              ) : (
                !("type" in suggestion) && (
                  <DropdownMenuItem
                    key={suggestion.suggestion}
                    onClick={() => handleSuggestionClick(suggestion.prompt)}
                  >
                    {suggestion.icon && <suggestion.icon className="size-4" />}
                    {suggestion.suggestion}
                  </DropdownMenuItem>
                )
              ),
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AddAttachmentsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const attachments = usePromptInputAttachments();
  return (
    <Tooltip content={t.inputBox.addAttachments}>
      <PromptInputButton
        className={cn("px-2!", className)}
        onClick={() => attachments.openFileDialog()}
      >
        <PaperclipIcon className="size-3" />
      </PromptInputButton>
    </Tooltip>
  );
}
