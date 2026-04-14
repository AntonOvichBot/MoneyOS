# MoneyOS Relay (Path C skeleton)

This directory anchors the v1 relay architecture and policy boundary.

Current scope in wave 1:
- `src/policy/moneyos-native-policy.ts`: deterministic sponsorship policy checks
- `config/policy.arbitrum.json`: config-driven allowlists and policy limits
  - `odosRouters` and `odosSwapSelectors` are intentionally empty in send-first scope until swap-provider routes are explicitly allowlisted
- `src/http/routes/intents.ts`: execute-route decision flow over nonce/simulation/caps gates
- `src/http/routes/capabilities.ts`: capability report shape

Not yet shipped here:
- persistence adapters
- simulation adapter implementation
- transaction submission adapter
- operational controls plumbing
