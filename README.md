# BlockRun AI Skill for lobster.cash

Gives lobster.cash agents access to 40+ AI models and image generation via [BlockRun](https://sol.blockrun.ai). Payment handled automatically by lobster.cash via x402.

## Install

From your lobster.cash plugin directory:

```bash
curl -sSL https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main/install.sh | bash
```

That's it. The script downloads the skill and adds it to your `openclaw.plugin.json`.

## What the agent can do

| Capability | Example |
|------------|---------|
| Chat with 40+ models | "Ask GPT-5 to explain quantum computing" |
| Generate images | "Create an image of a sunset over the ocean" |
| Browse models & pricing | "What AI models are available?" |

## API

All requests go to `https://sol.blockrun.ai/api/v1/`:

- `GET /models` — list models
- `POST /chat/completions` — chat (OpenAI-compatible)
- `POST /images/generations` — image generation

## Manual install

If you prefer not to use the script:

1. Copy `skills/blockrun/SKILL.md` into your plugin's `skills/blockrun/` directory
2. Add `"blockrun"` to the `skills` array in `openclaw.plugin.json`
