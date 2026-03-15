#!/bin/bash
# PostToolUse hook — auto-run Playwright after editing JS/TS files
# Add to Claude settings: hooks.PostToolUse for Write|Edit on *.{ts,tsx,js,jsx}
FILE="${1:-}"
if [[ "$FILE" =~ \.(ts|tsx|js|jsx)$ ]]; then
  echo "Auto-testing after edit: $FILE"
  cd /scrolls/kingdom-forge && npx playwright test --reporter=line 2>&1 | tail -8
fi
