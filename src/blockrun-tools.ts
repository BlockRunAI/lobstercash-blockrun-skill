import { Type } from "@sinclair/typebox";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import {
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  Connection,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";

const BLOCKRUN_API =
  "https://blockrun-sol-staging-demo-1092497648280.us-central1.run.app/api/v1";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ATA_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const COMPUTE_BUDGET_PROGRAM = new PublicKey(
  "ComputeBudget111111111111111111111111111111"
);
const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

// USDC on Solana mainnet
const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const USDC_DECIMALS = 6;

function getAgentId(ctx: OpenClawPluginToolContext): string {
  return ctx.agentId || "main";
}

function getAgentKeypair(): Keypair {
  const fs = require("fs");
  const path = require("path");
  const walletsPath = path.join(
    process.env.HOME || "/home/azureuser",
    ".openclaw/lobster-cash/wallets.json"
  );
  const data = JSON.parse(fs.readFileSync(walletsPath, "utf-8"));
  const wallet = data.wallets?.main;
  if (!wallet?.secretKey) {
    throw new Error("No agent keypair found. Run lobster_setup first.");
  }
  return Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
}

function findATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  );
  return ata;
}

// ── Solana instruction builders ─────────────────────────────

/** Build SPL TransferChecked instruction data: [12, amount_u64_le, decimals_u8] */
function buildTransferCheckedData(amount: bigint, decimals: number): Buffer {
  const data = Buffer.alloc(1 + 8 + 1);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return data;
}

/** Build ComputeBudget SetComputeUnitLimit instruction: [2, units_u32_le] */
function buildSetComputeUnitLimit(units: number): TransactionInstruction {
  const data = Buffer.alloc(5);
  data.writeUInt8(2, 0);
  data.writeUInt32LE(units, 1);
  return new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM,
    keys: [],
    data,
  });
}

/** Build ComputeBudget SetComputeUnitPrice instruction: [3, microLamports_u64_le] */
function buildSetComputeUnitPrice(
  microLamports: number
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt(microLamports), 1);
  return new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM,
    keys: [],
    data,
  });
}

/** Build Memo instruction with random nonce */
function buildMemoInstruction(): TransactionInstruction {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const memoText = Array.from(nonce)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [],
    data: Buffer.from(memoText, "utf-8"),
  });
}

// ── x402 types ──────────────────────────────────────────────

interface X402PaymentOption {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
  extra?: { feePayer?: string; [key: string]: unknown };
}

interface X402PaymentRequired {
  x402Version: number;
  accepts: X402PaymentOption[];
}

// ── x402 partially-signed transaction ───────────────────────

/**
 * Build a partially-signed x402 SPL TransferChecked transaction.
 * feePayer = facilitator (from x402 extra.feePayer)
 * Signed by agent keypair as token authority only.
 * Returns the base64-encoded X-PAYMENT header value.
 */
async function buildX402Payment(
  option: X402PaymentOption,
  x402Version: number
): Promise<string> {
  const keypair = getAgentKeypair();
  const connection = new Connection(SOLANA_RPC);

  const feePayer = option.extra?.feePayer;
  if (!feePayer) {
    throw new Error("feePayer missing in x402 payment requirements");
  }

  const feePayerPubkey = new PublicKey(feePayer);
  const payTo = new PublicKey(option.payTo);
  const amount = BigInt(option.amount);

  // Derive ATAs
  const sourceATA = findATA(keypair.publicKey, USDC_MINT);
  const destATA = findATA(payTo, USDC_MINT);

  // Build instructions
  const computeUnitLimit = buildSetComputeUnitLimit(20000);
  const computeUnitPrice = buildSetComputeUnitPrice(1);

  const transferIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: sourceATA, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: destATA, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
    ],
    data: buildTransferCheckedData(amount, USDC_DECIMALS),
  });

  const memoIx = buildMemoInstruction();

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Build v0 transaction message
  const messageV0 = new TransactionMessage({
    payerKey: feePayerPubkey,
    recentBlockhash: blockhash,
    instructions: [computeUnitPrice, computeUnitLimit, transferIx, memoIx],
  }).compileToV0Message();

  // Create versioned transaction and partially sign (agent signs as token authority)
  const tx = new VersionedTransaction(messageV0);
  tx.sign([keypair]);

  // Serialize to base64
  const serialized = tx.serialize();
  const base64Tx = Buffer.from(serialized).toString("base64");

  // Build x402 payment header. The decoded header IS the paymentPayload
  // sent to the facilitator, so scheme/network must be top-level.
  const headerPayload = {
    x402Version,
    scheme: option.scheme,
    network: option.network,
    accepted: option,
    payload: {
      transaction: base64Tx,
    },
  };

  return btoa(JSON.stringify(headerPayload));
}

/**
 * Fetch with x402 payment handling.
 * On 402: build partially-signed tx, retry with X-PAYMENT header.
 */
async function fetchWithX402(
  url: string,
  init: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 402) return res;

  const body = await res.text();
  const paymentRequired: X402PaymentRequired = JSON.parse(body);
  const option = paymentRequired.accepts?.[0];
  if (!option) throw new Error("No payment options in 402 response");

  const paymentHeader = await buildX402Payment(
    option,
    paymentRequired.x402Version || 2
  );

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("X-PAYMENT", paymentHeader);
  return fetch(url, { ...init, headers: retryHeaders });
}

// ── BlockRun tool factories ─────────────────────────────────

export function createBlockRunModelsTool() {
  return {
    name: "blockrun_models",
    description: "List available AI models on BlockRun with pricing.",
    parameters: Type.Object({
      filter: Type.Optional(
        Type.String({
          description:
            "Filter by keyword (e.g., 'openai', 'free', 'image')",
        })
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const res = await fetch(`${BLOCKRUN_API}/models`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const filter = (params.filter as string)?.toLowerCase();
        let models = result.data ?? [];
        if (filter) {
          models = models.filter(
            (m: any) =>
              m.id.toLowerCase().includes(filter) ||
              m.owned_by?.toLowerCase().includes(filter) ||
              m.billing_mode?.toLowerCase().includes(filter)
          );
        }
        const lines = models.map((m: any) => {
          const price =
            m.billing_mode === "free"
              ? "FREE"
              : m.pricing
                ? `$${m.pricing.input}/M in · $${m.pricing.output}/M out`
                : "paid";
          return `${m.id}  (${price})`;
        });
        return {
          content: [
            {
              type: "text",
              text: `BlockRun Models (${models.length}):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            { type: "text", text: `Failed: ${(e as Error).message}` },
          ],
        };
      }
    },
  };
}

export function createBlockRunChatTool() {
  return {
    name: "blockrun_chat",
    description:
      "Chat with an AI model via BlockRun. Supports GPT-5, Claude, Gemini, DeepSeek, and 40+ more. Paid with USDC via x402.",
    parameters: Type.Object({
      model: Type.String({
        description:
          "Model ID (e.g., 'openai/gpt-5.2', 'deepseek/deepseek-chat')",
      }),
      message: Type.String({ description: "The message to send" }),
      systemPrompt: Type.Optional(
        Type.String({ description: "System prompt" })
      ),
      maxTokens: Type.Optional(
        Type.Number({ description: "Max response tokens (default: 1024)" })
      ),
      temperature: Type.Optional(
        Type.Number({ description: "Temperature 0-2 (default: 1)" })
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const model = params.model as string;
      const message = params.message as string;
      if (!model || !message)
        return {
          content: [{ type: "text", text: "model and message are required." }],
        };
      try {
        const messages: any[] = [];
        if (params.systemPrompt)
          messages.push({ role: "system", content: params.systemPrompt });
        messages.push({ role: "user", content: message });

        const res = await fetchWithX402(
          `${BLOCKRUN_API}/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages,
              max_tokens: (params.maxTokens as number) || 1024,
              temperature: (params.temperature as number) ?? 1,
            }),
          }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const reply = result.choices?.[0]?.message?.content || "(empty)";
        const usage = result.usage;
        return {
          content: [
            {
              type: "text",
              text: `**${result.model}**:\n\n${reply}${usage ? `\n\n_${usage.prompt_tokens} in / ${usage.completion_tokens} out_` : ""}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            { type: "text", text: `Chat failed: ${(e as Error).message}` },
          ],
        };
      }
    },
  };
}

export function createBlockRunImageTool() {
  return {
    name: "blockrun_image",
    description:
      "Generate an image via BlockRun. Supports DALL-E 3, GPT Image 1, and Flux 1.1 Pro. Paid with USDC via x402.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Image description" }),
      model: Type.Optional(
        Type.String({
          description:
            "'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'",
        })
      ),
      size: Type.Optional(
        Type.String({
          description:
            "'1024x1024' (default), '1792x1024', or '1024x1792'",
        })
      ),
      quality: Type.Optional(
        Type.String({ description: "'standard' (default) or 'hd'" })
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const prompt = params.prompt as string;
      if (!prompt)
        return {
          content: [{ type: "text", text: "prompt is required." }],
        };
      const model = (params.model as string) || "openai/dall-e-3";
      try {
        const res = await fetchWithX402(
          `${BLOCKRUN_API}/images/generations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              prompt,
              size: (params.size as string) || "1024x1024",
              quality: (params.quality as string) || "standard",
              n: 1,
            }),
          }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const img = result.data?.[0];
        if (!img)
          return {
            content: [{ type: "text", text: "No image returned." }],
          };
        return {
          content: [
            {
              type: "text",
              text: `Image generated with ${model}!\n\nURL: ${img.url}${img.revised_prompt ? `\n\nRevised prompt: ${img.revised_prompt}` : ""}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Image generation failed: ${(e as Error).message}`,
            },
          ],
        };
      }
    },
  };
}
