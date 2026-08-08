# Bond 代币化演示指南

演示场景：将香港基础设施公司债券（HIBT）在 Mantle Network 上代币化，全程经过 AI 合规审核。

---

## Step 1 — 资产基本信息

在 `/tokenize` 页面填写以下字段：

| 字段 | 填写值 |
|---|---|
| **Asset Name** | Harbour Infrastructure Bond Token (HIBT) |
| **Asset Type** | `Bond`（点击 Bond 按钮） |
| **Description** | Tokenised corporate bond backed by Asia logistics infrastructure assets. 5-year tenor, 5.50% semi-annual coupon, SFC-authorised under SFO s.103. ERC-3643 on Mantle Network with AI compliance gating oracle. |
| **Total Token Supply** | `100000` |

点击 **"Next: Compliance Check"** 进入 Step 2。

---

## Step 2 — AI 合规检查

打开 `test/bond-pass.txt`，将全部内容**复制粘贴**到 "Prospectus / Term Sheet" 文本框中。

点击 **"Run AI Compliance"**。

### 预期结果

| 检查项 | 规则 | 预期 |
|---|---|---|
| 发行人资质（SFC 持牌） | SFC-001 (权重 20) | ✅ PASS — 明确写明 Type 1 & 6 牌照 |
| 专业投资者限制 | SFC-002 (权重 20) | ✅ PASS — PI Only，HKD 800万门槛 |
| 资产背书与产权 | SFC-003 (权重 15) | ✅ PASS — 信托契约 + Mantle 链上记录 |
| 托管安排 | SFC-004 (权重 15) | ✅ PASS — HSBC Institutional Trust + HashKey Custody |
| 信息披露完整性 | SFC-005 (权重 10) | ✅ PASS — 风险因素、估值、赎回、费用、利益冲突全部涵盖 |
| AML/KYC 程序 | SFC-006 (权重 10) | ✅ PASS — AMLO 合规 + PEP 筛查 + AI 身份核验 |
| 智能合约审计 | SFC-007 (权重 5) | ✅ PASS — PeckShield 审计报告，0 Critical |
| 链上转让限制 | SFC-008 (权重 5) | ✅ PASS — ERC-3643 合规模块强制执行 |

**预期合规分：88～95 / 100（PASSED）**

合规分写入 Mantle 上的 `ComplianceOracle.sol`，页面显示 `txHash`。

---

## Step 3 — AI 智能合约审计

合规通过后自动进入 Step 3，页面展示 AI 对 HarbourRWA 四个合约的安全审计报告：

- `ComplianceOracle.sol`
- `HarbourRWAToken.sol`
- `IdentityRegistry.sol`
- `YieldAggregator.sol`

演示要点：
- 展示 **0 Critical / 0 High** findings
- 高亮 `auditHash`（keccak256），说明报告可在链上验证

---

## Step 4 — KYC 注册 & 代币铸造

| 字段 | 演示值 |
|---|---|
| **Investor Wallet Address** | `0x742d35Cc6634C0532925a3b8D4C9e34E3A5e4F2b` |
| **Jurisdiction** | `SG` |

点击 **"Submit KYC & Register"** → 投资者地址写入 `IdentityRegistry.sol`。

点击 **"Mint Tokens"** → 铸造 100,000 HIBT 到投资者地址。

---

## 演示叙事重点（2 分钟 Demo 节奏）

```
00:00  打开 /tokenize，选择 Bond，填写 HIBT 信息
00:20  粘贴 bond-pass.txt，点击 Run AI Compliance
00:40  展示 AI 评分结果（SFC 逐条规则打分明细）
01:00  展示 txHash → 在 Mantle Explorer 上查看链上 Oracle 记录
01:15  Step 3 展示合约审计报告（0 Critical findings）
01:30  Step 4 KYC 注册 → Mint → 展示 txHash
01:50  回到首页，总结 "AI 合规分守门 + 链上可验证"
```

---

## 与 GreenBond 的区别（演示时可对比说明）

| | GreenBond（HGBT） | Bond（HIBT） |
|---|---|---|
| 额外合规规则 | GB-001 绿色认证（Sustainalytics SPO） | 无绿色认证要求 |
| 债券用途 | 100% 绿色项目 | 基础设施 + 供应链数字化 |
| 票息 | 4.25% 半年付 | 5.50% 半年付 |
| 发行规模 | USD 50M | USD 100M |

Bond 类型适用于**所有不需要绿色认证的企业债、政府债、基础设施债**，是更通用的模板。
