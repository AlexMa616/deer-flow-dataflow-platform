"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { useThreads } from "@/core/threads/hooks";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

export default function ChatsPage() {
  const { t } = useI18n();
  const { data: threads } = useThreads();
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = `${t.pages.chats} - ${t.pages.appName}`;
  }, [t.pages.chats, t.pages.appName]);

  const filteredThreads = useMemo(() => {
    return threads?.filter((thread) => {
      return titleOfThread(thread).toLowerCase().includes(search.toLowerCase());
    });
  }, [threads, search]);
  return (
    <WorkspaceContainer>
      <WorkspaceHeader></WorkspaceHeader>
      <WorkspaceBody>
        <div className="flex size-full flex-col px-3 pb-3 pt-2 md:px-4">
          <header className="flex shrink-0 items-center justify-center pt-3">
            <Input
              type="search"
              className="h-12 w-full max-w-(--container-width-lg) rounded-2xl border-sky-200/70 bg-white/85 text-xl shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
              placeholder={t.chats.searchChats}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </header>
          <main className="min-h-0 flex-1 pt-4">
            <ScrollArea className="size-full rounded-3xl border border-sky-200/70 bg-white/72 py-2 shadow-[0_16px_40px_rgba(15,23,42,0.07)] backdrop-blur">
              <div className="mx-auto flex size-full max-w-(--container-width-lg) flex-col px-2">
                {filteredThreads?.map((thread) => (
                  <Link
                    key={thread.thread_id}
                    href={pathOfThread(thread.thread_id)}
                  >
                    <div className="flex flex-col gap-2 rounded-2xl border border-transparent p-4 transition hover:border-sky-200/70 hover:bg-white/80">
                      <div>
                        <div className="font-medium text-slate-800">{titleOfThread(thread)}</div>
                      </div>
                      {thread.updated_at && (
                        <div className="text-sm text-slate-500">
                          {formatTimeAgo(thread.updated_at)}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </ScrollArea>
          </main>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
