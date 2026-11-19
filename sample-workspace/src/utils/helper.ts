// Try it here:
// 1. Type  testblock  -> should NOT appear (not a *.test.ts file).
// 2. Type  comp       -> should NOT appear (not under src/components/).
// 3. Type  leakcheck  -> appears (VS Code native, for comparison).
// Note: the third rule in settings.json matches every .ts file but points
// at a snippet file that does not exist, so it is silently skipped.
export function helper() {
  return 42;
}
