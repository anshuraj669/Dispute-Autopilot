export {};

// Run the agent on one dispute from the terminal.
// Usage: npm run investigate -- PP-D-1001

await import("./load-env");

const id = process.argv[2];
if (!id) {
  console.error("Usage: npm run investigate -- <dispute-id>");
  process.exit(1);
}

const { investigate } = await import("../lib/agent");
const decision = await investigate(id);
console.log(JSON.stringify(decision, null, 2));
