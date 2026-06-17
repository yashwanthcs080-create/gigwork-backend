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

async function exchangeCodeForVerifiedProfile({ code, worker, request }) {
  if (!code) throw new Error('Missing DigiLocker authorization code');

  if (!isMockMode()) {
    const baseUrl = process.env.DIGILOCKER_BASE_URL;
    const clientId = process.env.DIGILOCKER_CLIENT_ID;
    const clientSecret = process.env.DIGILOCKER_CLIENT_SECRET;
    const callbackUrl = request ? `${request.protocol}://${request.get('host')}/api/digilocker/callback` : '';
    const redirectUri = process.env.DIGILOCKER_REDIRECT_URI || callbackUrl;

    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error('DigiLocker OAuth is not fully configured (missing Client ID/Secret/Base URL)');
    }

    const axios = require('axios');
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    });

    try {
      const tokenUrl = `${baseUrl.replace(/\/$/, '')}/token`;
      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'accept': 'application/json'
        }
      });

      const tokenData = response.data;
      if (!tokenData || !tokenData.access_token) {
        console.error('DigiLocker token exchange failure response:', tokenData);
        throw new Error('Failed to obtain access token from DigiLocker');
      }

      // Try fetching e-Aadhaar XML data if available
      let fullName = tokenData.name || worker.name;
      let dateOfBirth = tokenData.dob || '1990-01-01';
      let aadhaarLast4 = '----';
      let xmlData = null;

      try {
        const eaadhaarUrl = `${baseUrl.replace(/\/$/, '')}/xml/eaadhaar`;
        const xmlResponse = await axios.get(eaadhaarUrl, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`
          }
        });
        xmlData = xmlResponse.data;

        if (xmlData) {
          const nameMatch = xmlData.match(/name="([^"]+)"/) || xmlData.match(/<Poi[^>]+name="([^"]+)"/);
          const dobMatch = xmlData.match(/dob="([^"]+)"/) || xmlData.match(/<Poi[^>]+dob="([^"]+)"/);
          
          if (nameMatch && nameMatch[1]) fullName = nameMatch[1];
          if (dobMatch && dobMatch[1]) dateOfBirth = dobMatch[1];

          // Extract last 4 of Aadhaar from XML if possible
          const uidMatch = xmlData.match(/uid="([^"]+)"/) || xmlData.match(/<UidData[^>]+uid="([^"]+)"/);
          if (uidMatch && uidMatch[1]) {
            const cleanUid = uidMatch[1].replace(/\D/g, '');
            if (cleanUid.length >= 4) {
              aadhaarLast4 = cleanUid.slice(-4);
            }
          }
        }
      } catch (xmlError) {
        console.warn('Could not fetch e-Aadhaar XML, falling back to profile details:', xmlError.message);
        if (tokenData.digilockerid) {
          aadhaarLast4 = tokenData.digilockerid.slice(-4);
        }
      }

      const verifiedAt = new Date();
      const proofPayload = [
        worker._id,
        worker.email,
        aadhaarLast4,
        verifiedAt.toISOString(),
        tokenData.digilockerid || 'unknown'
      ].join('|');

      return {
        fullName,
        dateOfBirth,
        aadhaarLast4,
        verificationStatus: 'verified',
        verifiedAt,
        documentHash: crypto.createHash('sha256').update(proofPayload).digest('hex')
      };

    } catch (err) {
      console.error('DigiLocker exchange error:', err.response ? err.response.data : err.message);
      throw new Error(err.message || 'Failed to exchange authorization code');
    }
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
