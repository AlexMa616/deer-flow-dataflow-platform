"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login, register } from "@/lib/auth";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "register";
type FieldKey = "username" | "email" | "password" | "confirmPassword";
type StageKey = "ask" | "plan" | "work" | "ship";

const WORKFLOW_STAGES: Array<{
  key: StageKey;
  label: string;
  description: string;
  tone: string;
}> = [
  {
    key: "ask",
    label: "Ask",
    description: "输入身份",
    tone: "bg-[#eaf4ff]",
  },
  {
    key: "plan",
    label: "Plan",
    description: "同步资料",
    tone: "bg-white/70",
  },
  {
    key: "work",
    label: "Work",
    description: "保护会话",
    tone: "bg-[#ecfdf5]",
  },
  {
    key: "ship",
    label: "Ship",
    description: "进入空间",
    tone: "bg-white/70",
  },
];

function resolveReturnTo(raw: string | null) {
  if (raw?.startsWith("/workspace/")) {
    return raw;
  }
  return "/workspace/chats/new";
}

function DeerFlowMark({ className }: { className?: string }) {
  return (
    <span className={cn("login-brand-mark", className)} aria-hidden="true">
      <span className="login-brand-core" />
      <span className="login-brand-node login-brand-node-a" />
      <span className="login-brand-node login-brand-node-b" />
      <span className="login-brand-node login-brand-node-c" />
    </span>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeReturnTo = useMemo(
    () => resolveReturnTo(searchParams.get("returnTo")),
    [searchParams],
  );

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pointer, setPointer] = useState({
    x: 50,
    y: 50,
  });
  const [focusedField, setFocusedField] = useState<FieldKey | null>(null);
  const [typingBeat, setTypingBeat] = useState(0);
  const [typingPulse, setTypingPulse] = useState(false);
  const [selectedStage, setSelectedStage] = useState<StageKey>("ask");
  const [hoveredStage, setHoveredStage] = useState<StageKey | null>(null);

  useEffect(() => {
    document.title = "DeerFlow";
    router.prefetch(safeReturnTo);
  }, [router, safeReturnTo]);

  useEffect(() => {
    if (!typingBeat) {
      return;
    }
    setTypingPulse(true);
    const timeout = window.setTimeout(() => setTypingPulse(false), 520);
    return () => window.clearTimeout(timeout);
  }, [typingBeat]);

  const submitLabel = mode === "login" ? "继续" : "创建";
  const focusedLabel =
    focusedField === "username"
      ? "identity"
      : focusedField === "email"
        ? "mail"
        : focusedField === "password"
          ? "secure"
          : focusedField === "confirmPassword"
            ? "match"
            : "ready";
  const signalLevel = Math.min(
    100,
    username.trim().length * 9 +
      password.length * 7 +
      (mode === "register" ? email.trim().length * 3 : 12) +
      (confirmPassword ? 12 : 0),
  );
  const agentBadge = username.trim().slice(0, 2).toUpperCase() || "AI";
  const focusedStage: StageKey | null =
    focusedField === "username"
      ? "ask"
      : focusedField === "email"
        ? "plan"
        : focusedField === "password"
          ? "work"
          : focusedField === "confirmPassword"
            ? "ship"
            : null;
  const liveStage = hoveredStage ?? focusedStage ?? selectedStage;
  const loginShellStyle = {
    "--mouse-x": `${pointer.x}%`,
    "--mouse-y": `${pointer.y}%`,
    "--tilt-x": `${(50 - pointer.y) * 0.055}deg`,
    "--tilt-y": `${(pointer.x - 50) * 0.055}deg`,
    "--signal": `${Math.max(signalLevel, 14)}%`,
  } as CSSProperties;

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  }

  function handleFieldChange(
    field: FieldKey,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const value = event.target.value;
    setTypingBeat((current) => current + 1);
    if (field === "username") {
      setSelectedStage("ask");
      setUsername(value);
    }
    if (field === "email") {
      setSelectedStage("plan");
      setEmail(value);
    }
    if (field === "password") {
      setSelectedStage("work");
      setPassword(value);
    }
    if (field === "confirmPassword") {
      setSelectedStage("ship");
      setConfirmPassword(value);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUsername = username.trim();
    const nextEmail = email.trim();

    if (!nextUsername || !password) {
      setErrorMessage("请填写账号和密码。");
      return;
    }

    if (mode === "register") {
      if (!nextEmail) {
        setErrorMessage("请填写邮箱。");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage("两次密码不一致。");
        return;
      }
    }

    setLoading(true);
    setErrorMessage("");

    try {
      if (mode === "login") {
        await login(nextUsername, password);
      } else {
        await register(nextUsername, nextEmail, password);
      }
      router.replace(safeReturnTo);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "请求失败，请稍后再试。",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className={cn(
        "login-agent-shell relative min-h-screen overflow-hidden bg-[#f7f9fc] text-[#101828]",
        typingPulse && "is-typing",
      )}
      style={loginShellStyle}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setPointer({ x: 50, y: 50 })}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(59,130,246,0.16),transparent_28%),radial-gradient(circle_at_78%_20%,rgba(14,165,233,0.12),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,249,253,0.92))]" />
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px)] [background-size:44px_44px] opacity-[0.34]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-none items-center px-1.5 py-1.5 sm:px-2 sm:py-2">
        <div className="login-auth-layout grid min-h-[calc(100vh-16px)] w-full overflow-hidden rounded-[42px] border border-white/80 bg-[#eef5ff] shadow-[0_28px_90px_rgba(15,23,42,0.13)] lg:grid-cols-[minmax(0,1.18fr)_minmax(500px,0.82fr)]">
          <section className="login-agent-stage relative hidden min-h-[700px] overflow-hidden bg-transparent lg:block">
            <div className="login-agent-canvas absolute inset-5 xl:inset-6">
              <div className="login-agent-glass relative h-full p-7 xl:p-8">
                <div className="absolute top-10 -left-8 h-36 w-36 rounded-full bg-[#bfdbfe]/70 blur-2xl" />
                <div className="absolute -right-12 bottom-16 h-48 w-48 rounded-full bg-[#99f6e4]/55 blur-3xl" />

                <div className="relative grid h-full grid-rows-[auto_1fr_auto] gap-6">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <span className="size-3 rounded-full bg-[#ffb86a]" />
                      <span className="size-3 rounded-full bg-[#7dd3fc]" />
                      <span className="size-3 rounded-full bg-[#86efac]" />
                    </div>
                    <div className="login-brand-pill login-brand-pill-inset flex items-center gap-3 rounded-full border border-white/75 bg-white/78 px-4 py-2 shadow-[0_16px_42px_rgba(15,23,42,0.08)] backdrop-blur">
                      <DeerFlowMark className="size-8" />
                      <span className="text-[12px] font-semibold tracking-[0.2em] text-[#344054] uppercase">
                        DeerFlow
                      </span>
                    </div>
                  </div>

                  <div className="grid min-h-0 place-items-center">
                    <div className="login-agent-orb relative size-[min(43vw,520px)] max-h-[520px] min-h-[390px] max-w-[520px] min-w-[390px]">
                      <div className="login-agent-ring absolute inset-0 rounded-full" />
                      <div className="login-agent-ring absolute inset-10 rounded-full [animation-delay:-7s]" />
                      <div className="login-agent-ring absolute inset-20 rounded-full [animation-delay:-13s]" />

                      {[
                        ["thread", "top-5 left-36"],
                        ["skill", "top-28 right-2"],
                        ["memory", "right-24 bottom-4"],
                        ["run", "bottom-24 left-0"],
                      ].map(([label, position], index) => (
                        <div
                          key={label}
                          className={cn(
                            "login-agent-node absolute rounded-full border border-white/80 bg-white/78 px-3 py-2 text-[11px] font-medium tracking-[0.12em] text-[#475467] uppercase shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur",
                            position,
                          )}
                          style={{ animationDelay: `${index * -1.4}s` }}
                        >
                          {label}
                        </div>
                      ))}

                      <div className="login-agent-core absolute inset-[27%] rounded-[42px] border border-white/80 bg-[#101828] p-5 text-white shadow-[0_28px_72px_rgba(16,24,40,0.28)]">
                        <div className="flex items-center justify-between">
                          <div className="grid size-12 place-items-center rounded-2xl bg-white text-sm font-semibold tracking-[0.18em] text-[#101828]">
                            {agentBadge}
                          </div>
                          <div className="flex items-end gap-1">
                            <span className="login-agent-wave h-5 w-1.5 rounded-full bg-[#93c5fd]" />
                            <span className="login-agent-wave h-8 w-1.5 rounded-full bg-[#67e8f9] [animation-delay:-0.8s]" />
                            <span className="login-agent-wave h-4 w-1.5 rounded-full bg-[#99f6e4] [animation-delay:-1.4s]" />
                          </div>
                        </div>
                        <div className="mt-7 space-y-2">
                          <div className="h-2 w-20 rounded-full bg-white/68" />
                          <div className="h-2 w-full rounded-full bg-white/16" />
                          <div className="h-2 w-3/4 rounded-full bg-white/16" />
                        </div>
                        <div className="login-agent-progress mt-7 h-2 overflow-hidden rounded-full bg-white/14" />
                      </div>

                      <div className="login-agent-chat login-agent-chat-a absolute top-16 left-8 w-44 rounded-[24px] border border-white/80 bg-white/86 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.13)] backdrop-blur">
                        <div className="mb-3 flex gap-1">
                          <span className="size-1.5 rounded-full bg-[#2563eb]" />
                          <span className="size-1.5 rounded-full bg-[#38bdf8]" />
                        </div>
                        <div className="login-agent-typed-line h-2 w-24 rounded-full bg-[#d0d5dd]" />
                        <div className="login-agent-typed-line mt-2 h-2 w-32 rounded-full bg-[#e4e7ec] [animation-delay:0.18s]" />
                        <div className="mt-4 inline-flex rounded-full bg-[#eff6ff] px-3 py-1 text-[11px] font-medium text-[#2563eb]">
                          {focusedLabel}
                        </div>
                      </div>

                      <div className="login-agent-chat login-agent-chat-b absolute right-3 bottom-20 w-48 rounded-[24px] border border-white/80 bg-[#101828] p-4 text-white shadow-[0_20px_50px_rgba(15,23,42,0.20)]">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-[#99f6e4]" />
                          <span className="text-[11px] font-medium tracking-[0.18em] text-white/58 uppercase">
                            agent
                          </span>
                        </div>
                        <div className="mt-4 h-2 w-full rounded-full bg-white/18" />
                        <div className="mt-2 h-2 w-28 rounded-full bg-white/18" />
                        <div className="mt-4 flex gap-1.5">
                          <span className="login-agent-dot" />
                          <span className="login-agent-dot [animation-delay:0.16s]" />
                          <span className="login-agent-dot [animation-delay:0.32s]" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative grid grid-cols-4 gap-3">
                    {WORKFLOW_STAGES.map((stage, index) => {
                      const isActive = liveStage === stage.key;
                      const stageSignal = Math.min(
                        100,
                        Math.max(24, signalLevel + (isActive ? 28 : index * 5)),
                      );

                      return (
                        <button
                          key={stage.key}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => setSelectedStage(stage.key)}
                          onPointerEnter={() => setHoveredStage(stage.key)}
                          onPointerLeave={() => setHoveredStage(null)}
                          className={cn(
                            "login-agent-step group h-24 rounded-[24px] border border-white/70 p-3 text-left shadow-[0_12px_30px_rgba(15,23,42,0.06)]",
                            stage.tone,
                            isActive && "is-active",
                          )}
                          style={
                            {
                              animationDelay: `${index * 0.18}s`,
                              "--stage-signal": `${stageSignal}%`,
                            } as CSSProperties
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[11px] font-semibold text-[#98a2b3] transition group-hover:text-[#2563eb]">
                                {stage.label}
                              </div>
                              <div className="mt-1 text-[11px] font-medium text-[#667085]/70">
                                {stage.description}
                              </div>
                            </div>
                            <span className="login-agent-step-dot" />
                          </div>
                          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#d0d5dd]">
                            <div className="login-agent-step-line h-full rounded-full bg-[#2563eb]/70" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="login-auth-stage relative flex min-h-[700px] items-center overflow-hidden bg-transparent px-5 py-7 sm:px-8 lg:px-10 xl:px-12">
            <div className="pointer-events-none absolute -top-24 right-10 size-72 rounded-full bg-[#dbeafe]/70 blur-3xl" />
            <div className="pointer-events-none absolute right-28 -bottom-24 size-72 rounded-full bg-[#ccfbf1]/55 blur-3xl" />

            <div className="login-auth-panel relative z-[2] mx-auto w-full max-w-[560px] rounded-[38px] border border-[#e6edf6] bg-white/88 p-7 shadow-[0_30px_82px_rgba(16,24,40,0.10)] backdrop-blur-xl sm:p-8 xl:p-9">
              <div className="mb-10 flex items-center justify-between lg:hidden">
                <div className="login-brand-pill flex items-center gap-3 rounded-full">
                  <DeerFlowMark className="size-9" />
                  <span className="text-sm font-semibold tracking-[0.18em] text-[#344054] uppercase">
                    DeerFlow
                  </span>
                </div>
              </div>

              <div className="mb-9">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#dbe7f5] bg-[#f8fbff] px-3 py-1.5 text-[11px] font-semibold tracking-[0.2em] text-[#6d7f97] uppercase">
                  <span className="size-1.5 rounded-full bg-[#2563eb]" />
                  DeerFlow
                </div>
                <h1 className="text-[38px] leading-tight font-semibold tracking-[-0.045em] text-[#101828]">
                  {mode === "login" ? "继续工作。" : "创建工作区。"}
                </h1>
                <p className="mt-3 max-w-md text-[15px] leading-7 text-[#667085]">
                  {mode === "login"
                    ? "登录后恢复线程、资源和自动化。"
                    : "注册后即可开始组织项目、研究和能力。"}
                </p>
              </div>

              <div className="login-mode-switch mb-8 grid w-full grid-cols-2 rounded-[22px] bg-[#f2f5f9] p-1.5">
                {(["login", "register"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setMode(item);
                      setErrorMessage("");
                    }}
                    className={cn(
                      "rounded-full px-5 py-2 text-sm font-medium transition",
                      mode === item
                        ? "bg-white text-[#101828] shadow-[0_10px_26px_rgba(15,23,42,0.08)]"
                        : "text-[#667085] hover:text-[#344054]",
                    )}
                  >
                    {item === "login" ? "登录" : "注册"}
                  </button>
                ))}
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <Input
                  value={username}
                  onChange={(event) => handleFieldChange("username", event)}
                  onFocus={() => setFocusedField("username")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="用户名"
                  autoComplete={mode === "login" ? "username" : "nickname"}
                  className={cn(
                    "h-[64px] rounded-[22px] border-[#d0d8e4] bg-[#fbfdff] px-5 text-[16px] shadow-none transition focus-visible:border-[#2563eb] focus-visible:bg-white focus-visible:ring-[#2563eb]/20",
                    focusedField === "username" &&
                      "shadow-[0_16px_36px_rgba(37,99,235,0.10)]",
                  )}
                />

                {mode === "register" ? (
                  <Input
                    value={email}
                    onChange={(event) => handleFieldChange("email", event)}
                    onFocus={() => setFocusedField("email")}
                    onBlur={() => setFocusedField(null)}
                    type="email"
                    placeholder="邮箱"
                    autoComplete="email"
                    className={cn(
                      "h-[64px] rounded-[22px] border-[#d0d8e4] bg-[#fbfdff] px-5 text-[16px] shadow-none transition focus-visible:border-[#2563eb] focus-visible:bg-white focus-visible:ring-[#2563eb]/20",
                      focusedField === "email" &&
                        "shadow-[0_16px_36px_rgba(37,99,235,0.10)]",
                    )}
                  />
                ) : null}

                <Input
                  value={password}
                  onChange={(event) => handleFieldChange("password", event)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  type="password"
                  placeholder="密码"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  className={cn(
                    "h-[64px] rounded-[22px] border-[#d0d8e4] bg-[#fbfdff] px-5 text-[16px] shadow-none transition focus-visible:border-[#2563eb] focus-visible:bg-white focus-visible:ring-[#2563eb]/20",
                    focusedField === "password" &&
                      "shadow-[0_16px_36px_rgba(37,99,235,0.10)]",
                  )}
                />

                {mode === "register" ? (
                  <Input
                    value={confirmPassword}
                    onChange={(event) =>
                      handleFieldChange("confirmPassword", event)
                    }
                    onFocus={() => setFocusedField("confirmPassword")}
                    onBlur={() => setFocusedField(null)}
                    type="password"
                    placeholder="确认密码"
                    autoComplete="new-password"
                    className={cn(
                      "h-[64px] rounded-[22px] border-[#d0d8e4] bg-[#fbfdff] px-5 text-[16px] shadow-none transition focus-visible:border-[#2563eb] focus-visible:bg-white focus-visible:ring-[#2563eb]/20",
                      focusedField === "confirmPassword" &&
                        "shadow-[0_16px_36px_rgba(37,99,235,0.10)]",
                    )}
                  />
                ) : null}

                {errorMessage ? (
                  <div className="rounded-2xl border border-[#fecaca] bg-[#fff5f5] px-4 py-3 text-sm text-[#b42318]">
                    {errorMessage}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  disabled={loading}
                  className="h-[64px] w-full rounded-[22px] bg-[#101828] text-[16px] font-medium text-white shadow-[0_18px_42px_rgba(16,24,40,0.22)] hover:bg-[#1d2939]"
                >
                  {loading ? "处理中" : submitLabel}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setErrorMessage("");
                }}
                className="mt-6 text-sm font-medium text-[#475467] transition hover:text-[#2563eb]"
              >
                {mode === "login" ? "创建新账号" : "已有账号"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
