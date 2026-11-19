# AGENTS.md — SnipGate-Solo

Conventions for working on this repository (Solo series common rules apply).

- Vanilla JS + VS Code API only. No build step, zero runtime dependencies.
- 100% local: settings and snippet files on disk only. No network, no tracking/telemetry, ever.
- Core logic lives in `src/core.js` with no VS Code dependency and is unit-tested with `node --test "test/*.test.js"`. VS Code glue stays in `src/extension.js`. Real-host tests live in `test-real/` and run via `npm run test:real` (@vscode/test-cli; in this VM the VS Code unzip needs `TAR_OPTIONS=--no-same-owner`).
- Settings namespace is `snipGate.*`; the gate folder convention is `.vscode/snipgate/` (a subfolder of `.vscode`, so VS Code does not auto-load gated snippet files).
- Any change to a file included in the package requires a version bump (minor for features, patch for fixes), keeping package.json, package-lock.json and CHANGELOG.md in sync. CHANGELOG entries are English bullets followed by a Japanese summary.
- package.nls.json / package.nls.ja.json are minified single-line JSON with sorted keys; package.json is 2-space indent.
