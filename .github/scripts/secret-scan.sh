#!/usr/bin/env bash
# A secret scan of every tracked file, with plain git grep (no third-party code). Exits 1 on any match.
# Each pattern is the shape of a real credential; examples in the docs use placeholders that do not match
# (for example 7m_ followed by fewer than 32 characters, or <your key>).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
patterns=(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'                       # PEM private keys
  'AKIA[0-9A-Z]{16}'                                         # AWS access key id
  'gh[pousr]_[A-Za-z0-9]{36,}'                               # GitHub tokens
  'github_pat_[A-Za-z0-9_]{22,}'                             # GitHub fine-grained tokens
  'xox[abprs]-[A-Za-z0-9-]{10,}'                             # Slack tokens
  'hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]{12,}'   # Slack webhooks
  'discord(app)?\.com/api/webhooks/[0-9]{6,}/[A-Za-z0-9_-]{20,}'       # Discord webhooks
  'sk_live_[0-9A-Za-z]{16,}'                                 # Stripe live keys
  'sk-ant-[A-Za-z0-9_-]{20,}'                                # Anthropic keys
  'sk-(proj-)?[A-Za-z0-9]{40,}'                              # OpenAI keys
  'AIza[0-9A-Za-z_-]{35}'                                    # Google API keys
  'npm_[A-Za-z0-9]{36}'                                      # npm tokens
  'pypi-[A-Za-z0-9_-]{50,}'                                  # PyPI tokens
  '\b7m_[0-9A-Za-z]{32}\b'                                   # 7Maps personal keys
  '[Xx]-7[Ii][Tt]-([Ss]taff|[Tt]est)["'"'"': =]+[a-f0-9]{64}' # 7IT staff and test header values
  '(private[_-]?key|PRIVATE_KEY)["'"'"' :=]+0x[0-9a-fA-F]{64}' # wallet private keys
)
found=0
for p in "${patterns[@]}"; do
  if git grep -nIE -e "$p" -- . ':(exclude).github/scripts/secret-scan.sh'; then
    echo "::error::possible secret matching: $p"
    found=1
  fi
done
if [ "$found" -ne 0 ]; then echo "Secret scan failed: remove the value and rotate it."; exit 1; fi
echo "Secret scan: no secrets found in $(git ls-files | wc -l) tracked files."
