---
name: blockrun
description: Use when the user wants to access AI models, generate images, or use intelligent language models paid with their Solana wallet via BlockRun. Activate on AI chat, image generation, model listing, or BlockRun mentions.
metadata: { "openclaw": { "emoji": "🤖" } }
---

# BlockRun AI

Access 40+ AI models and image generation via [BlockRun](https://sol.blockrun.ai), paid per-request with your lobster.cash Solana wallet using the x402 protocol. No API keys needed — just a funded wallet.

> **Note:** AI requests are paid with USDC from your lobster.cash wallet on Solana mainnet.

## When to Activate

Use this skill when the user:

- Wants to chat with an AI model (GPT, Claude, Gemini, DeepSeek, etc.)
- Wants to generate images (DALL-E 3, GPT Image 1, Flux)
- Asks about available AI models or pricing
- Mentions BlockRun or pay-per-request AI
- Wants to use AI without managing API keys

## Tools Overview

| Tool | Purpose | Payment |
|------|---------|---------|
| `blockrun_models` | List available models and pricing | USDC per request |
| `blockrun_chat` | Chat with any AI model | USDC per request |
| `blockrun_image` | Generate images with AI | USDC per request |

## Prerequisites

The lobster.cash wallet must be set up and funded before using BlockRun tools:

1. Run `crossmint_setup` to generate a Solana keypair
2. Complete the web delegation flow at lobster.cash
3. Run `crossmint_configure` with your wallet address and API key
4. Fund the wallet with USDC on Solana

The lobster.cash plugin handles all wallet setup automatically. Once the wallet is configured and funded with USDC, BlockRun tools work out of the box.

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

```
User: "What free models are there?"
Agent: Use blockrun_models with filter="free"
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

```
User: "Ask Claude to write a haiku about Solana"
Agent: Use blockrun_chat with model="anthropic/claude-sonnet-4.6", message="Write a haiku about Solana"
```

### Generate images

```
User: "Generate an image of a sunset over the ocean"
Agent: Use blockrun_image with prompt="A beautiful sunset over the ocean with vibrant orange and purple colors"
```

```
User: "Create a logo using Flux"
Agent: Use blockrun_image with model="black-forest/flux-1.1-pro", prompt="Modern minimalist logo..."
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

BlockRun uses the **x402 protocol** — a crypto-native pay-per-request system:

1. Agent sends the AI request to `sol.blockrun.ai`
2. Server responds with `402 Payment Required` including USDC amount and fee payer address
3. Plugin builds a Solana SPL `TransferChecked` transaction and partially signs it with the agent's local keypair
4. The signed transaction is sent in the `PAYMENT-SIGNATURE` header on retry
5. Server's CDP facilitator co-signs the transaction and settles it on-chain
6. Server returns the AI response

No API keys, no subscriptions — just pay for what you use. Your private key never leaves the agent.

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
  "temperature": "optional - creativity 0-2 (default: 1)",
  "agentId": "optional"
}
```

### blockrun_image

```json
{
  "prompt": "required - description of the image to generate",
  "model": "optional - 'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'",
  "size": "optional - '1024x1024' (default), '1792x1024', or '1024x1792'",
  "quality": "optional - 'standard' (default) or 'hd'",
  "agentId": "optional"
}
```

## Troubleshooting

### "No wallet found"

Set up the lobster.cash wallet first — the plugin handles keypair generation and delegation automatically.

### "Payment transaction failed"

The wallet may not have enough USDC. Check your balance using the lobster.cash wallet tools.

### "Chat completion failed" or "Image generation failed"

- Verify the model ID is correct (use `blockrun_models` to list valid IDs)
- Check that the wallet has sufficient USDC
- The model may be temporarily unavailable — try again or use a different model

## Best Practices

1. **Check models first** — Use `blockrun_models` to see what's available and pricing
2. **Use cheaper models for simple tasks** — DeepSeek or free NVIDIA models for basic queries
3. **Check balance before heavy usage** — Image generation and large models cost more
4. **Be specific with image prompts** — Detailed prompts produce better results
5. **Set appropriate max_tokens** — Lower values save costs for short responses
