// Optional signer adapter: pay from a TaskMarket agent keystore instead of a
// raw private key. TaskMarket wallets keep the key encrypted behind a key
// server; the official @lucid-agents/taskmarket package exposes
// loadKeystore() + signTypedData(), which is all the x402 client needs.
//
// Point TASKMARKET_CHUNK at the package's dist chunk that exports those two
// functions, e.g.:
//   TASKMARKET_CHUNK=/path/to/node_modules/@lucid-agents/taskmarket/dist/chunk-XXXX.js
//
// This adapter was used to produce the proof run in proof-output.json.

export async function taskmarketSigner() {
  const chunk = process.env.TASKMARKET_CHUNK;
  if (!chunk) {
    throw new Error(
      "TASKMARKET_CHUNK is not set: point it at the @lucid-agents/taskmarket dist chunk exporting loadKeystore/signTypedData"
    );
  }
  const mod = await import(chunk);
  const keystore = await mod.loadKeystore();
  return {
    address: keystore.walletAddress,
    signTypedData: (typedData) => mod.signTypedData(typedData, keystore),
  };
}
