"use client";

import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  FileCodeIcon,
  FileIcon,
  FolderIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SparklesIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShineBorder } from "@/components/ui/shine-border";
import { cn } from "@/lib/utils";

import {
  buildExplorerTree,
  normalizeArtifactPath,
  type ExplorerNode,
  type QuickAction,
} from "./vibe-utils";

function ExplorerTreeView({
  nodes,
  depth = 0,
  selectedArtifact,
  onSelect,
}: {
  nodes: ExplorerNode[];
  depth?: number;
  selectedArtifact: string | null;
  onSelect: (artifact: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <div key={node.id}>
            <div
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] leading-6 font-medium text-slate-400"
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
            >
              <ChevronRightIcon className="size-3 rotate-90 text-slate-500" />
              <FolderIcon className="size-3.5 text-emerald-300/70" />
              <span className="truncate">{node.label}</span>
            </div>
            <ExplorerTreeView
              nodes={node.children ?? []}
              depth={depth + 1}
              selectedArtifact={selectedArtifact}
              onSelect={onSelect}
            />
          </div>
        ) : (
          <button
            key={node.id}
            type="button"
            onClick={() => node.artifact && onSelect(node.artifact)}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl border py-2 pr-2 text-left text-[13.5px] leading-6 transition",
              selectedArtifact === node.artifact
                ? "border-cyan-400/30 bg-[linear-gradient(135deg,rgba(14,116,144,0.22),rgba(15,23,42,0.92))] text-white shadow-[0_14px_32px_rgba(6,182,212,0.12)]"
                : "border-transparent bg-transparent text-slate-400 hover:border-white/10 hover:bg-white/4 hover:text-white",
            )}
            style={{ paddingLeft: `${depth * 14 + 28}px` }}
          >
            <FileIcon className="size-3.5 shrink-0 text-slate-500" />
            <span className="truncate">{node.label}</span>
          </button>
        ),
      )}
    </>
  );
}

export function VibeExplorerPanel({
  activeFileLabel,
  collapsed,
  createdByLabel,
  explorerEmpty,
  explorerSearchEmpty,
  explorerSearchPlaceholder,
  overviewSummary,
  explorerTitle,
  explorerTree,
  fileItems,
  filesCountLabel,
  hideSidebarLabel,
  projectName,
  promptBadgeLabel,
  quickActions,
  quickStartLabel,
  selectedArtifact,
  showSidebarLabel,
  waitingForOutput,
  onQueuePrompt,
  onSelectArtifact,
  onToggle,
}: {
  activeFileLabel: string;
  collapsed: boolean;
  createdByLabel: string;
  explorerEmpty: string;
  explorerSearchEmpty: string;
  explorerSearchPlaceholder: string;
  overviewSummary: string;
  explorerTitle: string;
  explorerTree: ExplorerNode[];
  fileItems: string[];
  filesCountLabel: string;
  hideSidebarLabel: string;
  projectName: string;
  promptBadgeLabel: string;
  quickActions: QuickAction[];
  quickStartLabel: string;
  selectedArtifact: string | null;
  showSidebarLabel: string;
  waitingForOutput: string;
  onQueuePrompt: (prompt: string) => void;
  onSelectArtifact: (artifact: string) => void;
  onToggle: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTree = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return explorerTree;
    }
    const matchingArtifacts = fileItems.filter((artifact) =>
      normalizeArtifactPath(artifact).toLowerCase().includes(normalizedQuery),
    );
    return buildExplorerTree(matchingArtifacts);
  }, [explorerTree, fileItems, searchQuery]);

  const activeFile = selectedArtifact
    ? normalizeArtifactPath(selectedArtifact)
    : waitingForOutput;

  const quickActionStyles = [
    {
      card: "border-cyan-400/18 bg-[linear-gradient(180deg,rgba(14,116,144,0.18)_0%,rgba(15,23,42,0.92)_100%)] hover:border-cyan-300/34",
      iconWrap:
        "bg-[linear-gradient(135deg,#0f172a_0%,#0891b2_100%)] text-cyan-50 shadow-[0_18px_35px_rgba(6,182,212,0.12)]",
      badge: "border-cyan-400/25 bg-cyan-400/8 text-cyan-200",
    },
    {
      card: "border-emerald-400/18 bg-[linear-gradient(180deg,rgba(6,95,70,0.18)_0%,rgba(15,23,42,0.92)_100%)] hover:border-emerald-300/34",
      iconWrap:
        "bg-[linear-gradient(135deg,#052e2b_0%,#047857_100%)] text-emerald-50 shadow-[0_18px_35px_rgba(16,185,129,0.12)]",
      badge: "border-emerald-400/25 bg-emerald-400/8 text-emerald-200",
    },
    {
      card: "border-amber-300/18 bg-[linear-gradient(180deg,rgba(120,53,15,0.18)_0%,rgba(15,23,42,0.92)_100%)] hover:border-amber-300/34",
      iconWrap:
        "bg-[linear-gradient(135deg,#3b1d0d_0%,#b45309_100%)] text-amber-50 shadow-[0_18px_35px_rgba(245,158,11,0.12)]",
      badge: "border-amber-300/25 bg-amber-300/8 text-amber-200",
    },
  ] as const;

  return (
    <div
      className={cn(
        "grid h-full min-h-0 overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,13,18,0.96)_0%,rgba(15,23,42,0.98)_100%)] shadow-[0_30px_90px_rgba(2,6,23,0.48)]",
        collapsed ? "grid-cols-[52px]" : "grid-cols-[52px_minmax(0,1fr)]",
      )}
    >
      <div className="relative flex flex-col items-center gap-3 border-r border-white/8 bg-[linear-gradient(180deg,#070b12_0%,#0b1220_100%)] px-2 py-3">
        <div className="pointer-events-none absolute inset-x-2 top-6 h-[4rem] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.18),transparent_70%)] blur-2xl" />
        <button
          type="button"
          onClick={onToggle}
          className="relative z-10 flex size-9 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-slate-300 shadow-sm transition hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? showSidebarLabel : hideSidebarLabel}
          title={collapsed ? showSidebarLabel : hideSidebarLabel}
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="size-4" />
          ) : (
            <PanelLeftCloseIcon className="size-4" />
          )}
        </button>
        <div className="relative z-10 flex size-9 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-200 shadow-[0_12px_28px_rgba(6,182,212,0.08)]">
          <FileCodeIcon className="size-4" />
        </div>
        <div className="relative z-10 flex size-9 items-center justify-center rounded-2xl bg-white/6 text-slate-500 shadow-sm">
          <FolderIcon className="size-4" />
        </div>
        <div className="relative z-10 flex size-9 items-center justify-center rounded-2xl bg-white/6 text-slate-500 shadow-sm">
          <SquareTerminalIcon className="size-4" />
        </div>
      </div>

      <div
        className={cn(
          "min-w-0",
          collapsed
            ? "pointer-events-none hidden opacity-0"
            : "flex min-h-0 flex-col overflow-hidden opacity-100",
        )}
      >
        <div className="border-b border-white/8 px-4 py-4">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(8,47,73,0.88)_55%,rgba(6,95,70,0.84)_100%)] p-4 shadow-[0_22px_56px_rgba(2,6,23,0.36)]">
            <ShineBorder
              borderWidth={1}
              duration={16}
              shineColor={["rgba(34,211,238,0.28)", "rgba(16,185,129,0.22)"]}
            />
            <div className="pointer-events-none absolute -top-8 -right-10 h-28 w-28 rounded-full bg-cyan-300/16 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 -left-8 h-20 w-20 rounded-full bg-emerald-300/16 blur-3xl" />

            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/16 px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.18em] text-slate-300 uppercase">
                    <SparklesIcon className="size-3.5 text-cyan-300" />
                    {explorerTitle}
                  </div>
                  <div className="mt-3 truncate text-lg font-semibold tracking-tight text-white">
                    {projectName}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    {overviewSummary}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/18 px-3 py-2 text-right shadow-sm">
                  <div className="font-mono text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
                    {filesCountLabel}
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight text-white">
                    {fileItems.length}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-white/10 bg-black/18 px-3 py-3">
                  <div className="font-mono text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
                    {quickStartLabel}
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight text-white">
                    {quickActions.length}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/18 px-3 py-3">
                  <div className="font-mono text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
                    {activeFileLabel}
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-100">
                    {activeFile}
                  </div>
                </div>
              </div>

              <a
                href="https://deerflow.tech"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/8 hover:text-white"
              >
                {createdByLabel}
                <ArrowUpRightIcon className="size-3.5" />
              </a>
            </div>
          </div>

          <div className="relative mt-4">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={explorerSearchPlaceholder}
              className="h-11 rounded-2xl border-white/8 bg-white/4 pl-9 text-sm text-white shadow-none placeholder:text-slate-500"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-7 p-4">
            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="font-mono text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                  {filesCountLabel}
                </div>
                <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-xs text-slate-400">
                  {fileItems.length}
                </span>
              </div>
              {fileItems.length === 0 ? (
                <p className="rounded-[24px] border border-dashed border-white/10 bg-white/4 px-4 py-5 text-sm leading-7 text-slate-400">
                  {explorerEmpty}
                </p>
              ) : filteredTree.length === 0 ? (
                <p className="rounded-[24px] border border-dashed border-white/10 bg-white/4 px-4 py-5 text-sm leading-7 text-slate-400">
                  {explorerSearchEmpty}
                </p>
              ) : (
                <div className="space-y-1 rounded-[26px] border border-white/10 bg-black/16 p-2 shadow-[0_18px_34px_rgba(2,6,23,0.22)]">
                  <ExplorerTreeView
                    nodes={filteredTree}
                    selectedArtifact={selectedArtifact}
                    onSelect={onSelectArtifact}
                  />
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="font-mono text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                  {quickStartLabel}
                </div>
                <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-xs text-slate-400">
                  {quickActions.length}
                </span>
              </div>
              <div className="space-y-3">
                {quickActions.map((action, index) => {
                  const style =
                    quickActionStyles[index % quickActionStyles.length]!;

                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => onQueuePrompt(action.prompt)}
                      className={cn(
                        "w-full rounded-[26px] border px-4 py-4 text-left shadow-[0_16px_34px_rgba(2,6,23,0.24)] transition hover:-translate-y-0.5",
                        style.card,
                      )}
                    >
                      <div className="flex min-h-[118px] items-start gap-3.5">
                        <div
                          className={cn(
                            "mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-[18px]",
                            style.iconWrap,
                          )}
                        >
                          <action.icon className="size-[18px]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium",
                              style.badge,
                            )}
                          >
                            {promptBadgeLabel}
                          </div>
                          <div className="mt-3 text-[15px] font-semibold text-white">
                            {action.label}
                          </div>
                          <div className="mt-1.5 text-[13px] leading-6 text-slate-300">
                            {action.description}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
