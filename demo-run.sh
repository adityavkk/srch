#!/bin/bash
# Demo runner: types command visually, runs it, pauses for reading, clears

type_cmd() {
  local cmd="$1"
  printf '\033[1;32m❯\033[0m '
  for (( i=0; i<${#cmd}; i++ )); do
    printf '%s' "${cmd:$i:1}"
    sleep 0.03
  done
  printf '\n'
}

run() {
  local cmd="$1"
  type_cmd "$cmd"
  eval "$cmd"
  sleep 3
  clear
}

clear

run 'search web bun sqlite wasm'
run 'search web react compiler --json | head -30'
run "search code 'react suspense cache' | head -20"
run 'search fetch https://clig.dev | head -15'
