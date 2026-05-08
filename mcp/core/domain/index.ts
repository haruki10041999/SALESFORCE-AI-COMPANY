/**
 * Domain layer facade.
 *
 * Exposes policy and business logic modules with no top-level runtime wiring.
 */

export * as governance from "../governance/governance-manager.js";
export * as policyGate from "../governance/policy-gate.js";
export * as quality from "../quality/quality-checker.js";
export * as resourceSelector from "../resource/resource-selector.js";
export * as resourceGap from "../resource/resource-gap-detector.js";
export * as policySnapshot from "../learning/policy-snapshot.js";
export * as atRestCrypto from "../security/at-rest-crypto.js";
export * as secrets from "../security/secrets.js";
