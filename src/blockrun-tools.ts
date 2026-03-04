import { Type } from "@sinclair/typebox";

const BLOCKRUN_API = "https://sol.blockrun.ai/api/v1";

export function createBlockRunModelsTool() {
  return {
    name: "blockrun_models",
    description: "List available AI models on BlockRun with pricing.",
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Filter by keyword (e.g., 'openai', 'free', 'image')" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const res = await fetch(`${BLOCKRUN_API}/models`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const filter = (params.filter as string)?.toLowerCase();
        let models = result.data ?? [];
        if (filter) {
          models = models.filter((m: any) =>
            m.id.toLowerCase().includes(filter) ||
            m.owned_by?.toLowerCase().includes(filter) ||
            m.billing_mode?.toLowerCase().includes(filter),
          );
        }
        const lines = models.map((m: any) => {
          const price = m.billing_mode === "free" ? "FREE" : m.pricing ? `$${m.pricing.input}/M in · $${m.pricing.output}/M out` : "paid";
          return `${m.id}  (${price})`;
        });
        return { content: [{ type: "text", text: `BlockRun Models (${models.length}):\n\n${lines.join("\n")}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Failed: ${(e as Error).message}` }] };
      }
    },
  };
}

export function createBlockRunChatTool() {
  return {
    name: "blockrun_chat",
    description: "Chat with an AI model via BlockRun. Supports GPT-5, Claude, Gemini, DeepSeek, and 40+ more.",
    parameters: Type.Object({
      model: Type.String({ description: "Model ID (e.g., 'openai/gpt-5.2', 'deepseek/deepseek-chat')" }),
      message: Type.String({ description: "The message to send" }),
      systemPrompt: Type.Optional(Type.String({ description: "System prompt" })),
      maxTokens: Type.Optional(Type.Number({ description: "Max response tokens (default: 1024)" })),
      temperature: Type.Optional(Type.Number({ description: "Temperature 0-2 (default: 1)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const model = params.model as string;
      const message = params.message as string;
      if (!model || !message) return { content: [{ type: "text", text: "model and message are required." }] };
      try {
        const messages: any[] = [];
        if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
        messages.push({ role: "user", content: message });
        const res = await fetch(`${BLOCKRUN_API}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, max_tokens: (params.maxTokens as number) || 1024, temperature: (params.temperature as number) ?? 1 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const reply = result.choices?.[0]?.message?.content || "(empty)";
        const usage = result.usage;
        return { content: [{ type: "text", text: `**${result.model}**:\n\n${reply}${usage ? `\n\n_${usage.prompt_tokens} in / ${usage.completion_tokens} out_` : ""}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Chat failed: ${(e as Error).message}` }] };
      }
    },
  };
}

export function createBlockRunImageTool() {
  return {
    name: "blockrun_image",
    description: "Generate an image via BlockRun. Supports DALL-E 3, GPT Image 1, and Flux 1.1 Pro.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Image description" }),
      model: Type.Optional(Type.String({ description: "'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'" })),
      size: Type.Optional(Type.String({ description: "'1024x1024' (default), '1792x1024', or '1024x1792'" })),
      quality: Type.Optional(Type.String({ description: "'standard' (default) or 'hd'" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const prompt = params.prompt as string;
      if (!prompt) return { content: [{ type: "text", text: "prompt is required." }] };
      const model = (params.model as string) || "openai/dall-e-3";
      try {
        const res = await fetch(`${BLOCKRUN_API}/images/generations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, size: (params.size as string) || "1024x1024", quality: (params.quality as string) || "standard", n: 1 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const img = result.data?.[0];
        if (!img) return { content: [{ type: "text", text: "No image returned." }] };
        return { content: [{ type: "text", text: `Image generated with ${model}!\n\nURL: ${img.url}${img.revised_prompt ? `\n\nRevised prompt: ${img.revised_prompt}` : ""}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Image generation failed: ${(e as Error).message}` }] };
      }
    },
  };
}
