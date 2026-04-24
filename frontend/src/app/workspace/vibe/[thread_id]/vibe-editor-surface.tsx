"use client";

import { Code2Icon, EyeIcon, EyeOffIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Streamdown } from "streamdown";

import { CodeEditor } from "@/components/workspace/code-editor";
import { urlOfArtifact } from "@/core/artifacts/utils";
import { streamdownPlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

type SelectedArtifactMeta = {
  isCodeFile: boolean;
  isWriteFile: boolean;
  language: string | null;
  previewable: boolean;
};

export function VibeEditorSurface({
  editorEmptyBadge,
  editorEmptyCaption,
  editorEmptyChecklist,
  editorEmptyBody,
  editorEmptyTitle,
  noPreviewDetail,
  noPreview,
  previewLoading,
  selectedArtifact,
  selectedArtifactLoading,
  selectedArtifactMeta,
  selectedCodeValue,
  threadId,
}: {
  editorEmptyBadge: string;
  editorEmptyCaption: string;
  editorEmptyChecklist: string[];
  editorEmptyBody: string;
  editorEmptyTitle: string;
  noPreviewDetail: string;
  noPreview: string;
  previewLoading: string;
  selectedArtifact: string | null;
  selectedArtifactLoading: boolean;
  selectedArtifactMeta: SelectedArtifactMeta | null;
  selectedCodeValue: string;
  threadId: string;
}) {
  if (!selectedArtifact) {
    return (
      <div className="relative flex h-full min-h-[360px] overflow-hidden bg-[#f8fbff] p-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,0.08),transparent_28%),radial-gradient(circle_at_80%_100%,rgba(14,165,233,0.07),transparent_30%)]" />

        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[28px] border border-[#dbe4ef] bg-white shadow-[0_18px_48px_rgba(15,23,42,0.07)]">
          <div className="flex items-center justify-between gap-3 border-b border-[#e7edf5] bg-[#fbfdff] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 rounded-full bg-[#ef4444]" />
              <span className="size-2.5 rounded-full bg-[#f59e0b]" />
              <span className="size-2.5 rounded-full bg-[#22c55e]" />
              <span className="ml-2 truncate text-xs font-semibold tracking-[0.18em] text-[#7a8da4] uppercase">
                {editorEmptyBadge}
              </span>
            </div>
            <span className="rounded-full border border-[#dbe4ef] bg-white px-3 py-1 text-xs font-medium text-[#60748b]">
              {editorEmptyCaption}
            </span>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 p-5 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[26px] border border-[#e7edf5] bg-[linear-gradient(135deg,#ffffff_0%,#f4f8ff_100%)] p-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#dbeafe] bg-white px-3 py-1 text-xs font-medium text-[#2563eb]">
                  <SparklesIcon className="size-3.5" />
                  {editorEmptyTitle}
                </div>
                <p className="mt-4 max-w-sm text-sm leading-7 text-[#60748b]">
                  {editorEmptyBody}
                </p>
              </div>

              <div className="mt-8 space-y-3">
                <div className="h-3 w-2/3 rounded-full bg-[#e8eef7]" />
                <div className="h-3 w-1/2 rounded-full bg-[#eef3f9]" />
                <div className="grid gap-3 pt-2 sm:grid-cols-3">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-16 rounded-[18px] border border-[#e7edf5] bg-white"
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {editorEmptyChecklist.map((item, index) => {
                const ItemIcon =
                  index === 0
                    ? EyeIcon
                    : index === 1
                      ? Code2Icon
                      : SparklesIcon;

                return (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-[20px] border border-[#e7edf5] bg-[#fbfdff] px-4 py-4"
                  >
                    <span
                      className={cn(
                        "grid size-10 place-items-center rounded-2xl",
                        index === 0 && "bg-[#eef5ff] text-[#2563eb]",
                        index === 1 && "bg-[#f6f0ff] text-[#7c3aed]",
                        index === 2 && "bg-[#fff7ed] text-[#f59e0b]",
                      )}
                    >
                      <ItemIcon className="size-4" />
                    </span>
                    <span className="text-sm font-medium text-[#40556f]">
                      {item}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedArtifactLoading) {
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-8 text-sm text-[#60748b]">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-[22px] border border-[#bfdbfe] bg-[#eef5ff]" />
          <div className="absolute inset-2 animate-pulse rounded-2xl bg-[linear-gradient(135deg,rgba(37,99,235,0.2),rgba(14,165,233,0.18))]" />
        </div>
        <div className="space-y-2 text-center">
          <div className="text-sm font-medium text-[#142033]">
            {previewLoading}
          </div>
          <div className="flex items-center justify-center gap-1.5">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className={cn(
                  "size-2 rounded-full bg-[#dbe4ef]",
                  dot === 1 && "bg-[#2563eb]",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (selectedArtifactMeta?.isCodeFile) {
    if (selectedArtifactMeta.language === "html") {
      return selectedArtifactMeta.isWriteFile ? (
        <iframe
          className="size-full bg-white"
          sandbox="allow-forms allow-modals allow-scripts"
          srcDoc={selectedCodeValue}
          title={selectedArtifact}
        />
      ) : (
        <iframe
          className="size-full bg-white"
          sandbox="allow-forms allow-modals allow-scripts"
          src={urlOfArtifact({
            filepath: selectedArtifact,
            threadId,
          })}
          title={selectedArtifact}
        />
      );
    }

    if (selectedArtifactMeta.language === "markdown") {
      return (
        <ScrollPreview>
          <Streamdown
            className="max-w-none text-[15px] leading-8 text-[#24364b] [&_a]:text-[#2563eb] [&_blockquote]:border-l-4 [&_blockquote]:border-[#bfdbfe] [&_blockquote]:bg-[#f7fbff] [&_blockquote]:px-4 [&_code]:rounded-md [&_code]:bg-[#eef5ff] [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:overflow-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-[#dbe4ef] [&_pre]:bg-[#f8fbff] [&_pre]:p-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#dbe4ef] [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-[#dbe4ef] [&_th]:bg-[#f8fbff] [&_th]:px-3 [&_th]:py-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            {...streamdownPlugins}
          >
            {selectedCodeValue}
          </Streamdown>
        </ScrollPreview>
      );
    }

    return (
      <CodeEditor
        className="size-full bg-white"
        value={selectedCodeValue}
        readonly
        settings={{ lineNumbers: true, foldGutter: true }}
        themeMode="light"
      />
    );
  }

  if (!selectedArtifactMeta?.isWriteFile) {
    return (
      <iframe
        className="size-full bg-white"
        src={urlOfArtifact({
          filepath: selectedArtifact,
          threadId,
        })}
        title={selectedArtifact}
      />
    );
  }

  return (
    <div className="flex h-full min-h-[360px] items-center justify-center bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-6 py-10">
      <div className="w-full max-w-xl rounded-[28px] border border-[#dbe4ef] bg-white p-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex size-16 items-center justify-center rounded-[22px] bg-[#eef5ff] text-[#2563eb]">
          <EyeOffIcon className="size-7" />
        </div>
        <h3 className="mt-5 text-lg font-semibold text-[#142033]">
          {noPreview}
        </h3>
        <p className="mt-2 text-sm leading-7 text-[#60748b]">
          {noPreviewDetail}
        </p>
      </div>
    </div>
  );
}

function ScrollPreview({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-auto bg-white px-6 py-6">
      <div className="mx-auto min-h-full w-full max-w-4xl rounded-[24px] border border-[#e7edf5] bg-white px-6 py-6 shadow-[0_18px_44px_rgba(15,23,42,0.05)]">
        {children}
      </div>
    </div>
  );
}
