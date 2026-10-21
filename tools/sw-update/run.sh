#!/usr/bin/env bash
# The one check that exercises the service worker. The app never registers it on localhost, so no
# probe page and no unit test can see what a deploy does to a player's offline copy — which is how a
# working change shipped and stayed invisible on a phone. See sw-check.html for what it asserts.
#
#   tools/sw-update/run.sh        → prints the two builds and ALL PASS, or FAIL (exit 1)
#
# Builds two marked snapshots of the deployable app from the WORKING TREE (so it tests uncommitted
# changes), stamps each with tools/stamp-sw.py exactly as the deploy does, serves them like GitHub
# Pages, and drives one headless Windows Chrome session through install → deploy → update. The
# origin is WSL's own IP, not localhost (the app skips its worker there), made a secure context with
# --unsafely-treat-insecure-origin-as-secure. Real-time waits only: worker install is real-time work.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"; PROFILE="cc-sw-update-$$"
IP="$(hostname -I | awk '{print $1}')"; PORT=8701; CONTROL=8702; ORIGIN="http://$IP:$PORT"
CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"

snap() {   # NAME MTIME-OFFSET: later builds must LOOK later, or If-Modified-Since answers 304
  local s="$WORK/snap-$1"
  mkdir -p "$s/tools"
  cp -r "$REPO"/index.html "$REPO"/style.css "$REPO"/manifest.webmanifest "$REPO"/service-worker.js \
    "$REPO"/js "$REPO"/icons "$s/"
  cp "$REPO/tools/stamp-sw.py" "$s/tools/"
  printf '\n// MARKER-%s\n' "$1" | tee -a "$s/js/state.js" >> "$s/js/main.js"
  python3 "$s/tools/stamp-sw.py" > /dev/null
  cp "$HERE/sw-check.html" "$s/"
  find "$s" -type f -exec touch -d "@$(( $(date +%s) + $2 ))" {} +
}
snap A 0; snap B 120
ln -sfn snap-A "$WORK/site"
python3 "$HERE/server.py" "$WORK/site" $PORT & S1=$!
python3 "$HERE/server.py" "$WORK/site" $CONTROL & S2=$!
trap 'kill $S1 $S2 2>/dev/null; rm -rf "$WORK" "/mnt/c/Temp/$PROFILE"' EXIT
for _ in $(seq 1 100); do /mnt/c/Windows/System32/curl.exe -fs -o NUL "$ORIGIN/index.html" && break; sleep 0.1; done

out="$("$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir="C:\\Temp\\$PROFILE" --unsafely-treat-insecure-origin-as-secure="$ORIGIN" \
  --dump-dom "$ORIGIN/sw-check.html?next=B&control=$CONTROL" 2>/dev/null \
  | python3 -c "import html,re,sys; m=re.search(r'<pre id=\"out\"[^>]*>(.*?)</pre>', sys.stdin.read(), re.S); print(html.unescape(m.group(1)).replace(chr(13), '') if m else '(no output)')")"
echo "$out"
if grep -q 'state.js served: MARKER-B$' <<< "$out" && grep -q 'main.js served: MARKER-B$' <<< "$out"; then
  echo "ALL PASS — the new worker serves the new build's files"
else
  echo "FAIL — the new worker does not serve the new build's files"; exit 1
fi
