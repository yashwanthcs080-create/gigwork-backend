const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.FAST2SMS_API_KEY;

if (!apiKey) {
  console.log('ℹ️ FAST2SMS_API_KEY is empty/missing in .env.');
  console.log('🔄 Running in Mock OTP Mode verification...\n');
  
  const otpService = require('./services/otpService');
  
  console.log('Checking isMockMode()...', otpService.isMockMode() ? '✅ Yes' : '❌ No');
  
  // Test sending OTP
  const phone = '9876543210';
  console.log(`Sending Mock OTP to ${phone}...`);
  otpService.sendOTP(phone)
    .then(res => {
      console.log('Response:', JSON.stringify(res, null, 2));
      console.log(`Verifying with code "123456" (universal mockup code)...`);
      const verifiedUniversal = otpService.verifyOTP(phone, '123456');
      console.log('Verification status (Universal):', verifiedUniversal ? '✅ Verified!' : '❌ Failed');
    })
    .catch(err => {
      console.error('Error sending Mock OTP:', err.message);
    });
    
  return;
}

const args = process.argv.slice(2);
const phoneInput = args[0];

console.log('Using API Key (first 10 chars):', apiKey.substring(0, 10) + '...');

async function checkBalance() {
  try {
    const response = await axios.post('https://www.fast2sms.com/dev/wallet', {}, {
      headers: {
        'authorization': apiKey,
        'accept': 'application/json'
      }
    });
    console.log('\n✅ Wallet Balance check successful!');
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('\n❌ Wallet Balance check failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error message:', error.message);
    }
    return false;
  }
}

async function sendTestOTP(phone) {
  // Normalize phone (remove +91 prefix, spaces, dashes)
  let cleanedPhone = phone.replace(/[\s\-\+]/g, '');
  if (cleanedPhone.startsWith('91') && cleanedPhone.length === 12) {
    cleanedPhone = cleanedPhone.slice(2);
  }
  if (!/^\d{10}$/.test(cleanedPhone)) {
    console.error(`\n❌ Invalid phone number "${phone}". Must be 10 digits (e.g. 9876543210).`);
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  console.log(`\n📱 Sending test OTP (${code}) to phone: ${cleanedPhone}...`);

  try {
    const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
      params: {
        authorization: apiKey,
        variables_values: code,
        route: 'otp',
        numbers: cleanedPhone
      }
    });

    if (response.data && response.data.return === true) {
      console.log('✅ OTP sent successfully!');
      console.log('Response data:', JSON.stringify(response.data, null, 2));
    } else {
      console.error('❌ Failed to send OTP:');
      console.error('Response data:', response.data);
    }
  } catch (error) {
    console.error('❌ Fast2SMS API error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error message:', error.message);
    }
  }
}

async function main() {
  const ok = await checkBalance();
  if (ok && phoneInput) {
    await sendTestOTP(phoneInput);
  } else if (!phoneInput) {
    console.log('\n💡 Tip: You can also test sending a real SMS by running:');
    console.log('   node verify_fast2sms.js <your_10_digit_phone_number>');
  }
}

main();
