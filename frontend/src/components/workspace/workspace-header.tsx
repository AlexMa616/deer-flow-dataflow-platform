"use client";

import { LogOut, MessageSquarePlus, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AlexMark } from "@/components/brand/alex-mark";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";
import { getUser, logout, type User } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state } = useSidebar();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  const userDisplayName = currentUser?.username?.trim() ?? "DeerFlow";
  const userInitials = userDisplayName.slice(0, 2).toUpperCase();
  const isSidebarOpen = state !== "collapsed";
  const compactButtonClass =
    "mx-auto justify-center rounded-xl text-slate-600 hover:bg-white/85 hover:text-sky-700 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0!";

  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-12 flex-col justify-center",
          className,
        )}
      >
        {!isSidebarOpen ? (
          <div className="flex w-full items-center justify-center">
            <div className="group-hover/workspace-header:hidden">
              <AlexMark
                compact
                label={userInitials}
                className="h-10 w-10 rounded-2xl border-white/70 bg-white/90 shadow-[0_10px_24px_rgba(14,165,233,0.16)]"
              />
            </div>
            <SidebarTrigger className="hidden size-9 rounded-xl bg-white/80 p-0 shadow-sm group-hover/workspace-header:flex" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ? (
              <Link
                href="/"
                prefetch={false}
                className="ml-2 inline-flex items-center gap-2"
              >
                <AlexMark
                  compact
                  label={userInitials}
                  className="h-8 w-8 rounded-lg"
                />
                <span className="text-primary font-serif tracking-wide">
                  {userDisplayName}
                </span>
              </Link>
            ) : (
              <div className="text-primary ml-2 inline-flex cursor-default items-center gap-2 font-serif tracking-wide">
                <AlexMark
                  compact
                  label={userInitials}
                  className="h-8 w-8 rounded-lg"
                />
                <span>{userDisplayName}</span>
              </div>
            )}
            <SidebarTrigger />
          </div>
        )}
      </div>
      <SidebarMenu
        className={cn(
          !isSidebarOpen &&
            "w-12 items-center gap-1 rounded-[1.35rem] border border-white/75 bg-white/72 p-1.5 shadow-[0_12px_26px_rgba(15,23,42,0.08)] backdrop-blur",
        )}
      >
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/chats/new"}
            asChild
            tooltip={isSidebarOpen ? undefined : t.sidebar.newChat}
            className={cn(!isSidebarOpen && compactButtonClass)}
          >
            <Link
              className="text-muted-foreground"
              href="/workspace/chats/new"
              prefetch={false}
            >
              <MessageSquarePlus size={16} />
              <span>{t.sidebar.newChat}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={isSidebarOpen ? undefined : userDisplayName}
            className={cn(
              "text-muted-foreground cursor-default",
              !isSidebarOpen && compactButtonClass,
            )}
          >
            <UserCircle size={16} />
            <span>{userDisplayName}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={isSidebarOpen ? undefined : "退出登录"}
            className={cn(
              "text-muted-foreground hover:text-destructive",
              !isSidebarOpen &&
                "mx-auto justify-center rounded-xl text-slate-600 hover:bg-rose-50 hover:text-destructive group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0!",
            )}
            onClick={logout}
          >
            <LogOut size={16} />
            <span>退出登录</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
