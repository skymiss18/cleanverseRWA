# Trade Receivable Demo — Form Input Values

Use these values when filling in the tokenization or compliance form.
Upload the two .txt files in this folder as the invoice and contract documents.

---

## Step 1 — Asset Basics

| Field             | Value                                               |
|-------------------|-----------------------------------------------------|
| Asset Name        | Harbour Supply Chain Finance Token (HSCFT)          |
| Asset Type        | Trade Receivable                                    |
| Description       | Tokenised trade receivable pool backed by 120 verified invoices from Asia-Pacific exporters to investment-grade European and US buyers. SPV structure with bankruptcy-remote trust. ERC-3643 on Mantle Network. |
| Total Supply      | 120000                                              |
| Unit Price (USD)  | 100                                                 |
| Jurisdiction      | SG                                                  |

---

## Step 2 — Upload Documents

| Document            | File to Upload              |
|---------------------|-----------------------------|
| Commercial Invoice  | `sample-invoice.txt`        |
| Trade Contract      | `sample-contract.txt`       |

After upload the AI will extract the text and display it.
Click **"Run Trade Receivable Compliance Check"** to proceed.

---

## Step 2 (Compliance Page — standalone)

Same documents + enter these additional fields:

| Field             | Value                                               |
|-------------------|-----------------------------------------------------|
| Asset Name        | Harbour Supply Chain Finance Token (HSCFT)          |
| Total Supply      | 120000                                              |
| Unit Price (USD)  | 100                                                 |
| Asset Description | (same as above)                                     |

---

## Expected Compliance Results

The sample documents are designed to pass all TR-001 to TR-005 checks:

| Rule  | Check                                        | Expected Result |
|-------|----------------------------------------------|-----------------|
| TR-001 | Invoice amount ≥ token total value           | ✅ PASS (USD 505k > USD 120k) |
| TR-002 | Buyer name present                           | ✅ PASS (Europa Automotive GmbH) |
| TR-003 | Payment due date present                     | ✅ PASS (11 June 2026) |
| TR-004 | Assignment clause present in contract        | ✅ PASS (Article 4) |
| TR-005 | Governing law is SG                          | ✅ PASS (Article 6) |

SFC compliance score should be ≥ 85 / 100.

---

## Quick Test via curl (API only)

```powershell
cd E:\Repos\TheTuringTestHackathon2026\app

$invoice  = Get-Content .\test\sample-invoice.txt  -Raw
$contract = Get-Content .\test\sample-contract.txt -Raw

$body = @{
  invoiceText     = $invoice
  contractText    = $contract
  assetName       = "Harbour Supply Chain Finance Token (HSCFT)"
  totalSupply     = 120000
  unitPrice       = 100
  assetDescription = "Tokenised trade receivable pool backed by 120 verified invoices"
} | ConvertTo-Json -Depth 3

$response = Invoke-RestMethod -Uri "http://localhost:3000/api/compliance/trade-receivable" `
  -Method POST -ContentType "application/json" -Body $body

$response | ConvertTo-Json -Depth 10
```
