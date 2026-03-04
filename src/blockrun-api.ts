import type { Keypair } from "@solana/web3.js";

const BLOCKRUN_BASE_URL = "https://sol.blockrun.ai/api";

// Solana x402 constants
const SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1;
const DEFAULT_COMPUTE_UNIT_LIMIT = 8000;
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

// ============================================================================
// Types
// ============================================================================

export type BlockRunModel = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  billing_mode: "paid" | "free";
  pricing?: {
    input: number;
    output: number;
  };
};

export type BlockRunModelsResponse = {
  object: "list";
  data: BlockRunModel[];
  network: string;
  networkName: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
};

export type ChatCompletionResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  quality?: string;
};

export type ImageGenerationResponse = {
  created: number;
  data: Array<{
    url: string;
    revised_prompt?: string;
  }>;
};

type PaymentAccept = {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: {
    feePayer?: string;
    [key: string]: unknown;
  };
};

type PaymentRequired = {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: PaymentAccept[];
  error?: string;
  extensions?: Record<string, unknown>;
};

// ============================================================================
// x402 Solana payment — build a partially-signed SPL TransferChecked tx
// ============================================================================

/**
 * Parse x402 payment requirements from a 402 response.
 * Tries the PAYMENT-REQUIRED / X-Payment-Required header first,
 * then falls back to parsing the JSON response body.
 */
async function parsePaymentRequired(response: Response): Promise<PaymentRequired | null> {
  const header =
    response.headers.get("payment-required") ||
    response.headers.get("x-payment-required");

  if (header) {
    try {
      return JSON.parse(atob(header)) as PaymentRequired;
    } catch { /* fall through to body */ }
  }

  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (body.accepts || body.x402Version) {
      return body as unknown as PaymentRequired;
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Extract Solana payment details from the x402 v2 PaymentRequired.
 */
function extractSolanaPaymentDetails(pr: PaymentRequired): {
  amount: string;
  payTo: string;
  feePayer: string;
  maxTimeoutSeconds: number;
  resource: PaymentRequired["resource"];
  extensions: PaymentRequired["extensions"];
} {
  const option = pr.accepts.find((a) => a.network.startsWith("solana:"));
  if (!option) throw new Error("No Solana payment option in 402 response");

  const feePayer = option.extra?.feePayer;
  if (!feePayer) throw new Error("Missing feePayer in 402 extra field");

  return {
    amount: option.amount,
    payTo: option.payTo,
    feePayer,
    maxTimeoutSeconds: option.maxTimeoutSeconds || 300,
    resource: pr.resource,
    extensions: pr.extensions,
  };
}

/**
 * Create a partially-signed Solana SPL TransferChecked transaction
 * for x402 payment.  The CDP facilitator co-signs as feePayer and
 * submits on-chain.
 */
async function createSolanaPaymentPayload(
  keypair: Keypair,
  payTo: string,
  amount: string,
  feePayer: string,
  resource: PaymentRequired["resource"],
  extensions: PaymentRequired["extensions"],
  maxTimeoutSeconds: number,
): Promise<string> {
  const {
    Connection,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
    ComputeBudgetProgram,
  } = await import("@solana/web3.js");
  const {
    getAssociatedTokenAddress,
    createTransferCheckedInstruction,
    getMint,
  } = await import("@solana/spl-token");

  const connection = new Connection(SOLANA_RPC_URL);
  const feePayerPubkey = new PublicKey(feePayer);
  const ownerPubkey = keypair.publicKey;
  const tokenMint = new PublicKey(USDC_SOLANA);
  const payToPubkey = new PublicKey(payTo);

  // Get token decimals from mint
  const mintInfo = await getMint(connection, tokenMint);

  // Derive associated token accounts
  const sourceATA = await getAssociatedTokenAddress(tokenMint, ownerPubkey, false);
  const destinationATA = await getAssociatedTokenAddress(tokenMint, payToPubkey, false);

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Build instructions: compute budget + SPL TransferChecked
  const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: DEFAULT_COMPUTE_UNIT_LIMIT,
  });
  const setComputeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  });
  const transferIx = createTransferCheckedInstruction(
    sourceATA,
    tokenMint,
    destinationATA,
    ownerPubkey,
    BigInt(amount),
    mintInfo.decimals,
  );

  // Build v0 message — order matches @x402/svm: limit, price, transfer
  const messageV0 = new TransactionMessage({
    payerKey: feePayerPubkey,
    recentBlockhash: blockhash,
    instructions: [setComputeUnitLimitIx, setComputeUnitPriceIx, transferIx],
  }).compileToV0Message();

  // Create versioned tx and partially sign (only the transfer authority)
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([keypair]);

  // Serialize to base64
  const serializedTx = btoa(String.fromCharCode(...transaction.serialize()));

  // Build x402 v2 payment payload
  const paymentData = {
    x402Version: 2,
    resource: resource || {
      url: `${BLOCKRUN_BASE_URL}/v1/chat/completions`,
      description: "BlockRun Solana AI API call",
      mimeType: "application/json",
    },
    accepted: {
      scheme: "exact",
      network: SOLANA_NETWORK,
      amount,
      asset: USDC_SOLANA,
      payTo,
      maxTimeoutSeconds,
      extra: { feePayer },
    },
    payload: {
      transaction: serializedTx,
    },
    extensions: extensions || {},
  };

  return btoa(JSON.stringify(paymentData));
}

/**
 * Make a paid BlockRun API request using x402 protocol on Solana.
 *
 * Flow:
 *  1. Send request to BlockRun endpoint (no payment header)
 *  2. If 402 → parse payment requirements
 *  3. Build partially-signed Solana USDC TransferChecked tx
 *  4. Retry the request with PAYMENT-SIGNATURE header
 *  5. Server sends tx to CDP facilitator which co-signs + settles on-chain
 */
async function fetchBlockRunWithPayment(
  url: string,
  options: RequestInit,
  keypair: Keypair,
): Promise<Response> {
  // Step 1: Initial request
  const initialResponse = await fetch(url, options);

  if (initialResponse.status !== 402) {
    return initialResponse;
  }

  // Step 2: Parse payment requirements
  const paymentRequired = await parsePaymentRequired(initialResponse);
  if (!paymentRequired) {
    throw new Error("Received 402 but could not parse payment requirements");
  }

  const details = extractSolanaPaymentDetails(paymentRequired);

  // Step 3: Build partially-signed Solana transaction
  const paymentPayload = await createSolanaPaymentPayload(
    keypair,
    details.payTo,
    details.amount,
    details.feePayer,
    details.resource,
    details.extensions,
    details.maxTimeoutSeconds,
  );

  // Step 4: Retry with payment signature
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string>),
      "PAYMENT-SIGNATURE": paymentPayload,
    },
  });
}

// ============================================================================
// Public API functions
// ============================================================================

/**
 * List available models from BlockRun (paid via x402 Solana).
 */
export async function listModels(keypair: Keypair): Promise<BlockRunModelsResponse> {
  const response = await fetchBlockRunWithPayment(
    `${BLOCKRUN_BASE_URL}/v1/models`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
    keypair,
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list models: ${error}`);
  }

  return response.json();
}

/**
 * Chat completion via BlockRun (paid via x402 Solana).
 */
export async function chatCompletion(
  request: ChatCompletionRequest,
  keypair: Keypair,
): Promise<ChatCompletionResponse> {
  const response = await fetchBlockRunWithPayment(
    `${BLOCKRUN_BASE_URL}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    keypair,
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Chat completion failed (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Image generation via BlockRun (paid via x402 Solana).
 */
export async function generateImage(
  request: ImageGenerationRequest,
  keypair: Keypair,
): Promise<ImageGenerationResponse> {
  const response = await fetchBlockRunWithPayment(
    `${BLOCKRUN_BASE_URL}/v1/images/generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    keypair,
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Image generation failed (${response.status}): ${error}`);
  }

  return response.json();
}
