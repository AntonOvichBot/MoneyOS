# Contributing to MoneyOS

Thanks for taking the time to contribute.

## Before you start

- Check whether there is already an issue or PR for the work.
- If the change is large, open an issue first so the direction is clear.
- Keep changes focused. Small, clean PRs are easier to review and safer to
  merge.

## Development setup

Start with the basic checks:

```bash
npm install
npm test
npm run lint
npm run typecheck
```

If your change touches workspace packages or build output, also run:

```bash
npm run build:core
npm run build:swap
npm run build
```

## Branch and PR workflow

1. Start from `main`.
2. Create a feature branch.
3. Make your change.
4. Run the relevant checks.
5. Open a pull request with a clear title and summary.

## PR expectations

Please keep pull requests readable and intentional.

- Explain what changed
- Explain why it changed
- Mention any risks or follow-up work
- Include the commands you ran to validate the change
- Do not claim manual testing you did not actually perform

## Commit hygiene

- Prefer clear commit messages over clever ones
- Do not include secrets, private endpoints, or internal-only details
- Keep public history professional and readable

## Releasing

Root releases are tagged `moneyos-v<version>` (for example,
`moneyos-v0.5.1`). Workspace package releases are tagged
`moneyos-<package>-v<version>` (for example, `moneyos-swap-v0.2.0`).
The legacy `v<version>` form is still accepted by CI for existing
historical root tags, but new releases should use `moneyos-v<version>`.

## Security

If you believe you have found a security issue, do not open a public issue.
Please follow the guidance in [SECURITY.md](SECURITY.md).

## Questions

If you are unsure whether a change belongs in a PR yet, opening an issue first
is a good default.
