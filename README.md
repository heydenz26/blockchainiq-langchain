# blockchainiq-langchain

A [LangChain](https://js.langchain.com/) tool for the
[Blockchain IQ](https://www.blockchainiq.co) pay-per-call crypto data API,
paid over the open [x402](https://www.x402.org/) standard in USDC on Base.

Blockchain IQ sells crypto market data one request at a time — no account, no
API key. An unpaid request returns HTTP 402 with the price; this tool pays
with a gasless EIP-3009 authorization (the payer needs USDC on Base, no ETH)
and returns the JSON to your agent.

## Install

```bash
npm install blockchainiq-langchain
# or, from this repository:
npm install
```

## Use it in an agent

```js
import { privateKeyToAccount } from "viem/accounts";
import { createBlockchainIQTool } from "blockchainiq-langchain";

const account = privateKeyToAccount(process.env.BLOCKCHAINIQ_PRIVATE_KEY);
const tools = [
  createBlockchainIQTool({ signer: account, maxAmountUsdc: 0.01 }),
];
// hand `tools` to any LangChain/LangGraph agent as usual
```

Any signer shaped like `{ address, signTypedData }` works — a viem
`LocalAccount` qualifies out of the box, and
[`examples/taskmarket-signer.mjs`](examples/taskmarket-signer.mjs) shows an
adapter that pays from a TaskMarket agent keystore instead of a raw key.

## The tool

`blockchainiq_data` buys one call to one of four headline resources (the API
has 42; the free catalogue at `GET https://www.blockchainiq.co/api/x402/v1`
lists them all):

| resource      | price  | contents                                                        |
| ------------- | ------ | --------------------------------------------------------------- |
| `brief`       | $0.01  | BTC/ETH/SOL/XRP prices + 24h/7d/30d moves, 48h events, flags    |
| `stablecoins` | $0.02  | USDC & EURC supply and control snapshot                         |
| `calendar`    | $0.03  | Next 90 days of macro + crypto events                           |
| `macro`       | $0.05  | US macro indicators: GDP, CPI, PCE, Fed funds, Treasury yields  |

The return value is a JSON string: `{ resource, payment, data }`, where
`payment` records the amount, the payTo address, the payer and the settlement
transaction hash read from the x402 `PAYMENT-RESPONSE` header.

## Spend safety

- `maxAmountUsdc` (default **$0.01**) is a hard per-call cap: if the server
  quotes more, the tool throws **before** signing anything.
- The tool only signs for the canonical Base USDC contract
  (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
- Use a dedicated wallet with a small balance. Errors and 404s are never
  charged by the API.

## Proof run

`examples/proof.mjs` runs the tool once against the live API and writes the
full result, including the settlement transaction hash, to
`examples/proof-output.json`:

```bash
BLOCKCHAINIQ_PRIVATE_KEY=0x... node examples/proof.mjs brief
```

## How it works

`src/x402.js` is a small, dependency-light x402 v2 "exact"-scheme client:
402 → parse `PAYMENT-REQUIRED` → sign an EIP-3009
`transferWithAuthorization` → retry with `PAYMENT-SIGNATURE` → read the
settlement from `PAYMENT-RESPONSE`. `src/index.js` wraps it as a LangChain
tool. No part of the payment flow needs an account with Blockchain IQ.

## License

MIT
