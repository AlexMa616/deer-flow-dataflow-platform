"use client";

import { LayoutDashboardIcon, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const { open: isSidebarOpen } = useSidebar();
  const pathname = usePathname();
  const vibeHref = pathname.startsWith("/workspace/vibe")
    ? pathname
    : `/workspace/vibe/new?returnTo=${encodeURIComponent(pathname)}`;
  const agentStudioLabel =
    t.locale.localName === "中文" ? "协作工作台" : "Agent Studio";
  const compactButtonClass =
    "mx-auto justify-center rounded-xl text-slate-600 hover:bg-white/85 hover:text-sky-700 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0!";

  return (
    <SidebarGroup className={cn(isSidebarOpen ? "pt-1" : "p-0")}>
      <SidebarMenu className={cn(!isSidebarOpen && "items-center gap-1")}>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/chats"}
            asChild
            tooltip={isSidebarOpen ? undefined : t.sidebar.chats}
            className={cn(!isSidebarOpen && compactButtonClass)}
          >
            <Link className="text-muted-foreground" href="/workspace/chats">
              <MessagesSquare />
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/vibe")}
            asChild
            tooltip={isSidebarOpen ? undefined : agentStudioLabel}
            className={cn(!isSidebarOpen && compactButtonClass)}
          >
            <Link className="text-muted-foreground" href={vibeHref}>
              <LayoutDashboardIcon />
              <span>{agentStudioLabel}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
