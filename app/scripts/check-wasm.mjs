/**
 * WASM 自检脚本
 * 验证合约 WASM 文件：
 *  1. 文件存在且可读
 *  2. 导出了 Casper 必须的 `call` 函数
 *  3. 不包含 bulk memory 指令（memory.copy / memory.fill / memory.init）
 *  4. 文件大小在合理范围（Casper 限制约 512 KB）
 *
 * 用法：node scripts/check-wasm.mjs
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WASM_DIR = path.join(ROOT, "contracts-casper/target/wasm32-unknown-unknown/release");
const WASM_DIS  = path.join(ROOT, "node_modules/.bin/wasm-dis.cmd");

const FILES = [
  {
    label: "Identity Registry (nobulk)",
    file: path.join(WASM_DIR, "identity_registry_build_contract.nobulk.wasm"),
    envVar: "CASPER_IDENTITY_REGISTRY_WASM_PATH",
  },
  {
    label: "Token Coupon (min)",
    file: path.join(WASM_DIR, "token_coupon_build_contract.min.wasm"),
    envVar: "CASPER_TOKEN_WASM_PATH",
  },
];

let allPassed = true;

for (const { label, file, envVar } of FILES) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`  ${path.relative(ROOT, file)}`);
  console.log("=".repeat(60));

  // 1. 文件存在
  if (!fs.existsSync(file)) {
    console.error(`  ❌ 文件不存在！请先编译合约。`);
    allPassed = false;
    continue;
  }
  const sizeMB = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`  ✅ 文件存在  (${sizeMB} KB)`);

  // 2. 大小限制
  const sizeKB = fs.statSync(file).size / 1024;
  if (sizeKB > 512) {
    console.error(`  ❌ 文件过大 (${sizeKB.toFixed(1)} KB)，Casper 限制约 512 KB`);
    allPassed = false;
  } else {
    console.log(`  ✅ 大小合规 (< 512 KB)`);
  }

  // 3. 反汇编
  let wat;
  try {
    wat = execSync(`"${WASM_DIS}" "${file}"`, { maxBuffer: 50 * 1024 * 1024 }).toString();
  } catch (e) {
    // wasm-dis 对有些文件可能有警告但仍输出 wat
    wat = e.stdout?.toString() ?? "";
    if (!wat.includes("(module")) {
      console.error(`  ❌ wasm-dis 失败: ${e.message}`);
      allPassed = false;
      continue;
    }
  }

  // 4. 检查 `call` 导出
  const hasCallExport = /\(export\s+"call"\s+\(func/.test(wat);
  if (hasCallExport) {
    console.log(`  ✅ 导出了 "call" 函数（Casper 入口点）`);
  } else {
    console.error(`  ❌ 缺少 "call" 导出！Casper 会报 "Module doesn't have export call"`);
    // 打印所有导出帮助排查
    const exports = [...wat.matchAll(/\(export\s+"([^"]+)"/g)].map(m => m[1]);
    console.error(`     现有导出: ${exports.length ? exports.join(", ") : "(无)"}`);
    allPassed = false;
  }

  // 5. bulk memory 检查
  const bulkCount = (wat.match(/memory\.(copy|fill|init)/g) ?? []).length;
  if (bulkCount === 0) {
    console.log(`  ✅ 无 bulk memory 指令`);
  } else {
    console.error(`  ❌ 仍含 ${bulkCount} 处 bulk memory 指令（Casper 不支持）`);
    allPassed = false;
  }
}

console.log(`\n${"=".repeat(60)}`);
if (allPassed) {
  console.log("  🎉  全部检查通过，WASM 文件可以部署到 Casper！");
} else {
  console.error("  💥  有检查项失败，请修复后再部署。");
  process.exit(1);
}
