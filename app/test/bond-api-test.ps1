# Bond Tokenisation — API Quick Test (PowerShell)
# Run from: E:\Repos\TheTuringTestHackathon2026\app
#
# Prerequisites: npm run dev must be running on http://localhost:3000
#
# Usage:
#   cd E:\Repos\TheTuringTestHackathon2026\app
#   .\test\bond-api-test.ps1

$BASE_URL = "http://localhost:3000"
$PROSPECTUS = Get-Content ".\test\bond-pass.txt" -Raw -Encoding UTF8

Write-Host ""
Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HarbourRWA — Bond Tokenisation API Test" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: AI Compliance Check ──────────────────────────────────────────────
Write-Host "[1/3] Running AI Compliance Check..." -ForegroundColor Yellow

$complianceBody = @{
    text      = $PROSPECTUS
    assetType = "Bond"
    assetName = "Harbour Infrastructure Bond Token (HIBT)"
} | ConvertTo-Json -Depth 3

try {
    $compliance = Invoke-RestMethod `
        -Uri "$BASE_URL/api/compliance/submit" `
        -Method POST `
        -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($complianceBody))

    $scoreColor = if ($compliance.passed) { "Green" } else { "Red" }
    $passLabel  = if ($compliance.passed) { "PASSED ✓" } else { "FAILED ✗" }

    Write-Host ""
    Write-Host "  Score   : $($compliance.score)/100" -ForegroundColor $scoreColor
    Write-Host "  Status  : $passLabel"               -ForegroundColor $scoreColor
    Write-Host "  Engine  : $($compliance.engine)"    -ForegroundColor Gray
    Write-Host "  AssetId : $($compliance.assetId)"   -ForegroundColor Gray

    if ($compliance.txHash) {
        Write-Host "  TxHash  : $($compliance.txHash)" -ForegroundColor Cyan
        Write-Host "  OnChain : $($compliance.onChain)" -ForegroundColor Cyan
    } else {
        Write-Host "  OnChain : false (oracle address not configured)" -ForegroundColor DarkYellow
    }

    Write-Host ""
    Write-Host "  Summary : $($compliance.summary)" -ForegroundColor Gray

    if ($compliance.breakdown) {
        Write-Host ""
        Write-Host "  Rule Breakdown:" -ForegroundColor Yellow
        foreach ($rule in $compliance.breakdown) {
            $ruleColor = if ($rule.score -ge ($rule.maxScore * 0.7)) { "Green" } else { "Red" }
            Write-Host ("  {0,-10} {1,-25} {2,3}/{3}" -f $rule.ruleId, $rule.ruleName, $rule.score, $rule.maxScore) -ForegroundColor $ruleColor
        }
    }

    if ($compliance.recommendations -and $compliance.recommendations.Count -gt 0) {
        Write-Host ""
        Write-Host "  Recommendations:" -ForegroundColor Yellow
        foreach ($rec in $compliance.recommendations) {
            Write-Host "    • $rec" -ForegroundColor DarkYellow
        }
    }
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Make sure 'npm run dev' is running at $BASE_URL" -ForegroundColor DarkYellow
    exit 1
}

# ── Step 2: KYC Submission ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/3] Submitting KYC for demo investor..." -ForegroundColor Yellow

$kycBody = @{
    walletAddress = "0x742d35Cc6634C0532925a3b8D4C9e34E3A5e4F2b"
    jurisdiction  = "HK"
} | ConvertTo-Json -Depth 2

try {
    $kyc = Invoke-RestMethod `
        -Uri "$BASE_URL/api/kyc/submit" `
        -Method POST `
        -ContentType "application/json" `
        -Body $kycBody

    Write-Host "  Message : $($kyc.message)" -ForegroundColor Green
    if ($kyc.txHash) {
        Write-Host "  TxHash  : $($kyc.txHash)" -ForegroundColor Cyan
    }
} catch {
    Write-Host "  WARN: KYC submission failed — $($_.Exception.Message)" -ForegroundColor DarkYellow
}

# ── Step 3: Smart Contract Audit ─────────────────────────────────────────────
Write-Host ""
Write-Host "[3/3] Running AI Smart Contract Audit..." -ForegroundColor Yellow

$auditBody = @{ projectName = "HarbourRWA" } | ConvertTo-Json

try {
    $audit = Invoke-RestMethod `
        -Uri "$BASE_URL/api/audit/contract" `
        -Method POST `
        -ContentType "application/json" `
        -Body $auditBody

    $auditColor = if ($audit.passed) { "Green" } else { "Red" }
    $auditLabel = if ($audit.passed) { "PASSED ✓" } else { "ACTION REQUIRED ✗" }

    Write-Host "  Status      : $auditLabel"                -ForegroundColor $auditColor
    Write-Host "  Overall Risk: $($audit.overallRisk)"      -ForegroundColor $auditColor
    Write-Host "  Contracts   : $($audit.contractsAudited.Count) audited" -ForegroundColor Gray
    Write-Host "  Audit Hash  : $($audit.auditHash)"        -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Finding Summary:" -ForegroundColor Yellow
    Write-Host ("  Critical:{0}  High:{1}  Medium:{2}  Low:{3}  Info:{4}" -f `
        $audit.findingSummary.critical,
        $audit.findingSummary.high,
        $audit.findingSummary.medium,
        $audit.findingSummary.low,
        $audit.findingSummary.informational) -ForegroundColor Gray

    if ($audit.findings.Count -gt 0) {
        Write-Host ""
        Write-Host "  Findings:" -ForegroundColor Yellow
        foreach ($f in $audit.findings) {
            $fColor = switch ($f.severity) {
                "Critical"      { "Red" }
                "High"          { "DarkRed" }
                "Medium"        { "Yellow" }
                "Low"           { "DarkYellow" }
                default         { "Gray" }
            }
            Write-Host "    [$($f.severity)] $($f.id) — $($f.title) @ $($f.location)" -ForegroundColor $fColor
        }
    }
} catch {
    Write-Host "  WARN: Audit failed — $($_.Exception.Message)" -ForegroundColor DarkYellow
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Test Complete"                             -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps for live demo:" -ForegroundColor White
Write-Host "  1. Open http://localhost:3000/tokenize" -ForegroundColor Gray
Write-Host "  2. Select 'Bond', paste test\bond-pass.txt" -ForegroundColor Gray
Write-Host "  3. Click 'Run AI Compliance' — watch score write to Mantle" -ForegroundColor Gray
Write-Host "  4. Step 3: show contract audit (0 Critical findings)" -ForegroundColor Gray
Write-Host "  5. Step 4: KYC + Mint tokens" -ForegroundColor Gray
Write-Host ""
