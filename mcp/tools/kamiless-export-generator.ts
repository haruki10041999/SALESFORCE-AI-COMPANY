/**
 * Kamiless Export Generator
 *
 * Transforms *.kamiless.json authoring specs into Docutize Form export JSON
 * compatible with ImportExportFormTemplateController.importJson().
 *
 * Based on: TEST_DATA_GENERATION_SPEC.md
 */

import { promises as fsPromises, existsSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { deflateSync } from "node:zlib";

// ============================================================
// Authoring Spec Types
// ============================================================

export interface AuthoringSpec {
  kamiless_spec_version: number;
  name: string;
  title?: string;
  apply_type?: string;
  public_status?: string;
  document_name?: string;
  not_accepting_new_application?: boolean | null;
  not_accepting_ref_application?: boolean | null;
  enable_preset_access_key?: boolean | null;
  sections?: SectionSpec[];
  layouts?: LayoutSpec[];
  [key: string]: unknown;
}

export interface SectionSpec {
  key?: string;
  section_number: number;
  section_label?: string;
  description?: string;
  form_layout_number: number;
  section_hide_item_on_check_page?: string;
  section_hide_item_on_input_page?: string;
  supplement?: string;
  supplement_display?: string;
  permission_type?: string;
  fields?: FieldSpec[];
  [key: string]: unknown;
}

export interface FieldSpec {
  key?: string;
  field_number: number;
  field_label?: string;
  field_name?: string;
  field_type?: string;
  object_name?: string;
  required?: boolean | null;
  editable_at_remand?: string;
  checkbox_display_type?: string;
  default_value?: string;
  do_not_overwrite?: boolean | null;
  hidden_correct_request?: boolean | null;
  hide_item_on_check_page?: string;
  hide_item_on_input_page?: string;
  hide_setting_for_item?: boolean | null;
  max_checks?: number;
  min_checks?: number;
  not_drawing?: boolean | null;
  not_drawing_border?: boolean | null;
  save_as_part_name?: boolean | null;
  not_drawing_value?: boolean | null;
  permission_type?: string;
  supplement?: string;
  supplement_display?: string;
  use_encryption_field?: string;
  target_field_size?: number;
  [key: string]: unknown;
}

export interface LayoutSpec {
  key?: string;
  layout_number: number;
  name?: string;
  image_file?: string;
  line_width?: number;
  selected_part_stroke_style?: string;
  deselected_part_stroke_style?: string;
  error_part_stroke_style?: string;
  parts?: PartSpec[];
  [key: string]: unknown;
}

export interface PartSpec {
  key?: string;
  name: string;
  label?: string;
  field_type?: string;
  required?: boolean | null;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  target_field?: string;
  display_condition_form_part?: string;
  display_order?: number;
  not_display_value?: boolean | null;
  help_text?: string;
  is_original_help?: boolean | null;
  placeholder?: string;
  input_mask?: string;
  validation_regex?: string;
  validation_error_message?: string;
  max_length?: number;
  allow_decimal?: boolean | null;
  format_name?: string;
  format_length?: Record<string, unknown>;
  default_value?: string;
  default_value_type?: string;
  formula_setting?: FormulaSetting;
  conditional_exp_setting?: ConditionalExpSetting;
  function_statement?: FunctionStatement;
  date_setting?: DateSetting;
  file_name_setting?: FileNameSettingRow[];
  file_box_setting?: FileBoxSetting;
  image_pin_name_setting?: ImagePinNameSettingRow[];
  select_options?: SelectOption[];
  select_type?: string;
  search_record_apply_type?: string;
  search_record_refer_type?: string;
  where1_search_record_form_part?: string;
  where2_search_record_form_part?: string;
  search_record_field_name?: string;
  search_result_field_name?: string;
  duplication_form_part?: string;
  parent_search_record_form_part?: string;
  value_source_form_part?: string;
  relation_form_part?: string;
  part_preset_id?: string;
  file_box_custom_setting?: Record<string, unknown>;
  file_storage?: string;
  section_break?: boolean | null;
  [key: string]: unknown;
}

// ============================================================
// Sub-Setting Types
// ============================================================

export interface FormulaSetting {
  formula: string;
  inputFormType: string;
  variants: Array<{ key: string; formPart: string }>;
  relation: Array<{ key: string; formPart: string }>;
}

export interface ConditionalExpSetting {
  conditionalExp: string;
  falseAsError: boolean;
  variants: Array<{ key: string; formPart: string; type: string; returnValueType: string }>;
  relation: Array<{ key: string; formPart: string; type: string }>;
  checkboxType: string;
}

export interface FunctionStatementValue {
  valueType: string;
  formPart: string | null;
  constant: string | null;
}

export interface FunctionStatement {
  functionType: string;
  returnValueType: string;
  settingForIf: {
    conditions: Array<{
      condition: string;
      valueWhenTrue: FunctionStatementValue;
    }>;
    valueWhenFalse: FunctionStatementValue;
  };
  settingForSwitch: {
    evaluationValue: FunctionStatementValue;
    conditions: Array<{
      condition: FunctionStatementValue;
      valueWhenMatch: FunctionStatementValue;
    }>;
    valueWhenDefault: FunctionStatementValue;
  };
  variants: Array<{ label: string; id: string }>;
  relations: Array<{ label: string; id: string }>;
}

export interface DateSettingCriterion {
  type: string;
  form_part: string | null;
  custom_date: string | null;
}

export interface DateSettingSide {
  enabled: boolean;
  criterion: DateSettingCriterion;
  num: number;
  unit: string;
  timing: string;
  closing: string;
}

export interface DateSetting {
  inputType: string;
  earliest: DateSettingSide;
  latest: DateSettingSide;
}

export interface FileNameSettingRow {
  id: string;
  type: string;
  form_part: string;
  setting: string;
}

export interface FileBoxSetting {
  folder: Array<{ id: string; type: string; form_part: string; setting: string }>;
}

export interface ImagePinNameSettingRow {
  id: string;
  form_part: string;
  pin_name: string;
}

export interface SelectOption {
  label: string;
  value: string;
}

// ============================================================
// Export JSON Types
// ============================================================

export interface ExportFormTemplate {
  export_version: string;
  version: string;
  id: string;
  name: string;
  title: string;
  apply_type: string;
  public_status: string;
  document_name: string;
  linked_record_join: boolean;
  main_category: string;
  list_button_navigation: string;
  not_accepting_new_application: boolean;
  not_accepting_ref_application: boolean;
  enable_preset_access_key: boolean;
  form_layouts: ExportFormLayout[];
  target_field_sections: ExportTargetFieldSection[];
  [key: string]: unknown;
}

export interface ExportImage {
  id: string;
  path_on_client: string;
  title: string;
  data: string;
  dpi: number;
  width: number;
  height: number;
}

export interface ExportFormLayout {
  id: string;
  name: string;
  layout_number: number;
  line_width: number;
  selected_part_stroke_style: string;
  deselected_part_stroke_style: string;
  error_part_stroke_style: string;
  package_version_at_import: string;
  image: ExportImage;      // always present (default white when not specified)
  form_parts: ExportFormPart[];
  [key: string]: unknown;
}

export interface ExportFormPart {
  id: string;
  form_layout: string;
  name: string;
  label: string;
  field_type: string;
  required: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  display_condition_form_part: string | null;
  display_order: number;
  not_display_value: boolean;
  help_text: string;
  is_original_help: boolean;
  target_field: string | null;
  placeholder: string;
  input_mask: string;
  validation_regex: string;
  validation_error_message: string;
  max_length: number;
  allow_decimal: boolean;
  format_name: string;
  format_length: string;
  default_value: string;
  default_value_type: string;
  formula_setting: string;
  conditional_exp_setting: string;
  function_statement: string;
  date_setting: string;
  file_name_setting: string;
  file_box_setting: string;
  image_pin_name_setting: string;
  select_options: SelectOption[];
  select_type: string;
  search_record_apply_type: string;
  search_record_refer_type: string;
  where1_search_record_form_part: string | null;
  where2_search_record_form_part: string | null;
  search_record_field_name: string;
  search_result_field_name: string;
  duplication_form_part: string | null;
  parent_search_record_form_part: string | null;
  value_source_form_part: string | null;
  relation_form_part: string | null;
  part_preset_id: string;
  file_box_custom_setting: Record<string, unknown>;
  file_storage: string;
  section_break: boolean;
  previous_layout_data: string;
  [key: string]: unknown;
}

export interface ExportTargetFieldSection {
  id: string;
  name: string;
  description: string;
  form_layout_number: number;
  section_hide_item_on_check_page: string;
  section_hide_item_on_input_page: string;
  section_label: string;
  section_number: number;
  supplement: string;
  supplement_display: string;
  permission_type: string;
  target_fields: ExportTargetField[];
  [key: string]: unknown;
}

export interface ExportTargetField {
  id: string;
  name: string;
  checkbox_display_type: string;
  default_value: string;
  do_not_overwrite: boolean;
  editable_at_remand: string;
  field_label: string;
  field_name: string;
  field_number: number;
  field_type: string;
  hidden_correct_request: boolean;
  hide_item_on_check_page: string;
  hide_item_on_input_page: string;
  hide_setting_for_item: boolean;
  max_checks: number;
  min_checks: number;
  not_drawing: boolean;
  not_drawing_border: boolean;
  save_as_part_name: boolean;
  not_drawing_value: boolean;
  object_name: string;
  permission_type: string;
  required: boolean;
  supplement: string;
  supplement_display: string;
  use_encryption_field: string;
  target_field_size: number;
  [key: string]: unknown;
}

// ============================================================
// ID Map
// ============================================================

export interface IdMap {
  formTemplate: string;
  formLayouts: Map<string, string>;
  formParts: Map<string, string>;
  targetFieldSections: Map<string, string>;
  targetFields: Map<string, string>;
  images: Map<string, string>;
}

// ============================================================
// ID Generator (Phase 3.3 of spec)
// ============================================================

export class IdGenerator {
  private counters = {
    formTemplate: 1,
    formLayout: 1,
    formPart: 1,
    targetFieldSection: 1,
    targetField: 1,
    contentVersion: 1
  };

  private idMap: IdMap = {
    formTemplate: "",
    formLayouts: new Map(),
    formParts: new Map(),
    targetFieldSections: new Map(),
    targetFields: new Map(),
    images: new Map()
  };

  generateFormTemplateId(): string {
    const id = `a0HIn${String(this.counters.formTemplate++).padStart(13, "0")}`;
    this.idMap.formTemplate = id;
    return id;
  }

  generateFormLayoutId(logicalKey: string): string {
    if (this.idMap.formLayouts.has(logicalKey)) {
      return this.idMap.formLayouts.get(logicalKey)!;
    }
    const id = `a0EIn${String(this.counters.formLayout++).padStart(13, "0")}`;
    this.idMap.formLayouts.set(logicalKey, id);
    return id;
  }

  generateFormPartId(logicalKey: string): string {
    if (this.idMap.formParts.has(logicalKey)) {
      return this.idMap.formParts.get(logicalKey)!;
    }
    const id = `a0FIn${String(this.counters.formPart++).padStart(13, "0")}`;
    this.idMap.formParts.set(logicalKey, id);
    return id;
  }

  generateTargetFieldSectionId(logicalKey: string): string {
    if (this.idMap.targetFieldSections.has(logicalKey)) {
      return this.idMap.targetFieldSections.get(logicalKey)!;
    }
    const id = `a0TIn${String(this.counters.targetFieldSection++).padStart(13, "0")}`;
    this.idMap.targetFieldSections.set(logicalKey, id);
    return id;
  }

  generateTargetFieldId(logicalKey: string): string {
    if (this.idMap.targetFields.has(logicalKey)) {
      return this.idMap.targetFields.get(logicalKey)!;
    }
    const id = `a0VIn${String(this.counters.targetField++).padStart(13, "0")}`;
    this.idMap.targetFields.set(logicalKey, id);
    return id;
  }

  generateContentVersionId(filePath: string): string {
    if (this.idMap.images.has(filePath)) {
      return this.idMap.images.get(filePath)!;
    }
    const id = `068In${String(this.counters.contentVersion++).padStart(13, "0")}`;
    this.idMap.images.set(filePath, id);
    return id;
  }

  getIdMap(): IdMap {
    return this.idMap;
  }
}

// ============================================================
// Boolean null guard (spec section 9.2)
// ============================================================

function nullToFalse(value: boolean | null | undefined): boolean {
  return value === true;
}

// ============================================================
// Forward-compatibility: pass through unknown fields
// ============================================================

// Keys explicitly handled in each assembly function.
// Any key NOT in these sets is treated as an "extra" field
// and passed through to the export JSON unchanged.
// When the spec gains new fields, they will appear in the
// output automatically without requiring code changes.

const KNOWN_SPEC_KEYS = new Set([
  "kamiless_spec_version", "name", "title", "apply_type", "public_status",
  "document_name", "not_accepting_new_application", "not_accepting_ref_application",
  "enable_preset_access_key", "sections", "layouts"
]);

const KNOWN_SECTION_KEYS = new Set([
  "key", "section_number", "section_label", "description", "form_layout_number",
  "section_hide_item_on_check_page", "section_hide_item_on_input_page",
  "supplement", "supplement_display", "permission_type", "fields"
]);

const KNOWN_FIELD_KEYS = new Set([
  "key", "field_number", "field_label", "field_name", "field_type", "object_name",
  "required", "editable_at_remand", "checkbox_display_type", "default_value",
  "do_not_overwrite", "hidden_correct_request", "hide_item_on_check_page",
  "hide_item_on_input_page", "hide_setting_for_item", "max_checks", "min_checks",
  "not_drawing", "not_drawing_border", "save_as_part_name", "not_drawing_value",
  "permission_type", "supplement", "supplement_display", "use_encryption_field",
  "target_field_size"
]);

const KNOWN_LAYOUT_KEYS = new Set([
  "key", "layout_number", "name", "image_file", "line_width",
  "selected_part_stroke_style", "deselected_part_stroke_style",
  "error_part_stroke_style", "parts"
]);

const KNOWN_PART_KEYS = new Set([
  "key", "name", "label", "field_type", "required", "position", "size",
  "target_field", "display_condition_form_part", "display_order",
  "not_display_value", "help_text", "is_original_help", "placeholder",
  "input_mask", "validation_regex", "validation_error_message", "max_length",
  "allow_decimal", "format_name", "format_length", "default_value",
  "default_value_type", "formula_setting", "conditional_exp_setting",
  "function_statement", "date_setting", "file_name_setting", "file_box_setting",
  "image_pin_name_setting", "select_options", "select_type",
  "search_record_apply_type", "search_record_refer_type",
  "where1_search_record_form_part", "where2_search_record_form_part",
  "search_record_field_name", "search_result_field_name",
  "duplication_form_part", "parent_search_record_form_part",
  "value_source_form_part", "relation_form_part",
  "part_preset_id", "file_box_custom_setting", "file_storage", "section_break"
]);

/**
 * Returns fields present in `obj` that are NOT in `knownKeys`.
 * Used to pass through future/unknown spec fields to the export JSON.
 */
function pickExtra(
  obj: Record<string, unknown>,
  knownKeys: Set<string>
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!knownKeys.has(k) && v !== undefined) {
      extra[k] = v;
    }
  }
  return extra;
}

// ============================================================
// Default white background image generation (A4 at 96 DPI)
// ============================================================

/** Internal key used for the auto-generated default white background image. */
const DEFAULT_IMAGE_KEY = "__default_white__";
/** A4 page width in pixels at 96 DPI (210 mm). */
const DEFAULT_IMAGE_WIDTH = 794;
/** A4 page height in pixels at 96 DPI (297 mm). */
const DEFAULT_IMAGE_HEIGHT = 1123;

// CRC-32 lookup table (IEEE 802.3 polynomial)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

/**
 * Generates a valid PNG buffer filled with white (RGB 255,255,255).
 * Uses zlib deflate (built-in Node.js) — no external dependencies.
 */
function generateWhitePng(width: number, height: number): Buffer {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Each row: 1 filter byte (None=0) + width × 3 bytes (R,G,B all=0xff)
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < height; y++) raw[y * stride] = 0; // filter byte

  const compressed = deflateSync(raw, { level: 1 });

  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/** Lazily cached default white PNG buffer. */
let _defaultWhitePngCache: Buffer | null = null;
function getDefaultWhitePng(): Buffer {
  if (!_defaultWhitePngCache) {
    _defaultWhitePngCache = generateWhitePng(DEFAULT_IMAGE_WIDTH, DEFAULT_IMAGE_HEIGHT);
  }
  return _defaultWhitePngCache;
}

// ============================================================
// Image dimension extraction — pure Node.js (no external deps)
// ============================================================

interface ImageDimensions {
  width: number;
  height: number;
}

function readUint32BE(buf: Buffer, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function readUint16BE(buf: Buffer, offset: number): number {
  return ((buf[offset] << 8) | buf[offset + 1]) >>> 0;
}

function extractImageDimensions(buffer: Buffer): ImageDimensions {
  // PNG: signature 8 bytes + IHDR chunk (4 len + 4 type + 4 width + 4 height)
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      width: readUint32BE(buffer, 16),
      height: readUint32BE(buffer, 20)
    };
  }

  // JPEG: scan for SOF0/SOF1/SOF2 markers
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 8 < buffer.length) {
      if (buffer[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buffer[i + 1];
      const segLen = readUint16BE(buffer, i + 2);
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        // SOF: ff cX [2 len] [1 precision] [2 height] [2 width]
        const height = readUint16BE(buffer, i + 5);
        const width = readUint16BE(buffer, i + 7);
        return { width, height };
      }
      i += 2 + segLen;
    }
  }

  // GIF: width at offset 6, height at offset 8 (little-endian)
  if (
    buffer.length >= 10 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46
  ) {
    return {
      width: buffer[6] | (buffer[7] << 8),
      height: buffer[8] | (buffer[9] << 8)
    };
  }

  // WebP: signature RIFF at 0, WEBP at 8, VP8/VP8L/VP8X starts at 12
  if (
    buffer.length >= 30 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    const chunkType = buffer.slice(12, 16).toString("ascii");
    if (chunkType === "VP8 " && buffer.length >= 30) {
      // VP8: width at 26 (14-bit LE), height at 28 (14-bit LE)
      const w = (buffer[26] | (buffer[27] << 8)) & 0x3fff;
      const h = (buffer[28] | (buffer[29] << 8)) & 0x3fff;
      return { width: w, height: h };
    }
    if (chunkType === "VP8L" && buffer.length >= 25) {
      // VP8L: bits 1-13 = width-1, bits 14-26 = height-1
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const bits = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >> 14) & 0x3fff) + 1;
      return { width: w, height: h };
    }
    if (chunkType === "VP8X" && buffer.length >= 30) {
      // VP8X: canvas width-1 at 24 (24-bit LE), canvas height-1 at 27
      const cw = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
      const ch = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
      return { width: cw, height: ch };
    }
  }

  return { width: 0, height: 0 };
}

// ============================================================
// Phase 2: Build ID Map (First Pass)
// ============================================================

function buildIdMap(spec: AuthoringSpec, idGen: IdGenerator, specDir: string): void {
  idGen.generateFormTemplateId();

  for (const section of spec.sections ?? []) {
    const sectionKey = section.key ?? `section-${section.section_number}`;
    idGen.generateTargetFieldSectionId(sectionKey);
    for (const field of section.fields ?? []) {
      const fieldKey = field.key ?? `field-${field.field_number}`;
      idGen.generateTargetFieldId(fieldKey);
    }
  }

  for (const layout of spec.layouts ?? []) {
    const layoutKey = layout.key ?? `layout-${layout.layout_number}`;
    idGen.generateFormLayoutId(layoutKey);
    for (const part of layout.parts ?? []) {
      const partKey = part.key ?? `part-${part.name}`;
      idGen.generateFormPartId(partKey);
    }
    if (layout.image_file) {
      const imageAbsPath = resolve(specDir, layout.image_file);
      idGen.generateContentVersionId(imageAbsPath);
    } else {
      // Register default white background (singleton key)
      idGen.generateContentVersionId(DEFAULT_IMAGE_KEY);
    }
  }
}

// ============================================================
// Reference Resolvers
// ============================================================

function resolveFormPartRef(logicalKey: string | null | undefined, idMap: IdMap): string | null {
  if (!logicalKey) return null;
  const id = idMap.formParts.get(logicalKey);
  if (!id) {
    throw new Error(
      `[Reference Resolution] FormPart not found: '${logicalKey}'. ` +
        `Available: ${[...idMap.formParts.keys()].join(", ")}`
    );
  }
  return id;
}

function resolveTargetFieldRef(logicalKey: string | null | undefined, idMap: IdMap): string | null {
  if (!logicalKey) return null;
  const id = idMap.targetFields.get(logicalKey);
  if (!id) {
    throw new Error(
      `[Reference Resolution] TargetField not found: '${logicalKey}'. ` +
        `Available: ${[...idMap.targetFields.keys()].join(", ")}`
    );
  }
  return id;
}

// ============================================================
// Sub-setting ID resolution helpers
// ============================================================

function resolveFormulaSettingIds(setting: FormulaSetting, idMap: IdMap): FormulaSetting {
  return {
    ...setting,
    variants: setting.variants.map((v) => ({
      ...v,
      formPart: resolveFormPartRef(v.formPart, idMap) ?? v.formPart
    })),
    relation: setting.relation.map((r) => ({
      ...r,
      formPart: resolveFormPartRef(r.formPart, idMap) ?? r.formPart
    }))
  };
}

function resolveConditionalExpSettingIds(
  setting: ConditionalExpSetting,
  idMap: IdMap
): ConditionalExpSetting {
  return {
    ...setting,
    variants: setting.variants.map((v) => ({
      ...v,
      formPart: resolveFormPartRef(v.formPart, idMap) ?? v.formPart
    })),
    relation: setting.relation.map((r) => ({
      ...r,
      formPart: resolveFormPartRef(r.formPart, idMap) ?? r.formPart
    }))
  };
}

function resolveValueRef(val: FunctionStatementValue, idMap: IdMap): FunctionStatementValue {
  return {
    ...val,
    formPart: val.formPart ? (resolveFormPartRef(val.formPart, idMap) ?? val.formPart) : null
  };
}

function resolveFunctionStatementIds(fs: FunctionStatement, idMap: IdMap): FunctionStatement {
  return {
    ...fs,
    settingForIf: {
      conditions: fs.settingForIf.conditions.map((c) => ({
        ...c,
        valueWhenTrue: resolveValueRef(c.valueWhenTrue, idMap)
      })),
      valueWhenFalse: resolveValueRef(fs.settingForIf.valueWhenFalse, idMap)
    },
    settingForSwitch: {
      evaluationValue: resolveValueRef(fs.settingForSwitch.evaluationValue, idMap),
      conditions: fs.settingForSwitch.conditions.map((c) => ({
        condition: resolveValueRef(c.condition, idMap),
        valueWhenMatch: resolveValueRef(c.valueWhenMatch, idMap)
      })),
      valueWhenDefault: resolveValueRef(fs.settingForSwitch.valueWhenDefault, idMap)
    },
    variants: fs.variants.map((v) => ({
      ...v,
      id: resolveFormPartRef(v.id, idMap) ?? v.id
    })),
    relations: fs.relations.map((r) => ({
      ...r,
      id: resolveFormPartRef(r.id, idMap) ?? r.id
    }))
  };
}

function resolveDateSettingIds(ds: DateSetting, idMap: IdMap): DateSetting {
  return {
    ...ds,
    earliest: {
      ...ds.earliest,
      criterion: {
        ...ds.earliest.criterion,
        form_part: ds.earliest.criterion.form_part
          ? (resolveFormPartRef(ds.earliest.criterion.form_part, idMap) ?? null)
          : null
      }
    },
    latest: {
      ...ds.latest,
      criterion: {
        ...ds.latest.criterion,
        form_part: ds.latest.criterion.form_part
          ? (resolveFormPartRef(ds.latest.criterion.form_part, idMap) ?? null)
          : null
      }
    }
  };
}

function resolveFileNameSettingIds(rows: FileNameSettingRow[], idMap: IdMap): FileNameSettingRow[] {
  return rows.map((row) => ({
    ...row,
    form_part: resolveFormPartRef(row.form_part, idMap) ?? row.form_part
  }));
}

function resolveFileBoxSettingIds(fbs: FileBoxSetting, idMap: IdMap): FileBoxSetting {
  return {
    folder: fbs.folder.map((f) => ({
      ...f,
      form_part: resolveFormPartRef(f.form_part, idMap) ?? f.form_part
    }))
  };
}

function resolveImagePinNameSettingIds(
  rows: ImagePinNameSettingRow[],
  idMap: IdMap
): ImagePinNameSettingRow[] {
  return rows.map((row) => ({
    ...row,
    form_part: resolveFormPartRef(row.form_part, idMap) ?? row.form_part
  }));
}

// ============================================================
// Phase 3: Generate TargetFieldSections
// ============================================================

function generateTargetFieldSections(
  spec: AuthoringSpec,
  idMap: IdMap
): ExportTargetFieldSection[] {
  const sections: ExportTargetFieldSection[] = [];

  for (const section of spec.sections ?? []) {
    const sectionKey = section.key ?? `section-${section.section_number}`;
    const sectionId = idMap.targetFieldSections.get(sectionKey)!;

    const targetFields: ExportTargetField[] = [];
    for (const field of section.fields ?? []) {
      const fieldKey = field.key ?? `field-${field.field_number}`;
      const fieldId = idMap.targetFields.get(fieldKey)!;

      targetFields.push({
        id: fieldId,
        name: `TF-${String(field.field_number).padStart(6, "0")}`,
        checkbox_display_type: field.checkbox_display_type ?? "none",
        default_value: field.default_value ?? "",
        do_not_overwrite: nullToFalse(field.do_not_overwrite),
        editable_at_remand: field.editable_at_remand ?? "able",
        field_label: field.field_label ?? "",
        field_name: field.field_name ?? "",
        field_number: field.field_number,
        field_type: field.field_type ?? "Text",
        hidden_correct_request: nullToFalse(field.hidden_correct_request),
        hide_item_on_check_page: field.hide_item_on_check_page ?? "none",
        hide_item_on_input_page: field.hide_item_on_input_page ?? "none",
        hide_setting_for_item: nullToFalse(field.hide_setting_for_item),
        max_checks: field.max_checks ?? 0,
        min_checks: field.min_checks ?? 0,
        not_drawing: nullToFalse(field.not_drawing),
        not_drawing_border: nullToFalse(field.not_drawing_border),
        save_as_part_name: nullToFalse(field.save_as_part_name),
        not_drawing_value: nullToFalse(field.not_drawing_value),
        object_name: field.object_name ?? "",
        permission_type: field.permission_type ?? "Standard",
        required: nullToFalse(field.required),
        supplement: field.supplement ?? "",
        supplement_display: field.supplement_display ?? "none",
        use_encryption_field: field.use_encryption_field ?? "No",
        target_field_size: field.target_field_size ?? 12,
        ...pickExtra(field as Record<string, unknown>, KNOWN_FIELD_KEYS)
      });
    }

    sections.push({
      id: sectionId,
      name: `SN-${String(section.section_number).padStart(6, "0")}`,
      description: section.description ?? "",
      form_layout_number: section.form_layout_number,
      section_hide_item_on_check_page: section.section_hide_item_on_check_page ?? "none",
      section_hide_item_on_input_page: section.section_hide_item_on_input_page ?? "none",
      section_label: section.section_label ?? "",
      section_number: section.section_number,
      supplement: section.supplement ?? "",
      supplement_display: section.supplement_display ?? "none",
      permission_type: section.permission_type ?? "Standard",
      target_fields: targetFields,
      ...pickExtra(section as Record<string, unknown>, KNOWN_SECTION_KEYS)
    });
  }

  return sections;
}

// ============================================================
// Phase 4: Image Processing
// ============================================================

async function processImage(
  imageFile: string,
  specDir: string,
  idMap: IdMap
): Promise<ExportImage> {
  const resolvedPath = resolve(specDir, imageFile);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Image file not found: ${imageFile} (resolved: ${resolvedPath})`);
  }

  const ext = extname(resolvedPath).toLowerCase();
  const supported = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
  if (!supported.includes(ext)) {
    throw new Error(
      `Unsupported image format: ${ext}. Supported: ${supported.join(", ")}`
    );
  }

  const buffer = await fsPromises.readFile(resolvedPath);
  const base64Data = buffer.toString("base64");
  const dims = extractImageDimensions(buffer);
  const contentVersionId = idMap.images.get(resolvedPath)!;

  return {
    id: contentVersionId,
    path_on_client: basename(resolvedPath),
    title: imageFile,
    data: base64Data,
    dpi: 96,
    width: dims.width,
    height: dims.height
  };
}

// ============================================================
// Auto-layout: assign positions to FormParts without explicit coordinates
// Strategy: simple top-to-bottom vertical stacking in declaration order.
// Parts with an explicit `position` in the spec use that value as-is.
// ============================================================

function computeAutoLayout(
  parts: PartSpec[]
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  let currentY = 0;

  for (const part of parts) {
    const partKey = part.key ?? `part-${part.name}`;
    if (part.position != null) {
      // Explicit position specified in spec — honor it
      result.set(partKey, { x: part.position.x, y: part.position.y });
      // Advance cursor past this part so subsequent auto-parts don't overlap
      currentY = Math.max(currentY, part.position.y + (part.size?.height ?? 1));
    } else {
      // Auto-assign: place at current cursor row, column 0
      result.set(partKey, { x: 0, y: currentY });
      currentY += part.size?.height ?? 1;
    }
  }

  return result;
}

// ============================================================
// Phase 5: Generate FormParts
// ============================================================

function generateFormParts(
  layout: LayoutSpec,
  layoutId: string,
  idMap: IdMap,
  autoPositions: Map<string, { x: number; y: number }>
): ExportFormPart[] {
  const formParts: ExportFormPart[] = [];

  for (const part of layout.parts ?? []) {
    const partKey = part.key ?? `part-${part.name}`;
    const partId = idMap.formParts.get(partKey)!;

    // Resolve direct references
    const targetFieldId = resolveTargetFieldRef(part.target_field, idMap);
    const displayCondId = resolveFormPartRef(part.display_condition_form_part, idMap);
    const where1Id = resolveFormPartRef(part.where1_search_record_form_part, idMap);
    const where2Id = resolveFormPartRef(part.where2_search_record_form_part, idMap);
    const duplicationId = resolveFormPartRef(part.duplication_form_part, idMap);
    const parentSearchId = resolveFormPartRef(part.parent_search_record_form_part, idMap);
    const valueSourceId = resolveFormPartRef(part.value_source_form_part, idMap);
    const relationId = resolveFormPartRef(part.relation_form_part, idMap);

    // Serialize sub-settings with ID resolution
    const formulaSettingSerialized = part.formula_setting
      ? JSON.stringify(resolveFormulaSettingIds(part.formula_setting, idMap))
      : "";

    const conditionalExpSerialized = part.conditional_exp_setting
      ? JSON.stringify(resolveConditionalExpSettingIds(part.conditional_exp_setting, idMap))
      : "";

    const functionStatementSerialized = part.function_statement
      ? JSON.stringify(resolveFunctionStatementIds(part.function_statement, idMap))
      : "";

    const dateSettingSerialized = part.date_setting
      ? JSON.stringify(resolveDateSettingIds(part.date_setting, idMap))
      : "";

    const fileNameSettingSerialized = part.file_name_setting
      ? JSON.stringify(resolveFileNameSettingIds(part.file_name_setting, idMap))
      : "";

    const fileBoxSettingSerialized = part.file_box_setting
      ? JSON.stringify(resolveFileBoxSettingIds(part.file_box_setting, idMap))
      : "";

    const imagePinNameSerialized = part.image_pin_name_setting
      ? JSON.stringify(resolveImagePinNameSettingIds(part.image_pin_name_setting, idMap))
      : "";

    const formatLengthSerialized = part.format_length
      ? JSON.stringify(part.format_length)
      : "";

    formParts.push({
      id: partId,
      form_layout: layoutId,
      name: part.name,
      label: part.label ?? "",
      field_type: part.field_type ?? "text",
      required: nullToFalse(part.required),
      position: autoPositions.get(partKey) ?? { x: 0, y: 0 },
      size: { width: part.size?.width ?? 6, height: part.size?.height ?? 1 },
      display_condition_form_part: displayCondId,
      display_order: part.display_order ?? 1,
      not_display_value: nullToFalse(part.not_display_value),
      help_text: part.help_text ?? "",
      is_original_help: nullToFalse(part.is_original_help),
      target_field: targetFieldId,
      placeholder: part.placeholder ?? "",
      input_mask: part.input_mask ?? "",
      validation_regex: part.validation_regex ?? "",
      validation_error_message: part.validation_error_message ?? "",
      max_length: part.max_length ?? 0,
      allow_decimal: nullToFalse(part.allow_decimal),
      format_name: part.format_name ?? "",
      format_length: formatLengthSerialized,
      default_value: part.default_value ?? "",
      default_value_type: part.default_value_type ?? "constant",
      formula_setting: formulaSettingSerialized,
      conditional_exp_setting: conditionalExpSerialized,
      function_statement: functionStatementSerialized,
      date_setting: dateSettingSerialized,
      file_name_setting: fileNameSettingSerialized,
      file_box_setting: fileBoxSettingSerialized,
      image_pin_name_setting: imagePinNameSerialized,
      select_options: part.select_options ?? [],
      select_type: part.select_type ?? "",
      search_record_apply_type: part.search_record_apply_type ?? "",
      search_record_refer_type: part.search_record_refer_type ?? "",
      where1_search_record_form_part: where1Id,
      where2_search_record_form_part: where2Id,
      search_record_field_name: part.search_record_field_name ?? "",
      search_result_field_name: part.search_result_field_name ?? "",
      duplication_form_part: duplicationId,
      parent_search_record_form_part: parentSearchId,
      value_source_form_part: valueSourceId,
      relation_form_part: relationId,
      part_preset_id: part.part_preset_id ?? "",
      file_box_custom_setting: part.file_box_custom_setting ?? {},
      file_storage: part.file_storage ?? "SalesforceFileStorage",
      section_break: nullToFalse(part.section_break),
      previous_layout_data: "",
      ...pickExtra(part as Record<string, unknown>, KNOWN_PART_KEYS)
    });
  }

  return formParts;
}

// ============================================================
// Phase 4 wrapper: Generate FormLayouts (with images)
// ============================================================

async function generateFormLayouts(
  spec: AuthoringSpec,
  idMap: IdMap,
  specDir: string
): Promise<ExportFormLayout[]> {
  const layouts: ExportFormLayout[] = [];

  for (const layout of spec.layouts ?? []) {
    const layoutKey = layout.key ?? `layout-${layout.layout_number}`;
    const layoutId = idMap.formLayouts.get(layoutKey)!;

    let image: ExportImage;
    if (layout.image_file) {
      image = await processImage(layout.image_file, specDir, idMap);
    } else {
      // Use the default white A4 background when no image_file is specified
      const buf = getDefaultWhitePng();
      image = {
        id: idMap.images.get(DEFAULT_IMAGE_KEY)!,
        path_on_client: "default_background.png",
        title: "Default White Background",
        data: buf.toString("base64"),
        dpi: 96,
        width: DEFAULT_IMAGE_WIDTH,
        height: DEFAULT_IMAGE_HEIGHT
      };
    }

    // Auto-layout: compute positions for parts that have no explicit position
    const autoPositions = computeAutoLayout(layout.parts ?? []);

    const formParts = generateFormParts(layout, layoutId, idMap, autoPositions);

    const exportLayout: ExportFormLayout = {
      id: layoutId,
      name: layout.name ?? `Page ${layout.layout_number}`,
      layout_number: layout.layout_number,
      line_width: layout.line_width ?? 2,
      selected_part_stroke_style: layout.selected_part_stroke_style ?? "#0070D2",
      deselected_part_stroke_style: layout.deselected_part_stroke_style ?? "#B0C4DE",
      error_part_stroke_style: layout.error_part_stroke_style ?? "#C23934",
      package_version_at_import: "version 0.0",
      image, // always present (default white if not specified)
      form_parts: formParts,
      ...pickExtra(layout as Record<string, unknown>, KNOWN_LAYOUT_KEYS)
    };

    layouts.push(exportLayout);
  }

  return layouts;
}

// ============================================================
// Phase 6: Assemble Root FormTemplate
// ============================================================

function assembleFormTemplate(
  spec: AuthoringSpec,
  templateId: string,
  formLayouts: ExportFormLayout[],
  targetFieldSections: ExportTargetFieldSection[]
): ExportFormTemplate {
  return {
    export_version: "version 0.0",
    version: "1.0",
    id: templateId,
    name: spec.name,
    title: spec.title ?? "",
    apply_type: spec.apply_type ?? "apply",
    public_status: spec.public_status ?? "draft",
    document_name: spec.document_name ?? "",
    linked_record_join: true,
    main_category: "not_set",
    list_button_navigation: "-,docutizeform__InputData__c,standard__objectPage",
    not_accepting_new_application: nullToFalse(spec.not_accepting_new_application),
    not_accepting_ref_application: nullToFalse(spec.not_accepting_ref_application),
    enable_preset_access_key: nullToFalse(spec.enable_preset_access_key),
    form_layouts: formLayouts,
    target_field_sections: targetFieldSections,
    ...pickExtra(spec as Record<string, unknown>, KNOWN_SPEC_KEYS)
  };
}

// ============================================================
// Pre-processing Validation (spec section 13.1)
// ============================================================

function validateSpec(spec: AuthoringSpec): void {
  if (spec.kamiless_spec_version !== 1) {
    throw new Error(`Unsupported spec version: ${spec.kamiless_spec_version} (expected: 1)`);
  }

  if (!spec.name) {
    throw new Error("Missing required field: name");
  }

  const sectionKeys = new Set<string>();
  const partKeys = new Set<string>();
  const fieldKeyMap = new Map<string, boolean>();

  for (const section of spec.sections ?? []) {
    const key = section.key ?? `section-${section.section_number}`;
    if (sectionKeys.has(key)) {
      throw new Error(`Duplicate section key: ${key}`);
    }
    sectionKeys.add(key);

    for (const field of section.fields ?? []) {
      const fieldKey = field.key ?? `field-${field.field_number}`;
      fieldKeyMap.set(fieldKey, true);
    }
  }

  for (const layout of spec.layouts ?? []) {
    for (const part of layout.parts ?? []) {
      const partKey = part.key ?? `part-${part.name}`;
      if (partKeys.has(partKey)) {
        throw new Error(`Duplicate form part key: ${partKey}`);
      }
      partKeys.add(partKey);

      if (part.target_field && !fieldKeyMap.has(part.target_field)) {
        throw new Error(
          `FormPart '${partKey}' references unknown target_field: '${part.target_field}'`
        );
      }
    }
  }
}

// ============================================================
// Main Entry Point
// ============================================================

export interface KamilessExportResult {
  formTemplate: ExportFormTemplate;
  json: string;
  idMap: {
    formTemplate: string;
    formLayouts: Record<string, string>;
    formParts: Record<string, string>;
    targetFieldSections: Record<string, string>;
    targetFields: Record<string, string>;
  };
  stats: {
    layoutCount: number;
    formPartCount: number;
    targetFieldSectionCount: number;
    targetFieldCount: number;
    imageCount: number;
  };
}

export interface GenerateKamilessSpecFromRequirementsOptions {
  requirementsText: string;
  diffText?: string;
  formName?: string;
  title?: string;
  defaultObjectName?: string;
  applyType?: string;
  publicStatus?: string;
  documentName?: string;
}

export interface GenerateKamilessSpecFromRequirementsResult {
  spec: AuthoringSpec;
  json: string;
  stats: {
    sectionCount: number;
    fieldCount: number;
    partCount: number;
    skippedLineCount: number;
    diffCandidateCount: number;
  };
  skippedLines: string[];
}

function slugifyName(input: string, fallback: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

function toApiFieldName(label: string, index: number): string {
  const ascii = label
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();

  if (!ascii) {
    return `AutoField${String(index).padStart(3, "0")}__c`;
  }

  const pascal = ascii
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return pascal || `AutoField${String(index).padStart(3, "0")}__c`;
}

function normalizeTargetFieldType(rawType: string | undefined, label: string): string {
  const source = `${rawType ?? ""} ${label}`.toLowerCase();

  if (/mail|email|e-mail|メール/.test(source)) return "Email";
  if (/phone|tel|telephone|電話/.test(source)) return "Phone";
  if (/date|日付/.test(source)) return "Date";
  if (/checkbox|チェック|同意/.test(source)) return "Checkbox";
  if (/radio|ラジオ/.test(source)) return "Radio";
  if (/picklist|select|dropdown|選択|都道府県/.test(source)) return "Picklist";
  if (/textarea|longtext|備考|コメント|問い合わせ内容/.test(source)) return "LongTextArea";
  if (/number|numeric|金額|年齢|数|件数/.test(source)) return "Number";
  return "Text";
}

function toPartFieldType(targetFieldType: string): string {
  switch (targetFieldType) {
    case "Email": return "email";
    case "Phone": return "phone";
    case "Date": return "date";
    case "Checkbox": return "checkbox";
    case "Radio": return "radio";
    case "Picklist": return "select";
    case "LongTextArea": return "textarea";
    case "Number": return "number";
    default: return "text";
  }
}

function inferPartSize(targetFieldType: string): { width: number; height: number } {
  switch (targetFieldType) {
    case "LongTextArea":
      return { width: 12, height: 3 };
    case "Checkbox":
    case "Radio":
      return { width: 6, height: 1 };
    default:
      return { width: 6, height: 1 };
  }
}

function parseOptionsToken(token: string): SelectOption[] {
  const matched = token.match(/^(?:options|選択肢)\s*[:=]\s*(.+)$/i);
  if (!matched) return [];

  return matched[1]
    .split(/[、,\/]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ label: item, value: slugifyName(item, item) }));
}

function parseRequirementFieldLine(
  rawLine: string,
  fieldIndex: number,
  defaultObjectName: string
): {
  field: FieldSpec;
  part: PartSpec;
} | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  const line = trimmed
    .replace(/^[-*・]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();

  const tableTokens = line.startsWith("|")
    ? line.split("|").map((token) => token.trim()).filter(Boolean)
    : [];

  const tokens = tableTokens.length > 0
    ? tableTokens
    : line.split("|").map((token) => token.trim()).filter(Boolean);

  if (tokens.length === 0) return null;

  const firstToken = tokens[0];
  if (/^(項目名|label|field|型|type|必須|required|オブジェクト|field_name)$/i.test(firstToken)) {
    return null;
  }

  const label = firstToken
    .replace(/[（(].*?[)）]/g, "")
    .trim();

  if (!label) return null;

  const rawType = tokens.find((token, idx) => idx > 0 && /text|email|phone|date|checkbox|radio|picklist|select|textarea|longtext|number|メール|電話|日付|選択|備考|コメント|数|金額/i.test(token));
  const fieldType = normalizeTargetFieldType(rawType, label);
  const required = /必須|required/i.test(line);
  const objectField = tokens.find((token) => /^[A-Za-z_][A-Za-z0-9_]*[.:][A-Za-z_][A-Za-z0-9_]*(?:__c)?$/.test(token));

  let objectName = defaultObjectName;
  let fieldName = toApiFieldName(label, fieldIndex);
  if (objectField) {
    const [obj, fld] = objectField.split(/[.:]/);
    objectName = obj || defaultObjectName;
    fieldName = fld || fieldName;
  }

  const options = tokens.flatMap((token) => parseOptionsToken(token));
  const fieldKey = `field-${String(fieldIndex).padStart(3, "0")}`;
  const partKey = `part-${String(fieldIndex).padStart(3, "0")}`;

  const field: FieldSpec = {
    key: fieldKey,
    field_number: fieldIndex,
    field_label: label,
    field_name: fieldName,
    field_type: fieldType,
    object_name: objectName,
    required
  };

  const part: PartSpec = {
    key: partKey,
    name: `part-${String(fieldIndex).padStart(3, "0")}`,
    label,
    field_type: toPartFieldType(fieldType),
    required,
    target_field: fieldKey,
    size: inferPartSize(fieldType)
  };

  if (options.length > 0) {
    part.select_options = options;
    if (part.field_type === "text") {
      part.field_type = "select";
    }
  }

  return { field, part };
}

type DiffFieldCandidate = {
  label?: string;
  fieldType?: string;
  objectName?: string;
  fieldName?: string;
  required?: boolean;
  options?: string[];
};

function toRequirementLineFromCandidate(candidate: DiffFieldCandidate): string | null {
  if (!candidate.label) return null;

  const parts = [candidate.label];
  if (candidate.fieldType) {
    parts.push(candidate.fieldType);
  }
  if (candidate.objectName && candidate.fieldName) {
    parts.push(`${candidate.objectName}.${candidate.fieldName}`);
  }
  if (candidate.required) {
    parts.push("必須");
  }
  if (candidate.options && candidate.options.length > 0) {
    parts.push(`options=${candidate.options.join(",")}`);
  }
  return `- ${parts.join(" | ")}`;
}

function flushDiffCandidate(
  current: DiffFieldCandidate,
  output: string[]
): DiffFieldCandidate {
  const line = toRequirementLineFromCandidate(current);
  if (line) {
    output.push(line);
  }
  return {};
}

function extractRequirementLinesFromDiff(diffText: string): string[] {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let current: DiffFieldCandidate = {};

  for (const rawLine of lines) {
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) {
      if (current.label) {
        current = flushDiffCandidate(current, output);
      }
      continue;
    }

    const line = rawLine.slice(1).trim();
    if (!line || /^@@|^diff |^index |^---/.test(line)) {
      if (current.label) {
        current = flushDiffCandidate(current, output);
      }
      continue;
    }

    if (/^[-*・]|^\d+[.)]\s|^\|/.test(line)) {
      output.push(line);
      continue;
    }

    if (/^\{\s*$/.test(line)) {
      if (current.label) {
        current = flushDiffCandidate(current, output);
      }
      continue;
    }

    if (/^\},?\s*$/.test(line)) {
      if (current.label) {
        current = flushDiffCandidate(current, output);
      }
      continue;
    }

    let matched = line.match(/^(?:field_label|label)\s*[:=]\s*["'`](.+?)["'`],?$/);
    if (matched) {
      if (current.label) {
        current = flushDiffCandidate(current, output);
      }
      current.label = matched[1].trim();
      continue;
    }

    matched = line.match(/^"(?:field_label|label)"\s*:\s*"(.+?)",?$/);
    if (matched) {
      if (current.label) {
        current = flushDiffCandidate(current, output);
      }
      current.label = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:field_type|type)\s*[:=]\s*["'`](.+?)["'`],?$/);
    if (matched) {
      current.fieldType = matched[1].trim();
      continue;
    }

    matched = line.match(/^"(?:field_type|type)"\s*:\s*"(.+?)",?$/);
    if (matched) {
      current.fieldType = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:object_name)\s*[:=]\s*["'`](.+?)["'`],?$/);
    if (matched) {
      current.objectName = matched[1].trim();
      continue;
    }

    matched = line.match(/^"(?:object_name)"\s*:\s*"(.+?)",?$/);
    if (matched) {
      current.objectName = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:field_name)\s*[:=]\s*["'`](.+?)["'`],?$/);
    if (matched) {
      current.fieldName = matched[1].trim();
      continue;
    }

    matched = line.match(/^"(?:field_name)"\s*:\s*"(.+?)",?$/);
    if (matched) {
      current.fieldName = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:required)\s*[:=]\s*(true|false),?$/i);
    if (matched) {
      current.required = matched[1].toLowerCase() === "true";
      continue;
    }

    matched = line.match(/^"required"\s*:\s*(true|false),?$/i);
    if (matched) {
      current.required = matched[1].toLowerCase() === "true";
      continue;
    }

    matched = line.match(/^(?:select_options|options|選択肢)\s*[:=]\s*\[(.+)\],?$/i);
    if (matched) {
      current.options = matched[1]
        .split(/[、,]/)
        .map((token) => token.replace(/["'`{}\[\]]/g, "").trim())
        .filter(Boolean);
      continue;
    }

    matched = line.match(/^"(?:select_options|options)"\s*:\s*\[(.+)\],?$/i);
    if (matched) {
      current.options = matched[1]
        .split(/[、,]/)
        .map((token) => token.replace(/["'`{}\[\]]/g, "").trim())
        .filter(Boolean);
      continue;
    }

    matched = line.match(/([A-Za-z_][A-Za-z0-9_]*)(?:\.|__r\.)?([A-Za-z_][A-Za-z0-9_]*(?:__c)?)/);
    if (!current.label && matched && /field|label|name/i.test(line) === false) {
      // ignore generic code identifiers when no label is present
      continue;
    }
  }

  if (current.label) {
    flushDiffCandidate(current, output);
  }

  return [...new Set(output)];
}

export function generateKamilessSpecFromRequirements(
  options: GenerateKamilessSpecFromRequirementsOptions
): GenerateKamilessSpecFromRequirementsResult {
  let defaultObjectName = options.defaultObjectName ?? "TestObject__c";
  const lines = options.requirementsText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  const diffLines = options.diffText ? extractRequirementLinesFromDiff(options.diffText) : [];
  const sourceLines = [...lines, ...diffLines];

  let formName = options.formName;
  let title = options.title;
  let applyType = options.applyType ?? "apply";
  let publicStatus = options.publicStatus ?? "draft";
  let documentName = options.documentName;
  let currentSectionLabel = "基本情報";

  const sectionBuckets: Array<{ label: string; fields: FieldSpec[]; parts: PartSpec[] }> = [];
  const skippedLines: string[] = [];
  let globalFieldIndex = 1;

  const ensureSection = (label: string): { label: string; fields: FieldSpec[]; parts: PartSpec[] } => {
    let section = sectionBuckets.find((item) => item.label === label);
    if (!section) {
      section = { label, fields: [], parts: [] };
      sectionBuckets.push(section);
    }
    return section;
  };

  const appendFieldNamesLine = (value: string): void => {
    const section = ensureSection(currentSectionLabel);
    for (const name of value.split(/[、,]/).map((item) => item.trim()).filter(Boolean)) {
      const parsed = parseRequirementFieldLine(name, globalFieldIndex++, defaultObjectName);
      if (parsed) {
        section.fields.push(parsed.field);
        section.parts.push(parsed.part);
      }
    }
  };

  for (const rawLine of sourceLines) {
    const line = rawLine.trim();
    if (!line) continue;

    let matched = line.match(/^(?:フォーム名|form\s*name|name)\s*[:：]\s*(.+)$/i);
    if (matched) {
      formName = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:タイトル|title)\s*[:：]\s*(.+)$/i);
    if (matched) {
      title = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:適用種別|apply[_ -]?type)\s*[:：]\s*(apply|refer|both)$/i);
    if (matched) {
      applyType = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:公開状態|public[_ -]?status)\s*[:：]\s*(draft|public|closed)$/i);
    if (matched) {
      publicStatus = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:文書名|document[_ -]?name)\s*[:：]\s*(.+)$/i);
    if (matched) {
      documentName = matched[1].trim();
      continue;
    }

    matched = line.match(/^(?:オブジェクト名|object[_ -]?name)\s*[:：]\s*(.+)$/i);
    if (matched) {
      defaultObjectName = matched[1].trim() || defaultObjectName;
      continue;
    }

    matched = line.match(/^(?:セクション|section)\s*[:：]\s*(.+)$/i);
    if (matched) {
      currentSectionLabel = matched[1].trim() || currentSectionLabel;
      ensureSection(currentSectionLabel);
      continue;
    }

    matched = line.match(/^##+\s+(.+)$/);
    if (matched) {
      currentSectionLabel = matched[1].trim() || currentSectionLabel;
      ensureSection(currentSectionLabel);
      continue;
    }

    matched = line.match(/^(?:項目|入力項目|fields?)\s*[:：]\s*(.+)$/i);
    if (matched) {
      appendFieldNamesLine(matched[1]);
      continue;
    }

    if (/^(?:[-*・]|\d+[.)]\s|\|)/.test(line)) {
      const section = ensureSection(currentSectionLabel);
      const parsed = parseRequirementFieldLine(line, globalFieldIndex++, defaultObjectName);
      if (parsed) {
        section.fields.push(parsed.field);
        section.parts.push(parsed.part);
      } else {
        skippedLines.push(line);
      }
      continue;
    }

    skippedLines.push(line);
  }

  if (sectionBuckets.length === 0 || sectionBuckets.every((section) => section.fields.length === 0)) {
    throw new Error("requirements から入力項目を抽出できませんでした。箇条書きまたは『項目: 氏名, メールアドレス』形式で指定してください。");
  }

  const normalizedFormName = slugifyName(formName ?? title ?? "generated-form", "generated-form");
  const normalizedTitle = title ?? formName ?? "自動生成フォーム";
  const normalizedDocumentName = documentName ?? `${normalizedFormName}_document`;

  const sections: SectionSpec[] = [];
  const parts: PartSpec[] = [];

  let sectionNumber = 1;
  for (const bucket of sectionBuckets) {
    if (bucket.fields.length === 0) continue;
    sections.push({
      key: `section-${String(sectionNumber).padStart(3, "0")}`,
      section_number: sectionNumber,
      section_label: bucket.label,
      form_layout_number: 1,
      fields: bucket.fields
    });
    parts.push(...bucket.parts);
    sectionNumber += 1;
  }

  const spec: AuthoringSpec = {
    kamiless_spec_version: 1,
    name: normalizedFormName,
    title: normalizedTitle,
    apply_type: applyType,
    public_status: publicStatus,
    document_name: normalizedDocumentName,
    sections,
    layouts: [
      {
        key: "layout-001",
        layout_number: 1,
        name: "Page 1",
        parts
      }
    ]
  };

  validateSpec(spec);

  return {
    spec,
    json: JSON.stringify(spec, null, 2),
    stats: {
      sectionCount: sections.length,
      fieldCount: sections.reduce((sum, section) => sum + (section.fields?.length ?? 0), 0),
      partCount: parts.length,
      skippedLineCount: skippedLines.length,
      diffCandidateCount: diffLines.length
    },
    skippedLines
  };
}

export async function generateKamilessExport(
  specPath: string
): Promise<KamilessExportResult> {
  const resolvedSpecPath = resolve(specPath);

  if (!existsSync(resolvedSpecPath)) {
    throw new Error(`Spec file not found: ${resolvedSpecPath}`);
  }

  const specDir = dirname(resolvedSpecPath);
  const raw = await fsPromises.readFile(resolvedSpecPath, "utf-8");
  let spec: AuthoringSpec;
  try {
    spec = JSON.parse(raw) as AuthoringSpec;
  } catch (e) {
    throw new Error(`Failed to parse spec JSON: ${(e as Error).message}`);
  }

  // Phase 1: Validate
  validateSpec(spec);

  // Phase 2: Build ID Map (First Pass)
  const idGen = new IdGenerator();
  buildIdMap(spec, idGen, specDir);
  const idMap = idGen.getIdMap();

  // Phase 3: TargetFieldSections
  const targetFieldSections = generateTargetFieldSections(spec, idMap);

  // Phase 4 + 5: FormLayouts + FormParts
  const formLayouts = await generateFormLayouts(spec, idMap, specDir);

  // Phase 6: Assemble root
  const formTemplate = assembleFormTemplate(
    spec,
    idMap.formTemplate,
    formLayouts,
    targetFieldSections
  );

  // Phase 7: Serialize
  const json = JSON.stringify(formTemplate, null, 2);

  const formPartCount = formLayouts.reduce((sum, l) => sum + l.form_parts.length, 0);
  const targetFieldCount = targetFieldSections.reduce((sum, s) => sum + s.target_fields.length, 0);

  return {
    formTemplate,
    json,
    idMap: {
      formTemplate: idMap.formTemplate,
      formLayouts: Object.fromEntries(idMap.formLayouts),
      formParts: Object.fromEntries(idMap.formParts),
      targetFieldSections: Object.fromEntries(idMap.targetFieldSections),
      targetFields: Object.fromEntries(idMap.targetFields)
    },
    stats: {
      layoutCount: formLayouts.length,
      formPartCount,
      targetFieldSectionCount: targetFieldSections.length,
      targetFieldCount,
      imageCount: idMap.images.size
    }
  };
}
