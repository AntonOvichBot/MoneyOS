# Contributing to MoneyOS

Thanks for taking the time to contribute.

## Before you start

- Check whether there is already an issue or PR for the work.
- If the change is large, open an issue first so the direction is clear.
- Keep changes focused. Small, clean PRs are easier to review and safer to
  merge.

## Development setup

```bash
npm install
npm run build:core
npm run build:tool-swap
npm run build:executor-particle
npm run typecheck
npm test
npm run lint
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

## Commit hygiene

- Prefer clear commit messages over clever ones
- Do not include secrets, private endpoints, or internal-only details
- Keep public history professional and readable

## Security

If you believe you have found a security issue, do not open a public issue.
Please follow the guidance in [SECURITY.md](SECURITY.md).

## Questions

If you are unsure whether a change belongs in a PR yet, opening an issue first
is a good default.
