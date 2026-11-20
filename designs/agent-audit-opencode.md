# OpenCode integration audit

Scope: `f94e081`, and the existing ACP launcher and permission broker. No `opencode` executable is installed on PATH; `opencode --help`, execution, and whether a particular user's policy requests permission are **unverifiable here**. Installed HTTP client: `@opencode/client@2.2.5`.

| Item | What we use | Source | Verdict |
| --- | --- | --- | --- |
| CLI launch | `opencode acp`; model discovery's existing `opencode models` fallback | [official ACP docs](https://opencode.ai/docs/acp/); [CLI reference](https://opencode.ai/docs/cli/) | confirmed in docs, not local help |
| ACP lifecycle | `initialize` with `protocolVersion: 1`, `session/new` and advertised `session/load` with `cwd`/`mcpServers`, `session/prompt`, notification `session/cancel`, `session/update` | [official v1 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/1a52ecae06fed2fbfc7d9acf2b3cf121b5ff6288/schema/v1/schema.json); [OpenCode handler dispatch](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/cli/src/acp/agent.ts) | confirmed against schemas/source |
| Permissions RPC | `session/request_permission`, options `optionId/name/kind`, response `{outcome:{outcome:selected,optionId}}` or `{outcome:{outcome:cancelled}}` | [ACP permissions](https://agentclientprotocol.com/protocol/v1/tool-calls); [OpenCode conversion](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/cli/src/acp/permission.ts#L44-L79) | confirmed; once/always are opaque vendor IDs, not translated by Ormicode |
| Configuration override | Removed `OPENCODE_CONFIG_CONTENT` injection and singular `permission: {"*":"ask"}` | [current V2 config](https://opencode.ai/docs/config/); [permissions rules](https://opencode.ai/docs/permissions/); [upstream V2 environment compatibility issue](https://github.com/anomalyco/opencode/issues/36990) | **fixed**: the injected configuration was V1-only, and cannot support the previous V2 forced-ask claim |
| V2 configuration | Operator-managed `permissions` array containing `action`, `resource`, `effect: ask/allow/deny`; no invented programmatic replacement | same official config/permissions pages | confirmed syntax; automatic forced asking is **unverifiable/not implemented** |
| Environment | Standard Node child-process environment inheritance; no permission config inserted by Ormicode | `packages/agent-opencode-acp/src/connection.ts`; [Node spawn options](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options) | confirmed host behavior, not a vendor permission guarantee |

The broker existed before `f94e081`. Fixtures verify actual JSON-RPC selected-option round trips, denial, allowance, invalid options, and cancellation. They do **not** prove that a real vendor will emit a permission request under existing allow rules. V2 `permissions` must be configured to ask where cards are required; Ormicode does not rewrite a user's project/global files or promise to override managed vendor policies.

## Follow-up: asking before writes and shell commands

**Decision: use the explicit UI-warning fallback, not another automatic forced-ask claim.** A documented operator-managed configuration exists, but no documented isolated, Ormicode-session override was verified for the pinned V2 ACP launcher. This is not a claim that OpenCode cannot be configured to ask.

The [permissions guide](https://opencode.ai/docs/permissions/) documents this configuration in an operator's `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "edit", "resource": "*", "effect": "ask" },
    { "action": "shell", "resource": "*", "effect": "ask" }
  ]
}
```

`edit` covers `edit`, `write`, and `patch`; V2 shell commands use `shell`, not the V1 `bash` action. The [config guide](https://opencode.ai/docs/config/) documents project/global/system discovery and precedence. These files are not scoped to one Ormicode session. Rewriting them would affect other OpenCode sessions, and appending broad `ask` rules could replace configured denies. We leave them untouched.

To try to disprove the need for a warning, we checked both the documented file mechanism and ACP mode/config selection, rather than assuming environment variables were the only possible control:

| Candidate / causal link | Evidence at pinned OpenCode commit `4390284d4db936bce35ddb1edd510bc405cf7e0c` | Conclusion |
| --- | --- | --- |
| Isolated CLI configuration env/flag | [CLI environment surface](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/cli/src/env.ts#L1-L24), [command definitions](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/cli/src/commands/commands.ts), current config docs above | No documented `OPENCODE_CONFIG` path or permission-policy flag verified on this V2 ACP launch path. Do not substitute the embedding core's programmatic configuration-content option for a supported CLI environment variable. |
| ACP-advertised configuration | [config options and exhaustive resolver](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/cli/src/acp/config-option.ts#L22-L100), [service dispatch](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/cli/src/acp/service.ts#L244-L254) | Options select model, effort, or an advertised agent mode; no ask-before-writes permission option. Selecting a mode is not an independent permission-policy override. |
| Project-file `ask` rules always produce a card | Permissions guide: agent/global precedence, configured rules, and saved project approvals. [Actual evaluation order](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/core/src/permission.ts#L176-L231) | Disproved as an unconditional guarantee: saved allow rules are appended after configured rules (configured denies are checked first); agent policies also matter. A project edit alone cannot guarantee asking in every existing session/policy. |
| An allowed operation emits a request anyway | [Permission assertion](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/core/src/permission.ts#L284-L310) | An `allow` returns without waiting; only `ask` creates a pending request. Ormicode cannot deny an operation it never receives. |
| ACP request/denial bridge | [OpenCode permission conversion/reply](https://github.com/anomalyco/opencode/blob/4390284d4db936bce35ddb1edd510bc405cf7e0c/packages/cli/src/acp/permission.ts#L39-L79), [ACP permission specification](https://agentclientprotocol.com/protocol/v1/tool-calls) | Keep forwarding selected opaque option IDs and cancelled outcomes. The existing broker resolves actual requests; do not invent a force-ask RPC. |

The agent picker now warns before choosing OpenCode ACP, and its session header persistently says **“OpenCode may write without approval.”** The full notice explains that OpenCode runs with its own permission policy and that Deny blocks only a request it sends. Other vendors/transports and unloaded session details do not get this ACP-specific warning.

Fixtures render both picker layouts and the session header, and cover absent/mismatched session details. The ACP child fixture now performs a real local file write only after Allow; Deny and cancellation leave the file unchanged. This proves the Ormicode decision round trip and fixture's gating, **not** real vendor policy loading or tool execution. No local OpenCode CLI or authenticated run is available, so those remain unverified. No user policy files or worker environment overrides were added.
