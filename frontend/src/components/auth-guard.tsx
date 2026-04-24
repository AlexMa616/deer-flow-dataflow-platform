"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearAuth, fetchMe, getToken, setAuthHintCookie } from "@/lib/auth";

export function AuthGuard({
  children,
}: {
  children: React.ReactNode;
  initialAuthed?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [authState, setAuthState] = useState({
    checked: false,
    authed: false,
  });

  useEffect(() => {
    let active = true;
    let checkId = 0;

    const syncAuth = () => {
      const token = getToken();
      const currentCheckId = ++checkId;

      if (!token) {
        setAuthHintCookie(false);
        setAuthState({ checked: true, authed: false });
        return;
      }

      setAuthHintCookie(true);
      setAuthState((current) =>
        current.authed ? current : { checked: false, authed: false },
      );

      void fetchMe()
        .then(() => {
          if (!active || currentCheckId !== checkId) {
            return;
          }
          setAuthState({ checked: true, authed: true });
        })
        .catch(() => {
          if (!active || currentCheckId !== checkId) {
            return;
          }
          clearAuth();
          setAuthState({ checked: true, authed: false });
        });
    };

    syncAuth();
    window.addEventListener("storage", syncAuth);
    window.addEventListener("focus", syncAuth);
    return () => {
      active = false;
      window.removeEventListener("storage", syncAuth);
      window.removeEventListener("focus", syncAuth);
    };
  }, [pathname]);

  if (!authState.checked) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-3">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          验证中...
        </div>
      </div>
    );
  }

  if (!authState.authed) {
    return (
      <div className="bg-background flex h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white/90 p-5 text-center shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
          <h2 className="text-lg font-semibold text-slate-900">需要登录</h2>
          <button
            type="button"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            onClick={() =>
              router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`)
            }
          >
            登录
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
