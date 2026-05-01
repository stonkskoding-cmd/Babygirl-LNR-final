require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- КОНФИГУРАЦИЯ ---
const { CITIES } = require('./config/cities');
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'babygirl_secret_key_change_in_prod_123';

if (!MONGODB_URI) {
  console.error('❌ ОШИБКА: MONGODB_URI не задан в переменных окружения!');
  process.exit(1);
}

const app = express();

// --- СОЕДИНЕНИЕ С БД ---
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB успешно подключена'))
  .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

// --- МОДЕЛИ ДАННЫХ ---
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
  photos: { type: [String], max: 10 },
  services: [{ name: String, price: Number }],
  createdAt: { type: Date, default: Date.now }
});
const Girl = mongoose.model('Girl', GirlSchema);

const ChatSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
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

const NewsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const News = mongoose.model('News', NewsSchema);

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

if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads', { recursive: true });
}

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
    return res.status(403).json({ message: 'Доступ запрещен: нужен роль админа' });
  }
  next();
};

// 🔧 АВТО-СОЗДАНИЕ АДМИНОВ
async function ensureAdmins() {
  try {
    const adminCount = await User.countDocuments({ role: 'admin' });
    
    if (adminCount === 0) {
      console.log('\n🔐 CREATING DEFAULT ADMIN ACCOUNTS...\n');
      
      const admins = [
        { username: 'admin_main', pass: 'Babygirl2024!' },
        { username: 'operator_01', pass: 'Operator2024!' }
      ];
      
      for (const admin of admins) {
        const exists = await User.findOne({ username: admin.username });
        if (!exists) {
          const hash = await bcrypt.hash(admin.pass, 10);
          await User.create({
            username: admin.username,
            password: hash,
            role: 'admin'
          });
          console.log(`✅ Login: ${admin.username}`);
          console.log(`   Pass: ${admin.pass}\n`);
        }
      }
      console.log('🚀 Admins created successfully!\n');
    } else {
      console.log('✅ Admins already exist. Skipping creation.');
    }
  } catch (e) {
    console.error('⚠️ Error creating admins:', e.message);
  }
}

mongoose.connection.once('open', () => {
  console.log('✅ MongoDB connection open');
  ensureAdmins();
});

// --- ROUTES ---
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (await User.findOne({ username })) {
      return res.status(400).json({ message: 'Пользователь уже существует' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash, role: 'client' });
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.get('/api/girls', async (req, res) => {
  try {
    const girls = await Girl.find().sort({ createdAt: -1 });
    res.json(girls);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/girls', authenticate, isAdmin, async (req, res) => {
  try {
    const { action, girl } = req.body;
    // Валидация массива фото: преобразуем строку в массив и ограничиваем до 10
    if (girl && girl.photos) {
      if (typeof girl.photos === 'string') {
        girl.photos = [girl.photos];
      }
      if (Array.isArray(girl.photos)) {
        girl.photos = girl.photos.slice(0, 10); // Ограничиваем до 10 фото
      }
    }
    if (action === 'add') {
      const newGirl = await Girl.create(girl);
      return res.json(newGirl);
    } else if (action === 'update') {
      const updated = await Girl.findByIdAndUpdate(girl._id, girl, { new: true, runValidators: true });
      return res.json(updated);
    } else if (action === 'delete') {
      await Girl.findByIdAndDelete(girl._id);
      return res.json({ success: true });
    }
    res.status(400).json({ message: 'Неверное действие' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/upload', authenticate, isAdmin, upload.array('photos', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'Файлы не загружены' });
  }
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

// --- CHAT CLIENT ---
app.get('/api/chat', authenticate, async (req, res) => {
  try {
    let chat = await Chat.findOne({ userId: req.user.username });
    
    if (!chat) {
      chat = await Chat.create({
        userId: req.user.username,
        messages: [{
          type: 'bot',
          text: `Здравствуйте! 👋 Добро пожаловать в BABYGIRL_LNR!\nНапишите ваш город (${CITIES.join(', ')})`,
          time: new Date()
        }],
        botStep: 'asking_city',
        waitingForOperator: false
      });
      console.log(`💬 New chat created with greeting for: ${req.user.username}`);
    } else if (chat.messages.length === 0) {
       chat.messages.push({
          type: 'bot',
          text: `Здравствуйте! 👋 Напишите ваш город (${CITIES.join(', ')})`,
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

// Chat - Init with girl
app.post('/api/chat/init', authenticate, async (req, res) => {
  try {
    const { girlId } = req.body || {};
    if (!girlId) return res.status(400).json({ message: 'girlId обязателен' });
    const girl = await Girl.findById(girlId);
    if (!girl) return res.status(404).json({ message: 'Девушка не найдена' });
    let chat = await Chat.findOne({ userId: req.user.username });
    if (!chat) {
      chat = await Chat.create({
        userId: req.user.username,
        messages: [],
        botStep: 'greet',
        waitingForOperator: false,
        selectedGirl: null
      });
    }
    chat.messages = [];
    chat.botStep = 'girl_selected';
    chat.selectedGirl = girl;
    chat.waitingForOperator = false;
    chat.messages.push(
      { type: 'bot', text: 'Здравствуйте! 👋 Вы выбрали:', time: new Date() },
      { type: 'bot', text: '', extra: { type: 'profile', girl }, time: new Date() },
      { type: 'bot', text: '💰 Оплата девушке в руки. Выберите услугу:', extra: { type: 'services', girl }, time: new Date() }
    );
    await chat.save();
    res.json({ messages: chat.messages });
  } catch (e) {
    console.error('Chat init error:', e.message);
    res.status(500).json({ message: 'Ошибка инициализации чата' });
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
    
    if (!chat.waitingForOperator && chat.botEnabled) {
      const lower = text.toLowerCase();
      
      // Шаг 1: Выбор города
      if (chat.botStep === 'asking_city' || chat.botStep === 'greet') {
        const cities = ['луганск', 'стаханов', 'первомайск', 'мариуполь'];
        const city = cities.find(c => lower.includes(c));
        
        if (city) {
          const girls = await Girl.find({ 
            city: { $regex: city, $options: 'i' } 
          });
          
          chat.botStep = 'picking_girl';
          chat.messages.push({
            type: 'bot',
            text: `В городе ${city} найдено анкет: ${girls.length}. Выберите девушку:`,
            extra: { 
              type: 'girls_list', 
              girls: girls.map(g => ({
                name: g.name,
                city: g.city,
                age: g.age,
                photo: g.photos && g.photos[0] ? g.photos[0] : ''
              }))
            }
          });
        } else {
          chat.messages.push({ 
            type: 'bot', 
            text: `Пожалуйста, напишите название города: ${CITIES.join(', ')}.` 
          });
        }
      } 
      // Шаг 2: Выбор девушки
      else if (chat.botStep === 'picking_girl') {
        const girl = await Girl.findOne({ 
          name: { $regex: text, $options: 'i' } 
        });
        
        if (girl) {
  chat.selectedGirl = girl;
  chat.botStep = 'picking_service';
  let servicesList = girl.services.map(s => `- ${s.name}: ${s.price}₽`).join('\n');
  
  // 1. Отправляем полную анкету
  chat.messages.push({
    type: 'bot',
    text: `Вы выбрали ${girl.name}.\n📍 ${girl.city}\n📏 ${girl.height} см, ⚖️ ${girl.weight} кг\n👙 Грудь: ${girl.breast}\n\n📝 ${girl.desc}\n\nУслуги:\n${servicesList}`,
    extra: { 
      type: 'profile', 
      girl: {
        name: girl.name,
        city: girl.city,
        age: girl.age,
        height: girl.height,
        weight: girl.weight,
        breast: girl.breast,
        desc: girl.desc,
        photos: girl.photos,
        services: girl.services
      }
    }
  });
  
  // 2. Отправляем кнопки услуг
  chat.messages.push({
    type: 'bot',
    text: 'Выберите услугу:',
    extra: { 
      type: 'services', 
      girl: {
        name: girl.name,
        services: girl.services
      }
    }
  });
} else {
          chat.messages.push({ 
            type: 'bot', 
            text: 'Девушка не найдена. Попробуйте ввести имя еще раз.' 
          });
        }
      }
      // Шаг 3: Выбор услуги
      else if (chat.botStep === 'girl_selected' && chat.selectedGirl) {
        const services = chat.selectedGirl.services || [];
        const service = services.find(s => lower.includes((s.name || '').toLowerCase()));
        
        if (service) {
          chat.waitingForOperator = true;
          chat.botStep = 'waiting_operator';
          chat.messages.push({
            type: 'bot',
            text: `✅ Вы выбрали: ${service.name} — ${service.price}₽\nЗаявка в обработке.`,
            extra: { type: 'processing' }
          });
        } else {
          chat.messages.push({ 
            type: 'bot', 
            text: 'Напишите название услуги (например: час).',
            extra: { type: 'text' } 
          });
        }
      }
      // Шаг 4: Ожидание
      else if (chat.botStep === 'waiting_operator') {
        chat.messages.push({ 
          type: 'bot', 
          text: 'Заявка уже передана оператору. Пожалуйста, ожидайте.' 
        });
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

// --- ADMIN CHATS ---
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

app.post('/api/admin/chat/reply', authenticate, isAdmin, async (req, res) => {
  try {
    const { userId, text } = req.body;
    console.log(`📩 Operator reply to ${userId}: ${text}`);
    
    let chat = await Chat.findOne({ userId });
    if (!chat) {
      return res.status(404).json({ message: 'Чат не найден' });
    }
    
    if (chat.messages.length > 0 && chat.messages[chat.messages.length - 1].extra?.type === 'processing') {
      chat.messages.pop();
    }
    
    chat.messages.push({
      type: 'bot',
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
      text: 'Спасибо за заказ, приходите ещё! 💕',
      time: new Date()
    });
    await chat.save();
    
    console.log(`✅ Chat completed (bot reset) for ${req.params.userId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put('/api/admin/chat/:userId/clear', authenticate, isAdmin, async (req, res) => {
  try {
    await Chat.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { messages: [], waitingForOperator: false, botStep: 'greet', selectedGirl: null } }
    );
    console.log(`🗑️ Chat cleared (history deleted) for ${req.params.userId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE - Delete chat completely
app.delete('/api/admin/chat/:userId', authenticate, isAdmin, async (req, res) => {
  try {
    console.log('🗑️ DELETE CHAT - User:', req.user.username, 'Deleting chat for:', req.params.userId);
    const deleted = await Chat.findOneAndDelete({ userId: req.params.userId });
    if (!deleted) {
      console.log('❌ Chat not found:', req.params.userId);
      return res.status(404).json({ message: 'Чат не найден' });
    }
    console.log('✅ Chat deleted:', req.params.userId);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Delete chat error:', e.message);
    res.status(500).json({ message: 'Ошибка удаления' });
  }
});

app.get('/api/settings', async (req, res) => {
  const settings = await Settings.find();
  const obj = {};
  settings.forEach(s => obj[s.key] = s.value);
  res.json(obj);
});

app.put('/api/settings', authenticate, isAdmin, async (req, res) => {
  try {
    console.log('💾 SAVE SETTINGS - User:', req.user.username, 'Data:', req.body);
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await Settings.findOneAndUpdate({ key }, { value }, { upsert: true });
    }
    console.log('✅ Settings saved');
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Update settings error:', e.message);
    res.status(500).json({ message: 'Ошибка обновления настроек' });
  }
});

// --- NEWS ROUTES ---
app.get('/api/news', async (req, res) => {
  try {
    const news = await News.find({ isActive: true }).sort({ createdAt: -1 }).lean();
    res.json(news || []);
  } catch (e) {
    console.error('Get news error:', e.message);
    res.status(500).json([]);
  }
});

app.post('/api/news', authenticate, isAdmin, async (req, res) => {
  try {
    console.log('📰 CREATE NEWS - User:', req.user.username, 'Data:', req.body);
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Заголовок и текст обязательны' });
    }
    const news = await News.create({ title, content, isActive: true });
    console.log('✅ News created:', news._id);
    res.json(news);
  } catch (e) {
    console.error('❌ Create news error:', e.message);
    res.status(500).json({ message: 'Ошибка создания новости' });
  }
});

app.delete('/api/news/:id', authenticate, isAdmin, async (req, res) => {
  try {
    console.log('🗑️ DELETE NEWS - User:', req.user.username, 'ID:', req.params.id);
    const deleted = await News.findByIdAndDelete(req.params.id);
    if (!deleted) {
      console.log('❌ News not found:', req.params.id);
      return res.status(404).json({ message: 'Новость не найдена' });
    }
    console.log('✅ News deleted:', req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Delete news error:', e.message);
    res.status(500).json({ message: 'Ошибка удаления новости' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Local: http://localhost:${PORT}`);
});
