// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const CLOUD_NAME = process.env.CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const FOLDER_NAME = process.env.CLOUDINARY_FOLDER;

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

    const match = resources.find((res) => {
      const namePart = res.public_id.split('/').pop().split('_')[0].toLowerCase();
      return namePart === searchQuery;
    });

    res.json({
      public_id: match?.public_id || null,
      message: match ? 'Match found' : 'No match found',
      all_files: resources.map(res => ({
        public_id: res.public_id,
        url: res.secure_url
      }))
    });
  } catch (error) {
    console.error('Cloudinary API error:', error.message);
    res.status(500).json({ error: 'Error fetching Cloudinary data' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
