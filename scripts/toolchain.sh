#!/bin/sh
# Source from the repository root when using the optional local toolchain.
task_root="$(pwd)"
export CARGO_HOME="$task_root/.local/cargo"
export RUSTUP_HOME="$task_root/.local/rustup"
export NO_DNA=1
export PATH="$CARGO_HOME/bin:$task_root/.local/toolchain/solana-release/bin:$task_root/.local/toolchain/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
