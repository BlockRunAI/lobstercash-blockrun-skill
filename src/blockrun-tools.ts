import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OpenClawPluginToolContext } from "../../../src/plugins/types.js";
import { getWallet, getKeypair, isWalletConfigured } from "./wallet.js";
import {
  listModels,
  chatCompletion,
  generateImage,
  type ChatMessage,
} from "./blockrun-api.js";
import type { CrossmintPluginConfig } from "./config.js";

function getAgentId(ctx: OpenClawPluginToolContext): string {
  return ctx.agentId || "main";
}

// ============================================================================
// blockrun_models — list available AI models (paid via x402 Solana)
// ============================================================================

export function createBlockRunModelsTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "blockrun_models",
    description:
      "List available AI models on BlockRun with pricing. Includes models from OpenAI, Anthropic, Google, DeepSeek, xAI, and more. Requires a configured Solana wallet.",
    parameters: Type.Object({
      filter: Type.Optional(
        Type.String({
          description:
            "Optional filter keyword to narrow results (e.g., 'openai', 'anthropic', 'free', 'image').",
        }),
      ),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [{ type: "text", text: `No wallet found for agent "${agentId}". Run crossmint_setup first.` }],
        };
      }
      if (!isWalletConfigured(agentId)) {
        return {
          content: [{ type: "text", text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.` }],
        };
      }

      const keypair = getKeypair(agentId);
      if (!keypair) {
        return { content: [{ type: "text", text: "Failed to load wallet for signing." }] };
      }

      try {
        const filter = (params.filter as string)?.toLowerCase();
        const result = await listModels(keypair);

        let models = result.data;
        if (filter) {
          models = models.filter(
            (m) =>
              m.id.toLowerCase().includes(filter) ||
              m.owned_by.toLowerCase().includes(filter) ||
              m.billing_mode.toLowerCase().includes(filter),
          );
        }

        const lines = models.map((m) => {
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
              text: `BlockRun Models (${models.length} found):\n\n${lines.join("\n")}`,
            },
          ],
          details: {
            network: result.network,
            networkName: result.networkName,
            count: models.length,
            models: models.map((m) => ({
              id: m.id,
              owned_by: m.owned_by,
              billing_mode: m.billing_mode,
              pricing: m.pricing,
            })),
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list models: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  };
}

// ============================================================================
// blockrun_chat — chat with an AI model, paid with Solana USDC via x402
// ============================================================================

export function createBlockRunChatTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "blockrun_chat",
    description:
      "Send a message to an AI model via BlockRun and pay with USDC from your Solana wallet. Supports 40+ models including GPT-5, Claude, Gemini, DeepSeek, and more.",
    parameters: Type.Object({
      model: Type.String({
        description:
          "Model ID to use (e.g., 'openai/gpt-5.2', 'anthropic/claude-sonnet-4.6', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'). Use blockrun_models to see all options.",
      }),
      message: Type.String({
        description: "The message to send to the model.",
      }),
      systemPrompt: Type.Optional(
        Type.String({
          description: "Optional system prompt to set the model's behavior.",
        }),
      ),
      maxTokens: Type.Optional(
        Type.Number({
          description: "Maximum tokens in the response. Default: 1024",
        }),
      ),
      temperature: Type.Optional(
        Type.Number({
          description: "Sampling temperature (0-2). Lower = more focused, higher = more creative. Default: 1",
        }),
      ),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);
      const model = params.model as string;
      const message = params.message as string;
      const systemPrompt = params.systemPrompt as string | undefined;
      const maxTokens = typeof params.maxTokens === "number" ? params.maxTokens : 1024;
      const temperature = typeof params.temperature === "number" ? params.temperature : 1;

      if (!model) {
        return { content: [{ type: "text", text: "Model ID is required. Use blockrun_models to see available models." }] };
      }
      if (!message) {
        return { content: [{ type: "text", text: "Message is required." }] };
      }

      // Wallet must exist so we have a funded Solana keypair
      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [{ type: "text", text: `No wallet found for agent "${agentId}". Run crossmint_setup first.` }],
        };
      }
      if (!isWalletConfigured(agentId)) {
        return {
          content: [{ type: "text", text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.` }],
        };
      }

      const keypair = getKeypair(agentId);
      if (!keypair) {
        return { content: [{ type: "text", text: "Failed to load wallet for signing." }] };
      }

      try {
        const messages: ChatMessage[] = [];
        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
        }
        messages.push({ role: "user", content: message });

        const result = await chatCompletion(
          { model, messages, max_tokens: maxTokens, temperature },
          keypair,
        );

        const reply = result.choices?.[0]?.message?.content || "(empty response)";
        const usage = result.usage;

        return {
          content: [
            {
              type: "text",
              text: `**${result.model}** responded:\n\n${reply}${usage ? `\n\n_Tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out_` : ""}`,
            },
          ],
          details: {
            model: result.model,
            response: reply,
            finishReason: result.choices?.[0]?.finish_reason,
            usage,
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Chat failed: ${(error as Error).message}` }],
        };
      }
    },
  };
}

// ============================================================================
// blockrun_image — generate images, paid with Solana USDC via x402
// ============================================================================

export function createBlockRunImageTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "blockrun_image",
    description:
      "Generate an image using AI via BlockRun and pay with USDC from your Solana wallet. Supports DALL-E 3, GPT Image 1, and Flux 1.1 Pro.",
    parameters: Type.Object({
      prompt: Type.String({
        description: "A text description of the image to generate.",
      }),
      model: Type.Optional(
        Type.String({
          description:
            "Image model to use: 'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'.",
        }),
      ),
      size: Type.Optional(
        Type.String({
          description: "Image size: '1024x1024' (default), '1792x1024', or '1024x1792'.",
        }),
      ),
      quality: Type.Optional(
        Type.String({
          description: "Image quality: 'standard' (default) or 'hd'.",
        }),
      ),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);
      const prompt = params.prompt as string;
      const model = (params.model as string) || "openai/dall-e-3";
      const size = (params.size as string) || "1024x1024";
      const quality = (params.quality as string) || "standard";

      if (!prompt) {
        return { content: [{ type: "text", text: "Image prompt is required." }] };
      }

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [{ type: "text", text: `No wallet found for agent "${agentId}". Run crossmint_setup first.` }],
        };
      }
      if (!isWalletConfigured(agentId)) {
        return {
          content: [{ type: "text", text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.` }],
        };
      }

      const keypair = getKeypair(agentId);
      if (!keypair) {
        return { content: [{ type: "text", text: "Failed to load wallet for signing." }] };
      }

      try {
        const result = await generateImage(
          { model, prompt, size, quality, n: 1 },
          keypair,
        );

        const image = result.data?.[0];
        if (!image) {
          return { content: [{ type: "text", text: "Image generation returned no results." }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Image generated with ${model}!\n\nURL: ${image.url}${image.revised_prompt ? `\n\nRevised prompt: ${image.revised_prompt}` : ""}`,
            },
          ],
          details: {
            model,
            url: image.url,
            revisedPrompt: image.revised_prompt,
            size,
            quality,
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Image generation failed: ${(error as Error).message}` }],
        };
      }
    },
  };
}
