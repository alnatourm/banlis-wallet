export default async function handler(req, res) {
  try {
    const raw = String(process.env.GOOGLE_PRIVATE_KEY || '');
    // SAME fix as join.js
    let text = raw.trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1);
    }
    text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    const m = text.match(/-----BEGIN PRIVATE KEY-----\s*([\s\S]*?)\s*-----END PRIVATE KEY-----/);
    let body = m ? m[1] : text;
    body = body.replace(/[^A-Za-z0-9+/=]/g, '');
    if (body.startsWith('nMII')) body = body.slice(1);
    const wrapped = body.match(/.{1,64}/g).join('\n');
    const fixed = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;

    // Try to actually load it
    let keyInfo = 'NOT TESTED';
    try {
      const crypto = await import('crypto');
      const keyObj = crypto.createPrivateKey(fixed);
      keyInfo = 'SUCCESS - key is VALID! type=' + keyObj.asymmetricKeyType + ' size=' + keyObj.asymmetricKeySize;
    } catch (e2) {
      keyInfo = 'FAILED to load: ' + e2.message;
    }

    return res.status(200).json({
      rawLength: raw.length,
      hasBegin: raw.includes('BEGIN'),
      hasEnd: raw.includes('END'),
      hasBackslashN: raw.includes('\\n'),
      hasDoubleBackslashN: raw.includes('\\\\n'),
      hasRealNewline: raw.includes('\n'),
      startsWith: raw.slice(0, 40),
      endsWith: raw.slice(-40),
      fixedBodyLength: body.length,
      fixedBodyStarts: body.slice(0, 20),
      fixedBodyEnds: body.slice(-20),
      fixedBodyDivisibleBy4: body.length % 4 === 0,
      keyInfo: keyInfo
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
