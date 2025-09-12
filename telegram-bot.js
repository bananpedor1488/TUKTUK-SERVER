const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Токен бота из переменных окружения
const token = process.env.TELEGRAM_BOT_TOKEN || '8275147335:AAEZhVcVj8rU5rdD2p9ABi595IL-29yQ8Sc';

// Создаем бота
const bot = new TelegramBot(token, { polling: true });

// URL бэкенда
const BACKEND_URL = 'http://localhost:5000';

console.log('🤖 Telegram бот запущен!');

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name;
  
  bot.sendMessage(chatId, `Привет, ${firstName}! 👋\n\nДобро пожаловать в TukTuk! 🚀\n\nДля авторизации в приложении используйте команду /login`);
});

// Обработка команды /login
bot.onText(/\/login/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  try {
    // Отправляем данные пользователя на бэкенд
    const response = await axios.post(`${BACKEND_URL}/api/auth/telegram`, {
      chat_id: user.id.toString(),
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      photo_url: user.photo_url
    });

    if (response.data.success) {
      const { user: userData, accessToken } = response.data;
      
      bot.sendMessage(chatId, `✅ Авторизация успешна!\n\n👤 Имя: ${userData.displayName}\n🆔 Username: ${userData.username}\n\n🔑 Токен доступа:\n\`${accessToken}\`\n\nСкопируйте этот токен и используйте его для входа в приложение.`, {
        parse_mode: 'Markdown'
      });
      
      // Также отправляем инструкцию
      bot.sendMessage(chatId, `📱 Для входа в приложение:\n\n1. Откройте TukTuk в браузере\n2. Нажмите "Войти через Telegram"\n3. Нажмите "Тестовая авторизация"\n4. Введите токен: ${accessToken}\n\nИли просто используйте кнопку "Тестовая авторизация" с токеном выше.`);
      
    } else {
      bot.sendMessage(chatId, `❌ Ошибка авторизации: ${response.data.error}`);
    }
    
  } catch (error) {
    console.error('Ошибка при авторизации:', error.message);
    bot.sendMessage(chatId, `❌ Ошибка подключения к серверу. Убедитесь, что бэкенд запущен на localhost:5000`);
  }
});

// Обработка команды /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, `🆘 Помощь по TukTuk боту:\n\n/start - Начать работу с ботом\n/login - Авторизоваться в приложении\n/help - Показать эту справку\n\n💡 После авторизации через /login вы получите токен для входа в приложение.`);
});

// Обработка всех остальных сообщений
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  
  // Если сообщение не является командой, показываем справку
  if (!msg.text.startsWith('/')) {
    bot.sendMessage(chatId, `🤔 Не понимаю эту команду. Используйте /help для получения справки.`);
  }
});

// Обработка ошибок
bot.on('error', (error) => {
  console.error('Ошибка бота:', error);
});

bot.on('polling_error', (error) => {
  console.error('Ошибка polling:', error);
});

console.log('✅ Бот готов к работе!');
console.log('📱 Отправьте /start боту для начала работы');
console.log('🔗 Бэкенд должен быть запущен на localhost:5000');


