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

// --- Middleware ---
// Разрешаем запросы с Netlify (фронтенд) и локально
app.use(cors({ 
  origin: [
    'https://prodakhen.onrender.com', 
    'https://babgirl.netlify.app', 
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ], 
  credentials: true 
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Создаем папку для фото если нет
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- Database Connection ---
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/babgirl')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// --- Models ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' }
});
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
});
const Chat = mongoose.model('Chat', ChatSchema);

const SettingsSchema = new mongoose.Schema({
  mainTitle: String, mainSubtitle: String, title: String, desc: String, phone: String, globalBotEnabled: { type: Boolean, default: true }
});
const Settings = mongoose.model('Settings', SettingsSchema);

// --- Auth Middleware ---
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Access denied' });
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ message: 'Invalid token' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  next();
};

// --- Routes: Auth ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Заполните поля' });
    const exist = await User.findOne({ username });
    if (exist) return res.status(400).json({ message: 'Логин занят' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, process.env.JWT_SECRET);
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ message: 'Ошибка сервера' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'Неверный логин или пароль' });
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ message: 'Неверный логин или пароль' });
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, process.env.JWT_SECRET);
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ message: 'Ошибка сервера' }); }
});

// --- Routes: Girls ---
app.get('/api/girls', async (req, res) => {
  try {
    const girls = await Girl.find().sort({ createdAt: -1 });
    res.json(girls);
  } catch (e) { res.status(500).json([]); }
});

app.post('/api/girls', authenticate, isAdmin, async (req, res) => {
  try {
    const { action, girl } = req.body;
    if (action === 'add') {
      const newGirl = await Girl.create(girl);
      res.json(newGirl);
    } else if (action === 'update') {
      const updated = await Girl.findByIdAndUpdate(girl._id, girl, { new: true });
      res.json(updated);
    } else if (action === 'delete') {
      await Girl.findByIdAndDelete(girl._id);
      res.json({ success: true });
    }
  } catch (e) { res.status(500).json({ message: 'Ошибка' }); }
});

app.post('/api/upload', authenticate, isAdmin, upload.array('photos', 4), (req, res) => {
  const urls = req.files.map(f => `${req.protocol}://${req.get('host')}/uploads/${f.filename}`);
  res.json({ urls });
});

// --- Routes: Chat (BOT LOGIC) ---
app.get('/api/chat', authenticate, async (req, res) => {
  try {
    const chat = await Chat.findOne({ userId: req.user.username });
    res.json(chat || { messages: [] });
  } catch (e) { res.status(500).json({}); }
});

app.post('/api/chat/init', authenticate, async (req, res) => {
  try {
    const { girlId } = req.body;
    const girl = await Girl.findById(girlId);
    if (!girl) return res.status(404).json({ message: 'Girl not found' });

    let chat = await Chat.findOne({ userId: req.user.username });
    if (!chat) chat = await Chat.create({ userId: req.user.username, messages: [] });
    
    chat.messages = [];
    chat.botStep = 'girl_selected';
    chat.selectedGirl = girl;
    chat.waitingForOperator = false;

    // Бот сразу показывает анкету
    chat.messages.push(
      { type: 'bot', text: 'Здравствуйте! 👋 Вы выбрали:', time: new Date() },
      { type: 'bot', text: '', extra: { type: 'profile', girl }, time: new Date() },
      { type: 'bot', text: '💰 Оплата девушке в руки. Выберите услугу:', extra: { type: 'services', girl }, time: new Date() }
    );
    await chat.save();
    res.json({ messages: chat.messages });
  } catch (e) { res.status(500).json({ message: 'Ошибка инициализации' }); }
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

      // FSM State Machine
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
        const service = chat.selectedGirl.services.find(s => lower.includes(s.name.toLowerCase()));
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
  } catch (e) { res.status(500).json({ message: 'Ошибка чата' }); }
});

// --- Routes: Admin Chat ---
app.get('/api/admin/chats', authenticate, isAdmin, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ updatedAt: -1 });
    res.json(chats);
  } catch (e) { res.status(500).json([]); }
});

app.post('/api/admin/chat/reply', authenticate, isAdmin, async (req, res) => {
  try {
    const { userId, text } = req.body;
    const chat = await Chat.findOne({ userId });
    if (!chat) return res.status(404).json({ message: 'Not found' });
    
    // Удаляем статус "В обработке"
    if (chat.messages.length > 0 && chat.messages[chat.messages.length - 1].extra?.type === 'processing') {
      chat.messages.pop();
    }

    chat.messages.push({ type: 'bot', text: `[Оператор] ${text}`, time: new Date() });
    chat.waitingForOperator = false;
    chat.botStep = 'greet'; // Сброс бота
    chat.selectedGirl = null;
    await chat.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: 'Ошибка' }); }
});

app.put('/api/admin/chat/:userId/clear', authenticate, isAdmin, async (req, res) => {
  try {
    await Chat.findOneAndUpdate({ userId: req.params.userId }, { messages: [], waitingForOperator: false, botStep: 'greet' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: 'Ошибка' }); }
});

// --- Routes: Settings ---
app.get('/api/settings', async (req, res) => {
  try {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({ mainTitle: 'Анкеты девушек', mainSubtitle: 'Выберите идеальную компанию', title: 'BABYGIRL_LNR', phone: '' });
    res.json(s);
  } catch (e) { res.status(500).json({}); }
});

app.put('/api/settings', authenticate, isAdmin, async (req, res) => {
  try {
    const s = await Settings.findOneAndUpdate({}, req.body, { upsert: true, new: true });
    res.json(s);
  } catch (e) { res.status(500).json({ message: 'Ошибка' }); }
});

// --- Init Default Data ---
async function init() {
  const admin = await User.findOne({ username: 'admin' });
  if (!admin) {
    const hash = await bcrypt.hash('admin123', 10);
    await User.create({ username: 'admin', password: hash, role: 'admin' });
    console.log('✅ Admin created: admin / admin123');
  }
  
  if (await Girl.countDocuments() === 0) {
    await Girl.insertMany([
      { name: 'Алина', city: 'Луганск', photos: [], desc: 'Нежная и романтичная.', height: '168', weight: '52', breast: '2', age: '21', prefs: 'Романтика', services: [{name:'Встреча',price:'3000'},{name:'Свидание',price:'5000'},{name:'Ночь',price:'10000'}] },
      { name: 'Виктория', city: 'Стаханов', photos: [], desc: 'Яркая брюнетка.', height: '172', weight: '55', breast: '3', age: '23', prefs: 'Танцы', services: [{name:'Встреча',price:'3500'},{name:'Свидание',price:'6000'},{name:'Ночь',price:'12000'}] }
    ]);
    console.log('✅ Demo girls created');
  }
}
init();

// Serve Frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));