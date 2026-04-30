const crypto = require('crypto');

const pendingStates = new Map();

function isMockMode() {
  return String(process.env.USE_MOCK_DIGILOCKER || 'true').toLowerCase() === 'true';
}

function createVerificationState(userId) {
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, {
    userId: String(userId),
    createdAt: Date.now()
  });
  return state;
}

function consumeVerificationState(state) {
  const record = pendingStates.get(state);
  pendingStates.delete(state);
  if (!record) throw new Error('Invalid or expired DigiLocker verification state');

  const maxAgeMs = 10 * 60 * 1000;
  if (Date.now() - record.createdAt > maxAgeMs) {
    throw new Error('DigiLocker verification state expired');
  }

  return record;
}

function buildAuthRedirectUrl({ state, request }) {
  const callbackUrl = `${request.protocol}://${request.get('host')}/api/digilocker/callback`;

  if (isMockMode()) {
    return `${callbackUrl}?code=mock-success&state=${encodeURIComponent(state)}`;
  }

  const baseUrl = process.env.DIGILOCKER_BASE_URL;
  const clientId = process.env.DIGILOCKER_CLIENT_ID;
  const redirectUri = process.env.DIGILOCKER_REDIRECT_URI || callbackUrl;

  if (!baseUrl || !clientId) {
    throw new Error('DigiLocker OAuth is not configured');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile aadhaar',
    state
  });

  return `${baseUrl.replace(/\/$/, '')}/authorize?${params.toString()}`;
}

async function exchangeCodeForVerifiedProfile({ code, worker }) {
  if (!code) throw new Error('Missing DigiLocker authorization code');

  if (!isMockMode()) {
    throw new Error('Real DigiLocker token exchange is not implemented yet');
  }

  const aadhaarLast4 = '1234';
  const verifiedAt = new Date();
  const proofPayload = [
    worker._id,
    worker.email,
    aadhaarLast4,
    verifiedAt.toISOString(),
    code
  ].join('|');

  return {
    fullName: worker.name,
    dateOfBirth: '1990-01-01',
    aadhaarLast4,
    verificationStatus: 'verified',
    verifiedAt,
    documentHash: crypto.createHash('sha256').update(proofPayload).digest('hex')
  };
}

function sanitizeVerification(verification) {
  if (!verification) {
    return {
      verificationStatus: 'not_verified'
    };
  }

  return {
    fullName: verification.fullName,
    dateOfBirth: verification.dateOfBirth,
    aadhaarLast4: verification.aadhaarLast4,
    verificationStatus: verification.verificationStatus || 'not_verified',
    verifiedAt: verification.verifiedAt,
    documentHash: verification.documentHash
  };
}

module.exports = {
  createVerificationState,
  consumeVerificationState,
  buildAuthRedirectUrl,
  exchangeCodeForVerifiedProfile,
  sanitizeVerification
};
