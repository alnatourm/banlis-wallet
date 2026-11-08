import crypto from 'crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fixPrivateKey(raw) {
  let k = (raw || '').trim();
  // remove surrounding quotes if Vercel added them
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // turn literal \n into real newlines
  k = k.replace(/\\n/g, '\n');
  // extract just the base64 body between headers
  k = k.replace(/-----BEGIN.*?-----/s, '').replace(/-----END.*?-----/s, '');
  // remove ALL whitespace / spaces / newlines - rebuild it clean
  const body = k.replace(/\s/g, '');
  // re-wrap at 64 chars like a real PEM file
  const wrapped = body.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

function signJWT(payload, privateKey, clientEmail) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iss: clientEmail,
    aud: 'google',
    origins: [],
    typ: 'savetowallet',
    iat: now,
    ...payload
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKey);
  const sigB64 = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${data}.${sigB64}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });

    const issuerId = process.env.ISSUER_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = fixPrivateKey(process.env.GOOGLE_PRIVATE_KEY);

    if (!issuerId || !clientEmail || !process.env.GOOGLE_PRIVATE_KEY) {
      return res.status(500).json({ error: 'Missing env vars' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const objectId = `${issuerId}.${cleanPhone}_${Date.now()}`;
    const classId = `${issuerId}.banlis-loyalty`;

    const loyaltyClass = {
      id: classId,
      issuerName: 'BANLIS',
      programName: 'BANLIS',
      programLogo: {
        sourceUri: { uri: 'https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg' },
        contentDescription: { defaultValue: { language: 'en-US', value: 'BANLIS' } }
      },
      hexBackgroundColor: '#000000',
      rewardsTierLabel: 'Tier',
      rewardsTier: 'Gold',
      accountNameLabel: 'Member',
      accountIdLabel: 'Member ID',
      reviewStatus: 'UNDER_REVIEW'
    };

    const loyaltyObject = {
      id: objectId,
      classId: classId,
      state: 'ACTIVE',
      accountId: cleanPhone,
      accountName: name,
      barcode: {
        type: 'QR_CODE',
        value: cleanPhone,
        alternateText: cleanPhone
      },
      textModulesData: [
        { header: 'MEMBER', body: name },
        { header: 'PHONE', body: phone },
        { header: 'POINTS', body: '0 Points - Welcome to BANLIS!' }
      ]
    };

    const jwt = signJWT({
      payload: {
        loyaltyClasses: [loyaltyClass],
        loyaltyObjects: [loyaltyObject]
      }
    }, privateKey, clientEmail);

    const saveUrl = `https://pay.google.com/gp/v/save/${jwt}`;

    return res.status(200).json({ saveUrl, objectId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
