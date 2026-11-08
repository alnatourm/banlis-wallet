import crypto from 'crypto';

const ALLOWED_ORIGIN = 'https://banlis-wallet.vercel.app';

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=+$/, '');
}

function normalizePrivateKey(raw) {
  let key = String(raw || '').trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  key = key.replace(/\\r?\\n/g, '\n');

  // Accept a complete PKCS#8 PEM only. Never alter or strip key bytes.
  if (
    !key.startsWith('-----BEGIN PRIVATE KEY-----') ||
    !key.includes('-----END PRIVATE KEY-----')
  ) {
    throw new Error('Invalid wallet signing configuration');
  }

  return key.endsWith('\n') ? key : key + '\n';
}

function normalizePhone(value) {
  const digits = String(value ?? '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\\D/g, '');

  return digits;
}

function signJWT(payload, privateKey, clientEmail) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iss: clientEmail,
    aud: 'google',
    origins: [ALLOWED_ORIGIN],
    typ: 'savetowallet',
    iat: now,
    exp: now + 3600,
    ...payload
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();

  const signature = signer.sign(privateKey);
  const sigB64 = signature.toString('base64')
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=+$/, '');

  return `${data}.${sigB64}`;
}

export default async function handler(req, res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');

  const origin = req.headers.origin;
  if (origin && origin !== ALLOWED_ORIGIN) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = String(body.name ?? '').trim().replace(/[\\u0000-\\u001F\\u007F]/g, '');
    const phone = normalizePhone(body.phone);

    if (!name || name.length > 80 || phone.length < 8 || phone.length > 15) {
      return res.status(400).json({ error: 'Please enter a valid name and phone number' });
    }

    const issuerId = process.env.ISSUER_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!issuerId || !clientEmail || !rawPrivateKey) {
      return res.status(500).json({ error: 'Wallet service is not configured' });
    }

    const privateKey = normalizePrivateKey(rawPrivateKey);
    const objectId = `${issuerId}.${phone}_${Date.now()}`;
    // Keep the existing class ID unchanged to avoid breaking existing Wallet setup.
    const classId = `${issuerId}.banlis-loyalty`;

    const loyaltyClass = {
      id: classId,
      issuerName: 'BANLIS',
      programName: 'BANLIS Loyalty',
      reviewStatus: 'UNDER_REVIEW',
      hexBackgroundColor: '#1a1a1a',
      accountNameLabel: 'Member',
      accountIdLabel: 'Member ID'
    };

    const loyaltyObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountId: phone,
      accountName: name,
      barcode: {
        type: 'QR_CODE',
        value: phone,
        alternateText: phone
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
  } catch (error) {
    // Keep diagnostic details in server logs only, never return them to clients.
    console.error('Wallet join failed:', error?.message || 'Unknown error');
    return res.status(500).json({ error: 'Unable to create your wallet card right now' });
  }
}
