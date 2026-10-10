#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# UI redesign check-hex (F0). Flags hard-coded colours in screen/kit code:
#   • hex literals (#abc, #aabbcc, #aabbccdd)
#   • text-/bg- white|black utilities (incl. opacity, e.g. bg-black/25)
#
#   scripts/check-hex.sh [file ...]      # default: every src/**/*.tsx
#
# Allowed (not reported):
#   • any line containing the marker `check-hex-allow` (add a reason, e.g.
#     `// check-hex-allow: turf gradient`) — for broadcast field art only;
#   • lines matching an ALLOW entry below ("<path-substring>|<ERE>").
# Colour tokens live in src/index.css and src/lib/teamColor.ts; don't pass those.
# Exit 1 when anything is reported.
# ─────────────────────────────────────────────────────────────────────────────
set -u

ALLOW=(
  # "src/components/MatchView.tsx|turf|endzone"
)

HEX_RE='#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b'
BW_RE='\b(text|bg)-(white|black)(/[0-9]+)?\b'

cd "$(dirname "$0")/.." || exit 2

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=()
  while IFS= read -r f; do files+=("$f"); done < <(find src -name '*.tsx' | sort)
fi

total=0
for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "check-hex: no such file: $f" >&2
    total=$((total + 1))
    continue
  fi
  hits=$(grep -nE "($HEX_RE)|($BW_RE)" "$f" | grep -v 'check-hex-allow' || true)
  for entry in ${ALLOW[@]+"${ALLOW[@]}"}; do
    path=${entry%%|*}
    re=${entry#*|}
    case "$f" in
      *"$path"*) hits=$(printf '%s\n' "$hits" | grep -vE "$re" || true) ;;
    esac
  done
  [ -z "$hits" ] && continue
  n=$(printf '%s\n' "$hits" | wc -l | tr -d ' ')
  total=$((total + n))
  echo "── $f ($n)"
  printf '%s\n' "$hits" | sed 's/^/  /' | cut -c1-200
done

if [ "$total" -gt 0 ]; then
  echo "check-hex: $total hard-coded colour line(s) in ${#files[@]} file(s)"
  exit 1
fi
echo "check-hex: clean (${#files[@]} file(s))"
