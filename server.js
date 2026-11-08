// BANLIS Wallet Server
const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const ISSUER_ID = process.env.ISSUER_ID;
const CLASS_ID = ISSUER_ID ? `${ISSUER_ID}.banlis_loyalty` : null;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : null;
const CASHIER_API_KEY = process.env.CASHIER_API_KEY;

function requireWalletConfig() {
  if (!ISSUER_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Google Wallet environment variables are not configured');
  }
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function createWalletLink(customer) {
  requireWalletConfig();

  const phone = normalizePhone(customer.phone);
  const genericObject = {
    id: `${ISSUER_ID}.${phone}`,
    classId: CLASS_ID,
    genericType: 'GENERIC_TYPE_OTHER',
    hexBackgroundColor: '#1a1a1a',
    cardTitle: { defaultValue: { language: 'ar', value: 'BANLIS - بانليس' } },
    subheader: { defaultValue: { language: 'ar', value: customer.name } },
    header: { defaultValue: { language: 'ar', value: 'بطاقة ولاء' } },
    textModulesData: [
      { header: 'الأختام', body: `${customer.stamps} / 5`, id: 'stamps' },
      { header: 'المكافأة', body: '5 أختام = قهوة مجانية', id: 'reward' }
    ],
    barcode: {
      type: 'QR_CODE',
      value: phone,
      alternateText: `BL-${phone}`
    },
    locations: [{ latitude: 31.9532, longitude: 35.93 }]
  };

  const claims = {
    iss: GOOGLE_CLIENT_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    payload: { genericObjects: [genericObject] }
  };

  const token = jwt.sign(claims, GOOGLE_PRIVATE_KEY, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${token}`;
}

app.post('/api/join', (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = normalizePhone(req.body.phone);
    if (!name || name.length > 80 || phone.length < 8 || phone.length > 15) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال اسم ورقم هاتف صحيحين' });
    }

    const walletLink = createWalletLink({ name, phone, stamps: 0 });
    return res.json({ success: true, walletLink });
  } catch (error) {
    console.error('Wallet join error:', error.message);
    return res.status(500).json({ success: false, message: 'تعذر إنشاء البطاقة حالياً' });
  }
});

app.post('/api/stamp', (req, res) => {
  const suppliedKey = req.get('x-cashier-key');
  if (!CASHIER_API_KEY || suppliedKey !== CASHIER_API_KEY) {
    return res.status(401).json({ success: false, message: 'غير مصرح للكاشير' });
  }

  try {
    const phone = normalizePhone(req.body.phone);
    const stamps = Number(req.body.stamps);
    if (phone.length < 8 || phone.length > 15 || !Number.isInteger(stamps) || stamps < 0 || stamps > 5) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف أو عدد الأختام غير صحيح' });
    }

    const walletLink = createWalletLink({ name: 'عميل بانليس', phone, stamps });
    return res.json({ success: true, message: 'تم إنشاء رابط تحديث البطاقة', walletLink });
  } catch (error) {
    console.error('Wallet stamp error:', error.message);
    return res.status(500).json({ success: false, message: 'تعذر تحديث البطاقة حالياً' });
  }
});

app.listen(PORT, () => console.log(`Banlis Wallet running on port ${PORT}`));
