const { readFileSync } = require('fs');
const makeAssetId = name => name.trim().toLowerCase().replace(/\s+/g, '_');
const deps = JSON.parse(readFileSync('./app/data/deployments.json','utf-8'));

// Simulate exactly what findCasperDeployment("NIBT") does
const assetName = "NIBT";
const assetId = makeAssetId(assetName);
console.log('Looking for assetName="NIBT", assetId="nibt"\n');

for(const [id,d] of Object.entries(deps)) {
  if(!(d.network||'').toLowerCase().includes('casper')) continue;
  const byAssetId = d.assetId === assetId;
  const byName = (d.assetName||'').trim().toLowerCase() === assetName.toLowerCase();
  if(byAssetId || byName) {
    console.log('MATCH:', id.slice(-10), '| assetName:', d.assetName, '| assetId:', d.assetId, '| contractHash:', d.contractHash ? '✅' : '❌MISSING');
    console.log('  → This would be RETURNED by find() (first match)');
    break;  // find() stops at first match
  }
}

