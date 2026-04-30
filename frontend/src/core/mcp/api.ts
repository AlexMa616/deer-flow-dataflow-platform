import { requestJSON } from "@/core/api";
import { getBackendBaseURL } from "@/core/config";

import type { MCPConfig } from "./types";

export async function loadMCPConfig() {
  return requestJSON<MCPConfig>(`${getBackendBaseURL()}/api/mcp/config`);
}

export async function updateMCPConfig(config: MCPConfig) {
  return requestJSON<MCPConfig>(
    `${getBackendBaseURL()}/api/mcp/config`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    },
  );
}
