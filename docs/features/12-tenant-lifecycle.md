# Tenant ライフサイクル

tenant の作成・一時停止・再開・エクスポート・削除を管理する機能です。
enterprise 運用で必要な最小セットを、MCP tool と CLI の両方で扱えます。

## 対応ツール

- `tenant_create`
- `tenant_suspend`
- `tenant_resume`
- `tenant_export`
- `tenant_delete`
- `tenant_get`

## 保存先

- registry: `outputs/tenants/tenant-registry.json`
- export archive: `outputs/tenants/exports/<tenantId>/*.tar.gz`

## 動作

### tenant_create

- tenant の lifecycle レコードを作成します
- 既存レコードがある場合は active に戻します

### tenant_suspend / tenant_resume

- suspend は status を `suspended` に変更します
- resume は status を `active` に戻します
- deleted tenant は再開できません

### tenant_export

- tenant 情報、manifest、DB の tenant-scoped rows を tar.gz にまとめます
- `databaseUrl` がある場合は、tenant_id を持つテーブルを走査します
- 失敗したテーブルは `errors/*.txt` に記録します

### tenant_delete

- tenant_id を持つテーブルから best-effort で削除します
- registry 上は `deleted` に更新します
- export ディレクトリは削除します

## 使い方

```text
tenant_create:
  tenantId: "tenant-acme"
```

```text
tenant_export:
  tenantId: "tenant-acme"
```

```text
tenant_delete:
  tenantId: "tenant-acme"
```

## 関連

- [mcp/core/application/tenant/tenant-service.ts](../../mcp/core/application/tenant/tenant-service.ts)
- [mcp/handlers/tenant/tenant-lifecycle-tools.ts](../../mcp/handlers/tenant/tenant-lifecycle-tools.ts)
- [scripts/tenant-export.ts](../../scripts/tenant-export.ts)
