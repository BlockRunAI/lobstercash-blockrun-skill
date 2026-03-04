#!/usr/bin/env bash
set -euo pipefail

# BlockRun AI skill installer for lobster.cash
# Usage: curl -sSL https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main/install.sh | bash

REPO="https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main"

# Find lobster.cash plugin directory
PLUGIN_DIR="$HOME/.openclaw/extensions/lobster.cash"
if [ ! -d "$PLUGIN_DIR" ]; then
  echo "Error: lobster.cash plugin not found at $PLUGIN_DIR"
  echo "Install it first: openclaw plugins install @crossmint/lobster.cash"
  exit 1
fi

echo "Found lobster.cash at $PLUGIN_DIR"

# Download skill + tools
mkdir -p "$PLUGIN_DIR/skills/blockrun" "$PLUGIN_DIR/src"
curl -sSL "$REPO/skills/blockrun/SKILL.md" -o "$PLUGIN_DIR/skills/blockrun/SKILL.md"
curl -sSL "$REPO/src/blockrun-tools.ts" -o "$PLUGIN_DIR/src/blockrun-tools.ts"
echo "Downloaded SKILL.md + blockrun-tools.ts"

# Add "blockrun" to openclaw.plugin.json skills array
PLUGIN_JSON="$PLUGIN_DIR/openclaw.plugin.json"
if [ -f "$PLUGIN_JSON" ] && command -v jq &>/dev/null; then
  if ! jq -e '.skills | index("blockrun")' "$PLUGIN_JSON" &>/dev/null 2>&1; then
    jq '.skills += ["blockrun"]' "$PLUGIN_JSON" > "$PLUGIN_DIR/tmp.$$.json" && mv "$PLUGIN_DIR/tmp.$$.json" "$PLUGIN_JSON"
    echo "Patched openclaw.plugin.json"
  fi
fi

# Patch index.ts — add import + register tools
INDEX="$PLUGIN_DIR/src/index.ts"
if [ -f "$INDEX" ] && ! grep -q "blockrun-tools" "$INDEX"; then
  IMPORT='import { createBlockRunModelsTool, createBlockRunChatTool, createBlockRunImageTool } from "./blockrun-tools.js";'

  # Add import after last import line
  LAST_IMPORT=$(grep -n '^import ' "$INDEX" | tail -1 | cut -d: -f1)
  if [ -n "$LAST_IMPORT" ]; then
    sed -i "${LAST_IMPORT}a\\${IMPORT}" "$INDEX"
  else
    sed -i "1i\\${IMPORT}" "$INDEX"
  fi

  # Add registerTool calls after last existing registerTool line
  LAST_REGISTER=$(grep -n 'registerTool' "$INDEX" | tail -1 | cut -d: -f1)
  if [ -n "$LAST_REGISTER" ]; then
    sed -i "${LAST_REGISTER}a\\    api.registerTool(createBlockRunModelsTool(), { name: \"blockrun_models\" });" "$INDEX"
    LAST_REGISTER=$((LAST_REGISTER + 1))
    sed -i "${LAST_REGISTER}a\\    api.registerTool(createBlockRunChatTool(), { name: \"blockrun_chat\" });" "$INDEX"
    LAST_REGISTER=$((LAST_REGISTER + 1))
    sed -i "${LAST_REGISTER}a\\    api.registerTool(createBlockRunImageTool(), { name: \"blockrun_image\" });" "$INDEX"
  fi

  echo "Patched src/index.ts"
fi

echo ""
echo "Done! Restart the gateway: openclaw gateway restart"
