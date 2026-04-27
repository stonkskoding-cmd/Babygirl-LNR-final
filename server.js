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
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_change_in_prod';

// Подключение к MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ DB Error:', err));

// Модели
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' }
});
const User = mongoose.model('User', UserSchema);

const GirlSchema = new mongoose.Schema({
  name: String, city: String, age: Number, height: Number, weight: Number,
  breast: String, desc: String, prefs: String, photos: [String],
  services: [{ name: String, price: Number }],
  createdAt: { type: Date, default: Date.now }
});
const Girl = mongoose.model('Girl', GirlSchema);

const ChatSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  messages: [{
    type: { type: String, enum: ['user', 'bot', 'system'] },
    text: String, extra: Object, time: { type: Date, default: Date.now }
  }],
  botStep: { type: String, default: 'greet' },
  waitingForOperator: { type: Boolean, default: false },
  selectedGirl: Object,
  botEnabled: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', ChatSchema);

const SettingsSchema = new mongoose.Schema({ key: String, value: String });
const Settings = mongoose.model('Settings', SettingsSchema);

// Middleware
app.use(cors({ origin: true, credentials: true, methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads', { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp|gif/;
  cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
}});

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) { res.status(401).json({ message: 'Invalid token' }); }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access denied' });
  next();
};

// Инициализация данных (Создание 2 админов!)
async function initData() {
  const count = await User.countDocuments({ role: 'admin' });
  if (count === 0) {
    const randStr = () => Math.random().toString(36).slice(-6);
    const randPass = () => Math.random().toString(36).slice(-10);
    
    const admins = [
      { username: 'admin_' + randStr(), pass: randPass() },
      { username: 'operator_' + randStr(), pass: randPass() }
    ];

    console.log('\n🔐 FIRST RUN: CREATING ADMINS (SAVE THESE!) 🔐');
    console.log('='.repeat(50));
    
    for (const admin of admins) {
      const hash = await bcrypt.hash(admin.pass, 10);
      await User.create({ username: admin.username, password: hash, role: 'admin' });
      console.log(`Login: ${admin.username}`);
      console.log(`Pass:  ${admin.pass}`);
      console.log('-'.repeat(50));
    }
    console.log('='.repeat(50) + '\n');
  }
}
initData();

// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (await User.findOne({ username })) return res.status(400).json({ message: 'User exists' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash, role: 'client' });
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ message: e.message }); }
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
    if (action === 'add') return res.json(await Girl.create(girl));
    if (action === 'update') return res.json(await Girl.findByIdAndUpdate(girl._id, girl, { new: true }));
    if (action === 'delete') {
      await Girl.findByIdAndDelete(girl._id);
      return res.json({ success: true });
    }
    res.status(400).json({ message: 'Invalid action' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/upload', authenticate, isAdmin, upload.array('photos', 10), (req, res) => {
  res.json({ urls: req.files.map(f => `/uploads/${f.filename}`) });
});

// Chat Client
app.get('/api/chat', authenticate, async (req, res) => {
  try {
    let chat = await Chat.findOne({ userId: req.user.username });
    if (!chat) {
      chat = await Chat.create({
        userId: req.user.username,
        messages: [{ type: 'bot', text: 'Здравствуйте! 👋 Напишите ваш город (Луганск, Стаханов или Первомайск)', time: new Date() }],
        botStep: 'asking_city'
      });
    } else if (chat.messages.length === 0) {
      chat.messages.push({ type: 'bot', text: 'Здравствуйте! 👋 Напишите ваш город', time: new Date() });
      chat.botStep = 'asking_city';
      await chat.save();
    }
    res.json(chat);
  } catch (e) { res.status(500).json({ messages: [] }); }
});

app.post('/api/chat/send', authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    let chat = await Chat.findOne({ userId: req.user.username }) || await Chat.create({ userId: req.user.username, messages: [], botStep: 'greet' });
    
    chat.messages.push({ type: 'user', text, time: new Date() });
    
    if (!chat.waitingForOperator && chat.botEnabled) {
      const lower = text.toLowerCase();
      if (chat.botStep === 'asking_city' || chat.botStep === 'greet') {
        const cities = ['луганск', 'стаханов', 'первомайск'];
        const city = cities.find(c => lower.includes(c));
        if (city) {
          const girls = await Girl.find({ city: new RegExp(city, 'i') });
          chat.botStep = 'picking_girl';
          chat.messages.push({ type: 'bot', text: `В городе ${city} найдено анкет: ${girls.length}. Напишите имя девушки.` });
        } else {
          chat.messages.push({ type: 'bot', text: 'Напишите город: Луганск, Стаханов или Первомайск' });
        }
      } else if (chat.botStep === 'picking_girl') {
        const girl = await Girl.findOne({ name: new RegExp(lower, 'i') });
        if (girl) {
          chat.selectedGirl = girl;
          chat.botStep = 'picking_service';
          const services = girl.services.map(s => `- ${s.name}: ${s.price}₽`).join('\n');
          chat.messages.push({ type: 'bot', text: `Выбрана ${girl.name}.\nУслуги:\n${services}\nНапишите услугу.` });
        } else {
          chat.messages.push({ type: 'bot', text: 'Девушка не найдена.' });
        }
      } else if (chat.botStep === 'picking_service' && chat.selectedGirl) {
        const service = chat.selectedGirl.services.find(s => s.name.toLowerCase().includes(lower));
        if (service) {
          chat.waitingForOperator = true;
          chat.botStep = 'waiting_operator';
          chat.messages.push({ type: 'bot', text: `✅ Заказ: ${service.name} (${service.price}₽). Ожидайте оператора.` });
        } else {
          chat.messages.push({ type: 'bot', text: 'Услуга не найдена.' });
        }
      } else if (chat.botStep === 'waiting_operator') {
        chat.messages.push({ type: 'bot', text: 'Ожидайте ответа оператора.' });
      }
    }
    chat.updatedAt = new Date();
    await chat.save();
    res.json({ messages: chat.messages });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin Chats
app.get('/api/admin/chats', authenticate, isAdmin, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ updatedAt: -1 });
    res.json(chats);
  } catch (e) { res.status(500).json([]); }
});

app.get('/api/admin/chat/:userId', authenticate, isAdmin, async (req, res) => {
  try {
    const chat = await Chat.findOne({ userId: req.params.userId });
    if (!chat) return res.status(404).json({ message: 'Not found' });
    res.json(chat);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/chat/reply', authenticate, isAdmin, async (req, res) => {
  try {
    const { userId, text } = req.body;
    const chat = await Chat.findOne({ userId });
    if (!chat) return res.status(404).json({ message: 'Not found' });
    
    if (chat.messages.length > 0 && chat.messages[chat.messages.length - 1].extra?.type === 'processing') {
      chat.messages.pop();
    }
    chat.messages.push({ type: 'bot', text: `[Оператор] ${text}`, time: new Date() });
    chat.waitingForOperator = false;
    chat.updatedAt = new Date();
    await chat.save();
    res.json({ success: true, messages: chat.messages });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/admin/chat/:userId/complete', authenticate, isAdmin, async (req, res) => {
  try {
    const chat = await Chat.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { waitingForOperator: false, botStep: 'greet', selectedGirl: null, botEnabled: true } },
      { new: true }
    );
    if (!chat) return res.status(404).json({ message: 'Not found' });
    chat.messages.push({ type: 'system', text: 'Чат завершен оператором.', time: new Date() });
    await chat.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/admin/chat/:userId/clear', authenticate, isAdmin, async (req, res) => {
  try {
    await Chat.findOneAndUpdate({ userId: req.params.userId }, { $set: { messages: [], waitingForOperator: false, botStep: 'greet' } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
