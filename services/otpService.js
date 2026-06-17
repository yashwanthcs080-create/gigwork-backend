// services/otpService.js — OTP Service (Fast2SMS + Mock mode)
// If FAST2SMS_API_KEY is set → sends real SMS
// Otherwise → mock mode (stores OTP in memory, always accepts "123456")

const axios = require('axios');

// In-memory store for OTPs and cooldowns
const otpStore = new Map();      // phone → { code, expiresAt }
const cooldownStore = new Map(); // phone → lastSentAt (timestamp)

const OTP_EXPIRY_MS  = (Number(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000;
const COOLDOWN_MS    = (Number(process.env.OTP_COOLDOWN_SECONDS) || 60) * 1000;

function isMockMode() {
  return !process.env.FAST2SMS_API_KEY;
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

// Check if phone is in cooldown period
function isInCooldown(phone) {
  const lastSent = cooldownStore.get(phone);
  if (!lastSent) return false;
  const elapsed = Date.now() - lastSent;
  return elapsed < COOLDOWN_MS;
}

function getCooldownRemaining(phone) {
  const lastSent = cooldownStore.get(phone);
  if (!lastSent) return 0;
  const remaining = COOLDOWN_MS - (Date.now() - lastSent);
  return Math.max(0, Math.ceil(remaining / 1000));
}

// Send OTP to a phone number
async function sendOTP(phone) {
  // Normalize phone (remove +91 prefix, spaces, dashes)
  phone = phone.replace(/[\s\-\+]/g, '');
  if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);
  if (!/^\d{10}$/.test(phone)) {
    throw new Error('Invalid phone number. Must be 10 digits.');
  }

  // Check cooldown
  if (isInCooldown(phone)) {
    const remaining = getCooldownRemaining(phone);
    throw new Error(`Please wait ${remaining} seconds before requesting another OTP.`);
  }

  const code = generateOTP();

  if (isMockMode()) {
    // Mock mode — store OTP in memory
    console.log(`📱 [MOCK OTP] Phone: ${phone} → Code: ${code} (also accepts "123456")`);
    otpStore.set(phone, {
      code,
      expiresAt: Date.now() + OTP_EXPIRY_MS
    });
    cooldownStore.set(phone, Date.now());
    return { ok: true, mock: true, message: `OTP sent (mock mode). Code: ${code}` };
  }

  // Real mode — Fast2SMS
  try {
    const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
      params: {
        authorization: process.env.FAST2SMS_API_KEY,
        variables_values: code,
        route: 'otp',
        numbers: phone
      }
    });

    if (response.data && response.data.return === true) {
      otpStore.set(phone, {
        code,
        expiresAt: Date.now() + OTP_EXPIRY_MS
      });
      cooldownStore.set(phone, Date.now());
      console.log(`📱 [OTP SENT] Phone: ${phone}`);
      return { ok: true, mock: false, message: 'OTP sent successfully' };
    } else {
      console.error('Fast2SMS error:', response.data);
      throw new Error('Failed to send OTP. Please try again.');
    }
  } catch (err) {
    if (err.response) {
      console.error('Fast2SMS API error:', err.response.data);
    }
    throw new Error(err.message || 'Failed to send OTP');
  }
}

// Verify OTP for a phone number
function verifyOTP(phone, code) {
  phone = phone.replace(/[\s\-\+]/g, '');
  if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);

  // Mock mode: always accept "123456"
  if (isMockMode() && code === '123456') {
    otpStore.delete(phone);
    return true;
  }

  const stored = otpStore.get(phone);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(phone);
    return false; // Expired
  }
  if (stored.code !== code) return false;

  // Valid — clean up
  otpStore.delete(phone);
  return true;
}

module.exports = { sendOTP, verifyOTP, isMockMode, getCooldownRemaining };
