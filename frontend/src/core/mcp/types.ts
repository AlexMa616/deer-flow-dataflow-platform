export interface MCPServerConfig extends Record<string, unknown> {
  enabled: boolean;
  description: string;
}

export interface MCPToolInterceptorConfig extends Record<string, unknown> {
  enabled?: boolean;
  action?: "allow" | "deny" | "decorate";
  server?: string | null;
  tool: string;
  descriptionPrefix?: string | null;
  descriptionSuffix?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MCPConfig {
  mcp_servers: Record<string, MCPServerConfig>;
  tool_interceptors?: MCPToolInterceptorConfig[];
}
