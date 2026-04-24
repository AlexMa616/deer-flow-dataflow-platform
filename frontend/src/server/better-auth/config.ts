import { betterAuth } from "better-auth";

import { env } from "@/env";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_BASE_URL ?? "http://127.0.0.1:2026",
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
});

export type Session = typeof auth.$Infer.Session;
