export default function handler(req, res) {
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  const email = process.env.GOOGLE_CLIENT_EMAIL || '';
  const issuer = process.env.ISSUER_ID || '';

  // clean it like join.js does
  let k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"'))) k = k.slice(1, -1);
  k = k.replace(/\\n/g, '\n');
  const body = k.replace(/-----BEGIN.*?-----/s, '').replace(/-----END.*?-----/s, '').replace(/\s/g, '');

  return res.status(200).json({
    hasKey: !!raw,
    rawLength: raw.length,
    rawStarts: raw.slice(0, 30),
    rawEnds: raw.slice(-30),
    hasBegin: raw.includes('BEGIN PRIVATE KEY'),
    hasEnd: raw.includes('END PRIVATE KEY'),
    hasBackslashN: raw.includes('\\n'),
    hasRealNewline: raw.includes('\n'),
    bodyLength: body.length,
    bodyStarts: body.slice(0, 20),
    bodyEnds: body.slice(-20),
    bodyHasOnlyBase64: /^[A-Za-z0-9+/=]+$/.test(body),
    email: email,
    emailLength: email.length,
    issuer: issuer,
  });
}
