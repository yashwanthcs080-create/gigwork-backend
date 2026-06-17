// services/googleAuthService.js — Google Sign-In Token Verification
const { OAuth2Client } = require('google-auth-library');

let client = null;

function getClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '736951455554-gfaf277nrsqr06tg2fk5cbkpfqj0c40a.apps.googleusercontent.com';
  if (!client && clientId) {
    client = new OAuth2Client(clientId);
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
    const clientId = process.env.GOOGLE_CLIENT_ID || '736951455554-gfaf277nrsqr06tg2fk5cbkpfqj0c40a.apps.googleusercontent.com';
    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: clientId
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
  return !!(process.env.GOOGLE_CLIENT_ID || '736951455554-gfaf277nrsqr06tg2fk5cbkpfqj0c40a.apps.googleusercontent.com');
}

module.exports = { verifyGoogleToken, isConfigured };
