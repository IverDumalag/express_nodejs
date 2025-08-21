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
    pass: process.env.SMTP_PASS,
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

// ------------------ MODELS ------------------
const models = {
  alphabet: {
    url: "https://teachablemachine.withgoogle.com/models/WXYVjkR9b/",
    model: null,
  },
  words: {
    url: "https://teachablemachine.withgoogle.com/models/mPUpHpKe6/",
    model: null,
  },
};

// Load all models on startup
(async () => {
  for (const key in models) {
    const m = models[key];
    try {
      m.model = await tmImage.load(m.url + "model.json", m.url + "metadata.json");
      console.log(`✅ Loaded model: ${key}`);
    } catch (err) {
      console.error(`❌ Error loading model ${key}:`, err.message);
    }
  }
})();

// Predict route
app.post('/predict/:model', upload.single('image'), async (req, res) => {
  const key = req.params.model;
  if (!models[key] || !models[key].model) {
    return res.status(400).json({ error: "Invalid model" });
  }

  try {
    const img = await loadImage(req.file.buffer);
    const canvas = createCanvas(224, 224);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 224, 224);

    const prediction = await models[key].model.predict(canvas);
    const highest = prediction.reduce((a, b) =>
      a.probability > b.probability ? a : b
    );

    res.json({
      label: highest.className,
      confidence: (highest.probability * 100).toFixed(1) + "%",
    });
  } catch (err) {
    console.error("Prediction error:", err.message);
    res.status(500).json({ error: "Prediction failed" });
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
