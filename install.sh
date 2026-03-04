#!/usr/bin/env bash
set -euo pipefail

# BlockRun AI skill installer for lobster.cash
# Usage: curl -sSL https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main/install.sh | bash

REPO="https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main"
SKILL_DIR="skills/blockrun"
SKILL_FILE="$SKILL_DIR/SKILL.md"
PLUGIN_JSON="openclaw.plugin.json"

# Check we're in a plugin directory
if [ ! -f "$PLUGIN_JSON" ]; then
  echo "Error: $PLUGIN_JSON not found. Run this from your lobster.cash plugin directory."
  exit 1
fi

# Download SKILL.md
mkdir -p "$SKILL_DIR"
curl -sSL "$REPO/skills/blockrun/SKILL.md" -o "$SKILL_FILE"
echo "Installed $SKILL_FILE"

# Add "blockrun" to skills array if not already present
if command -v jq &>/dev/null; then
  if ! jq -e '.skills | index("blockrun")' "$PLUGIN_JSON" &>/dev/null; then
    jq '.skills += ["blockrun"]' "$PLUGIN_JSON" > tmp.$$.json && mv tmp.$$.json "$PLUGIN_JSON"
    echo "Added \"blockrun\" to $PLUGIN_JSON skills array"
  else
    echo "\"blockrun\" already in $PLUGIN_JSON"
  fi
else
  echo "Note: install jq to auto-update $PLUGIN_JSON, or manually add \"blockrun\" to the skills array"
fi

echo ""
echo "Done! BlockRun AI skill is ready."
