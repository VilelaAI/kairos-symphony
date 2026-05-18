#!/bin/bash
# Fake CLI: lê prompt via stdin (até EOF), ecoa, e sai com código passado em $1 (default 0).
read -r line || true
echo "FAKE_CLI got: $line"
sleep 0.05
exit "${1:-0}"
