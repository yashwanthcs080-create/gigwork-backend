// models/index.js - All MongoDB Schemas
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ═══════════════════════════════════════
//  USER SCHEMA (Worker + Client unified)
// ═══════════════════════════════════════
const UserSchema = new mongoose.Schema({
  role:     { type: String, enum: ['worker', 'client'], required: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, minlength: 6 }, // Not required — Google-only users won't have one

  // Google OAuth
  googleId: { type: String, unique: true, sparse: true },

  // Phone verification
  phoneVerified: { type: Boolean, default: false },
  phoneOtp:      { type: String, default: null },
  phoneOtpExpires: { type: Date, default: null },

  // Common profile
  name:     { type: String, required: true, trim: true },
  phone:    { type: String, trim: true },
  avatar:   { type: String, default: null }, // file path or null

  // Address (both)
  address: {
    street:  String,
    area:    String,
    city:    String,
    state:   String,
    pin:     String,
    lat:     Number,
    lng:     Number
  },

  // ── WORKER ONLY fields ──
  trade:       String,
  customTrade: String, // When trade is "Other", stores the custom trade name
  experience:  Number,
  available:   { type: Boolean, default: true },
  serviceRadius: { type: Number, default: 30 },
  hourlyRate:  { type: Number, default: 450 },
  jobRate:     { type: Number, default: 2200 },
  languages:   { type: [String], default: ['Hindi'] },

  // Skills with level
  skills: [{
    name:  String,
    level: { type: String, enum: ['Beginner','Intermediate','Expert'], default: 'Intermediate' }
  }],

  // Certifications (locked until DigiLocker verified)
  certifications: [{
    id:       String,
    name:     String,
    issuer:   String,
    icon:     String,
    verified: { type: Boolean, default: false },
    txHash:   String,
    verifiedAt: Date
  }],

  // Live location (updated by socket)
  liveLocation: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    updatedAt: Date
  },

  // Portfolio / work images
  portfolioImages: [String],

  // Soulbound badges
  badges: [{
    name: String,
    icon: String,
    earnedAt: Date,
    txHash: String
  }],

  // QR session token (for review form)
  qrToken: { type: String, unique: true, sparse: true },

  // DigiLocker verification proof. Full Aadhaar numbers are never stored.
  digilockerVerification: {
    fullName: String,
    dateOfBirth: String,
    aadhaarLast4: String,
    verificationStatus: {
      type: String,
      enum: ['not_verified', 'pending', 'verified', 'failed'],
      default: 'not_verified'
    },
    verifiedAt: Date,
    documentHash: String
  },

  // Reputation (cached, recomputed on each review)
  reputation: {
    score:        { type: Number, default: 0 },
    reliability:  { type: Number, default: 0 },
    skillQuality: { type: Number, default: 0 },
    punctuality:  { type: Number, default: 0 },
    communication:{ type: Number, default: 0 },
    repeatHires:  { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    avgStar:      { type: Number, default: 0 }
  },

  // ── CLIENT ONLY fields ──
  neededTrades: [String],   // what type of workers they usually need

  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Hash password before save
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
UserSchema.methods.matchPassword = async function(entered) {
  if (!this.password) return false;
  return await bcrypt.compare(entered, this.password);
};

// ═══════════════════════════════════════
//  REVIEW SCHEMA
// ═══════════════════════════════════════
const ReviewSchema = new mongoose.Schema({
  workerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  qrToken:     { type: String, required: true }, // must match worker's qrToken
  clientName:  { type: String, required: true },
  clientType:  { type: String, enum: ['Residential','Commercial','Industrial','Government'], required: true },
  clientIp:    String,    // to prevent duplicate reviews per IP

  location: {
    text: String,
    lat:  Number,
    lng:  Number
  },

  workType:   String,
  dateOfWork: Date,
  daysWorked: Number,
  whenReview: String,

  // Ratings
  mainStar:     { type: Number, min:1, max:5, required: true },
  reliability:  { type: Number, min:1, max:5, default: 3 },
  skillQuality: { type: Number, min:1, max:5, default: 3 },
  punctuality:  { type: Number, min:1, max:5, default: 3 },
  communication:{ type: Number, min:1, max:5, default: 3 },
  repeatHires:  { type: Number, min:1, max:5, default: 3 },

  text:      { type: String, required: true, minlength: 10 },
  method:    { type: String, default: 'QR Verified' },
  txHash:    String,    // blockchain anchor hash

  helpful:   { type: Number, default: 0 },
  unhelpful: { type: Number, default: 0 },

  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ═══════════════════════════════════════
//  BOOKING SCHEMA
// ═══════════════════════════════════════
const BookingSchema = new mongoose.Schema({
  workerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  clientName: String,
  clientPhone: String,
  workType:   String,
  date:       Date,
  timeSlot:   String,
  address:    String,
  notes:      String,

  status: {
    type: String,
    enum: ['pending','accepted','rejected','completed','cancelled'],
    default: 'pending'
  },

  // ETA in minutes (when accepted)
  etaMinutes: { type: Number, default: 20 },

  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const User    = mongoose.model('User',    UserSchema);
const Review  = mongoose.model('Review',  ReviewSchema);
const Booking = mongoose.model('Booking', BookingSchema);

module.exports = { User, Review, Booking };
