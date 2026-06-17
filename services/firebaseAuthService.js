// services/firebaseAuthService.js — Firebase ID Token Verification (JWT)
// Verifies client-side Firebase phone auth tokens securely without a service account.

const jwt = require('jsonwebtoken');
const axios = require('axios');

// Cache for Google's public certificates
let googleCerts = null;
let certsExpiry = 0;

async function getGoogleCerts() {
  if (googleCerts && Date.now() < certsExpiry) {
    return googleCerts;
  }

  try {
    const response = await axios.get(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken-system@system.gserviceaccount.com'
    );
    googleCerts = response.data;
    // Cache for 1 hour
    certsExpiry = Date.now() + 3600 * 1000;
    return googleCerts;
  } catch (err) {
    console.error('Failed to fetch Firebase public certs:', err.message);
    throw new Error('Failed to verify authentication token');
  }
}

/**
 * Verify a Firebase ID token and return the verified payload
 * @param {string} token - The Firebase ID token (JWT)
 * @returns {object} { phone_number, uid }
 */
async function verifyFirebaseToken(token) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('Firebase Project ID is not configured in server .env');
  }

  // Decode the token header to find the Key ID (kid)
  const decodedToken = jwt.decode(token, { complete: true });
  if (!decodedToken || !decodedToken.header || !decodedToken.header.kid) {
    throw new Error('Invalid token format');
  }

  const kid = decodedToken.header.kid;
  const certs = await getGoogleCerts();
  const cert = certs[kid];

  if (!cert) {
    throw new Error('Invalid token signature key');
  }

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      cert,
      {
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`,
        algorithms: ['RS256']
      },
      (err, decoded) => {
        if (err) {
          console.error('Firebase token verification failed:', err.message);
          return reject(new Error('Authentication token verification failed'));
        }
        resolve({
          phone: decoded.phone_number,
          uid: decoded.sub
        });
      }
    );
  });
}

function isConfigured() {
  return !!process.env.FIREBASE_PROJECT_ID;
}

module.exports = { verifyFirebaseToken, isConfigured };
