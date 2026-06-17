// routes/index.js — All API Routes
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const QRCode   = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { User, Review, Booking } = require('../models');
const digilockerService = require('../services/digilockerService');
const otpService = require('../services/otpService');
const googleAuthService = require('../services/googleAuthService');

const router = express.Router();

// ── Multer setup ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g,'_'))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Auth middleware ──
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function verifyTokenFromRequest(req) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) throw new Error('No token');
  return jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
}

// ── Fake blockchain hash ──
function fakeTxHash() {
  return '0x' + Array.from({length:64}, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('');
}

function isDigiLockerVerified(worker) {
  return worker?.digilockerVerification?.verificationStatus === 'verified';
}

// ── Recompute reputation ──
async function recomputeReputation(workerId) {
  const reviews = await Review.find({ workerId });
  if (!reviews.length) return;
  const avg = key => reviews.reduce((s,r) => s + (r[key]||3), 0) / reviews.length;
  const reliability   = +avg('reliability').toFixed(2);
  const skillQuality  = +avg('skillQuality').toFixed(2);
  const punctuality   = +avg('punctuality').toFixed(2);
  const communication = +avg('communication').toFixed(2);
  const repeatHires   = +avg('repeatHires').toFixed(2);
  const score = Math.round((reliability+skillQuality+punctuality+communication+repeatHires)/5*10);
  const avgStar = +avg('mainStar').toFixed(1);
  await User.findByIdAndUpdate(workerId, {
    reputation: { score, reliability, skillQuality, punctuality, communication, repeatHires, totalReviews: reviews.length, avgStar }
  });
}

// ════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════

// Strong password validation
function validatePassword(password) {
  const errors = [];
  if (password.length < 8) errors.push('Minimum 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('At least one uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('At least one number');
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/`~]/.test(password)) errors.push('At least one special character');
  return errors;
}

// POST /api/auth/send-otp — Send OTP to phone
router.post('/auth/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    const result = await otpService.sendOTP(phone);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth/verify-otp — Verify OTP code
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code are required' });
    const valid = otpService.verifyOTP(phone, code);
    if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP', verified: false });
    res.json({ ok: true, verified: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth/lookup-user — Find user by email/phone, send OTP to their phone
router.post('/auth/lookup-user', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Email or phone number is required' });

    // Find user by email or phone
    const normalized = identifier.trim().toLowerCase();
    let user = await User.findOne({
      $or: [
        { email: normalized },
        { phone: normalized },
        { phone: normalized.replace(/^\+91/, '') }
      ]
    });

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email or phone number' });
    }

    if (!user.phone) {
      return res.status(400).json({ error: 'No phone number linked to this account. Please contact support.' });
    }

    // Send OTP to user's phone (only if not using Firebase)
    const isFirebase = !!process.env.FIREBASE_API_KEY;
    if (!isFirebase) {
      await otpService.sendOTP(user.phone);
    }

    // Return masked phone and details
    const masked = '****' + user.phone.slice(-4);
    res.json({
      ok: true,
      found: true,
      maskedPhone: masked,
      phone: user.phone,
      isFirebase
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth/otp-login — Login with OTP (after lookup-user sent OTP)
router.post('/auth/otp-login', async (req, res) => {
  try {
    const { identifier, code, firebaseToken } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Identifier is required' });

    const normalized = identifier.trim().toLowerCase();
    const user = await User.findOne({
      $or: [
        { email: normalized },
        { phone: normalized },
        { phone: normalized.replace(/^\+91/, '') }
      ]
    });

    if (!user) return res.status(404).json({ error: 'No account found' });
    if (!user.phone) return res.status(400).json({ error: 'No phone linked' });

    // Verify OTP
    if (firebaseToken) {
      const firebaseAuthService = require('../services/firebaseAuthService');
      const verified = await firebaseAuthService.verifyFirebaseToken(firebaseToken);
      // Ensure the verified phone matches user's phone
      const cleanVerified = verified.phone.replace(/[\s\-\+]/g, '');
      const cleanUserPhone = user.phone.replace(/[\s\-\+]/g, '');
      if (!cleanVerified.includes(cleanUserPhone) && !cleanUserPhone.includes(cleanVerified)) {
        return res.status(400).json({ error: 'Verified phone number does not match account' });
      }
    } else {
      if (!code) return res.status(400).json({ error: 'OTP code is required' });
      const valid = otpService.verifyOTP(user.phone, code);
      if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '7d' }
    );

    res.json({ token, user: sanitizeUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/google — Google Sign-In
router.post('/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential is required' });

    const profile = await googleAuthService.verifyGoogleToken(credential);

    // Check if user exists by googleId or email
    let user = await User.findOne({
      $or: [
        { googleId: profile.googleId },
        { email: profile.email }
      ]
    });

    if (user) {
      // Existing user — update googleId if not set
      if (!user.googleId) {
        user.googleId = profile.googleId;
        await user.save();
      }

      const token = jwt.sign(
        { id: user._id, role: user.role, name: user.name },
        process.env.JWT_SECRET || 'dev_secret',
        { expiresIn: '7d' }
      );

      return res.json({ token, user: sanitizeUser(user) });
    }

    // New user — return profile so frontend can route to registration
    res.json({
      newUser: true,
      profile: {
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        googleId: profile.googleId
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth/check-email — Check if email is already registered
router.post('/auth/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const exists = !!(await User.findOne({ email: email.trim().toLowerCase() }));
    res.json({ exists });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/register
router.post('/auth/register', upload.single('avatar'), async (req, res) => {
  try {
    const { role, email, password, name, phone, trade, customTrade, experience,
            neededTrades, googleId,
            street, area, city, state, pin, lat, lng } = req.body;

    if (await User.findOne({ email }))
      return res.status(400).json({ error: 'Email already registered' });

    // Password validation (required unless Google sign-up)
    if (!googleId) {
      if (!password) return res.status(400).json({ error: 'Password is required' });
      const pwErrors = validatePassword(password);
      if (pwErrors.length > 0) {
        return res.status(400).json({ error: 'Weak password: ' + pwErrors.join(', ') });
      }
    }

    // Determine actual trade name
    const actualTrade = (trade === 'Other' && customTrade) ? customTrade : trade;

    // Default skills for workers
    const defaultSkills = actualTrade === 'Electrician' ? [
      { name:'Electrical Wiring', level:'Expert' },
      { name:'Panel Installation', level:'Expert' },
      { name:'CCTV & Security', level:'Intermediate' },
      { name:'Solar Panel Setup', level:'Intermediate' },
      { name:'EV Charging Points', level:'Beginner' }
    ] : [];

    // Default certs
    const defaultCerts = [
      { id:'aadhaar', name:'Aadhaar Identity Verification', issuer:'UIDAI · via DigiLocker', icon:'🪪', verified:false },
      { id:'iti',     name:'ITI / Trade Certificate',       issuer:'Govt ITI · via DigiLocker', icon:'📜', verified:false },
      { id:'license', name:'Trade License',                 issuer:'State Authority',           icon:'⚡', verified:false },
      { id:'safety',  name:'Safety Training Certificate',   issuer:'NSDC',                      icon:'🏥', verified:false },
      { id:'police',  name:'Police Verification',           issuer:'Local Police Station',      icon:'🚔', verified:false }
    ];

    const qrToken = uuidv4();

    const userData = {
      role, email, name, phone,
      trade: role==='worker' ? actualTrade : undefined,
      customTrade: (trade === 'Other' && customTrade) ? customTrade : undefined,
      experience: role==='worker' ? Number(experience)||0 : undefined,
      available: true,
      serviceRadius: 30,
      neededTrades: role==='client' ? (neededTrades ? JSON.parse(neededTrades) : []) : undefined,
      address: { street, area, city, state, pin, lat: Number(lat)||0, lng: Number(lng)||0 },
      skills: role==='worker' ? defaultSkills : [],
      certifications: role==='worker' ? defaultCerts : [],
      avatar: req.file ? '/uploads/' + req.file.filename : null,
      qrToken: role==='worker' ? qrToken : undefined,
      phoneVerified: !!req.body.phoneVerified,
      badges: role==='worker' ? [
        { name:'Profile Created', icon:'🆕', earnedAt: new Date(), txHash: fakeTxHash() }
      ] : []
    };

    // Google OAuth user
    if (googleId) {
      userData.googleId = googleId;
    }
    if (password) {
      userData.password = password;
    }

    const user = await User.create(userData);

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({ token, user: sanitizeUser(user) });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login (email+password fallback — kept for backward compat)
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '7d' }
    );

    res.json({ token, user: sanitizeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/me
router.get('/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: sanitizeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  WORKER ROUTES
// ════════════════════════════════════════

// GET /api/worker/:id/verification
router.get('/worker/:id/verification', async (req, res) => {
  try {
    const worker = await User.findById(req.params.id).select('role digilockerVerification');
    if (!worker || worker.role !== 'worker')
      return res.status(404).json({ error: 'Worker not found' });

    res.json({ verification: digilockerService.sanitizeVerification(worker.digilockerVerification) });
  } catch(e) { res.status(500).json({ error: 'Could not load verification status' }); }
});

// In-memory store for Aadhaar OTP transactions
const aadhaarTxStore = new Map(); // transactionId -> { aadhaarNumber, otp, expiresAt }

// POST /api/digilocker/aadhaar/otp — Request Aadhaar OTP
router.post('/digilocker/aadhaar/otp', auth, async (req, res) => {
  try {
    const { aadhaarNumber } = req.body;
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      return res.status(400).json({ error: 'Invalid Aadhaar number. Must be 12 digits.' });
    }

    const txId = 'adh_tx_' + uuidv4().substring(0, 8);
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    
    // Store in-memory with 5-minute expiry
    aadhaarTxStore.set(txId, {
      aadhaarNumber,
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    console.log(`🔒 [AADHAAR OTP] Tx: ${txId} | Aadhaar: ${aadhaarNumber} → OTP: ${otp} (Mock Mode)`);

    res.json({
      ok: true,
      txId,
      mock: true,
      message: `OTP sent successfully to Aadhaar-linked mobile number. (Code: ${otp})`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/digilocker/aadhaar/confirm — Confirm Aadhaar OTP
router.post('/digilocker/aadhaar/confirm', auth, async (req, res) => {
  try {
    const { txId, otp } = req.body;
    const tx = aadhaarTxStore.get(txId);

    if (!tx) {
      return res.status(400).json({ error: 'Invalid or expired transaction session.' });
    }

    if (Date.now() > tx.expiresAt) {
      aadhaarTxStore.delete(txId);
      return res.status(400).json({ error: 'Transaction session expired. Please request another OTP.' });
    }

    if (tx.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP code. Please try again.' });
    }

    // Success — clean up tx
    aadhaarTxStore.delete(txId);

    // Get user details
    const user = await User.findById(req.user.id);
    const verifiedName = user ? user.name : 'Verified Worker';

    res.json({
      ok: true,
      details: {
        fullName: verifiedName,
        dateOfBirth: '1992-08-15',
        gender: 'M',
        aadhaarLast4: tx.aadhaarNumber.slice(-4),
        address: 'B-404, Shanti Nagar, Sector 5, Mira Road, Thane, Maharashtra - 401107'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/digilocker/pan/verify — Verify PAN Card
router.post('/digilocker/pan/verify', auth, async (req, res) => {
  try {
    const { panNumber } = req.body;
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber)) {
      return res.status(400).json({ error: 'Invalid PAN number format (e.g. ABCDE1234F).' });
    }

    const user = await User.findById(req.user.id);
    const verifiedName = user ? user.name : 'Verified Worker';

    res.json({
      ok: true,
      details: {
        panNumber: panNumber,
        fullName: verifiedName,
        status: 'Active',
        category: 'Individual'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/digilocker/dl/verify — Verify Driving License
router.post('/digilocker/dl/verify', auth, async (req, res) => {
  try {
    const { dlNumber, dob } = req.body;
    if (dlNumber.replace(/[\s\-]/g, '').length < 10) {
      return res.status(400).json({ error: 'Invalid Driving License number format.' });
    }

    const user = await User.findById(req.user.id);
    const verifiedName = user ? user.name : 'Verified Worker';

    res.json({
      ok: true,
      details: {
        dlNumber: dlNumber,
        fullName: verifiedName,
        dob: dob || '1992-08-15',
        validity: '2035-08-14',
        classOfVehicle: 'MCWG, LMV',
        status: 'Active'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/digilocker/submit — Submit verified credentials & update user
router.post('/digilocker/submit', auth, async (req, res) => {
  try {
    const { fullName, dob, aadhaarLast4, panNumber, dlNumber } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 1. Update DigiLocker status
    const verifiedAt = new Date();
    const docHash = fakeTxHash();
    
    user.digilockerVerification = {
      fullName: fullName || user.name,
      dateOfBirth: dob || '1992-08-15',
      aadhaarLast4: aadhaarLast4 || '1234',
      verificationStatus: 'verified',
      verifiedAt,
      documentHash: docHash
    };

    // 2. Update certifications
    // Verify Aadhaar
    let aadhaarCert = user.certifications.find(c => c.id === 'aadhaar');
    if (aadhaarCert) {
      aadhaarCert.verified = true;
      aadhaarCert.verifiedAt = verifiedAt;
      aadhaarCert.txHash = fakeTxHash();
    } else {
      user.certifications.push({
        id: 'aadhaar',
        name: 'Aadhaar Identity Verification',
        issuer: 'UIDAI · via DigiLocker',
        icon: '🪪',
        verified: true,
        txHash: fakeTxHash(),
        verifiedAt
      });
    }

    // Verify/Add PAN
    if (panNumber) {
      let panCert = user.certifications.find(c => c.id === 'pan' || c.id === 'iti');
      if (panCert) {
        panCert.verified = true;
        panCert.verifiedAt = verifiedAt;
        panCert.txHash = fakeTxHash();
      } else {
        user.certifications.push({
          id: 'pan',
          name: 'PAN Verification (Income Tax Dept)',
          issuer: 'NDSL · via DigiLocker',
          icon: '📜',
          verified: true,
          txHash: fakeTxHash(),
          verifiedAt
        });
      }
    }

    // Verify/Add Driving License
    if (dlNumber) {
      let dlCert = user.certifications.find(c => c.id === 'license');
      if (dlCert) {
        dlCert.verified = true;
        dlCert.verifiedAt = verifiedAt;
        dlCert.txHash = fakeTxHash();
        dlCert.name = 'Driving License';
      } else {
        user.certifications.push({
          id: 'license',
          name: 'Driving License (MoRTH)',
          issuer: 'Ministry of Road Transport · via DigiLocker',
          icon: '⚡',
          verified: true,
          txHash: fakeTxHash(),
          verifiedAt
        });
      }
    }

    // Award "Identity Verified" badge if not already present
    const hasBadge = user.badges.some(b => b.name === 'Identity Verified');
    if (!hasBadge) {
      user.badges.push({
        name: 'Identity Verified',
        icon: '🛡️',
        earnedAt: verifiedAt,
        txHash: fakeTxHash()
      });
    }

    await user.save();
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/digilocker/auth
router.get('/digilocker/auth', async (req, res) => {
  try {
    const sessionUser = verifyTokenFromRequest(req);
    if (sessionUser.role !== 'worker')
      return res.status(403).json({ error: 'Only workers can verify with DigiLocker' });

    const worker = await User.findByIdAndUpdate(
      sessionUser.id,
      { 'digilockerVerification.verificationStatus': 'pending' },
      { new: true }
    );
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const state = digilockerService.createVerificationState(worker._id);
    const redirectUrl = digilockerService.buildAuthRedirectUrl({ state, request: req });
    if ((req.get('accept') || '').includes('application/json')) {
      return res.json({ redirectUrl });
    }
    res.redirect(redirectUrl);
  } catch(e) {
    console.error('DigiLocker auth failed:', e.message);
    res.redirect('/worker-profile.html?digilocker=failed');
  }
});

// GET /api/digilocker/callback
router.get('/digilocker/callback', async (req, res) => {
  let workerId = null;
  try {
    const { code, state } = req.query;
    const stateRecord = digilockerService.consumeVerificationState(state);
    workerId = stateRecord.userId;

    const worker = await User.findById(workerId);
    if (!worker || worker.role !== 'worker') throw new Error('Worker not found');

    const verification = await digilockerService.exchangeCodeForVerifiedProfile({ code, worker, request: req });
    worker.digilockerVerification = verification;
    await worker.save();

    res.redirect(`/worker-profile.html?id=${worker._id}&digilocker=success`);
  } catch(e) {
    console.error('DigiLocker callback failed:', e.message);
    if (workerId) {
      await User.findByIdAndUpdate(workerId, { 'digilockerVerification.verificationStatus': 'failed' });
    }
    res.redirect('/worker-profile.html?digilocker=failed');
  }
});

// GET /api/workers?city=Mumbai&trade=Electrician&lat=&lng=
router.get('/workers', async (req, res) => {
  try {
    const { city, trade, lat, lng } = req.query;
    const query = { role: 'worker', available: true };
    if (city)  query['address.city'] = new RegExp(city, 'i');
    if (trade) query.trade = new RegExp(trade, 'i');
    const workers = await User.find(query).select('-password -qrToken');
    res.json({ workers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/workers/:id
router.get('/workers/:id', async (req, res) => {
  try {
    const worker = await User.findById(req.params.id).select('-password');
    if (!worker || worker.role !== 'worker')
      return res.status(404).json({ error: 'Worker not found' });
    const reviews = await Review.find({ workerId: req.params.id }).sort('-submittedAt');
    res.json({ worker: sanitizeUser(worker), reviews });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/workers/:id/qr — generate QR code as base64 PNG
router.get('/workers/:id/qr', auth, async (req, res) => {
  try {
    const worker = await User.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Not found' });
    if (!isDigiLockerVerified(worker)) {
      return res.status(403).json({ error: 'DigiLocker verification is required before collecting reviews.' });
    }
    const port = process.env.PORT || 5000;
    const host = process.env.LOCAL_IP ? `${process.env.LOCAL_IP}:${port}` : req.get('host');
    const reviewUrl = `${req.protocol}://${host}/review.html?token=${worker.qrToken}&wid=${worker._id}`;
    const qrDataUrl = await QRCode.toDataURL(reviewUrl, {
      width: 200, margin: 2,
      color: { dark: '#1E2530', light: '#FFFFFF' }
    });
    res.json({ qr: qrDataUrl, url: reviewUrl });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/workers/:id/availability
router.patch('/workers/:id/availability', auth, async (req, res) => {
  try {
    if (req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    const worker = await User.findByIdAndUpdate(
      req.params.id, { available: req.body.available }, { new: true }
    ).select('-password');
    res.json({ worker: sanitizeUser(worker) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/workers/:id/location  (called by socket or direct)
router.patch('/workers/:id/location', auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    await User.findByIdAndUpdate(req.params.id, {
      liveLocation: { lat, lng, updatedAt: new Date() }
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/workers/:id/skills
router.patch('/workers/:id/skills', auth, async (req, res) => {
  try {
    if (req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    await User.findByIdAndUpdate(req.params.id, { skills: req.body.skills });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/workers/:id/portfolio — upload work photo
router.post('/workers/:id/portfolio', auth, upload.single('photo'), async (req, res) => {
  try {
    if (req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const imgPath = '/uploads/' + req.file.filename;
    await User.findByIdAndUpdate(req.params.id, { $push: { portfolioImages: imgPath } });
    res.json({ ok: true, path: imgPath });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/workers/:id/portfolio/:imgIndex
router.delete('/workers/:id/portfolio/:imgIndex', auth, async (req, res) => {
  try {
    if (req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    const worker = await User.findById(req.params.id);
    worker.portfolioImages.splice(Number(req.params.imgIndex), 1);
    await worker.save();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/workers/:id/avatar
router.post('/workers/:id/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (req.user.id !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const imgPath = '/uploads/' + req.file.filename;
    await User.findByIdAndUpdate(req.params.id, { avatar: imgPath });
    res.json({ ok: true, path: imgPath });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  REVIEW ROUTES
// ════════════════════════════════════════

// POST /api/reviews — submit review via QR
router.post('/reviews', async (req, res) => {
  try {
    const { workerId, qrToken, clientName, clientType, locationText, lat, lng,
            workType, dateOfWork, daysWorked,
            mainStar, reliability, skillQuality, punctuality, communication, repeatHires, text } = req.body;

    // Validate QR token matches worker
    const worker = await User.findById(workerId);
    if (!worker || worker.qrToken !== qrToken)
      return res.status(400).json({ error: 'Invalid QR token. This review link is not valid.' });
    if (!isDigiLockerVerified(worker))
      return res.status(403).json({ error: 'This worker must complete DigiLocker verification before collecting reviews.' });

    // One-review-per-IP check
    const clientIp = req.ip || req.connection.remoteAddress;
    const existing = await Review.findOne({ workerId, clientIp });
    if (existing)
      return res.status(409).json({
        error: 'No fake reviews allowed in this website! You have already submitted a review for this worker.'
      });

    const txHash = fakeTxHash();

    const review = await Review.create({
      workerId, qrToken, clientName, clientType,
      clientIp,
      location: { text: locationText, lat: Number(lat)||0, lng: Number(lng)||0 },
      workType, dateOfWork: new Date(dateOfWork),
      daysWorked: Number(daysWorked)||1,
      whenReview: 'just now',
      mainStar: Number(mainStar),
      reliability:   Number(reliability)||3,
      skillQuality:  Number(skillQuality)||3,
      punctuality:   Number(punctuality)||3,
      communication: Number(communication)||3,
      repeatHires:   Number(repeatHires)||3,
      text,
      method: 'QR Verified',
      txHash
    });

    // Recompute reputation
    await recomputeReputation(workerId);

    // Award badges
    const totalReviews = await Review.countDocuments({ workerId });
    const milestones = [
      { count:10,  name:'10 Jobs Done',     icon:'🌟' },
      { count:50,  name:'50 Jobs Done',     icon:'🏅' },
      { count:100, name:'100 Jobs Done',    icon:'💯' },
      { count:200, name:'200+ Jobs',        icon:'🏆' }
    ];
    for (const m of milestones) {
      if (totalReviews === m.count) {
        const hasBadge = worker.badges.some(b => b.name === m.name);
        if (!hasBadge) {
          worker.badges.push({ name:m.name, icon:m.icon, earnedAt:new Date(), txHash:fakeTxHash() });
          await worker.save();
        }
      }
    }

    res.json({ ok: true, review, txHash });
  } catch(e) {
    if (e.code === 11000)
      return res.status(409).json({ error: 'No fake reviews allowed in this website!' });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reviews/worker/:id
router.get('/reviews/worker/:id', async (req, res) => {
  try {
    const reviews = await Review.find({ workerId: req.params.id }).sort('-submittedAt');
    res.json({ reviews });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/reviews/:id/helpful
router.patch('/reviews/:id/helpful', async (req, res) => {
  try {
    const { dir } = req.body; // 1 or -1
    const field = dir === 1 ? 'helpful' : 'unhelpful';
    const review = await Review.findByIdAndUpdate(
      req.params.id, { $inc: { [field]: 1 } }, { new: true }
    );
    res.json({ ok: true, review });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  BOOKING ROUTES
// ════════════════════════════════════════

// POST /api/bookings
router.post('/bookings', async (req, res) => {
  try {
    const { workerId, clientName, clientPhone, workType, date, timeSlot, address, notes, clientId } = req.body;
    const booking = await Booking.create({
      workerId, clientId: clientId||null,
      clientName, clientPhone, workType,
      date: new Date(date), timeSlot, address, notes,
      status: 'pending'
    });

    // Auto accept/reject simulation (70/30)
    setTimeout(async () => {
      const accepted = Math.random() < 0.7;
      const etaMinutes = accepted ? Math.floor(Math.random()*15)+10 : 0;
      await Booking.findByIdAndUpdate(booking._id, {
        status: accepted ? 'accepted' : 'rejected',
        etaMinutes
      });
      // Emit via socket if available
      if (global.io) {
        global.io.to(`worker_${workerId}`).emit('booking_update', {
          bookingId: booking._id, status: accepted ? 'accepted' : 'rejected',
          clientName, workType
        });
        global.io.to(`booking_${booking._id}`).emit('booking_response', {
          status: accepted ? 'accepted' : 'rejected',
          etaMinutes, bookingId: booking._id
        });
      }
    }, 3000);

    res.json({ ok: true, bookingId: booking._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bookings/:id/status
router.get('/bookings/:id/status', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ status: booking.status, etaMinutes: booking.etaMinutes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function sanitizeUser(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  return obj;
}

module.exports = router;
