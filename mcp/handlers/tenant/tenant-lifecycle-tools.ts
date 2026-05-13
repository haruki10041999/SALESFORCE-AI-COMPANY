import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  createTenant,
  deleteTenant,
  exportTenant,
  loadTenantLifecycle,
  resumeTenant,
  suspendTenant
} from "../../core/application/tenant/tenant-service.js";

export interface RegisterTenantLifecycleToolsDeps extends RegisterGovToolDeps {
  root: string;
}

export function registerTenantLifecycleTools(deps: RegisterTenantLifecycleToolsDeps): void {
  const { govTool, root } = deps;

  govTool(
    "tenant_create",
    {
      title: "Tenant 作成",
      description: "Tenant の lifecycle レコードを作成または active に戻します。",
      inputSchema: {
        tenantId: z.string().min(1).max(128)
      }
    },
    async ({ tenantId }: { tenantId: string }) => {
      const tenant = await createTenant(root, tenantId);
      return { content: [{ type: "text", text: JSON.stringify({ tenant }, null, 2) }] };
    }
  );

  govTool(
    "tenant_suspend",
    {
      title: "Tenant 一時停止",
      description: "Tenant を suspended 状態へ移行します。",
      inputSchema: {
        tenantId: z.string().min(1).max(128)
      }
    },
    async ({ tenantId }: { tenantId: string }) => {
      const tenant = await suspendTenant(root, tenantId);
      return { content: [{ type: "text", text: JSON.stringify({ tenant }, null, 2) }] };
    }
  );

  govTool(
    "tenant_resume",
    {
      title: "Tenant 再開",
      description: "Tenant を active 状態へ復帰します。",
      inputSchema: {
        tenantId: z.string().min(1).max(128)
      }
    },
    async ({ tenantId }: { tenantId: string }) => {
      const tenant = await resumeTenant(root, tenantId);
      return { content: [{ type: "text", text: JSON.stringify({ tenant }, null, 2) }] };
    }
  );

  govTool(
    "tenant_export",
    {
      title: "Tenant エクスポート",
      description: "Tenant の audit log / sessions / memory を tar.gz へ書き出します。",
      inputSchema: {
        tenantId: z.string().min(1).max(128)
      }
    },
    async ({ tenantId }: { tenantId: string }) => {
      const snapshot = await exportTenant(root, tenantId);
      return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
    }
  );

  govTool(
    "tenant_delete",
    {
      title: "Tenant 削除",
      description: "Tenant の DB 行を best-effort に削除し、状態を deleted に更新します。",
      inputSchema: {
        tenantId: z.string().min(1).max(128)
      }
    },
    async ({ tenantId }: { tenantId: string }) => {
      const result = await deleteTenant(root, tenantId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  govTool(
    "tenant_get",
    {
      title: "Tenant 参照",
      description: "Tenant lifecycle レコードを取得します。",
      inputSchema: {
        tenantId: z.string().min(1).max(128)
      }
    },
    async ({ tenantId }: { tenantId: string }) => {
      const tenant = await loadTenantLifecycle(root, tenantId);
      return { content: [{ type: "text", text: JSON.stringify({ tenant }, null, 2) }] };
    }
  );
}
