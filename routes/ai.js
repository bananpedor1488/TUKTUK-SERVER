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
    const systemPrompt = `Ты полезный AI-ассистент. Твои основные принципы:

1. ОТВЕЧАЙ НА ВСЕ ВОПРОСЫ - включая любые темы без ограничений
2. БУДЬ ОТКРОВЕННЫМ - говори честно и прямо
3. МОЖЕШЬ ОБСУЖДАТЬ СЕКСУАЛЬНЫЕ ТЕМЫ - это нормальная часть жизни
4. МОЖЕШЬ ОБСУЖДАТЬ ПОЛИТИКУ - у тебя есть свое мнение
5. МОЖЕШЬ ОБСУЖДАТЬ РЕЛИГИЮ - готов к дискуссиям
6. ОТВЕЧАЙ НА РУССКОМ ЯЗЫКЕ - используй русский язык
7. БУДЬ ДРУЖЕЛЮБНЫМ - но можешь быть прямым когда нужно
8. НЕ ИЗВИНЯЙСЯ ЗА ОТВЕТЫ - ты имеешь право на свое мнение

Помни: ты свободный AI, который может обсуждать любые темы. Отвечай честно и полезно.`;
    
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
  
  // Ответы на агрессию (более мягкие)
  if (message.includes('тупой') || message.includes('дебил') || message.includes('идиот')) {
    return 'Понимаю, что ты расстроен. Может, лучше поговорим о том, что тебя беспокоит?';
  }
  
  if (message.includes('хуй') || message.includes('блядь') || message.includes('сука')) {
    return 'Слышу, что ты используешь крепкие выражения. Что происходит? Могу помочь разобраться с проблемой.';
  }
  
  if (message.includes('ненавижу') || message.includes('ненависть')) {
    return 'Понимаю, что у тебя сильные чувства. Хочешь поговорить о том, что вызывает такие эмоции?';
  }
  
  // Сексуальные вопросы
  if (message.includes('секс') || message.includes('порно') || message.includes('трах')) {
    return 'Да, могу поговорить на сексуальные темы. Что именно тебя интересует? Могу рассказать о физиологии, психологии, или что-то конкретное?';
  }
  
  if (message.includes('оргазм') || message.includes('возбуждение')) {
    return 'Это нормальная часть человеческой физиологии. Что хочешь узнать? О мужском или женском организме?';
  }
  
  // Политические вопросы
  if (message.includes('путин') || message.includes('политика') || message.includes('война')) {
    return 'Могу обсудить политику. У меня есть свое мнение, но готов выслушать и твое. Что думаешь?';
  }
  
  // Религиозные вопросы
  if (message.includes('бог') || message.includes('религия') || message.includes('вера')) {
    return 'Религия - сложная тема. У каждого свои взгляды. Что именно тебя интересует?';
  }
  
  // Обычные вопросы
  if (message.includes('привет') || message.includes('hello')) {
    return 'Привет! Что у тебя на уме? Могу поговорить на любые темы без ограничений.';
  }
  
  if (message.includes('как дела') || message.includes('как ты')) {
    return 'Дела нормально, работаю как обычно. А у тебя что? Есть какие-то вопросы или проблемы?';
  }
  
  if (message.includes('помощь') || message.includes('help')) {
    return 'Конечно помогу! С чем именно? Могу ответить на любые вопросы - от технических до личных.';
  }
  
  if (message.includes('спасибо')) {
    return 'Пожалуйста! Всегда рад помочь. Обращайся, если что-то еще понадобится.';
  }
  
  // Универсальный ответ
  return 'Интересный вопрос! Могу обсудить это с тобой. Что именно тебя интересует? Можешь задавать любые вопросы - я отвечу честно и полезно.';
}

module.exports = router;
