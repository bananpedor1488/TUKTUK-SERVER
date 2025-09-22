const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const router = express.Router();

// Helper to get model id for Kandinsky 3.1
async function getKandinskyModelId(headers) {
  try {
    const { data } = await axios.get('https://api-key.fusionbrain.ai/key/api/v1/models', { headers });
    const models = Array.isArray(data) ? data : (data?.models || []);
    const found = models.find(m => /kandinsky/i.test(m?.name || '') && /3\.1/.test(m?.name || '')) || models.find(m => /kandinsky/i.test(m?.name || ''));
    return found?.id || found?._id || models?.[0]?.id || models?.[0]?._id;
  } catch (e) {
    console.error('Failed to fetch models from FusionBrain:', e?.response?.data || e.message);
    return null;
  }
}

// Start generation
async function startGeneration({ prompt, negativePrompt, width, height, seed, numImages = 1, headers, modelId }) {
  const form = new FormData();
  form.append('model_id', String(modelId));
  form.append('params', JSON.stringify({
    type: 'GENERATE',
    num_images: numImages,
    width: width || 1024,
    height: height || 1024,
    negativePrompt: negativePrompt || '',
    seed: seed || Math.floor(Math.random() * 1e9),
    text: prompt
  }));

  const { data } = await axios.post('https://api-key.fusionbrain.ai/key/api/v1/text2image/run', form, {
    headers: { ...headers, ...form.getHeaders() }
  });
  return data;
}

// Poll result
async function pollResult(uuid, headers, timeoutMs = 60000, intervalMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data } = await axios.get(`https://api-key.fusionbrain.ai/key/api/v1/text2image/status/${uuid}`, { headers });
    if (data?.status === 'DONE' && Array.isArray(data?.images) && data.images.length > 0) {
      // FusionBrain returns base64 images without prefix
      return `data:image/png;base64,${data.images[0]}`;
    }
    if (data?.status === 'ERROR') {
      throw new Error(data?.error || 'Generation failed');
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Generation timeout');
}

// POST /images/kandinsky
router.post('/kandinsky', async (req, res) => {
  try {
    const apiKey = process.env.FUSIONBRAIN_KEY;
    const apiSecret = process.env.FUSIONBRAIN_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ message: 'FusionBrain credentials are not set on server' });
    }

    const { prompt, negativePrompt = '', width = 1024, height = 1024, seed, numImages = 1 } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 2) {
      return res.status(400).json({ message: 'prompt is required' });
    }

    const headers = {
      'X-Key': `Key ${apiKey}`,
      'X-Secret': `Secret ${apiSecret}`
    };

    const modelId = await getKandinskyModelId(headers);
    if (!modelId) {
      return res.status(502).json({ message: 'Kandinsky model not found' });
    }

    const run = await startGeneration({ prompt, negativePrompt, width, height, seed, numImages, headers, modelId });
    const uuid = run?.uuid || run?.id;
    if (!uuid) {
      return res.status(502).json({ message: 'Failed to start generation', run });
    }

    const dataUrl = await pollResult(uuid, headers);
    return res.json({ success: true, image: dataUrl });
  } catch (error) {
    console.error('Kandinsky generation error:', error?.response?.data || error.message);
    res.status(500).json({ message: 'Generation failed', error: error?.response?.data || error.message });
  }
});

module.exports = router;
