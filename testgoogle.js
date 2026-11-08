import crypto from 'crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fixPrivateKey(raw) {
  let text = String(raw || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1);
  text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  const m = text.match(/-----BEGIN PRIVATE KEY-----\s*([\s\S]*?)\s*-----END PRIVATE KEY-----/);
  let body = m ? m[1] : text;
  body = body.replace(/[^A-Za-z0-9+/=]/g, '');
  if (body.startsWith('nMII')) body = body.slice(1);
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

export default async function handler(req, res) {
  try {
    const issuerId = process.env.ISSUER_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = fixPrivateKey(process.env.GOOGLE_PRIVATE_KEY);

    // 1. Get access token from Google - this tests if service account is valid
    const now = Math.floor(Date.now() / 1000);
    const claim = { iss: clientEmail, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
    const h = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const p = base64url(JSON.stringify(claim));
    const data = `${h}.${p}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(data); signer.end();
    const sig = signer.sign(privateKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = `${data}.${sig}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      return res.status(200).json({ step: 'GET_TOKEN_FAILED', tokenError: tokenJson, issuerId, clientEmail });
    }

    // 2. Try to create the class directly via API - Google will return the REAL error here
    const classId = `${issuerId}.banlis-loyalty`;
    const createRes = await fetch('https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenJson.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: classId,
        issuerName: 'BANLIS',
        programName: 'BANLIS Loyalty',
        reviewStatus: 'UNDER_REVIEW',
        hexBackgroundColor: '#1a1a1a',
        accountNameLabel: 'Member',
        accountIdLabel: 'Member ID'
      })
    });
    const createJson = await createRes.json();

    return res.status(200).json({
      step: 'CREATE_CLASS',
      status: createRes.status,
      issuerId,
      clientEmail,
      googleError: createJson,
      meaning: createRes.status === 200 ? 'CLASS CREATED - your issuer works!' : createRes.status === 409 ? 'CLASS ALREADY EXISTS - your issuer works, class is fine!' : 'SEE googleError.error.message - that is the real reason'
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
