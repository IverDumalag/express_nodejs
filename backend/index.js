const express = requir// Multiple SMTP configurations for better reliability on Render
const createEmailTransporters = () => {
  return [
    {
      name: "Brevo SMTP",
      transporter: nodemailer.createTransporter({
        host: "smtp-relay.brevo.com",
        port: 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        tls: {
          ciphers: 'SSLv3',
          rejectUnauthorized: false
        }
      })
    },
    {
      name: "Brevo SSL",
      transporter: nodemailer.createTransporter({
        host: "smtp-relay.brevo.com", 
        port: 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        tls: {
          rejectUnauthorized: false
        }
      })
    },
    {
      name: "Gmail Backup",
      transporter: nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER || 'projectz681@gmail.com',
          pass: process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      })
    }
  ];
};

const emailTransporters = createEmailTransporters();
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const tf = require("@tensorflow/tfjs-node");

dotenv.config({ path: path.join(__dirname, ".env") });

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
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ================= Enhanced OTP Route with Multiple Providers =================
app.post("/send-otp", async (req, res) => {
  const { to, otp } = req.body;

  console.log("📧 Attempting to send OTP to:", to);
  
  if (!to || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP are required",
    });
  }

  // Email content
  const mailOptions = {
    from: '"FSL Express" <projectz681@gmail.com>',
    to,
    subject: "🔐 Your FSL Express Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4A90E2; text-align: center;">FSL Express</h2>
        <h3>Email Verification</h3>
        <p>Hello!</p>
        <p>Your verification code is:</p>
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
          <h1 style="color: #4A90E2; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
        </div>
        <p>This code will expire in 10 minutes for security reasons.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <hr style="margin: 30px 0;">
        <p style="color: #888; font-size: 12px; text-align: center;">
          This email was sent from FSL Express registration system.
        </p>
      </div>
    `,
    text: `Your FSL Express verification code is: ${otp}. This code will expire in 10 minutes.`
  };

  // Try each email provider
  for (let i = 0; i < emailTransporters.length; i++) {
    const { name, transporter } = emailTransporters[i];
    console.log(`🔄 Attempting ${name}...`);
    
    try {
      // Test connection with short timeout
      await Promise.race([
        transporter.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 8000)
        )
      ]);
      
      console.log(`✅ ${name} connection verified`);
      
      // Send email with timeout
      const info = await Promise.race([
        transporter.sendMail(mailOptions),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Send timeout')), 15000)
        )
      ]);
      
      console.log(`✅ Email sent successfully via ${name}:`, info.messageId);
      return res.json({
        success: true,
        messageId: info.messageId,
        message: "OTP sent successfully",
        provider: name
      });
      
    } catch (err) {
      console.error(`❌ ${name} failed:`, err.message);
      
      // If this is the last provider, return error
      if (i === emailTransporters.length - 1) {
        console.error("🚨 All email providers failed");
        return res.status(500).json({
          success: false,
          message: "Email service temporarily unavailable. Please try again later.",
          error: "All email providers failed",
          lastError: err.message
        });
      }
      
      // Continue to next provider
      console.log(`🔄 Trying next email provider...`);
      continue;
    }
  }
});

// ================= Simple OTP Endpoint (Alternative) =================
app.post("/send-otp-simple", async (req, res) => {
  const { to, otp } = req.body;
  console.log("📧 Simple OTP send to:", to);
  
  try {
    // Use only Gmail service which is more reliable on Render
    const simpleTransporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        user: 'projectz681@gmail.com',
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 5000,
      socketTimeout: 5000,
    });

    const mailOptions = {
      from: 'projectz681@gmail.com',
      to,
      subject: "FSL Express - Verification Code",
      text: `Your verification code is: ${otp}`,
      html: `<h3>Your FSL Express verification code is: <strong>${otp}</strong></h3>`
    };

    const info = await simpleTransporter.sendMail(mailOptions);
    console.log("✅ Simple email sent:", info.messageId);
    
    res.json({
      success: true,
      messageId: info.messageId,
      message: "OTP sent via simple method"
    });
    
  } catch (error) {
    console.error("❌ Simple OTP failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Simple email service failed",
      error: error.message
    });
  }
});

// ================= Cloudinary Search Route =================
app.get("/api/search", async (req, res) => {
  const searchQuery = (req.query.q || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  try {
    const response = await axios.get(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`,
      {
        auth: { username: API_KEY, password: API_SECRET },
        params: {
          expression: `folder:${FOLDER_NAME}`,
          max_results: 500,
        },
      }
    );

    const resources = response.data.resources;
    const match = resources.find((res) => {
      const namePart = res.public_id
        .split("/")
        .pop()
        .split("_")[0]
        .toLowerCase();
      return namePart === searchQuery;
    });

    res.json({
      public_id: match?.public_id || null,
      message: match ? "Match found" : "No match found",
      all_files: resources.map((res) => ({
        public_id: res.public_id,
        url: res.secure_url,
      })),
    });
  } catch (error) {
    console.error("Cloudinary Error:", error.message);
    res.status(500).json({ error: "Error fetching Cloudinary data" });
  }
});

// ================= ML MODELS =================
const modelConfigs = {
  alphabet: { path: "./models/alphabet/model.json", labelsPath: "./models/alphabet/metadata.json" },
  words: { path: "./models/words/model.json", labelsPath: "./models/words/metadata.json" },
};

const loadedModels = {};

async function getModel(name) {
  if (loadedModels[name]) return loadedModels[name];
  const config = modelConfigs[name];
  if (!config) return null;
  try {
    const absPath = path.join(__dirname, config.path);
    const model = await tf.loadLayersModel(`file://${absPath}`);
    let labels = [];
    const metadataPath = path.join(__dirname, config.labelsPath);
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      labels = metadata.labels || [];
    }
    loadedModels[name] = { model, labels };
    return loadedModels[name];
  } catch (err) {
    console.error(`❌ Error loading model ${name}:`, err.message);
    return null;
  }
}

// Multer for uploads
const upload = multer({ storage: multer.memoryStorage() });

// Prediction route
app.post("/predict/:model", upload.single("image"), async (req, res) => {
  try {
    const key = req.params.model;
    const m = await getModel(key);
    if (!m || !m.model) {
      return res.status(400).json({ error: "Invalid model" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }
    // Decode image to tensor
    const imageTensor = tf.node.decodeImage(req.file.buffer, 3)
      .resizeNearestNeighbor([224, 224])
      .expandDims(0)
      .toFloat()
      .div(tf.scalar(255));
    const prediction = m.model.predict(imageTensor);
    const values = await prediction.data();
    // Find highest probability
    const maxIndex = values.indexOf(Math.max(...values));
    const label = m.labels[maxIndex] || `Class ${maxIndex}`;
    const confidence = (values[maxIndex] * 100).toFixed(1) + "%";
    // Dispose tensors to free memory
    tf.dispose([imageTensor, prediction]);
    res.json({ label, confidence });
  } catch (err) {
    console.error("Prediction error:", err.message);
    res.status(500).json({ error: "Prediction failed" });
  }
});

// ================= Keep-Alive & Health Endpoints =================
app.get("/", (req, res) => {
  res.json({
    service: "FSL Express Node.js Backend",
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "express-nodejs"
  });
});

app.get("/wake", (req, res) => {
  const now = new Date().toISOString();
  console.log(`🌅 Wake-up ping received at ${now}`);
  res.json({
    message: "Service is awake!",
    timestamp: now,
    status: "active"
  });
});

// ================= Start Server =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
