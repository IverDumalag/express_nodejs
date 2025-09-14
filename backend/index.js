// backend/server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const tf = require("@tensorflow/tfjs-node");

// Load .env only when NOT in production (Render injects env vars)
const envPath = path.join(__dirname, ".env");
if (process.env.NODE_ENV !== "production" && fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}

const app = express();
app.use(cors());
app.use(express.json());

// ---- Environment Variables ----
const {
  CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_FOLDER,

  // Old SMTP vars no longer used for OTP sending:
  // SMTP_USER,
  // SMTP_PASS,

  // Brevo HTTP API (required for OTP):
  BREVO_API_KEY,

  // Must be a Brevo-verified sender address
  FROM_EMAIL,

  // Optional debugging toggles
  SMTP_DEBUG,
} = process.env;

const PORT = process.env.PORT || 5000;

// ---- Cloudinary Search Route ----
app.get("/api/search", async (req, res) => {
  const searchQuery = (req.query.q || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  try {
    const response = await axios.get(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`,
      {
        auth: { username: CLOUDINARY_API_KEY, password: CLOUDINARY_API_SECRET },
        params: { expression: `folder:${CLOUDINARY_FOLDER}`, max_results: 500 },
      }
    );

    const resources = response.data.resources || [];
    const match = resources.find((r) => {
      const namePart = r.public_id.split("/").pop().split("_")[0].toLowerCase();
      return namePart === searchQuery;
    });

    res.json({
      public_id: match?.public_id || null,
      message: match ? "Match found" : "No match found",
      all_files: resources.map((r) => ({
        public_id: r.public_id,
        url: r.secure_url,
      })),
    });
  } catch (error) {
    console.error("Cloudinary Error:", error?.message || error);
    res.status(500).json({ error: "Error fetching Cloudinary data" });
  }
});

// ---------------------------------------------------------
// ---- OTP Route (Brevo HTTP API – no SMTP/Nodemailer) ----
// ---------------------------------------------------------
/**
 * POST /send-otp
 * Body: { to: string, otp: string|number, subject?: string }
 *
 * Requirements:
 *  - BREVO_API_KEY must be set
 *  - FROM_EMAIL must be a verified Brevo sender
 */
app.post("/send-otp", async (req, res) => {
  try {
    const { to, otp, subject } = req.body || {};

    // Basic validation
    if (!to || typeof to !== "string") {
      return res.status(400).json({ success: false, message: "Missing or invalid 'to' email." });
    }
    if (otp === undefined || otp === null || String(otp).trim() === "") {
      return res.status(400).json({ success: false, message: "Missing 'otp'." });
    }

    // Dev-safe fallback: don't crash if missing API key in local dev
    if (!BREVO_API_KEY) {
      console.warn("[/send-otp] BREVO_API_KEY not set. Simulating success (dev only).");
      return res.json({
        success: true,
        simulated: true,
        message: "OTP send simulated (set BREVO_API_KEY in env for real sending).",
      });
    }

    if (!FROM_EMAIL) {
      return res.status(500).json({
        success: false,
        message: "FROM_EMAIL is not set. Please configure a Brevo-verified sender.",
      });
    }

    // Construct email payload for Brevo API
    const emailPayload = {
      sender: { email: FROM_EMAIL, name: "FSL Express" },
      to: [{ email: to }],
      subject: subject || "Your OTP Code",
      htmlContent: `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size:16px; color:#111">
          <p style="margin:0 0 8px">Hi,</p>
          <p style="margin:0 0 12px">Your OTP code is:</p>
          <p style="font-size:28px; margin:4px 0 16px; font-weight:700; letter-spacing:2px">${String(otp).trim()}</p>
          <p style="margin:0 0 8px; color:#555">This code will expire shortly. If you didn’t request this, you can ignore this email.</p>
          <hr style="border:none; border-top:1px solid #eee; margin:16px 0" />
          <p style="font-size:12px; color:#888; margin:0">FSL Express</p>
        </div>
      `,
    };

    // Send via Brevo API
    const brevoResp = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      emailPayload,
      {
        headers: {
          "api-key": BREVO_API_KEY,
          "content-type": "application/json",
          accept: "application/json",
        },
        timeout: 10000, // 10s HTTP timeout for robustness
      }
    );

    const data = brevoResp?.data || {};
    // Brevo returns { messageId: "<...>" }
    return res.json({
      success: true,
      provider: "brevo-http",
      messageId: data.messageId || null,
      message: "OTP sent successfully",
    });
  } catch (err) {
    // Extract useful error info
    const status = err?.response?.status;
    const data = err?.response?.data;
    const msg = err?.message || String(err);

    console.error("OTP Send Error (Brevo HTTP):", {
      status,
      data,
      message: msg,
    });

    // Friendly hints
    let hint;
    if (status === 401) {
      hint = "Invalid BREVO_API_KEY. Double-check the key in your environment.";
    } else if (status === 400 && data?.message?.match(/sender/i)) {
      hint = "FROM_EMAIL must be a verified sender in Brevo.";
    }

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: data?.message || msg,
      hint,
      provider: "brevo-http",
    });
  }
});

// ---- ML Models ----
const modelConfigs = {
  alphabet: { path: "./models/alphabet/model.json", labelsPath: "./models/alphabet/metadata.json" },
  words: { path: "./models/words/model.json", labelsPath: "./models/words/metadata.json" },
};

const loadedModels = {};

async function getModel(name) {
  if (loadedModels[name]) return loadedModels[name];
  const cfg = modelConfigs[name];
  if (!cfg) return null;

  try {
    const modelAbs = path.join(__dirname, cfg.path);
    const model = await tf.loadLayersModel(`file://${modelAbs}`);

    let labels = [];
    const metaAbs = path.join(__dirname, cfg.labelsPath);
    if (fs.existsSync(metaAbs)) {
      const metadata = JSON.parse(fs.readFileSync(metaAbs, "utf8"));
      labels = Array.isArray(metadata.labels) ? metadata.labels : [];
    }

    loadedModels[name] = { model, labels };
    return loadedModels[name];
  } catch (e) {
    console.error(`Error loading model "${name}":`, e?.message || e);
    return null;
  }
}

const upload = multer({ storage: multer.memoryStorage() });

app.post("/predict/:model", upload.single("image"), async (req, res) => {
  try {
    const key = req.params.model;
    const m = await getModel(key);
    if (!m || !m.model) return res.status(400).json({ error: "Invalid model" });
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const imageTensor = tf.node
      .decodeImage(req.file.buffer, 3)
      .resizeNearestNeighbor([224, 224])
      .expandDims(0)
      .toFloat()
      .div(tf.scalar(255));

    const prediction = m.model.predict(imageTensor);
    const values = await prediction.data();

    let maxIdx = 0;
    for (let i = 1; i < values.length; i++) if (values[i] > values[maxIdx]) maxIdx = i;

    const label = m.labels[maxIdx] || `Class ${maxIdx}`;
    const confidence = `${(values[maxIdx] * 100).toFixed(1)}%`;

    tf.dispose([imageTensor, prediction]);
    res.json({ label, confidence });
  } catch (err) {
    console.error("Prediction error:", err?.message || err);
    res.status(500).json({ error: "Prediction failed" });
  }
});

// ---- Health ----
app.get("/", (req, res) => {
  res.json({
    service: "FSL Express Node.js Backend",
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: "1.0.2",
    email_provider: BREVO_API_KEY ? "brevo-http" : "(not configured)",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "express-nodejs",
  });
});

app.get("/wake", (req, res) => {
  const now = new Date().toISOString();
  console.log(`🌅 Wake-up ping received at ${now}`);
  res.json({ message: "Service is awake!", timestamp: now, status: "active" });
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // Sanity (no secrets printed)
  console.log("BREVO_API_KEY set:", !!BREVO_API_KEY);
  console.log("FROM_EMAIL:", FROM_EMAIL || "(not set)");
});
