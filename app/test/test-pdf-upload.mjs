import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(__dirname, 'sample-contract-v2.pdf');
const bytes = fs.readFileSync(pdfPath);
const boundary = 'TestBoundary123456';
const CRLF = '\r\n';

const header = Buffer.from(
  `--${boundary}${CRLF}` +
  `Content-Disposition: form-data; name="file"; filename="sample-contract.pdf"${CRLF}` +
  `Content-Type: application/pdf${CRLF}${CRLF}`
);
const footer = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
const body = Buffer.concat([header, bytes, footer]);

const req = http.request({
  hostname: 'localhost', port: 3000,
  path: '/api/extract-document', method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const j = JSON.parse(data);
    if (j.error) { console.error('API ERROR:', j.error); process.exit(1); }
    console.log('SUCCESS! chars=' + j.charCount);
    console.log(j.text.substring(0, 400));
  });
});
req.on('error', e => { console.error(e.message); process.exit(1); });
req.write(body);
req.end();
