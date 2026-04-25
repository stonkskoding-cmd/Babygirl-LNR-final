require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// ===== CORS =====
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('onrender.com') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.options('*', cors());

// ===== Middleware =====
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 50000 }));

// ===== File Upload =====
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/i;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowed.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error('Только изображения (jpeg, jpg, png, webp, gif)'));
  }
});

// ===== MongoDB =====
let dbConnected = false;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/babgirl')
  .then(() => { 
    dbConnected = true;
    console.log('✅ MongoDB Connected');
  })
  .catch(err => { 
    console.error('❌ MongoDB Error:', err.message);
    dbConnected = false;
  });

// ===== Models =====
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' }
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const GirlSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  city: { type: String, default: '' },
  photos: [{ type: String, default: '' }],
  desc: { type: String, default: '' },
  height: { type: String, default: '' },
  weight: { type: String, default: '' },
  breast: { type: String, default: '' },
  age: { type: String, default: '' },
  prefs: { type: String, default: '' },
  services: [{ name: { type: String, default: '' }, price: { type: String, default: '' } }]
}, { timestamps: true });
const Girl = mongoose.model('Girl', GirlSchema);

const ChatSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  messages: [{
    type: { type: String, enum: ['user', 'bot', 'system'], required: true },
    text: { type: String, default: '' },
    extra: mongoose.Schema.Types.Mixed,
    time: { type: Date, default: Date.now }
  }],
  waitingForOperator: { type: Boolean, default: false },
  botEnabled: { type: Boolean, default: true },
  botStep: { type: String, default: 'greet' },
  selectedGirl: mongoose.Schema.Types.Mixed
}, { timestamps: true });
const Chat = mongoose.model('Chat', ChatSchema);

const SettingsSchema = new mongoose.Schema({
  mainTitle: { type: String, default: 'Анкеты девушек' },
  mainSubtitle: { type: String, default: 'Выберите идеальную компанию' },
  title: { type: String, default: 'BABYGIRL_LNR' },
  desc: { type: String, default: '' },
  phone: { type: String, default: '' },
  globalBotEnabled: { type: Boolean, default: true }
}, { timestamps: true });
const Settings = mongoose.model('Settings', SettingsSchema);

// ===== Auth Middleware =====
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Нет токена' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_change_in_prod');
    next();
  } catch (err) { 
    console.error('Token error:', err.message);
    res.status(401).json({ message: 'Неверный токен' }); 
  }
};

const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ message: 'Только для админов' });
  next();
};

// ===== Init Data =====
async function initData() {
  try {
    // Wait for DB connection
    let attempts = 0;
    while (!dbConnected && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    if (!dbConnected) {
      console.error('❌ Could not connect to MongoDB after 10 seconds');
      return;
    }

    // Generate random admin credentials
    const randomPass1 = Math.random().toString(36).slice(-10);
    const randomPass2 = Math.random().toString(36).slice(-10);
    const admins = [
      { username: 'admin_' + Math.random().toString(36).slice(-6), pass: randomPass1 },
      { username: 'operator_' + Math.random().toString(36).slice(-6), pass: randomPass2 }
    ];
    
    let firstRun = true;
    for (const a of admins) {
      const exist = await User.findOne({ username: a.username });
      if (!exist) {
        const hash = await bcrypt.hash(a.pass, 10);
        await User.create({ username: a.username, password: hash, role: 'admin' });
      } else {
        firstRun = false;
      }
    }
    
    // Only print credentials on first run
    if (firstRun) {
      console.log('\n' + '='.repeat(50));
      console.log('🔐 ADMIN CREDENTIALS (SAVE THIS!):');
      console.log('='.repeat(50));
      admins.forEach((a, i) => {
        console.log(`${i+1}. Login: ${a.username}`);
        console.log(`   Pass: ${a.pass}`);
      });
      console.log('='.repeat(50) + '\n');
    }

    // NO demo girls - admin will add real ones
  } catch (err) {
    console.error('❌ Init data error:', err.message);
  }
}
initData();

// ===== ROUTES =====

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Auth
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Заполните все поля' });
    
    const exist = await User.findOne({ username });
    if (exist) return res.status(400).json({ message: 'Логин уже занят' });
    
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed, role: 'client' });
    
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'default_secret_change_in_prod');
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { 
    console.error('Register error:', e.message);
    res.status(500).json({ message: 'Ошибка сервера при регистрации' }); 
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Заполните все поля' });
    
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'Неверный логин или пароль' });
    
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ message: 'Неверный логин или пароль' });
    
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'default_secret_change_in_prod');
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { 
    console.error('Login error:', e.message);
    res.status(500).json({ message: 'Ошибка сервера при входе' }); 
  }
});

// Girls - Get all
app.get('/api/girls', async (req, res) => {
  try {
    const girls = await Girl.find().sort({ createdAt: -1 }).lean();
    res.json(girls || []);
  } catch (e) { 
    console.error('Get girls error:', e.message);
    res.status(500).json([]); 
  }
});

// Girls - CRUD (admin only)
app.post('/api/girls', authenticate, isAdmin, async (req, res) => {
  try {
    const { action, girl } = req.body || {};
    if (!action) return res.status(400).json({ message: 'Не указано действие' });
    
    if (action === 'add') {
      if (!girl || !girl.name) return res.status(400).json({ message: 'Имя обязательно' });
      const newGirl = await Girl.create({
        name: girl.name || '',
        city: girl.city || '',
        photos: Array.isArray(girl.photos) ? girl.photos : [],
        desc: girl.desc || '',
        height: girl.height || '',
        weight: girl.weight || '',
        breast: girl.breast || '',
        age: girl.age || '',
        prefs: girl.prefs || '',
        services: Array.isArray(girl.services) ? girl.services : []
      });
      return res.json(newGirl);
    } else if (action === 'update') {
      if (!girl || !girl._id) return res.status(400).json({ message: 'ID не указан' });
      const updated = await Girl.findByIdAndUpdate(girl._id, {
        name: girl.name || '',
        city: girl.city || '',
        photos: Array.isArray(girl.photos) ? girl.photos : [],
        desc: girl.desc || '',
        height: girl.height || '',
        weight: girl.weight || '',
        breast: girl.breast || '',
        age: girl.age || '',
        prefs: girl.prefs || '',
        services: Array.isArray(girl.services) ? girl.services : []
      }, { new: true });
      if (!updated) return res.status(404).json({ message: 'Анкета не найдена' });
      return res.json(updated);
    } else if (action === 'delete') {
      if (!girl || !girl._id) return res.status(400).json({ message: 'ID не указан' });
      const deleted = await Girl.findByIdAndDelete(girl._id);
      if (!deleted) return res.status(404).json({ message: 'Анкета не найдена' });
      return res.json({ success: true });
    }
    res.status(400).json({ message: 'Неверное действие' });
  } catch (e) { 
    console.error('Girls CRUD error:', e.message);
    res.status(500).json({ message: 'Ошибка: ' + e.message }); 
  }
});

// Upload (admin only)
app.post('/api/upload', authenticate, isAdmin, upload.array('photos', 4), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Файлы не загружены' });
    }
    // Build full URL for Render
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    const urls = req.files.map(f => `${baseUrl}/uploads/${f.filename}`);
    res.json({ urls });
  } catch (e) {
    console.error('Upload error:', e.message);
    res.status(500).json({ message: 'Ошибка загрузки: ' + e.message });
  }
});

// Chat - Get current user chat
app.get('/api/chat', authenticate, async (req, res) => {
  try {
    const chat = await Chat.findOne({ userId: req.user.username }).lean();
    res.json(chat || { messages: [], userId: req.user.username });
  } catch (e) { 
    console.error('Get chat error:', e.message);
    res.status(500).json({ messages: [], userId: req.user.username }); 
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

// Chat - Send message
app.post('/api/chat/send', authenticate, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ message: 'Текст сообщения пуст' });
    
    let chat = await Chat.findOne({ userId: req.user.username });
    if (!chat) {
      chat = await Chat.create({ 
        userId: req.user.username, 
        messages: [],
        botStep: 'greet'
      });
    }

    // Add user message
    chat.messages.push({ type: 'user', text: text || '', time: new Date() });
    
    const settings = await Settings.findOne();
    const botEnabled = chat.botEnabled && (settings?.globalBotEnabled !== false);
    
    // Bot logic - only if not waiting for operator and bot is enabled
    if (!chat.waitingForOperator && botEnabled) {
      const lower = (text || '').toLowerCase();
      let botReply = null;

      if (chat.botStep === 'greet' || chat.botStep === 'asking_city') {
        const cities = ['луганск', 'стаханов', 'первомайск'];
        const city = cities.find(c => lower.includes(c));
        if (city) {
          const girls = await Girl.find({ city: new RegExp(city, 'i') }).lean();
          if (girls && girls.length > 0) {
            chat.botStep = 'picking_girl';
            botReply = { text: `Отлично! В ${city.charAt(0).toUpperCase() + city.slice(1)} есть ${girls.length} анкет:`, extra: { type: 'girls_list', girls } };
          } else {
            botReply = { text: `В городе ${city} пока нет анкет.`, extra: { type: 'text' } };
          }
        } else {
          chat.botStep = 'asking_city';
          botReply = { text: 'Напишите город (Луганск, Стаханов или Первомайск).', extra: { type: 'text' } };
        }
      } 
      else if (chat.botStep === 'picking_girl') {
        const girl = await Girl.findOne({ name: new RegExp(lower, 'i') }).lean();
        if (girl) {
          chat.selectedGirl = girl;
          chat.botStep = 'girl_selected';
          botReply = { text: '💰 Оплата в руки. Выберите услугу:', extra: { type: 'services', girl } };
        } else {
          botReply = { text: 'Напишите имя девушки из списка.', extra: { type: 'text' } };
        }
      } 
      else if (chat.botStep === 'girl_selected' && chat.selectedGirl) {
        const services = chat.selectedGirl.services || [];
        const service = services.find(s => lower.includes((s.name || '').toLowerCase()));
        if (service) {
          chat.waitingForOperator = true;
          chat.botStep = 'waiting';
          botReply = { text: `✅ Вы выбрали: ${service.name} — ${service.price}₽\nЗаявка в обработке.`, extra: { type: 'processing' } };
        } else {
          botReply = { text: 'Напишите название услуги (например: Встреча).', extra: { type: 'text' } };
        }
      } 
      else if (chat.botStep === 'waiting') {
        botReply = { text: 'Заявка в обработке, ожидайте оператора.', extra: { type: 'text' } };
      }

      if (botReply) {
        chat.messages.push({ type: 'bot', text: botReply.text || '', extra: botReply.extra || {}, time: new Date() });
      }
    }

    await chat.save();
    res.json({ messages: chat.messages || [] });
  } catch (e) { 
    console.error('Chat send error:', e.message);
    res.status(500).json({ message: 'Ошибка отправки сообщения' }); 
  }
});

// Admin - Get all chats
app.get('/api/admin/chats', authenticate, isAdmin, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ updatedAt: -1 }).lean();
    res.json(chats || []);
  } catch (e) { 
    console.error('Get admin chats error:', e.message);
    res.status(500).json([]); 
  }
});

// Admin - Reply to chat
app.post('/api/admin/chat/reply', authenticate, isAdmin, async (req, res) => {
  try {
    const { userId, text } = req.body || {};
    if (!userId) return res.status(400).json({ message: 'userId обязателен' });
    if (!text) return res.status(400).json({ message: 'Текст ответа пуст' });
    
    const chat = await Chat.findOne({ userId });
    if (!chat) return res.status(404).json({ message: 'Чат не найден' });
    
    // Remove processing message if exists
    if (chat.messages.length > 0 && chat.messages[chat.messages.length - 1].extra?.type === 'processing') {
      chat.messages.pop();
    }

    chat.messages.push({ type: 'bot', text: `[Оператор] ${text}`, time: new Date() });
    chat.waitingForOperator = false;
    chat.botStep = 'greet';
    chat.selectedGirl = null;
    await chat.save();
    res.json({ success: true });
  } catch (e) { 
    console.error('Admin reply error:', e.message);
    res.status(500).json({ message: 'Ошибка ответа' }); 
  }
});

// Admin - Clear chat history
app.put('/api/admin/chat/:userId/clear', authenticate, isAdmin, async (req, res) => {
  try {
    await Chat.findOneAndUpdate(
      { userId: req.params.userId }, 
      { $set: { messages: [], waitingForOperator: false, botStep: 'greet', selectedGirl: null } }
    );
    res.json({ success: true });
  } catch (e) { 
    console.error('Clear chat error:', e.message);
    res.status(500).json({ message: 'Ошибка очистки' }); 
  }
});

// Admin - Delete chat
app.delete('/api/admin/chat/:userId', authenticate, isAdmin, async (req, res) => {
  try {
    const deleted = await Chat.findOneAndDelete({ userId: req.params.userId });
    if (!deleted) return res.status(404).json({ message: 'Чат не найден' });
    res.json({ success: true });
  } catch (e) { 
    console.error('Delete chat error:', e.message);
    res.status(500).json({ message: 'Ошибка удаления' }); 
  }
});

// Settings - Get
app.get('/api/settings', async (req, res) => {
  try {
    let s = await Settings.findOne().lean();
    if (!s) {
      s = await Settings.create({ 
        mainTitle: 'Анкеты девушек', 
        mainSubtitle: 'Выберите идеальную компанию', 
        title: 'BABYGIRL_LNR', 
        phone: '',
        globalBotEnabled: true 
      });
    }
    res.json(s);
  } catch (e) { 
    console.error('Get settings error:', e.message);
    res.status(500).json({}); 
  }
});

// Settings - Update (admin only)
app.put('/api/settings', authenticate, isAdmin, async (req, res) => {
  try {
    const updates = req.body || {};
    const s = await Settings.findOneAndUpdate({}, updates, { upsert: true, new: true });
    res.json(s);
  } catch (e) { 
    console.error('Update settings error:', e.message);
    res.status(500).json({ message: 'Ошибка обновления настроек' }); 
  }
});

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Local: http://localhost:${PORT}`);
  console.log(`🌐 Health: http://localhost:${PORT}/api/health`);
});
