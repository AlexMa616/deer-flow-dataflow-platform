"use client";

import { CopyIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PtyTerminal,
  type PtyTerminalHandle,
} from "@/components/workspace/terminal/pty-terminal";
import type { TerminalState } from "@/core/terminal/api";
import { cn } from "@/lib/utils";

import { VibeErrorBoundary } from "./vibe-error-boundary";
import type { AgentCommandItem } from "./vibe-utils";
import { summarizeConsoleText } from "./vibe-utils";

export function VibeTerminalTab({
  activityEmpty,
  agentCommandItems,
  agentCommandsTitle,
  copyCommandLabel,
  defaultLayout,
  output,
  rerunCommandLabel,
  resultSummary,
  state,
  statusLabel,
  terminalNotStartedHint,
  onLayoutChanged,
  onResize,
  onRunCommand,
  onSendInput,
  onStart,
}: {
  activityEmpty: string;
  agentCommandItems: AgentCommandItem[];
  agentCommandsTitle: string;
  copyCommandLabel: string;
  defaultLayout?: Record<string, number>;
  output: string;
  rerunCommandLabel: string;
  resultSummary: string;
  state: TerminalState | null;
  statusLabel: string;
  terminalNotStartedHint: string;
  onLayoutChanged?: (layout: Record<string, number>) => void;
  onResize: (cols: number, rows: number) => void;
  onRunCommand: (command: string) => void | Promise<unknown>;
  onSendInput: (value: string) => void;
  onStart: () => Promise<unknown>;
}) {
  const terminalSurfaceRef = useRef<PtyTerminalHandle | null>(null);
  const [isTerminalFocused, setIsTerminalFocused] = useState(false);

  const handleFocusTerminalSurface = useCallback(() => {
    if (!state?.session_id || state.status === "stopped") {
      void onStart().catch((error) => {
        console.error(error);
        toast.error("Failed to start terminal");
      });
    }

    window.requestAnimationFrame(() => {
      terminalSurfaceRef.current?.focus();
    });
  }, [onStart, state?.session_id, state?.status]);

  const handleCopyCommand = useCallback(
    async (command: string) => {
      try {
        await navigator.clipboard.writeText(command);
        toast.success(copyCommandLabel);
      } catch (error) {
        console.error(error);
        toast.error("Failed to copy command");
      }
    },
    [copyCommandLabel],
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="min-h-0"
    >
      <ResizablePanel id="terminal" defaultSize={74} minSize={52}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[16px] border border-[#dbe4ef] bg-white text-[#142033] shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-[#e7edf5] bg-[#f8fbff] px-4 py-2.5">
            <div className="min-w-0 truncate font-mono text-sm text-[#40556f]">
              {state?.cwd ?? "deer-flow"}
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-[#cfe0f5] bg-white text-[#2563eb]"
            >
              {statusLabel}
            </Badge>
          </div>

          <div
            className={cn(
              "relative min-h-0 flex-1 overflow-hidden bg-[#f7f9fc]",
              isTerminalFocused && "ring-1 ring-[#93c5fd] ring-inset",
            )}
          >
            <VibeErrorBoundary
              title="Terminal temporarily unavailable"
              description="The integrated terminal hit an unexpected state. Retry will remount this area without reloading the whole page."
            >
              <PtyTerminal
                ref={terminalSurfaceRef}
                output={output}
                onActivate={handleFocusTerminalSurface}
                onFocusChange={setIsTerminalFocused}
                onInput={onSendInput}
                onResize={onResize}
              />
            </VibeErrorBoundary>
            {!state?.session_id && state?.status !== "running" && (
              <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center px-6">
                <div className="rounded-full border border-[#dbe4ef] bg-white/92 px-3 py-1.5 text-xs text-[#60748b] shadow-sm backdrop-blur">
                  {terminalNotStartedHint}
                </div>
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle
        withHandle
        className="mx-2 bg-[#dbe4ef] hover:bg-[#bfdbfe]"
      />

      <ResizablePanel id="activity" defaultSize={26} minSize={18}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[16px] border border-[#dbe4ef] bg-white">
          <div className="border-b border-[#e7edf5] bg-[#f8fbff] px-4 py-3">
            <div className="font-mono text-sm font-semibold text-[#142033]">
              {agentCommandsTitle}
            </div>
            <div className="mt-1 text-xs text-[#7a8da4]">{resultSummary}</div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-3">
              {agentCommandItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#dbe4ef] bg-[#fbfdff] px-3 py-4 text-sm leading-6 text-[#6d7f97]">
                  {activityEmpty}
                </div>
              ) : (
                agentCommandItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[#e7edf5] bg-[#fbfdff] p-3 shadow-[0_12px_28px_rgba(15,23,42,0.05)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        {item.description}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-lg px-2 text-[#60748b] hover:bg-white hover:text-[#142033]"
                          onClick={() => void handleCopyCommand(item.command)}
                        >
                          <CopyIcon className="size-3.5" />
                          {copyCommandLabel}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-lg px-2 text-[#60748b] hover:bg-white hover:text-[#142033]"
                          onClick={() => void onRunCommand(item.command)}
                        >
                          <RotateCcwIcon className="size-3.5" />
                          {rerunCommandLabel}
                        </Button>
                      </div>
                    </div>
                    <pre className="mt-2 overflow-hidden rounded-xl border border-[#e7edf5] bg-white px-3 py-2 font-mono text-[12px] leading-5 break-words whitespace-pre-wrap text-[#31475f]">
                      {item.command}
                    </pre>
                    {item.result && (
                      <div className="mt-2 text-xs leading-5 text-[#7a8da4]">
                        {summarizeConsoleText(item.result, 180)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
