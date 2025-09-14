const express = require("express");
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

const CLOUD_NAME = process.env.CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const FOLDER_NAME = process.env.CLOUDINARY_FOLDER;

// Nodemailer transporters with fallback support
const brevoTransporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 30000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
  pool: true,
  maxConnections: 3,
  rateDelta: 20000,
  rateLimit: 5,
});

// Gmail fallback transporter
const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
  connectionTimeout: 30000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});

// Function to send email with multiple fallbacks
async function sendEmailWithFallback(mailOptions) {
  const transporters = [
    { name: 'Brevo', transport: brevoTransporter, condition: () => process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_PASS !== 'getenv(\'SMTP_PASS\')' },
    { name: 'Gmail', transport: gmailTransporter, condition: () => process.env.GMAIL_USER && process.env.GMAIL_PASS }
  ];

  const errors = [];

  for (const { name, transport, condition } of transporters) {
    if (!condition()) {
      errors.push(`${name}: Not configured`);
      continue;
    }

    try {
      console.log(`Trying ${name} SMTP...`);
      
      // Quick verification with shorter timeout
      await Promise.race([
        transport.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`${name} verification timeout`)), 15000)
        )
      ]);

      console.log(`${name} verified, sending email...`);
      
      // Adjust from address for Gmail
      const adjustedOptions = { ...mailOptions };
      if (name === 'Gmail' && process.env.GMAIL_USER) {
        adjustedOptions.from = `"FSL Express" <${process.env.GMAIL_USER}>`;
      }

      const info = await transport.sendMail(adjustedOptions);
      console.log(`Email sent successfully via ${name}:`, info.messageId);
      return info;

    } catch (error) {
      console.log(`${name} failed:`, error.message);
      errors.push(`${name}: ${error.message}`);
    }
  }

  throw new Error(`All SMTP services failed: ${errors.join(', ')}`);
}

app.post("/send-otp", async (req, res) => {
  const { to, otp } = req.body;
  console.log("Sending OTP to:", to);
  
  if (!to || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP are required",
    });
  }

  try {
    const mailOptions = {
      from: "FSL Express <projectz681@gmail.com>",
      to,
      subject: "Your OTP Code",
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">FSL Express - OTP Verification</h2>
          <p>Your OTP code is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #007bff; font-size: 32px; margin: 0;">${otp}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 14px;">If you did not request this code, please ignore this email.</p>
        </div>`,
    };

    console.log("Attempting to send email with fallback...");
    const info = await sendEmailWithFallback(mailOptions);
    
    res.json({
      success: true,
      messageId: info.messageId,
      message: "OTP sent successfully",
    });
  } catch (err) {
    console.error("OTP Send Error:", err.message);
    
    let errorMessage = "Failed to send OTP";
    if (err.message.includes("timeout")) {
      errorMessage = "Connection timeout - please try again in a few moments";
    } else if (err.message.includes("Authentication")) {
      errorMessage = "Email service authentication failed";
    } else if (err.message.includes("Not configured")) {
      errorMessage = "Email service not properly configured";
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === "development" ? err.message : "Internal server error",
    });
  }
});

app.get("/test-smtp", async (req, res) => {
  try {
    console.log("Testing SMTP services...");
    const results = [];

    // Test Brevo
    if (process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_PASS !== 'getenv(\'SMTP_PASS\')') {
      try {
        const startTime = Date.now();
        await Promise.race([
          brevoTransporter.verify(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Brevo timeout")), 15000)
          )
        ]);
        const endTime = Date.now();
        results.push({
          service: "Brevo",
          success: true,
          responseTime: `${endTime - startTime}ms`,
          message: "Connection successful"
        });
      } catch (err) {
        results.push({
          service: "Brevo",
          success: false,
          error: err.message
        });
      }
    } else {
      results.push({
        service: "Brevo",
        success: false,
        message: "Not configured or using placeholder password"
      });
    }

    // Test Gmail
    if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
      try {
        const startTime = Date.now();
        await Promise.race([
          gmailTransporter.verify(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Gmail timeout")), 15000)
          )
        ]);
        const endTime = Date.now();
        results.push({
          service: "Gmail",
          success: true,
          responseTime: `${endTime - startTime}ms`,
          message: "Connection successful"
        });
      } catch (err) {
        results.push({
          service: "Gmail",
          success: false,
          error: err.message
        });
      }
    } else {
      results.push({
        service: "Gmail",
        success: false,
        message: "Not configured"
      });
    }

    const hasWorkingService = results.some(r => r.success);
    
    res.status(hasWorkingService ? 200 : 500).json({
      success: hasWorkingService,
      message: hasWorkingService ? "At least one SMTP service is working" : "All SMTP services failed",
      results,
      environment: {
        brevo_configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_PASS !== 'getenv(\'SMTP_PASS\')'),
        gmail_configured: !!(process.env.GMAIL_USER && process.env.GMAIL_PASS),
        smtp_pass_value: process.env.SMTP_PASS ? (process.env.SMTP_PASS === 'getenv(\'SMTP_PASS\')' ? 'PLACEHOLDER_VALUE' : 'SET') : 'NOT_SET'
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("SMTP Test Error:", err);
    res.status(500).json({
      success: false,
      message: "SMTP test failed",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

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
    console.error(`Error loading model ${name}:`, err.message);
    return null;
  }
}

const upload = multer({ storage: multer.memoryStorage() });

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
    const imageTensor = tf.node.decodeImage(req.file.buffer, 3)
      .resizeNearestNeighbor([224, 224])
      .expandDims(0)
      .toFloat()
      .div(tf.scalar(255));
    const prediction = m.model.predict(imageTensor);
    const values = await prediction.data();
    const maxIndex = values.indexOf(Math.max(...values));
    const label = m.labels[maxIndex] || `Class ${maxIndex}`;
    const confidence = (values[maxIndex] * 100).toFixed(1) + "%";
    tf.dispose([imageTensor, prediction]);
    res.json({ label, confidence });
  } catch (err) {
    console.error("Prediction error:", err.message);
    res.status(500).json({ error: "Prediction failed" });
  }
});

app.get("/", (req, res) => {
  res.json({
    service: "FSL Express Node.js Backend",
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: "1.0.1"
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
  console.log(`Wake-up ping received at ${now}`);
  res.json({
    message: "Service is awake!",
    timestamp: now,
    status: "active"
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
