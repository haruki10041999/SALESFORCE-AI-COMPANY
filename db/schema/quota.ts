import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const tenantQuotaWindowsTable = pgTable(
  "tenant_tool_quota_windows",
  {
    tenantId: text("tenant_id").notNull(),
    toolName: text("tool_name").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.toolName, t.windowStart], name: "pk_tenant_tool_quota_windows" }),
    tenantToolIdx: index("idx_tenant_tool_quota_windows_tenant_tool").on(t.tenantId, t.toolName),
    updatedAtIdx: index("idx_tenant_tool_quota_windows_updated_at").on(t.updatedAt)
  })
);
