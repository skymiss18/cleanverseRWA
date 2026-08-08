# HarbourRWA — 手工测试用例
## 页面：`/compliance`（AI Compliance Check）

**前置条件：** `cd app && npm run dev`，浏览器打开 http://localhost:3000/compliance

---

## 页面结构说明

打开页面后应看到以下元素（从上到下）：

| 区域 | 控件 |
|------|------|
| 标题 | "AI Compliance Check" |
| 说明文字 | "Paste your prospectus or term sheet below..." |
| 表单 | Asset Name 输入框 |
| 表单 | Asset Type 三选一按钮（REIT / GreenBond / TradeReceivable） |
| 表单 | Prospectus / Term Sheet Content 文本框（字数计数显示在下方） |
| 表单 | Mode 二选一按钮（Local Check Only / Analyse + Write to Mantle） |
| 表单 | 提交按钮（Run Compliance Check 或 Analyse & Write On-Chain） |

---

## TC-C01：页面初始状态验证

**操作步骤：**
1. 打开 http://localhost:3000/compliance

**预期结果：**
- 标题显示 "AI Compliance Check"
- Asset Name 输入框为空，placeholder 显示 `e.g. Link REIT 2026 Token`
- Asset Type 默认选中 `REIT`（绿色高亮）
- 文本框为空，字数显示 `0 characters`
- Mode 默认选中 `Local Check Only`（蓝色高亮）
- 提交按钮文字为 `Run Compliance Check`
- 页面下方无结果区域

---

## TC-C02：Asset Type 切换按钮

**操作步骤：**
1. 依次点击 `GreenBond`、`TradeReceivable`、`REIT`

**预期结果（每次点击后）：**
- 被点击的按钮变为绿色（emerald）高亮，文字变黑
- 其余两个按钮恢复灰色边框
- 三个按钮互斥，同一时刻只有一个选中

---

## TC-C03：Mode 切换按钮

**操作步骤：**
1. 点击 `Analyse + Write to Mantle`

**预期结果：**
- 该按钮变绿色高亮
- `Local Check Only` 恢复灰色
- 提交按钮文字变为 `Analyse & Write On-Chain`

**操作步骤：**
2. 再点击回 `Local Check Only`

**预期结果：**
- 提交按钮文字变回 `Run Compliance Check`

---

## TC-C04：文本框字数计数

**操作步骤：**
1. 在文本框输入任意文字

**预期结果：**
- 文本框下方实时显示当前字符数，例如 `12 characters`
- 字数随输入实时更新

---

## TC-C05：提交空表单——前端拦截

**操作步骤：**
1. 保持 Asset Name 和文本框均为空
2. 点击提交按钮

**预期结果：** 浏览器原生 required 校验拦截，表单不提交，高亮 Asset Name 输入框

---

## TC-C06：Asset Name 有值但文本框为空

**操作步骤：**
1. Asset Name 填写 `Test REIT`
2. 文本框保持为空
3. 点击提交按钮

**预期结果：** 浏览器拦截，提示文本框为必填

---

## TC-C07：文本过短（< 20 字符）——API 校验

**操作步骤：**
1. Asset Name：`Test Asset`
2. 文本框输入：`hello world`（11 字符）
3. 点击 `Run Compliance Check`

**预期结果：**
- 页面显示红色错误框
- 错误信息：`Error: Document text too short or missing`

---

## TC-C08：REIT 完整招股书——通过（本地检查模式）

**操作步骤：**
1. Asset Name：`Central Exchange REIT Token`
2. Asset Type：点选 `REIT`
3. Mode：`Local Check Only`（默认）
4. 打开 `test/reit-pass.txt`，全选复制，粘贴到文本框
5. 点击 `Run Compliance Check`

**预期结果：**
- 按钮文字变为 `Analysing...`，短暂等待
- 结果区域出现，包含：

  **评分卡（Score Card）：**
  - 标题显示 `Central Exchange REIT Token`
  - 右侧徽章显示 `REIT`（绿色字体）
  - 引擎标签显示 `Qwen AI`（紫色）或 `Rule-based`（灰色）
  - 状态徽章显示 **`PASSED`**（绿色）
  - 大字分数 **≥ 70**
  - 进度条为绿色（emerald）
  - Summary 显示 "passes SFC compliance threshold"
  - `onChain` 为 false，不显示链上交易链接

  **SFC Rule Breakdown：**
  - 每条规则显示 `ruleId: ruleName` + `score/maxScore`
  - 进度条显示各规则得分比例
  - SFC-001 至 SFC-008、REIT-001 各行均有内容

  **Recommendations：**
  - 若有未满分规则，显示黄色建议框
  - 若全部满分，建议框不出现

---

## TC-C09：绿色债券招股书——通过

**操作步骤：**
1. Asset Name：`Harbour Green Bond 2026-A`
2. Asset Type：点选 `GreenBond`
3. 粘贴 `test/greenbond-pass.txt` 全文
4. 点击 `Run Compliance Check`

**预期结果：**
- 分数 **≥ 70**，状态 **`PASSED`**（绿色）
- Rule Breakdown 中包含 `GB-001: Green Certification` 行
- GB-001 得分 > 0（因含 green、ESG、sustainable、certification 等关键词）

---

## TC-C10：贸易应收账款——不通过

**操作步骤：**
1. Asset Name：`Pearl River Trade Token`
2. Asset Type：点选 `TradeReceivable`
3. 粘贴 `test/trade-receivable-fail.txt` 全文
4. 点击 `Run Compliance Check`

**预期结果：**
- 分数 **< 70**，状态 **`FAILED`**（红色）
- 进度条为红色
- Summary 显示 "does NOT meet SFC compliance threshold"
- Recommendations 区域（黄色框）出现，列出多条缺失规则的改进建议
  - 包含：SFC-001（Issuer Eligibility）、SFC-002（Investor Restriction）等

---

## TC-C11：贸易应收账款完整招股书——通过

**操作步骤：**
1. Asset Name：`Harbour Supply Chain Token`
2. Asset Type：点选 `TradeReceivable`
3. 粘贴 `test/trade-receivable-pass.txt` 全文
4. 点击 `Run Compliance Check`

**预期结果：**
- 分数 **≥ 70**，状态 **`PASSED`**（绿色）

---

## TC-C12：进度条颜色随分数变化

根据前几条用例结果，验证进度条颜色规则：

| 分数范围 | 进度条颜色 |
|---------|-----------|
| ≥ 70 | 绿色（emerald） |
| 50–69 | 黄色（yellow） |
| < 50 | 红色（red） |

**验证方法：** 对比 TC-C08（高分绿）和 TC-C10（低分红）的进度条颜色

---

## TC-C13：Mode = "Analyse + Write to Mantle"（合约未部署）

**操作步骤：**
1. Asset Name：`Central Exchange REIT Token`
2. Asset Type：`REIT`
3. Mode：点选 `Analyse + Write to Mantle`
4. 粘贴 `test/reit-pass.txt` 全文
5. 点击 `Analyse & Write On-Chain`

**预期结果（`.env.local` 中合约地址为空时）：**
- 正常返回合规分数和规则明细
- 评分卡中**不显示**链上交易链接（`onChain: false`）
- 不报错

**预期结果（合约地址已填入 `.env.local`）：**
- 评分卡底部显示绿色链接：`On-chain: 0x1234...abcd`
- 点击链接跳转至 Mantle Sepolia Explorer 的交易详情页

---

## TC-C14：重复提交——结果刷新

**操作步骤：**
1. 先提交 `reit-pass.txt`，等待结果出现
2. 清空文本框，粘贴 `trade-receivable-fail.txt`
3. 修改 Asset Name 为 `Pearl River Token`
4. 再次点击提交

**预期结果：**
- 旧结果消失，按钮显示 `Analysing...`
- 新结果替换旧结果
- 分数和 PASS/FAIL 状态反映新文档

---

## TC-C15：超长文本（> 6000 字符）自动截断

**操作步骤：**
1. 将 `reit-pass.txt` 内容复制后重复粘贴 3 次（约 9000+ 字符）
2. 提交

**预期结果：**
- 正常返回合规结果，无报错
- 后端自动截断至 6000 字符处理

---

## 测试数据文件速查

| 文件 | 适用 Asset Type | 预期结果 | 对应用例 |
|------|----------------|---------|---------|
| `test/reit-pass.txt` | REIT | ≥70 PASS | TC-C08, TC-C13 |
| `test/greenbond-pass.txt` | GreenBond | ≥70 PASS | TC-C09 |
| `test/trade-receivable-pass.txt` | TradeReceivable | ≥70 PASS | TC-C11 |
| `test/trade-receivable-fail.txt` | TradeReceivable | <70 FAIL | TC-C10 |
