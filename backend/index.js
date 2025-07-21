const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());

// Cloudinary credentials
const CLOUD_NAME = process.env.CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const FOLDER_NAME = process.env.CLOUDINARY_FOLDER;

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: getenv('SMTP_PASS'),
  },
});

// Route: Send OTP
app.post('/send-otp', async (req, res) => {
  const { to, otp } = req.body;

  console.log('Sending OTP to:', to);
  try {
    await transporter.verify();

    const mailOptions = {
      from: `"FSL Express" <projectz681@gmail.com>`,
      to,
      subject: 'Your OTP Code',
      html: `<p>Your OTP code is: <b>${otp}</b></p>`,
    };

    const info = await transporter.sendMail(mailOptions);
    res.json({
      success: true,
      messageId: info.messageId,
      message: 'OTP sent successfully',
    });
  } catch (err) {
    console.error('OTP Send Error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: err.message,
    });
  }
});

// Route: Cloudinary search
app.get('/api/search', async (req, res) => {
  const searchQuery = (req.query.q || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  try {
    const response = await axios.get(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`, {
      auth: { username: API_KEY, password: API_SECRET },
      params: {
        expression: `folder:${FOLDER_NAME}`,
        max_results: 500,
      },
    });

    const resources = response.data.resources;
    const match = resources.find(res => {
      const namePart = res.public_id.split('/').pop().split('_')[0].toLowerCase();
      return namePart === searchQuery;
    });

    res.json({
      public_id: match?.public_id || null,
      message: match ? 'Match found' : 'No match found',
      all_files: resources.map(res => ({
        public_id: res.public_id,
        url: res.secure_url,
      })),
    });
  } catch (error) {
    console.error('Cloudinary Error:', error.message);
    res.status(500).json({ error: 'Error fetching Cloudinary data' });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
