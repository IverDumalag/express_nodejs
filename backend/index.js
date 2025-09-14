// backend/server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
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
  SMTP_USER,
  SMTP_PASS,
  FROM_EMAIL, // optional; must be verified in Brevo
  SMTP_DEBUG, // optional: "1" to enable SMTP logs
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

// ---- Nodemailer Transport (Brevo) ----
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,       // STARTTLS
  secure: false,   // use STARTTLS (not SMTPS)
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  logger: SMTP_DEBUG === "1",
  debug: SMTP_DEBUG === "1",
});

// ---- OTP Route ----
app.post("/send-otp", async (req, res) => {
  const { to, otp } = req.body || {};
  if (!to || !otp) {
    return res.status(400).json({ success: false, message: "Missing 'to' or 'otp'." });
  }

  // Use a Brevo-verified sender; fallback to SMTP_USER
  const sender = FROM_EMAIL || SMTP_USER;

  try {
    await transporter.verify(); // surface auth/sender problems early

    const info = await transporter.sendMail({
      from: `"FSL Express" <${sender}>`,
      to,
      subject: "Your OTP Code",
      html: `<p>Your OTP code is: <b>${String(otp).trim()}</b></p>`,
    });

    return res.json({
      success: true,
      messageId: info.messageId,
      message: "OTP sent successfully",
    });
  } catch (err) {
    console.error("OTP Send Error:", err?.stack || err?.message || err);
    const hint =
      /EAUTH/i.test(String(err)) ? "Check SMTP_USER/SMTP_PASS." :
      /(sender|from).*(not|allowed|authorized|verify)/i.test(String(err)) ? "Use a Brevo-verified FROM_EMAIL." :
      undefined;

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: err?.message || String(err),
      hint,
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

    const imageTensor = tf.node.decodeImage(req.file.buffer, 3)
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
    version: "1.0.1",
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
  // one-time sanity (no secrets printed)
  console.log("SMTP_USER len:", (SMTP_USER || "").length);
  console.log("SMTP_PASS len:", (SMTP_PASS || "").length);
  console.log("FROM_EMAIL:", FROM_EMAIL || "(not set, will use SMTP_USER)");
});
