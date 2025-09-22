const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const router = express.Router();

async function checkPipelineAvailability(headers) {
  try {
    const { data } = await axios.get('https://api-key.fusionbrain.ai/key/api/v1/pipeline/availability', { headers });
    return data; // { pipeline_status: 'AVAILABLE' | 'DISABLED_BY_QUEUE' | ... }
  } catch (e) {
    // If endpoint not available, fail open
    return { pipeline_status: 'UNKNOWN', error: e?.response?.data || e.message };
  }
}

// Helper to get pipeline id for Kandinsky 3.0
async function getKandinskyPipelineId(headers) {
  try {
    const { data } = await axios.get('https://api-key.fusionbrain.ai/key/api/v1/pipelines', { headers });
    const list = Array.isArray(data) ? data : (data?.pipelines || []);
    // Prefer 3.0 as per user request
    const found = list.find(p => /kandinsky/i.test(p?.name || '') && String(p?.version) === '3.0')
      || list.find(p => /kandinsky/i.test(p?.name || ''))
      || list[0];
    return found?.id || found?.uuid;
  } catch (e) {
    console.error('Failed to fetch pipelines from FusionBrain:', e?.response?.data || e.message);
    return null;
  }
}

// Start generation (pipelines)
async function startGeneration({ prompt, negativePrompt, width, height, numImages = 1, headers, pipelineId }) {
  const form = new FormData();
  form.append('pipeline_id', String(pipelineId));
  form.append('params', JSON.stringify({
    type: 'GENERATE',
    numImages: numImages,
    width: width || 1024,
    height: height || 1024,
    negativePromptDecoder: negativePrompt || '',
    generateParams: {
      query: String(prompt)
    }
  }), { contentType: 'application/json' });

  const { data } = await axios.post('https://api-key.fusionbrain.ai/key/api/v1/pipeline/run', form, {
    headers: { ...headers, ...form.getHeaders() }
  });
  return data; // { uuid, status }
}

// Poll result
async function pollResult(uuid, headers, timeoutMs = 60000, intervalMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data } = await axios.get(`https://api-key.fusionbrain.ai/key/api/v1/pipeline/status/${uuid}`, { headers });
    if (data?.status === 'DONE' && data?.result && Array.isArray(data.result.files) && data.result.files.length > 0) {
      // files are base64 strings without data: prefix
      return `data:image/png;base64,${data.result.files[0]}`;
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

    // Normalize headers: allow env to contain raw token or already prefixed with 'Key ' / 'Secret '
    const normKey = apiKey.startsWith('Key ') ? apiKey : `Key ${apiKey}`;
    const normSecret = apiSecret.startsWith('Secret ') ? apiSecret : `Secret ${apiSecret}`;
    const headers = {
      'X-Key': normKey,
      'X-Secret': normSecret
    };

    const pipelineId = await getKandinskyPipelineId(headers);
    if (!pipelineId) {
      return res.status(502).json({ message: 'Kandinsky pipeline not found' });
    }

    // Optional: check availability to not waste attempts
    const availability = await checkPipelineAvailability(headers);
    if (availability?.pipeline_status && availability.pipeline_status !== 'AVAILABLE') {
      return res.status(503).json({ message: 'Kandinsky service is temporarily unavailable', availability });
    }

    const run = await startGeneration({ prompt, negativePrompt, width, height, numImages, headers, pipelineId });
    const uuid = run?.uuid || run?.id;
    if (!uuid) {
      return res.status(502).json({ message: 'Failed to start generation', run });
    }

    const dataUrl = await pollResult(uuid, headers);
    return res.json({ success: true, image: dataUrl });
  } catch (error) {
    const errPayload = error?.response?.data || { message: error.message };
    console.error('Kandinsky generation error:', errPayload);
    const status = error?.response?.status || 500;
    res.status(status).json({ message: 'Generation failed', error: errPayload });
  }
});

module.exports = router;
