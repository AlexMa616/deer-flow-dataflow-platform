"use client";

import { SparklesIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AlexMark } from "@/components/brand/alex-mark";
import { useI18n } from "@/core/i18n/hooks";
import { fetchMe, getUser, type User } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function Welcome({
  className,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isSkillMode = searchParams.get("mode") === "skill";
  const isChinese = /[\u4e00-\u9fff]/.test(t.welcome.greeting);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

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
  const userInitials = useMemo(
    () => userDisplayName.slice(0, 2).toUpperCase(),
    [userDisplayName],
  );

  const heroQuestion = isChinese
    ? `你好，${userDisplayName}，需要我为你做些什么？`
    : `Hi ${userDisplayName}, what can I help you with?`;
  const heroDescription = isChinese
    ? "我可以帮你搜索信息、分析文档、生成图片和视频，也可以协助写作、学习与创作。"
    : "I can search the web, analyze files, generate images and videos, and assist with writing and study.";

  if (isSkillMode) {
    return (
      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-3 px-6 py-4 text-center",
          className,
        )}
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-white/88 px-3 py-1.5 text-slate-700 shadow-[0_6px_18px_rgba(15,23,42,0.06)] backdrop-blur">
          <SparklesIcon className="size-4 text-sky-500" />
          <span className="text-sm font-medium tracking-wide">
            {t.welcome.createYourOwnSkill}
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          {t.welcome.createYourOwnSkillDescription.replaceAll("\n", " ")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-4xl flex-col items-center justify-center gap-3 px-6 py-4 text-center",
        className,
      )}
    >
      <div className="inline-flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/86 px-3 py-2 text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur">
        <SparklesIcon className="size-4 text-indigo-500" />
        <AlexMark compact label={userInitials} className="h-8 w-8 rounded-lg" />
        <span className="text-lg font-medium tracking-tight">
          {isChinese
            ? `${userDisplayName}，欢迎回来`
            : `Welcome back, ${userDisplayName}`}
        </span>
      </div>
      <h1 className="text-[1.08rem] leading-[1.25] font-black tracking-tight text-slate-900 md:text-[1.22rem]">
        {heroQuestion}
      </h1>
      <p className="max-w-3xl text-sm leading-6 text-slate-500">
        {heroDescription}
      </p>
    </div>
  );
}
