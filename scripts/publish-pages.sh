#!/bin/zsh
# Publish a build of <commit> (default: the stable snapshot's HEAD) to the gh-pages branch
# of THIS repo (Nepussie69/gridiron-dynasty only — never the CRM repo).
# Site: https://nepussie69.github.io/gridiron-dynasty/
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SNAP=/private/tmp/claude-501/-Users-aaron-Documents-deepseek-harness-untitled-folder/7e69e49a-fbb2-4ed9-bfd2-53e0300ae15d/scratchpad/snap
REV=${1:-$(git -C "$SNAP" rev-parse HEAD)}
OUT=$(mktemp -d)
WT=$(mktemp -d)/src
git -C "$REPO" worktree add -q --detach "$WT" "$REV"
ln -s "$REPO/node_modules" "$WT/node_modules"
(cd "$WT" && PATH="$HOME/.local/node/bin:$PATH" npx vite build --base=/gridiron-dynasty/ --outDir "$OUT" >/dev/null)
git -C "$REPO" worktree remove --force "$WT"
cd "$OUT" && touch .nojekyll && git init -q -b gh-pages && git add -A
git -c user.name=Aaron -c user.email=aaron@local.dev commit -qm "Stable build $(git -C "$REPO" rev-parse --short "$REV") for GitHub Pages"
git push -f https://github.com/Nepussie69/gridiron-dynasty.git gh-pages
echo "published $(git -C "$REPO" rev-parse --short "$REV") -> https://nepussie69.github.io/gridiron-dynasty/"
