const express = require('express');
const router = express.Router();

// AI chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        error: 'Messages array is required' 
      });
    }

    console.log('AI Chat request:', {
      userId: req.userId,
      messageCount: messages.length,
      lastMessage: messages[messages.length - 1]?.content?.substring(0, 50) + '...'
    });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.CLIENT_URL,
        'X-Title': 'Tuktuk AI Chat'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Ты полезный AI-ассистент. Отвечай на русском языке, будь дружелюбным и полезным.'
          },
          ...messages.map(msg => ({
            role: msg.type === 'user' ? 'user' : 'assistant',
            content: msg.content
          }))
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      
      let errorMessage = 'Извините, произошла ошибка при обработке вашего запроса. Попробуйте еще раз.';
      
      if (response.status === 429) {
        errorMessage = 'Превышен лимит запросов к API. Подождите немного и попробуйте снова.';
      } else if (response.status === 401) {
        errorMessage = 'Ошибка авторизации API. Проверьте ключ доступа.';
      } else if (response.status === 400) {
        errorMessage = 'Неверный запрос к API. Попробуйте переформулировать вопрос.';
      } else if (response.status === 500) {
        errorMessage = 'Ошибка сервера API. Попробуйте позже.';
      }
      
      return res.status(response.status).json({ 
        error: errorMessage,
        isError: true
      });
    }

    const data = await response.json();
    
    res.json({
      content: data.choices[0].message.content,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера',
      isError: true
    });
  }
});

module.exports = router;
