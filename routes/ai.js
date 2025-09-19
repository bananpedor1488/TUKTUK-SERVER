const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Простая проверка токена без refresh token
const simpleAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error('Simple auth error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(403).json({ message: 'Invalid token' });
  }
};

// AI chat endpoint
router.post('/chat', simpleAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        error: 'Messages array is required' 
      });
    }

    console.log('🤖 AI Chat request:', {
      userId: req.userId,
      messageCount: messages.length,
      lastMessage: messages[messages.length - 1]?.content?.substring(0, 50) + '...',
      timestamp: new Date().toISOString(),
      authSuccess: true
    });

    // Проверяем наличие API ключа
    if (!process.env.OPENROUTER_API_KEY) {
      console.log('❌ OPENROUTER_API_KEY not configured');
      return res.status(500).json({ 
        error: 'AI сервис временно недоступен. Попробуйте позже.',
        isError: true
      });
    }

    console.log('🤖 Calling OpenRouter API with model:', process.env.OPENROUTER_MODEL);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.CLIENT_URL || 'https://tuktuk-five.vercel.app',
        'X-Title': 'Tuktuk AI Chat'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5',
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
      console.error('❌ OpenRouter API error:', response.status, errorText);
      
      let errorMessage = 'Извините, произошла ошибка при обработке вашего запроса. Попробуйте еще раз.';
      
      if (response.status === 429) {
        errorMessage = 'Превышен лимит запросов к AI сервису. Подождите немного и попробуйте снова.';
      } else if (response.status === 401) {
        errorMessage = 'AI сервис временно недоступен. Попробуйте позже.';
        console.log('❌ OpenRouter API key issue - check configuration');
      } else if (response.status === 400) {
        errorMessage = 'Неверный запрос к AI сервису. Попробуйте переформулировать вопрос.';
      } else if (response.status === 500) {
        errorMessage = 'Ошибка AI сервиса. Попробуйте позже.';
      } else if (response.status === 403) {
        errorMessage = 'AI сервис временно недоступен. Попробуйте позже.';
      }
      
      return res.status(200).json({ 
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
    console.error('❌ AI chat error:', error);
    
    // Fallback ответ, если OpenRouter недоступен
    const fallbackResponse = getFallbackResponse(messages[messages.length - 1]?.content);
    
    res.json({
      content: fallbackResponse,
      timestamp: new Date().toISOString(),
      isFallback: true
    });
  }
});

// Простые ответы как fallback
function getFallbackResponse(userMessage) {
  const message = userMessage?.toLowerCase() || '';
  
  if (message.includes('привет') || message.includes('hello')) {
    return 'Привет! Я AI-ассистент. К сожалению, основной AI сервис временно недоступен, но я могу помочь с базовыми вопросами.';
  }
  
  if (message.includes('как дела') || message.includes('как ты')) {
    return 'У меня все хорошо! Я готов помочь вам, хотя основной AI сервис сейчас недоступен.';
  }
  
  if (message.includes('спасибо')) {
    return 'Пожалуйста! Рад был помочь!';
  }
  
  if (message.includes('помощь') || message.includes('help')) {
    return 'Я AI-ассистент и готов помочь с различными вопросами. Основной сервис временно недоступен, но я постараюсь ответить на ваши вопросы.';
  }
  
  return 'Извините, основной AI сервис временно недоступен. Попробуйте позже или обратитесь к администратору.';
}

module.exports = router;
