import { cookies } from "next/headers";

import { AUTH_HINT_COOKIE_KEY } from "@/lib/auth";

import { WorkspaceLayoutClient } from "./workspace-layout-client";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const initialAuthed = cookieStore.get(AUTH_HINT_COOKIE_KEY)?.value === "1";

  return (
    <WorkspaceLayoutClient initialAuthed={initialAuthed}>
      {children}
    </WorkspaceLayoutClient>
  );
}
