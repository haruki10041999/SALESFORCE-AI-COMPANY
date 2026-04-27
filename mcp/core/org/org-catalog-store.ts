/**
 * A1: Org カタログのファイル I/O ラッパ。
 * outputs/orgs/catalog.json を SSoT とし、純粋関数 (org-catalog.ts) を呼び出す。
 */
import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import { buildEmptyOrgCatalog, type OrgCatalog } from "./org-catalog.js";
import { FileUnitOfWork } from "../persistence/unit-of-work.js";

export async function loadOrgCatalog(filePath: string): Promise<OrgCatalog> {
  if (!existsSync(filePath)) return buildEmptyOrgCatalog();
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as OrgCatalog;
    if (!parsed || !Array.isArray(parsed.orgs)) return buildEmptyOrgCatalog();
    return parsed;
  } catch {
    return buildEmptyOrgCatalog();
  }
}

export async function saveOrgCatalog(filePath: string, catalog: OrgCatalog): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const unitOfWork = new FileUnitOfWork();
  await unitOfWork.stageFileWrite(filePath, JSON.stringify(catalog, null, 2));
  await unitOfWork.commit();
}
