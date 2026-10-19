export {};

// Loads .env for CLI scripts (Next.js loads it itself for the app).
// Fails loudly instead of silently running without credentials.

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  console.error(`Node ${process.versions.node} is too old; this project needs Node 22 (run \`nvm use\`).`);
  process.exit(1);
}

try {
  process.loadEnvFile();
} catch (err: any) {
  if (err?.code !== "ENOENT") throw err;
  console.warn("No .env file found; using environment variables only.");
}
