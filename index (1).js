// routes/index.js — All API Routes
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const QRCode   = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { User, Review, Booking } = require('../models');

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

// ── Fake blockchain hash ──
function fakeTxHash() {
  return '0x' + Array.from({length:64}, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('');
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

// POST /api/auth/register
router.post('/auth/register', upload.single('avatar'), async (req, res) => {
  try {
    const { role, email, password, name, phone, trade, experience,
            serviceRadius, hourlyRate, jobRate, neededTrades,
            street, area, city, state, pin, lat, lng } = req.body;

    if (await User.findOne({ email }))
      return res.status(400).json({ error: 'Email already registered' });

    // Default skills for workers
    const defaultSkills = trade === 'Electrician' ? [
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

    const user = await User.create({
      role, email, password, name, phone,
      trade: role==='worker' ? trade : undefined,
      experience: role==='worker' ? Number(experience)||0 : undefined,
      available: true,
      serviceRadius: Number(serviceRadius)||30,
      hourlyRate: Number(hourlyRate)||450,
      jobRate:    Number(jobRate)||2200,
      neededTrades: role==='client' ? (neededTrades ? JSON.parse(neededTrades) : []) : undefined,
      address: { street, area, city, state, pin, lat: Number(lat)||0, lng: Number(lng)||0 },
      skills: role==='worker' ? defaultSkills : [],
      certifications: role==='worker' ? defaultCerts : [],
      avatar: req.file ? '/uploads/' + req.file.filename : null,
      qrToken: role==='worker' ? qrToken : undefined,
      badges: role==='worker' ? [
        { name:'Profile Created', icon:'🆕', earnedAt: new Date(), txHash: fakeTxHash() }
      ] : []
    });

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

// POST /api/auth/login
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
    const reviewUrl = `${req.protocol}://${req.get('host')}/review.html?token=${worker.qrToken}&wid=${worker._id}`;
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
//  DIGILOCKER VERIFICATION
// ════════════════════════════════════════

// POST /api/verify/send-otp
router.post('/verify/send-otp', auth, async (req, res) => {
  // In production: hit DigiLocker OAuth / Aadhaar eKYC API
  // For demo/hackathon: simulate
  const { aadhaar } = req.body;
  if (!aadhaar || !/^\d{12}$/.test(aadhaar.replace(/\s/g,'')))
    return res.status(400).json({ error: 'Invalid Aadhaar number' });
  // Store in session — here we use a temp field on user
  await User.findByIdAndUpdate(req.user.id, { 'address.tempOtp': '123456' });
  res.json({ ok: true, message: 'OTP sent to Aadhaar-linked mobile (Demo OTP: 123456)' });
});

// POST /api/verify/verify-doc
router.post('/verify/verify-doc', auth, async (req, res) => {
  try {
    const { certId, otp } = req.body;
    // Demo: accept any 4+ digit OTP
    if (!otp || otp.length < 4)
      return res.status(400).json({ error: 'Invalid OTP' });

    const worker = await User.findById(req.user.id);
    const cert = worker.certifications.find(c => c.id === certId);
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });

    cert.verified   = true;
    cert.verifiedAt = new Date();
    cert.txHash     = fakeTxHash();
    await worker.save();

    // Check if all certs verified — award badge
    const allVerified = worker.certifications.every(c => c.verified);
    if (allVerified) {
      const hasBadge = worker.badges.some(b => b.name === 'Fully Verified');
      if (!hasBadge) {
        worker.badges.push({ name:'Fully Verified', icon:'🛡️', earnedAt:new Date(), txHash:fakeTxHash() });
        await worker.save();
      }
    }

    res.json({ ok: true, txHash: cert.txHash, message: `${cert.name} verified via DigiLocker` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  REVIEW ROUTES
// ════════════════════════════════════════

// POST /api/reviews — submit review via QR
router.post('/reviews', async (req, res) => {
  try {
    const { workerId, qrToken, clientName, clientType, locationText, lat, lng,
            workType, dateOfWork, daysWorked, whenReview,
            mainStar, reliability, skillQuality, punctuality, communication, repeatHires, text } = req.body;

    // Validate QR token matches worker
    const worker = await User.findById(workerId);
    if (!worker || worker.qrToken !== qrToken)
      return res.status(400).json({ error: 'Invalid QR token. This review link is not valid.' });

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
      whenReview,
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
