"use client";

import { HistoryIcon } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useThreadTranscript } from "@/core/transcript";
import { cn } from "@/lib/utils";

function stringifyContent(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[无法序列化的内容]";
  }
}

function labelOfType(type: string | null | undefined) {
  if (type === "human") return "User";
  if (type === "ai") return "Assistant";
  if (type === "tool") return "Tool";
  return type ?? "Message";
}

export function FullTranscriptSheet({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const { data, isLoading, isError, refetch } = useThreadTranscript(
    threadId,
    true,
  );
  const groupedEntries = useMemo(() => data?.entries ?? [], [data?.entries]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          className={cn(
            "text-muted-foreground hover:text-foreground",
            className,
          )}
          variant="ghost"
        >
          <HistoryIcon />
          完整记录
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[92vw] max-w-3xl gap-0 p-0 sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-slate-200/80 bg-white/92 pr-12">
          <SheetTitle>完整上下文记录</SheetTitle>
          <SheetDescription>
            这里显示线程级原始消息归档。它独立于当前 summary
            后的可见消息列表，适合排查长对话中被折叠的上下文。
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            {isLoading && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                正在加载完整记录...
              </div>
            )}
            {isError && (
              <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <div>完整记录暂时读取失败。</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refetch()}
                >
                  重试
                </Button>
              </div>
            )}
            {!isLoading && !isError && groupedEntries.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                这个线程还没有生成完整记录归档。新对话或接下来继续发送的消息会自动开始归档。
              </div>
            )}
            {groupedEntries.map((entry) => {
              const content = stringifyContent(entry.message.content);
              const toolCalls = stringifyContent(entry.message.tool_calls);
              const hasToolCalls =
                toolCalls.trim().length > 0 && toolCalls !== "null";
              return (
                <section
                  key={entry.key}
                  className="rounded-2xl border border-slate-200/80 bg-white/92 shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.14em] text-slate-700 uppercase">
                        {labelOfType(entry.message.type)}
                      </span>
                      {entry.message.name && (
                        <span className="text-xs text-slate-500">
                          {entry.message.name}
                        </span>
                      )}
                    </div>
                    <div className="text-right text-[11px] text-slate-500">
                      <div>{new Date(entry.captured_at).toLocaleString()}</div>
                      <div>{entry.phase}</div>
                    </div>
                  </div>
                  <div className="space-y-3 px-4 py-4">
                    {content.trim().length > 0 && (
                      <pre className="overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-xs leading-6 break-words whitespace-pre-wrap text-slate-100">
                        {content}
                      </pre>
                    )}
                    {hasToolCalls && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold tracking-[0.08em] text-slate-500 uppercase">
                          Tool Calls
                        </div>
                        <pre className="overflow-x-auto rounded-xl bg-slate-100 px-4 py-3 text-xs leading-6 break-words whitespace-pre-wrap text-slate-700">
                          {toolCalls}
                        </pre>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
