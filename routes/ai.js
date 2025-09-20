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

// AI chat endpoint using Google Gemini API
router.post('/chat', simpleAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        error: 'Messages array is required' 
      });
    }

    console.log('🤖 Gemini AI Chat request:', {
      userId: req.userId,
      messageCount: messages.length,
      lastMessage: messages[messages.length - 1]?.content?.substring(0, 50) + '...',
      timestamp: new Date().toISOString(),
      authSuccess: true
    });

    // Проверяем наличие API ключа Gemini
    const geminiApiKey = process.env.GEMINI_API_KEY || 'AIzaSyCJ6fygtEi4HywiUg6-qU-MlwHvJfSRZ3s';
    
    if (!geminiApiKey) {
      console.log('❌ GEMINI_API_KEY not configured');
      return res.status(500).json({ 
        error: 'AI сервис временно недоступен. Попробуйте позже.',
        isError: true
      });
    }

    console.log('🤖 Calling Google Gemini API');

    // Подготавливаем сообщения для Gemini (правильный формат)
    const systemPrompt = 'Ты полезный AI-ассистент. Отвечай на русском языке, будь дружелюбным и полезным. Помогай пользователям с их вопросами и задачами.';
    
    // Объединяем все сообщения в один текст для Gemini
    const conversationText = messages.map(msg => {
      const prefix = msg.type === 'user' ? 'Пользователь: ' : 'Ассистент: ';
      return prefix + msg.content;
    }).join('\n\n');
    
    const fullPrompt = systemPrompt + '\n\n' + conversationText + '\n\nАссистент:';

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': geminiApiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: fullPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Gemini API error:', response.status, errorText);
      
      let errorMessage = 'Извините, произошла ошибка при обработке вашего запроса. Попробуйте еще раз.';
      
      if (response.status === 429) {
        errorMessage = 'Превышен лимит запросов к AI сервису. Подождите немного и попробуйте снова.';
      } else if (response.status === 401) {
        errorMessage = 'AI сервис временно недоступен. Проверьте API ключ.';
        console.log('❌ Gemini API key issue - check configuration');
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
    
    // Проверяем, что получили валидный ответ от Gemini
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
      console.error('❌ Invalid Gemini response structure:', data);
      return res.status(200).json({ 
        error: 'AI сервис вернул некорректный ответ. Попробуйте еще раз.',
        isError: true
      });
    }
    
    const aiResponse = data.candidates[0].content.parts[0].text;
    
    res.json({
      content: aiResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Gemini AI chat error:', error);
    
    // Fallback ответ, если Gemini недоступен
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
