#!/usr/bin/env bash
# Runs the golden vectors in JavaScript engine shells.
#   bash scripts/run-engines.sh               every engine found on this machine
#   bash scripts/run-engines.sh node jsc gjs  these must be installed and pass
#
# jsc  = JavaScriptCore, Safari's engine. Ubuntu: apt install libjavascriptcoregtk-bin.
#        macOS ships it inside the JavaScriptCore framework; this script finds it.
# gjs  = GNOME's JavaScript shell, built on SpiderMonkey, Firefox's engine.
#        Ubuntu: apt install gjs.
# node = V8, Chrome's engine.
set -uo pipefail
cd "$(dirname "$0")/.."
npx tsx scripts/build-engine-parity.ts || exit 1

MAC_JSC=""
for p in /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc \
         /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc; do
  if [ -x "$p" ]; then MAC_JSC="$p"; break; fi
done

command_for() {
  case "$1" in
    node) command -v node ;;
    jsc) command -v jsc || { [ -n "$MAC_JSC" ] && echo "$MAC_JSC"; } ;;
    gjs) command -v gjs ;;
    *) echo "unknown engine $1" >&2 ;;
  esac
}

label_for() {
  case "$1" in
    node) echo "V8 (node, Chrome's engine)" ;;
    jsc) echo "JavaScriptCore (jsc, Safari's engine)" ;;
    gjs) echo "SpiderMonkey (gjs, Firefox's engine)" ;;
  esac
}

if [ $# -gt 0 ]; then wanted=("$@"); strict=1; else wanted=(node jsc gjs); strict=0; fi
status=0
for e in "${wanted[@]}"; do
  cmd="$(command_for "$e" || true)"
  if [ -z "$cmd" ]; then
    if [ "$strict" = 1 ]; then echo "FAIL $e: not installed"; status=1; else echo "skip $e: not installed"; fi
    continue
  fi
  out="$("$cmd" dist/engine-parity.js 2>&1)"
  if echo "$out" | grep -q "^RESULT: PASS"; then
    echo "PASS $(label_for "$e"): $(echo "$out" | grep '^RESULT' | sed 's/RESULT: PASS //')"
  else
    echo "FAIL $(label_for "$e")"
    echo "$out" | grep -v '^ok' | sed 's/^/    /'
    status=1
  fi
done
exit $status
