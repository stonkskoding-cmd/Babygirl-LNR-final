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
    // Разрешаем запросы без origin (mobile apps, curl)
    if (!origin) return callback(null, true);
    
    // Разрешаем все домены onrender.com
    if (origin.includes('onrender.com')) {
      return callback(null, true);
    }
    
    // Для localhost
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight
app.options('*', cors());

// ===== Middleware =====
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 50000 }));

// ===== File Upload =====
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    if (extname) cb(null, true);
    else cb(new Error('Только изображения'));
  }
});

// ===== MongoDB =====
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/babgirl')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ===== Models =====
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' }
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const GirlSchema = new mongoose.Schema({
  name: String, city: String, photos: [String], desc: String,
  height: String, weight: String, breast: String, age: String, prefs: String,
  services: [{ name: String, price: String }]
}, { timestamps: true });
const Girl = mongoose.model('Girl', GirlSchema);

const ChatSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  messages: [{
    type: { type: String, enum: ['user', 'bot', 'system'], required: true },
    text: String,
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
  mainTitle: String, mainSubtitle: String, title: String, desc: String, phone: String, globalBotEnabled: { type: Boolean, default: true }
}, { timestamps: true });
const Settings = mongoose.model('Settings', SettingsSchema);

// ===== Auth Middleware =====
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Нет токена' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
    next();
  } catch (err) { 
    console.error('Token error:', err);
    res.status(401).json({ message: 'Неверный токен' }); 
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Только для админов' });
  next();
};

// ===== Init Data =====
async function initData() {
  const admins = [
    { username: 'admin', pass: 'admin123' },
    { username: 'operator', pass: 'operator123' }
  ];
  
  for (const a of admins) {
    const hash = await bcrypt.hash(a.pass, 10);
    await User.findOneAndUpdate(
      { username: a.username },
      { $set: { password: hash, role: 'admin' } },
      { upsert: true, new: true }
    );
  }
  console.log('✅ Admin accounts: admin/admin123 & operator/operator123');

  if (await Girl.countDocuments() === 0) {
    await Girl.insertMany([
      { name: 'Алина', city: 'Луганск', photos: [], desc: 'Нежная и романтичная.', height: '168', weight: '52', breast: '2', age: '21', prefs: 'Романтика', services: [{name:'Встреча',price:'3000'},{name:'Свидание',price:'5000'},{name:'Ночь',price:'10000'}] },
      { name: 'Виктория', city: 'Стаханов', photos: [], desc: 'Яркая брюнетка.', height: '172', weight: '55', breast: '3', age: '23', prefs: 'Танцы', services: [{name:'Встреча',price:'3500'},{name:'Свидание',price:'6000'},{name:'Ночь',price:'12000'}] }
    ]);
    console.log('✅ Demo girls created');
  }
  
  if (!await Settings.findOne()) {
    await Settings.create({ 
      mainTitle: 'Анкеты девушек', 
      mainSubtitle: 'Выберите идеальную компанию', 
      title: 'BABYGIRL_LNR', 
      phone: '',
      globalBotEnabled: true 
    });
    console.log('✅ Default settings created');
  }
}
initData();

// ===== ROUTES =====

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Auth
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Заполните поля' });
    
    const exist = await User.findOne({ username });
    if (exist) return res.status(400).json({ message: 'Логин занят' });
    
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'default_secret');
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { 
    console.error('Register error:', e);
    res.status(500).json({ message: 'Ошибка сервера' }); 
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'Неверный логин или пароль' });
    
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ message: 'Неверный логин или пароль' });
    
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'default_secret');
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { 
    console.error('Login error:', e);
    res.status(500).json({ message: 'Ошибка сервера' }); 
  }
});

// Girls
app.get('/api/girls', async (req, res) => {
  try {
    const girls = await Girl.find().sort({ createdAt: -1 });
    res.json(girls);
  } catch (e) { 
    console.error('Get girls error:', e);
    res.status(500).json([]); 
  }
});

app.post('/api/girls', authenticate, isAdmin, async (req, res) => {
  try {
    const { action, girl } = req.body;
    console.log('Girl action:', action, girl);
    
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
  } catch (e) { 
    console.error('Girls CRUD error:', e);
    res.status(500).json({ message: 'Ошибка: ' + e.message }); 
  }
});

// Upload
app.post('/api/upload', authenticate, isAdmin, upload.array('photos', 4), (req, res) => {
  try {
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    console.log('Uploaded files:', urls);
    res.json({ urls });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ message: 'Ошибка загрузки' });
  }
});

// Chat
app.get('/api/chat', authenticate, async (req, res) => {
  try {
    const chat = await Chat.findOne({ userId: req.user.username });
    res.json(chat || { messages: [] });
  } catch (e) { 
    console.error('Get chat error:', e);
    res.status(500).json({ messages: [] }); 
  }
});

app.post('/api/chat/init', authenticate, async (req, res) => {
  try {
    const { girlId } = req.body;
    const girl = await Girl.findById(girlId);
    if (!girl) return res.status(404).json({ message: 'Девушка не найдена' });

    let chat = await Chat.findOne({ userId: req.user.username });
    if (!chat) chat = await Chat.create({ userId: req.user.username, messages: [] });
    
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
    console.error('Chat init error:', e);
    res.status(500).json({ message: 'Ошибка' }); 
  }
});

app.post('/api/chat/send', authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    let chat = await Chat.findOne({ userId: req.user.username });
    if (!chat) chat = await Chat.create({ userId: req.user.username, messages: [] });

    chat.messages.push({ type: 'user', text, time: new Date() });
    
    const settings = await Settings.findOne();
    if (!chat.waitingForOperator && chat.botEnabled && settings?.globalBotEnabled) {
      const lower = text.toLowerCase();
      let botReply = null;

      if (chat.botStep === 'greet' || chat.botStep === 'asking_city') {
        const cities = ['луганск', 'стаханов', 'первомайск'];
        const city = cities.find(c => lower.includes(c));
        if (city) {
          const girls = await Girl.find({ city: new RegExp(city, 'i') });
          if (girls.length > 0) {
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
        const girl = await Girl.findOne({ name: new RegExp(lower, 'i') });
        if (girl) {
          chat.selectedGirl = girl;
          chat.botStep = 'girl_selected';
          botReply = { text: '💰 Оплата в руки. Выберите услугу:', extra: { type: 'services', girl } };
        } else {
          botReply = { text: 'Напишите имя девушки из списка.', extra: { type: 'text' } };
        }
      } 
      else if (chat.botStep === 'girl_selected' && chat.selectedGirl) {
        const service = chat.selectedGirl.services?.find(s => lower.includes(s.name.toLowerCase()));
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

      if (botReply) chat.messages.push({ type: 'bot', text: botReply.text, extra: botReply.extra, time: new Date() });
    }

    await chat.save();
    res.json({ messages: chat.messages });
  } catch (e) { 
    console.error('Chat send error:', e);
    res.status(500).json({ message: 'Ошибка' }); 
  }
});

// Admin Chat
app.get('/api/admin/chats', authenticate, isAdmin, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ updatedAt: -1 });
    res.json(chats);
  } catch (e) { 
    console.error('Get admin chats error:', e);
    res.status(500).json([]); 
  }
});

app.post('/api/admin/chat/reply', authenticate, isAdmin, async (req, res) => {
  try {
    const { userId, text } = req.body;
    const chat = await Chat.findOne({ userId });
    if (!chat) return res.status(404).json({ message: 'Чат не найден' });
    
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
    console.error('Admin reply error:', e);
    res.status(500).json({ message: 'Ошибка' }); 
  }
});

app.put('/api/admin/chat/:userId/clear', authenticate, isAdmin, async (req, res) => {
  try {
    await Chat.findOneAndUpdate(
      { userId: req.params.userId }, 
      { messages: [], waitingForOperator: false, botStep: 'greet', selectedGirl: null }
    );
    res.json({ success: true });
  } catch (e) { 
    console.error('Clear chat error:', e);
    res.status(500).json({ message: 'Ошибка' }); 
  }
});

app.delete('/api/admin/chat/:userId', authenticate, isAdmin, async (req, res) => {
  try {
    await Chat.findOneAndDelete({ userId: req.params.userId });
    res.json({ success: true });
  } catch (e) { 
    console.error('Delete chat error:', e);
    res.status(500).json({ message: 'Ошибка' }); 
  }
});

// Settings
app.get('/api/settings', async (req, res) => {
  try {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({ mainTitle: 'Анкеты девушек', mainSubtitle: 'Выберите идеальную компанию', title: 'BABYGIRL_LNR', phone: '', globalBotEnabled: true });
    res.json(s);
  } catch (e) { 
    console.error('Get settings error:', e);
    res.status(500).json({}); 
  }
});

app.put('/api/settings', authenticate, isAdmin, async (req, res) => {
  try {
    const s = await Settings.findOneAndUpdate({}, req.body, { upsert: true, new: true });
    res.json(s);
  } catch (e) { 
    console.error('Update settings error:', e);
    res.status(500).json({ message: 'Ошибка' }); 
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Local: http://localhost:${PORT}`);
  console.log(`🌐 Health: http://localhost:${PORT}/api/health`);
});
