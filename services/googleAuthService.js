// services/googleAuthService.js — Google Sign-In Token Verification
const { OAuth2Client } = require('google-auth-library');

let client = null;

function getClient() {
  if (!client && process.env.GOOGLE_CLIENT_ID) {
    client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return client;
}

/**
 * Verify a Google ID token (credential from Google Sign-In button)
 * @param {string} credential - The JWT token from Google
 * @returns {object} { googleId, email, name, picture }
 */
async function verifyGoogleToken(credential) {
  const oauthClient = getClient();
  if (!oauthClient) {
    throw new Error('Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in .env');
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified
    };
  } catch (err) {
    console.error('Google token verification failed:', err.message);
    throw new Error('Invalid Google token. Please try again.');
  }
}

function isConfigured() {
  return !!process.env.GOOGLE_CLIENT_ID;
}

module.exports = { verifyGoogleToken, isConfigured };
