// LangChain tool for the Blockchain IQ pay-per-call crypto data API.
//
// Blockchain IQ (https://www.blockchainiq.co) sells crypto market data one
// request at a time over the x402 standard: no account, no API key. An unpaid
// request returns HTTP 402 with a price; the tool pays in USDC on Base with a
// gasless EIP-3009 authorization and returns the JSON.
//
// Usage with any LangChain agent:
//
//   import { privateKeyToAccount } from "viem/accounts";
//   import { createBlockchainIQTool } from "blockchainiq-langchain";
//
//   const account = privateKeyToAccount(process.env.BLOCKCHAINIQ_PRIVATE_KEY);
//   const tools = [createBlockchainIQTool({ signer: account })];
//
// Any signer shaped like { address, signTypedData } works (a viem
// LocalAccount qualifies out of the box). Set `maxAmountUsdc` to cap what a
// single call may spend; the default cap is $0.01, the price of the market
// brief, and the tool refuses to sign anything above the cap.

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchWithX402 } from "./x402.js";

export { fetchWithX402 } from "./x402.js";

export const BLOCKCHAINIQ_BASE_URL = "https://www.blockchainiq.co/api/x402/v1";

// A few headline resources from the free catalogue
// (GET https://www.blockchainiq.co/api/x402/v1 lists all 42 with prices).
export const BLOCKCHAINIQ_RESOURCES = {
  brief: { path: "/brief", priceUsdc: 0.01, blurb: "BTC/ETH/SOL/XRP prices + 48h event risk + flags" },
  stablecoins: { path: "/stablecoins", priceUsdc: 0.02, blurb: "USDC & EURC supply and control snapshot" },
  calendar: { path: "/calendar", priceUsdc: 0.03, blurb: "Next 90 days of macro + crypto events" },
  macro: { path: "/macro", priceUsdc: 0.05, blurb: "US macro indicators (GDP, CPI, Fed funds, yields)" },
};

/**
 * Create a LangChain tool that buys Blockchain IQ data via x402.
 *
 * @param {object} opts
 * @param {{address: string, signTypedData: Function}} opts.signer payer wallet
 * @param {number} [opts.maxAmountUsdc=0.01] per-call spend cap in USDC
 */
export function createBlockchainIQTool({ signer, maxAmountUsdc = 0.01 } = {}) {
  const maxAmountRaw = BigInt(Math.round(maxAmountUsdc * 1_000_000));
  return tool(
    async ({ resource }) => {
      const entry = BLOCKCHAINIQ_RESOURCES[resource] ?? BLOCKCHAINIQ_RESOURCES.brief;
      const { data, payment } = await fetchWithX402(BLOCKCHAINIQ_BASE_URL + entry.path, {
        signer,
        maxAmountRaw,
      });
      return JSON.stringify({ resource, payment, data });
    },
    {
      name: "blockchainiq_data",
      description:
        "Buy one call of crypto market data from Blockchain IQ, paid per call in USDC on Base " +
        "via x402 (no API key). Resources: 'brief' ($0.01: BTC/ETH/SOL/XRP prices, 24h/7d/30d " +
        "moves, events in the next 48h, risk flags), 'stablecoins' ($0.02), 'calendar' ($0.03), " +
        "'macro' ($0.05). Calls above the configured spend cap are refused before signing.",
      schema: z.object({
        resource: z
          .enum(["brief", "stablecoins", "calendar", "macro"])
          .default("brief")
          .describe("Which Blockchain IQ resource to buy. Default 'brief' ($0.01)."),
      }),
    }
  );
}
