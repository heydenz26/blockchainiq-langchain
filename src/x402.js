// Minimal x402 (v2, "exact" scheme) payment client for EVM chains.
//
// Flow: GET a paid resource -> HTTP 402 with a PAYMENT-REQUIRED header ->
// sign an EIP-3009 `transferWithAuthorization` for the quoted USDC amount ->
// retry the GET with a PAYMENT-SIGNATURE header -> HTTP 200 + JSON data and a
// PAYMENT-RESPONSE header carrying the settlement proof (transaction hash).
//
// The payer never sends a transaction and needs no ETH: the signature is a
// gasless EIP-3009 authorization that the seller's facilitator settles.
//
// The signer is pluggable: anything with { address, signTypedData } works
// (a viem LocalAccount already has exactly that shape).

import { randomBytes } from "node:crypto";

export const BASE_CHAIN_ID = 8453;
export const BASE_NETWORK = "eip155:8453";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

function decodeHeaderJson(res, name) {
  const raw = res.headers.get(name);
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Fetch a Blockchain IQ resource, paying via x402 if the server asks.
 *
 * @param {string} url absolute resource URL
 * @param {object} opts
 * @param {{address: string, signTypedData: Function}} opts.signer
 * @param {bigint} [opts.maxAmountRaw] hard cap in USDC base units (default 10000n = $0.01);
 *        the call aborts before signing if the server quotes more.
 * @returns {Promise<{data: any, payment: null | {amountRaw: string, asset: string,
 *          payTo: string, network: string, payer: string, transaction: string|null,
 *          success: boolean|null}}>}
 */
export async function fetchWithX402(url, { signer, maxAmountRaw = 10000n } = {}) {
  if (!signer?.address || typeof signer.signTypedData !== "function") {
    throw new Error("fetchWithX402: a signer { address, signTypedData } is required");
  }

  const first = await fetch(url, { headers: { accept: "application/json" } });
  if (first.status === 200) {
    return { data: await first.json(), payment: null };
  }
  if (first.status !== 402) {
    throw new Error(`fetchWithX402: unexpected HTTP ${first.status} from ${url}`);
  }

  const required = decodeHeaderJson(first, "payment-required");
  if (!required || !Array.isArray(required.accepts)) {
    throw new Error("fetchWithX402: 402 response carried no parseable PAYMENT-REQUIRED header");
  }
  const accept = required.accepts.find(
    (a) => a.scheme === "exact" && a.network === BASE_NETWORK
  );
  if (!accept) {
    throw new Error(`fetchWithX402: no exact-scheme offer on ${BASE_NETWORK}`);
  }

  const amount = BigInt(accept.amount);
  if (amount > maxAmountRaw) {
    throw new Error(
      `fetchWithX402: quoted amount ${amount} exceeds cap ${maxAmountRaw}; refusing to sign`
    );
  }
  if (accept.asset.toLowerCase() !== BASE_USDC.toLowerCase()) {
    throw new Error(`fetchWithX402: unexpected asset ${accept.asset}; refusing to sign`);
  }

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: signer.address,
    to: accept.payTo,
    value: amount,
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + Math.min(accept.maxTimeoutSeconds ?? 300, 300) - 10),
    nonce: "0x" + randomBytes(32).toString("hex"),
  };

  const signature = await signer.signTypedData({
    domain: {
      name: accept.extra?.name ?? "USD Coin",
      version: accept.extra?.version ?? "2",
      chainId: BASE_CHAIN_ID,
      verifyingContract: accept.asset,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  const payload = {
    x402Version: required.x402Version ?? 2,
    // x402 v2: echo the accepted payment requirements so the server can
    // match this payload to one of its offers.
    accepted: accept,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
  };

  const paid = await fetch(url, {
    headers: {
      accept: "application/json",
      "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64"),
    },
  });
  if (paid.status !== 200) {
    const body = await paid.text().catch(() => "");
    throw new Error(`fetchWithX402: paid retry failed with HTTP ${paid.status}: ${body.slice(0, 300)}`);
  }

  const settlement = decodeHeaderJson(paid, "payment-response");
  return {
    data: await paid.json(),
    payment: {
      amountRaw: accept.amount,
      asset: accept.asset,
      payTo: accept.payTo,
      network: BASE_NETWORK,
      payer: signer.address,
      transaction: settlement?.transaction ?? null,
      success: settlement?.success ?? null,
    },
  };
}
