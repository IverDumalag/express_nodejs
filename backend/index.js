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

// ================= OTP Route =================
app.post("/send-otp", async (req, res) => {
  const { to, otp } = req.body;

  console.log("Sending OTP to:", to);
  try {
    await transporter.verify();

    const mailOptions = {
      from: `"FSL Express" <projectz681@gmail.com>`,
      to,
      subject: "Your OTP Code",
      html: `<p>Your OTP code is: <b>${otp}</b></p>`,
    };

    const info = await transporter.sendMail(mailOptions);
    res.json({
      success: true,
      messageId: info.messageId,
      message: "OTP sent successfully",
    });
  } catch (err) {
    console.error("OTP Send Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: err.message,
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
