# Validator Bonds SDK

SDK based on top of the Anchor Program IDL. Anchor IDL wrapper.

- To read account data see ./api.ts
- To import types and read PDA addresses see ./sdk.ts
- To execute contract operations see ./instructions/\*

The SDK imports `@coral-xyz/anchor`, but Anchor 1.x is published as `@anchor-lang/core`.
Install the peer under the old name with an npm alias:

```json
"@coral-xyz/anchor": "npm:@anchor-lang/core@^1.2.1"
```
