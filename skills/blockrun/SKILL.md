---
name: blockrun
description: Use when the user wants to access AI models, generate images, or use intelligent language models via BlockRun. Activate on AI chat, image generation, model listing, or BlockRun mentions.
metadata: { "openclaw": { "emoji": "🤖" } }
---

# BlockRun AI

Access <!-- br:models.chatVisible -->76<!-- /br:models.chatVisible --> AI models and image generation via [BlockRun](https://sol.blockrun.ai). No API keys needed — payment is handled automatically by lobster.cash via x402.

> This skill delegates wallet operations and payment execution to lobster.cash.

## When to Activate

Use this skill when the user:

- Wants to chat with an AI model (GPT, Claude, Gemini, DeepSeek, etc.)
- Wants to generate images (DALL-E 3, GPT Image 1, Flux)
- Asks about available AI models or pricing
- Mentions BlockRun or pay-per-request AI

## Tools Overview

| Tool | Purpose |
|------|---------|
| `blockrun_models` | List available models and pricing |
| `blockrun_chat` | Chat with any AI model |
| `blockrun_image` | Generate images with AI |

## Prerequisites

The lobster.cash wallet must be set up and funded with USDC before using paid BlockRun tools. The lobster.cash plugin handles wallet setup automatically — BlockRun tools just call the API.

## Common Operations

### List available models

```
User: "What AI models are available?"
Agent: Use blockrun_models
```

```
User: "Show me OpenAI models"
Agent: Use blockrun_models with filter="openai"
```

### Chat with a model

```
User: "Ask GPT-5 what the capital of France is"
Agent: Use blockrun_chat with model="openai/gpt-5.2", message="What is the capital of France?"
```

```
User: "Use DeepSeek to explain quantum computing"
Agent: Use blockrun_chat with model="deepseek/deepseek-chat", message="Explain quantum computing simply"
```

### Generate images

```
User: "Generate an image of a sunset over the ocean"
Agent: Use blockrun_image with prompt="A beautiful sunset over the ocean with vibrant orange and purple colors"
```

## Available Models

### Chat Models (selection)

| Provider | Models | Pricing (per 1M tokens) |
|----------|--------|------------------------|
| OpenAI | gpt-5.2, gpt-5-mini, gpt-4.1 | $1.75–$14/M output |
| Anthropic | claude-opus-4.6, claude-sonnet-4.6, claude-haiku-4.5 | $1–$15/M output |
| Google | gemini-2.5-pro, gemini-2.5-flash | $0.30–$10/M output |
| DeepSeek | deepseek-chat | $0.28/M output |
| xAI | grok-4-1-fast-reasoning | varies |
| NVIDIA | gpt-oss-120b | FREE |

Use `blockrun_models` for the full up-to-date list.

### Image Models

| Model | Price per image |
|-------|----------------|
| openai/dall-e-3 | ~$0.04 |
| openai/gpt-image-1 | ~$0.02 |
| black-forest/flux-1.1-pro | ~$0.04 |

## How Payment Works

BlockRun uses the **x402 protocol**. Transaction execution and final status are handled by lobster.cash:

1. Tool sends the AI request to `sol.blockrun.ai`
2. If payment is required, lobster.cash handles wallet signing and settlement
3. AI response is returned

No API keys, no subscriptions — just pay for what you use.

## Tool Parameters

### blockrun_models

```json
{
  "filter": "optional - keyword to filter (e.g., 'openai', 'free', 'image')"
}
```

### blockrun_chat

```json
{
  "model": "required - model ID (e.g., 'openai/gpt-5.2')",
  "message": "required - the message to send",
  "systemPrompt": "optional - system prompt for model behavior",
  "maxTokens": "optional - max response tokens (default: 1024)",
  "temperature": "optional - creativity 0-2 (default: 1)"
}
```

### blockrun_image

```json
{
  "prompt": "required - description of the image to generate",
  "model": "optional - 'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'",
  "size": "optional - '1024x1024' (default), '1792x1024', or '1024x1792'",
  "quality": "optional - 'standard' (default) or 'hd'"
}
```

## Troubleshooting

- **Model not found** — Use `blockrun_models` to verify the model ID
- **Payment failed** — Check wallet USDC balance via lobster.cash wallet tools
- **Empty response** — Try a different model or adjust max_tokens

## Best Practices

1. **Check models first** — Use `blockrun_models` to see what's available and pricing
2. **Use cheaper models for simple tasks** — DeepSeek or free NVIDIA models for basic queries
3. **Be specific with image prompts** — Detailed prompts produce better results
4. **Set appropriate max_tokens** — Lower values save costs for short responses
