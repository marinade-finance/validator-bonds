# Eval Questions: marinade-ecosystem Skill

## Factual Recall

### Program IDs & Tokens

1. What is the Validator Bonds program ID?
2. What is the mSOL mint address?
3. What is the Liquid Staking program ID?
4. What is the MNDE token address?
5. Where should I verify program addresses before using them?

### Public Links & Sites

6. What is the URL for the Marinade developer docs?
7. Where can I find the PSR Dashboard?
8. What is the Bonds API docs URL?
9. How do I get SAM scoring data for a specific epoch?
10. Where is the GCS bucket for epoch data?
11. Where can I find the Discord PSR feed channel?
12. What npm package contains the validator-bonds CLI?

### Repo Navigation

13. Which repo implements the core mSOL staking program?
14. Which repo is the SAM evaluation CLI and SDK in?
15. Where is the validator scoring API and stake allocation logic?
16. Which repo generates the SAM blacklist?
17. Where does the institutional staking product live?
18. Which repo is the PSR Dashboard frontend?
19. What repo would I look at to understand how SAM auction results flow into delegation?

### Packages & SDKs

20. Which package provides the `configGetter` pattern?
21. What is `@marinade.finance/cli-common` used for?
22. Which SDK would I use to integrate liquid staking (deposit, unstake) from TypeScript?
23. What is `ds-sam-sdk` for?
24. Which package is `web3js-kit` and when would I use it over `web3js-1x`?

## Issue Filing

25. How do I file a bug against the validator bonds repo?
26. How can a validator subscribe to bond event notifications?
27. Where do validators go for community support about PSR/bond questions?

## Pattern Knowledge

28. How does the `configGetter` pattern work — show an example with `RPC_URL` (required) and `PORT` (default 3000)?
29. What database library does Marinade use and what's the key rule for queries?
30. All TS repos use pnpm workspaces — what command targets a specific package?
31. When should a new service use Bun vs Node.js?

## Cross-Repo Navigation (Scenario)

32. I need to debug why a validator isn't getting SAM stake — which repos and tools should I look at?
33. I want to build a TS integration that deposits SOL for mSOL — what SDK and package do I start with?
34. A user reports that their bond was charged for a PSR event they didn't expect — where do I find the PSR event data and which repos handle that flow?
35. I want to add a new endpoint to the Bonds API — which repo and what language/framework is it in?
36. The SAM auction config changed and I want to see the history — where do I look?
37. A validator wants to know their current bid price and expected stake allocation — what public tool or API do they use?
