"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";

import { AuthGuard } from "@/components/auth-guard";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { useLocalSettings } from "@/core/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 0,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

export function WorkspaceLayoutClient({
  children,
  initialAuthed,
}: Readonly<{
  children: React.ReactNode;
  initialAuthed: boolean;
}>) {
  const pathname = usePathname();
  const [settings, setSettings] = useLocalSettings();
  const [open, setOpen] = useState(() => !settings.layout.sidebar_collapsed);
  const isImmersiveVibeRoute = pathname.startsWith("/workspace/vibe");

  useEffect(() => {
    setOpen(!settings.layout.sidebar_collapsed);
  }, [settings.layout.sidebar_collapsed]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      setSettings("layout", { sidebar_collapsed: !nextOpen });
    },
    [setSettings],
  );

  return (
    <AuthGuard initialAuthed={initialAuthed}>
      <QueryClientProvider client={queryClient}>
        {isImmersiveVibeRoute ? (
          <SidebarProvider
            className="relative h-screen overflow-hidden bg-[#edf2f8] text-slate-900"
            defaultOpen={false}
          >
            {children}
          </SidebarProvider>
        ) : (
          <SidebarProvider
            className="relative h-screen overflow-hidden bg-[#f6f9ff] text-slate-900"
            open={open}
            onOpenChange={handleOpenChange}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_8%_8%,rgba(34,211,238,0.22),transparent_42%),radial-gradient(circle_at_84%_4%,rgba(129,140,248,0.2),transparent_40%),radial-gradient(circle_at_50%_100%,rgba(56,189,248,0.14),transparent_48%),linear-gradient(180deg,#f8fbff,#eef4ff_55%,#f8fbff)]" />
              <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:64px_64px] opacity-45" />
              <div className="absolute -top-28 right-12 h-72 w-72 rounded-full bg-cyan-300/35 blur-3xl" />
              <div className="absolute -bottom-32 left-10 h-80 w-80 rounded-full bg-indigo-300/30 blur-3xl" />
            </div>
            <WorkspaceSidebar className="relative z-10" />
            <SidebarInset className="relative z-10 min-h-0 min-w-0 overflow-hidden">
              {children}
            </SidebarInset>
          </SidebarProvider>
        )}
        <Toaster position="top-center" />
      </QueryClientProvider>
    </AuthGuard>
  );
}
