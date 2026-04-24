"use client";

import {
  Activity,
  Box,
  Database,
  HardDrive,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AuroraText } from "@/components/ui/aurora-text";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useSystemOverview } from "@/core/system/hooks";
import type { SystemRecommendation } from "@/core/system/types";
import { cn } from "@/lib/utils";

type PulseView = "overview" | "insights";

function formatBytes(bytes: number): string {
  if (!bytes) {
    return "0B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
}

function getPulseStatus(recommendations: SystemRecommendation[]) {
  const hasAction = recommendations.some((rec) => rec.level === "action");
  const hasWarn = recommendations.some((rec) => rec.level === "warn");
  if (hasAction) {
    return {
      label: "需处理",
      tone: "border border-rose-200/70 bg-rose-100 text-rose-700",
    };
  }
  if (hasWarn) {
    return {
      label: "需关注",
      tone: "border border-amber-200/70 bg-amber-100 text-amber-700",
    };
  }
  return {
    label: "稳定",
    tone: "border border-emerald-200/70 bg-emerald-100 text-emerald-700",
  };
}

function RecommendationItem({ recommendation }: { recommendation: SystemRecommendation }) {
  const tone =
    recommendation.level === "action"
      ? "border-rose-200/70 bg-rose-50/70 text-rose-700"
      : recommendation.level === "warn"
        ? "border-amber-200/70 bg-amber-50/70 text-amber-700"
        : "border-sky-200/70 bg-sky-50/70 text-sky-700";
  return (
    <div className={cn("rounded-lg border px-2.5 py-2 text-xs", tone)}>
      <div className="flex items-center gap-1 font-semibold">
        <Sparkles className="size-3" />
        {recommendation.title}
      </div>
      <p className="text-[11px] text-slate-600">{recommendation.detail}</p>
    </div>
  );
}

export function SystemPulse({ className }: { className?: string }) {
  const { data, isLoading } = useSystemOverview();
  const [view, setView] = useState<PulseView>("overview");

  const status = useMemo(
    () => getPulseStatus(data?.recommendations ?? []),
    [data?.recommendations],
  );

  const lastUpdated = useMemo(() => {
    if (!data?.timestamp) {
      return "—";
    }
    const date = new Date(data.timestamp);
    if (Number.isNaN(date.valueOf())) {
      return "—";
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [data?.timestamp]);

  const recommendations = data?.recommendations ?? [];
  const storageBytes =
    (data?.threads.uploads.bytes ?? 0) +
    (data?.threads.outputs.bytes ?? 0) +
    (data?.threads.workspace.bytes ?? 0);

  return (
    <div
      className={cn(
        "relative shrink-0 rounded-2xl border border-sky-200/70 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.25),transparent_65%),linear-gradient(145deg,#ffffff,#eef2ff)] px-3 py-3.5 text-slate-900 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur",
        className,
      )}
    >
      <div
        className="ambilight enabled pointer-events-none absolute inset-0 opacity-25"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-cyan-300/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-32 w-32 rounded-full bg-indigo-300/25 blur-3xl" />
      <div className="relative z-10 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full border border-sky-200/70 bg-white/70">
              <Activity className="size-4 text-sky-600" />
            </div>
            <div className="leading-tight">
              <AuroraText colors={["#0ea5e9", "#6366f1", "#22d3ee"]}>
                系统脉冲
              </AuroraText>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                实时智能
              </p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
              status.tone,
            )}
          >
            {status.label}
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span>更新于 {lastUpdated}</span>
          <span className="flex items-center gap-1 text-sky-600">
            <ShieldCheck className="size-3" />
            {data?.sandbox_mode ?? "—"} 沙盒
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 p-1 text-[11px]">
          {(["overview", "insights"] as PulseView[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 transition",
                view === item
                  ? "bg-sky-100 text-sky-700 shadow-[0_0_0_1px_rgba(14,165,233,0.25)]"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              {item === "overview" ? "概览" : "洞察"}
            </button>
          ))}
        </div>

        {view === "overview" ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200/70 bg-white/70 p-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Database className="size-3 text-sky-500" />
                会话
              </div>
              <NumberTicker
                value={data?.threads.count ?? 0}
                className="text-lg leading-none font-semibold text-sky-700"
              />
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white/70 p-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Box className="size-3 text-indigo-500" />
                上传
              </div>
              <NumberTicker
                value={data?.threads.uploads.files ?? 0}
                className="text-lg leading-none font-semibold text-indigo-600"
              />
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white/70 p-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <HardDrive className="size-3 text-emerald-500" />
                存储
              </div>
              <p className="text-lg leading-none font-semibold text-emerald-600">
                {formatBytes(storageBytes)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white/70 p-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Sparkles className="size-3 text-pink-500" />
                记忆事实
              </div>
              <NumberTicker
                value={data?.memory.facts ?? 0}
                className="text-lg leading-none font-semibold text-pink-600"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {isLoading ? (
              <div className="rounded-xl border border-slate-200/70 bg-white/70 p-3 text-xs text-slate-600">
                正在同步系统情报...
              </div>
            ) : recommendations.length > 0 ? (
              recommendations
                .slice(0, 2)
                .map((recommendation) => (
                  <RecommendationItem
                    key={recommendation.id}
                    recommendation={recommendation}
                  />
                ))
            ) : (
              <div className="rounded-xl border border-slate-200/70 bg-white/70 p-3 text-xs text-slate-600">
                系统状态良好，暂无建议。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
