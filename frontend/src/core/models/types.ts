export interface Model {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  supports_thinking?: boolean;
  supports_plan_mode?: boolean;
  supports_subagents?: boolean;
  ultra_uses_plan_mode?: boolean;
}
