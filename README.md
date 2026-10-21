# EMO

**Tokens that change shape.** A Solana launch experience where a token's market-cap climb moves it up a ladder of forms.

[![Live site](https://img.shields.io/badge/live-emoonfun.ink-fdcb24?style=flat-square&labelColor=062157)](https://emoonfun.ink)

| | |
|---|---|
| Chain | Solana |
| Contract address | `pending` (announced here once it is public) |

## Overview

EMO pairs each token with a character. As the token's market cap passes set thresholds, the character moves to its next form, and a shared treasury backs the move with a purchase that stays locked. This repository holds the static website for the project, including a live board of the busiest Solana tokens.

## Features

- Live Solana market board: top ten by 24h volume, with price, change, volume, liquidity and one-click address copy
- Ticker driven by the same feed, with skeleton loading, exponential backoff and a pause while the tab is hidden
- Contract address slot at the top of the page, inert until the address is public
- Social links (X, GitHub) that stay inert until their URLs are published
- Scroll-reveal motion, hero parallax and spotlight hovers, with a full reduced-motion fallback

## Links

- Website: https://emoonfun.ink
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm run build   # writes the deployable site to dist/
npm run gates   # runs the verification gates against dist/ and mutated builds
```

Deploy by uploading the contents of `dist/`. Facts that can change (contract address, social links, thresholds) live in `src/register.json`; a record that is not stated renders inert.

## License

MIT. See [LICENSE](LICENSE).
