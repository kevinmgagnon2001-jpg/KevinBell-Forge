#!/usr/bin/env bash
# Run a build step; if it fails, publish the end of its output as an error annotation so the
# reason shows on the run's summary page (and can be read through the API without the raw logs).
#   .github/scripts/step.sh "Title" command args...
title="$1"; shift
log="$(mktemp)"
set -o pipefail
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
  # Keep error-looking lines plus the last lines; annotations are one line, so encode newlines.
  { grep -iE "error|failed|cannot|could not|not found|panicked" "$log" | tail -n 25; echo "----- last lines -----"; tail -n 40 "$log"; } \
    | cut -c1-400 | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}' > "$log.msg"
  echo "::error title=${title} failed (exit ${code})::$(cat "$log.msg")"
fi
rm -f "$log" "$log.msg"
exit "$code"
