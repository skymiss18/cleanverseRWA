// snarkjs does not ship TypeScript type declarations. zk-provider.ts loads it
// via a dynamic import() and casts the result to a local SnarkJsModule shape,
// so we only need to tell TypeScript the module exists.
declare module "snarkjs";
