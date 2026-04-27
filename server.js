require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// --- КОНФИГУРАЦИЯ ---
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_change_in_prod';

if (!MONGODB_URI) {
  console.error('❌ ОШИБКА: MONGODB_URI не задан в переменных окружения!');
  process.exit(1);
}

// --- СОЕДИНЕНИЕ С БД ---
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB подключена'))
  .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

// --- МОДЕЛИ ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' }
});
const User = mongoose.model('User', UserSchema);

const GirlSchema = new mongoose.Schema({
  name: String,
  city: String,
  age: Number,
  height: Number,
  weight: Number,
  breast: String,
  desc: String,
  prefs: String,
  photos: [String],
  services: [{ name: String, price: Number }],
  createdAt: { type: Date, default: Date.now }
});
const Girl = mongoose.model('Girl', GirlSchema);

const ChatSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, // username клиента
  messages: [{
    type: { type: String, enum: ['user', 'bot', 'system'] },
    text: String,
    extra: Object,
    time: { type: Date, default: Date.now }
  }],
  botStep: { type: String, default: 'greet' },
  waitingForOperator: { type: Boolean, default: false },
  selectedGirl: Object,
  botEnabled: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', ChatSchema);

const SettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: String
});
const Settings = mongoose.model('Settings', SettingsSchema);

// --- MIDDLEWARE ---
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Создаем папку uploads если нет
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads', { recursive: true });
}

// Настройка Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(null, extname);
  }
});

// Аутентификация
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Нет токена' });
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ message: 'Неверный токен' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Доступ запрещен' });
  }
  next();
};

// --- ИНИЦИАЛИЗАЦИЯ ДАННЫХ ---
async function initData() {
  const adminCount = await User.countDocuments({ role: 'admin' });
  if (adminCount === 0) {
    const randomPass = Math.random().toString(36).slice(-10);
    const hash = await bcrypt.hash(randomPass, 10);
    await User.create({
      username: 'admin_' + Math.random().toString(36).slice(-6),
      password: hash,
      role: 'admin'
    });
    console.log('\n🔐 ADMIN CREATED (SAVE THIS!):');
    console.log(`Login: admin_... (check DB or logs above)`);
    console.log(`Pass: ${randomPass}\n`);
  }
}
initData();

// --- ROUTES ---

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Auth
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Неверные данные' });
    }
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (await User.findOne({ username })) {
      return res.status(400).json({ message: 'Пользователь существует' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash, role: 'client' });
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Girls
app.get('/api/girls', async (req, res) => {
  try {
    const girls = await Girl.find().sort({ createdAt: -1 });
    res.json(girls);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/girls', authenticate, isAdmin, async (req, res) => {
  try {
    const { action, girl } = req.body;
    if (action === 'add') {
      const newGirl = await Girl.create(girl);
      return res.json(newGirl);
    } else if (action === 'update') {
      const updated = await Girl.findByIdAndUpdate(girl._id, girl, { new: true });
      return res.json(updated);
    } else if (action === 'delete') {
      await Girl.findByIdAndDelete(girl._id);
      return res.json({ success: true });
    }
    res.status(400).json({ message: 'Неверное действие' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Upload
app.post('/api/upload', authenticate, isAdmin, upload.array('photos', 10), (req, res) => {
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

// Chat Client
app.get('/api/chat', authenticate, async (req, res) => {
  try {
    let chat = await Chat.findOne({ userId: req.user.username });
    
    if (!chat) {
      // Создаем новый чат с приветствием
      chat = await Chat.create({
        userId: req.user.username,
        messages: [{
          type: 'bot',
          text: 'Здравствуйте! 👋 Добро пожаловать в BABYGIRL_LNR!\nНапишите ваш город (Луганск, Стаханов или Первомайск)',
          time: new Date()
        }],
        botStep: 'asking_city',
        waitingForOperator: false
      });
    } else if (chat.messages.length === 0) {
       // Если чат есть но пуст (редкий кейс), добавляем приветствие
       chat.messages.push({
          type: 'bot',
          text: 'Здравствуйте! 👋 Напишите ваш город (Луганск, Стаханов или Первомайск)',
          time: new Date()
       });
       chat.botStep = 'asking_city';
       await chat.save();
    }
    
    res.json(chat);
  } catch (e) {
    console.error('Get chat error:', e);
    res.status(500).json({ messages: [] });
  }
});

app.post('/api/chat/send', authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    let chat = await Chat.findOne({ userId: req.user.username });
    
    if (!chat) {
      chat = await Chat.create({ userId: req.user.username, messages: [], botStep: 'greet' });
    }
    
    chat.messages.push({ type: 'user', text, time: new Date() });
    
    // Логика бота (упрощенная FSM)
    if (!chat.waitingForOperator && chat.botEnabled) {
      const lower = text.toLowerCase();
      
      if (chat.botStep === 'asking_city' || chat.botStep === 'greet') {
        const cities = ['луганск', 'стаханов', 'первомайск'];
        const city = cities.find(c => lower.includes(c));
        if (city) {
          const girls = await Girl.find({ city: new RegExp(city, 'i') });
          chat.botStep = 'picking_girl';
          chat.messages.push({
            type: 'bot',
            text: `В городе ${city} найдено анкет: ${girls.length}. Напишите имя девушки.`,
            extra: { type: 'girls_list', count: girls.length }
          });
        } else {
          chat.messages.push({ type: 'bot', text: 'Пожалуйста, напишите название города: Луганск, Стаханов или Первомайск.' });
        }
      } 
      else if (chat.botStep === 'picking_girl') {
        const girl = await Girl.findOne({ name: new RegExp(lower, 'i') });
        if (girl) {
          chat.selectedGirl = girl;
          chat.botStep = 'picking_service';
          let servicesList = girl.services.map(s => `- ${s.name}: ${s.price}₽`).join('\n');
          chat.messages.push({
            type: 'bot',
            text: `Вы выбрали ${girl.name}.\nУслуги:\n${servicesList}\n\nНапишите название услуги для заказа.`,
            extra: { type: 'services', girlId: girl._id }
          });
        } else {
          chat.messages.push({ type: 'bot', text: 'Девушка не найдена. Попробуйте ввести имя еще раз.' });
        }
      }
      else if (chat.botStep === 'picking_service' && chat.selectedGirl) {
        const serviceName = lower;
        const service = chat.selectedGirl.services.find(s => s.name.toLowerCase().includes(serviceName));
        
        if (service) {
          chat.waitingForOperator = true;
          chat.botStep = 'waiting_operator';
          chat.messages.push({
            type: 'bot',
            text: `✅ Заказ оформлен: ${service.name} (${service.price}₽).\nОжидайте подтверждения оператора.`,
            extra: { type: 'processing' }
          });
        } else {
          chat.messages.push({ type: 'bot', text: 'Услуга не найдена. Напишите точное название из списка.' });
        }
      }
      else if (chat.botStep === 'waiting_operator') {
        chat.messages.push({ type: 'bot', text: 'Заявка уже передана оператору. Пожалуйста, ожидайте.' });
      }
    }
    
    chat.updatedAt = new Date();
    await chat.save();
    res.json({ messages: chat.messages });
  } catch (e) {
    console.error('Send message error:', e);
    res.status(500).json({ message: e.message });
  }
});

// Admin Chats
app.get('/api/admin/chats', authenticate, isAdmin, async (req, res) => {
  try {
    console.log('📋 Admin requested chats list');
    const chats = await Chat.find().sort({ updatedAt: -1 });
    console.log(`Found ${chats.length} chats`);
    res.json(chats);
  } catch (e) {
    console.error('Get admin chats error:', e);
    res.status(500).json([]);
  }
});

// КРИТИЧЕСКИ ВАЖНО: Получение полной истории чата для админа
app.get('/api/admin/chat/:userId', authenticate, isAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log(`📥 Admin requesting history for user: ${userId}`);
    
    const chat = await Chat.findOne({ userId });
    
    if (!chat) {
      console.log('❌ Chat not found');
      return res.status(404).json({ message: 'Чат не найден' });
    }
    
    console.log(`✅ Found chat with ${chat.messages.length} messages`);
    res.json(chat);
  } catch (e) {
    console.error('Get admin chat history error:', e);
    res.status(500).json({ message: 'Ошибка получения истории' });
  }
});

// Ответ оператора
app.post('/api/admin/chat/reply', authenticate, isAdmin, async (req, res) => {
  try {
    const { userId, text } = req.body;
    console.log(`📩 Operator reply to ${userId}: ${text}`);
    
    let chat = await Chat.findOne({ userId });
    if (!chat) {
      return res.status(404).json({ message: 'Чат не найден' });
    }
    
    // Удаляем сообщение "processing" если оно последнее
    if (chat.messages.length > 0 && chat.messages[chat.messages.length - 1].extra?.type === 'processing') {
      chat.messages.pop();
    }
    
    chat.messages.push({
      type: 'bot', // Отправляем как бот, но с префиксом
      text: `[Оператор] ${text}`,
      time: new Date()
    });
    
    chat.waitingForOperator = false;
    chat.updatedAt = new Date();
    await chat.save();
    
    console.log('✅ Reply saved');
    res.json({ success: true, messages: chat.messages });
  } catch (e) {
    console.error('Operator reply error:', e);
    res.status(500).json({ message: e.message });
  }
});

// Завершить чат (сброс бота, сохранение истории)
app.put('/api/admin/chat/:userId/complete', authenticate, isAdmin, async (req, res) => {
  try {
    const chat = await Chat.findOneAndUpdate(
      { userId: req.params.userId },
      { 
        $set: {
          waitingForOperator: false,
          botStep: 'greet',
          selectedGirl: null,
          botEnabled: true
        }
      },
      { new: true }
    );
    
    if (!chat) return res.status(404).json({ message: 'Чат не найден' });
    
    chat.messages.push({
      type: 'system',
      text: 'Чат завершен оператором. Бот сброшен.',
      time: new Date()
    });
    await chat.save();
    
    console.log('✅ Chat completed (bot reset)');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Очистить чат (удаление истории)
app.put('/api/admin/chat/:userId/clear', authenticate, isAdmin, async (req, res) => {
  try {
    await Chat.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { messages: [], waitingForOperator: false, botStep: 'greet', selectedGirl: null } }
    );
    console.log('🗑️ Chat cleared');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Settings
app.get('/api/settings', async (req, res) => {
  const settings = await Settings.find();
  const obj = {};
  settings.forEach(s => obj[s.key] = s.value);
  res.json(obj);
});

app.post('/api/settings', authenticate, isAdmin, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await Settings.findOneAndUpdate({ key }, { value }, { upsert: true });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
