// End-to-end proof: run the LangChain tool once against the live Blockchain IQ
// API and print the data plus the x402 settlement proof (transaction hash).
//
// Signer options (pick one):
//   BLOCKCHAINIQ_PRIVATE_KEY=0x...   a dedicated wallet holding a little USDC on Base
//   TASKMARKET_CHUNK=/path/to/chunk-XXXX.js   pay from a TaskMarket keystore
//
// The spend cap defaults to $0.01 (the price of the market brief). Raise it
// with MAX_AMOUNT_USDC only if you also want the pricier resources.
//
// Usage: node examples/proof.mjs [resource]

import { writeFile } from "node:fs/promises";
import { createBlockchainIQTool } from "../src/index.js";

async function resolveSigner() {
  if (process.env.BLOCKCHAINIQ_PRIVATE_KEY) {
    const { privateKeyToAccount } = await import("viem/accounts");
    return privateKeyToAccount(process.env.BLOCKCHAINIQ_PRIVATE_KEY);
  }
  const { taskmarketSigner } = await import("./taskmarket-signer.mjs");
  return taskmarketSigner();
}

const resource = process.argv[2] ?? "brief";
const maxAmountUsdc = Number(process.env.MAX_AMOUNT_USDC ?? "0.01");

const signer = await resolveSigner();
console.log("payer:", signer.address);
console.log("resource:", resource, "| per-call cap: $" + maxAmountUsdc.toFixed(2));

const bqTool = createBlockchainIQTool({ signer, maxAmountUsdc });
const raw = await bqTool.invoke({ resource });
const result = JSON.parse(raw);

console.log("\n--- settlement ---");
console.log(JSON.stringify(result.payment, null, 2));
console.log("\n--- data (first 800 chars) ---");
console.log(JSON.stringify(result.data).slice(0, 800));

await writeFile(new URL("./proof-output.json", import.meta.url), JSON.stringify(result, null, 2));
console.log("\nfull result written to examples/proof-output.json");
