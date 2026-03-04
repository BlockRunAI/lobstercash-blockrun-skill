import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OpenClawPluginToolContext } from "../../../src/plugins/types.js";
import type { CrossmintPluginConfig } from "./config.js";

const BLOCKRUN_API = "https://sol.blockrun.ai/api/v1";

// ============================================================================
// blockrun_models — list available AI models
// ============================================================================

export function createBlockRunModelsTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "blockrun_models",
    description:
      "List available AI models on BlockRun with pricing. Includes models from OpenAI, Anthropic, Google, DeepSeek, xAI, and more.",
    parameters: Type.Object({
      filter: Type.Optional(
        Type.String({
          description:
            "Optional filter keyword to narrow results (e.g., 'openai', 'anthropic', 'free', 'image').",
        }),
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
              m.billing_mode?.toLowerCase().includes(filter),
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
              text: `BlockRun Models (${models.length} found):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list models: ${(error as Error).message}` }],
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
      "Send a message to an AI model via BlockRun. Supports 40+ models including GPT-5, Claude, Gemini, DeepSeek, and more. Payment is handled automatically by lobster.cash via x402.",
    parameters: Type.Object({
      model: Type.String({
        description:
          "Model ID (e.g., 'openai/gpt-5.2', 'anthropic/claude-sonnet-4.6', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'). Use blockrun_models to see all options.",
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
          description: "Sampling temperature (0-2). Default: 1",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
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

      try {
        const messages: Array<{ role: string; content: string }> = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: message });

        const res = await fetch(`${BLOCKRUN_API}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

        const result = await res.json();
        const reply = result.choices?.[0]?.message?.content || "(empty response)";
        const usage = result.usage;

        return {
          content: [
            {
              type: "text",
              text: `**${result.model}** responded:\n\n${reply}${usage ? `\n\n_Tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out_` : ""}`,
            },
          ],
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
// blockrun_image — generate images via BlockRun
// ============================================================================

export function createBlockRunImageTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "blockrun_image",
    description:
      "Generate an image using AI via BlockRun. Supports DALL-E 3, GPT Image 1, and Flux 1.1 Pro. Payment is handled automatically by lobster.cash via x402.",
    parameters: Type.Object({
      prompt: Type.String({
        description: "A text description of the image to generate.",
      }),
      model: Type.Optional(
        Type.String({
          description:
            "Image model: 'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'.",
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
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const prompt = params.prompt as string;
      const model = (params.model as string) || "openai/dall-e-3";
      const size = (params.size as string) || "1024x1024";
      const quality = (params.quality as string) || "standard";

      if (!prompt) {
        return { content: [{ type: "text", text: "Image prompt is required." }] };
      }

      try {
        const res = await fetch(`${BLOCKRUN_API}/images/generations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, size, quality, n: 1 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

        const result = await res.json();
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
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Image generation failed: ${(error as Error).message}` }],
        };
      }
    },
  };
}
