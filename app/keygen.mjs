import casperSdk from "casper-js-sdk";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

const { PrivateKey, KeyAlgorithm } = casperSdk;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const force = process.argv.includes("--force");

const privKey = await PrivateKey.generate(KeyAlgorithm.ED25519);
const pubHex = privKey.publicKey.toHex();
const privHex = Buffer.from(privKey.toBytes()).toString("hex");

const dir = join(repoRoot, "casper-keys");
const publicKeyPath = join(dir, "public_key.hex");
const secretKeyPath = join(dir, "secret_key.hex");

const existingFiles = [publicKeyPath, secretKeyPath].filter((file) => existsSync(file));
if (existingFiles.length > 0 && !force) {
  throw new Error(
    `Refusing to overwrite existing Casper key files: ${existingFiles
      .map((file) => relative(repoRoot, file))
      .join(", ")}. Re-run with --force only if you want a new faucet address.`
  );
}

mkdirSync(dir, { recursive: true });
writeFileSync(publicKeyPath, `${pubHex}\n`);
writeFileSync(secretKeyPath, `${privHex}\n`);

console.log("Casper Ed25519 keypair generated.");
console.log("PUBLIC KEY / faucet address:", pubHex);
console.log("Public key saved:", relative(repoRoot, publicKeyPath));
console.log("Secret key saved:", relative(repoRoot, secretKeyPath));
console.log("Private key was not printed. Do not commit casper-keys/.");
