package sfai.tool_access

# Documentation-oriented Rego source for security/audit review.
# Runtime evaluation currently uses config/policies/tool_access.json.

default allow := true

deny[reason] {
  input.tool == "apply_resource_actions"
  input.actor.role != "admin"
  reason := "apply_resource_actions requires admin role"
}
