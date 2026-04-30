"use client";

import type React from "react";

import { cn } from "@/lib/utils";

export function AlexMark({
  className,
  accent = "#22d3ee",
  compact = false,
  label = "ALEX",
}: {
  className?: string;
  accent?: string;
  compact?: boolean;
  label?: string;
}) {
  const normalizedLabel = label.trim().slice(0, 4).toUpperCase() || "AI";
  const fontSize =
    normalizedLabel.length <= 2 ? 34 : normalizedLabel.length === 3 ? 31 : 27;

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-2xl border border-white/35 bg-white/80 text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur",
        compact ? "h-9 w-9 rounded-xl" : "h-14 w-14",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 96 96"
        className="h-[88%] w-[88%]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="alex-mark-fill" x1="14" y1="16" x2="82" y2="84">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <rect
          x="10"
          y="10"
          width="76"
          height="76"
          rx="20"
          fill="url(#alex-mark-fill)"
          opacity="0.16"
        />
        <text
          x="48"
          y="58"
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight="800"
          letterSpacing={normalizedLabel.length <= 2 ? "1" : "2"}
          fill="url(#alex-mark-fill)"
          fontFamily="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        >
          {normalizedLabel}
        </text>
      </svg>
      <span
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          boxShadow: `inset 0 0 0 1px ${accent}66, 0 0 18px ${accent}40`,
        }}
      />
    </div>
  );
}
