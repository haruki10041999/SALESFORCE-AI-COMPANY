/**
 * Custom tool definition
 */
export interface CustomToolDefinition {
  name: string;
  description: string;
  agents: string[];
  skills?: string[];
  tags?: string[];
  persona?: string;
  createdAt: string;
}

/**
 * Resource operation log entry
 */
export interface ResourceOperation {
  type: "create" | "delete";
  resourceType: "skills" | "tools" | "presets";
  name: string;
  timestamp: string;
}
