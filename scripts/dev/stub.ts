#!/usr/bin/env bun
// Placeholder entry point for a script whose work package hasn't landed. Usage: bun scripts/dev/stub.ts <WP-ID> <what>
const [wp = "?", ...what] = process.argv.slice(2);
console.log(`Not built yet · WP-${wp}${what.length ? ` (${what.join(" ")})` : ""}`);
