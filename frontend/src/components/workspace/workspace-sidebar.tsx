"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { RecentChatList } from "./recent-chat-list";
import { SystemPulse } from "./system-pulse";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNavChatList } from "./workspace-nav-chat-list";
import { WorkspaceNavMenu } from "./workspace-nav-menu";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { open: isSidebarOpen } = useSidebar();
  const panelClass =
    "shrink-0 rounded-2xl border border-sky-200/75 bg-white/80 p-1 shadow-[0_10px_22px_rgba(15,23,42,0.06)] backdrop-blur";
  const railSectionClass =
    "mx-auto w-12 rounded-[1.35rem] border border-white/75 bg-white/72 p-1.5 shadow-[0_12px_26px_rgba(15,23,42,0.08)] backdrop-blur";

  return (
    <>
      <Sidebar variant="sidebar" collapsible="icon" {...props}>
        <div className="relative flex h-full flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,#eef9ff_0%,#f8fbff_44%,#eef1ff_100%)]" />
            <div className="absolute inset-y-0 right-0 w-px bg-sky-200/80" />
          </div>
          <div className="relative z-10 flex h-full flex-col">
            <SidebarHeader
              className={cn(isSidebarOpen ? "px-2 py-2" : "px-2 pb-2 pt-4")}
            >
              <div
                className={cn(
                  isSidebarOpen
                    ? "rounded-2xl border border-sky-200/75 bg-white/80 p-2 shadow-[0_14px_34px_rgba(15,23,42,0.08)] backdrop-blur"
                    : "flex flex-col items-center gap-3",
                )}
              >
                <WorkspaceHeader />
              </div>
            </SidebarHeader>
            <SidebarContent
              className={cn(
                isSidebarOpen
                  ? "gap-3 overflow-x-hidden overflow-y-auto px-2 pb-3 [&>*]:shrink-0"
                  : "items-center gap-4 overflow-hidden px-2 py-1",
              )}
            >
              {isSidebarOpen && <SystemPulse className="mb-0.5 shrink-0" />}
              <div
                className={cn(isSidebarOpen ? panelClass : railSectionClass)}
              >
                <WorkspaceNavChatList />
              </div>
              {isSidebarOpen && (
                <div className={panelClass}>
                  <RecentChatList />
                </div>
              )}
            </SidebarContent>
            <SidebarFooter
              className={cn(isSidebarOpen ? "px-2 pb-3" : "mt-auto px-2 pb-4")}
            >
              <div
                className={cn(isSidebarOpen ? panelClass : railSectionClass)}
              >
                <WorkspaceNavMenu />
              </div>
            </SidebarFooter>
          </div>
        </div>
        <SidebarRail className="z-20" />
      </Sidebar>
    </>
  );
}
