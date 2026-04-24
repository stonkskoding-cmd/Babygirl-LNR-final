# BABYGIRL_LNR - Production Ready

## 🚀 Деплой на Render.com

### 1. MongoDB Atlas Setup
1. Перейдите на https://cloud.mongodb.com/
2. Создайте бесплатный кластер M0
3. Создайте пользователя Database User (admin / сложный пароль)
4. В Network Access добавьте IP: 0.0.0.0/0
5. Скопируйте connection string в формате:
   ```
   mongodb+srv://admin:<password>@cluster0.xxxxx.mongodb.net/babgirl_lnr?retryWrites=true&w=majority
   ```

### 2. Render.com Setup
1. Залейте код на GitHub
2. В Render создайте новый Web Service
3. Подключите репозиторий GitHub
4. Настройки:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment Variables**:
     - `MONGODB_URI`: ваш connection string из MongoDB Atlas
     - `JWT_SECRET`: случайная строка (сгенерируйте через `openssl rand -hex 32`)
     - `PORT`: 3000
     - `NODE_ENV`: production

### 3. Первый запуск
После деплоя:
1. Откройте https://ваш-сайт.onrender.com
2. Пройдите проверку 18+
3. Войдите как админ:
   - Логин: `admin`
   - Пароль: `admin123`
4. **СРОЧНО смените пароли админов!**
5. Добавьте анкеты девушек через админ-панель
6. Настройте сайт в разделе "Настройки"

## 🔐 Безопасность
- JWT токены для авторизации
- bcrypt хеширование паролей (10 rounds)
- CORS настроен для onrender.com
- Валидация всех входных данных
- Rate limiting рекомендуется добавить

## 📁 Структура проекта
```
/project-root
├── server.js          # Backend (Express + MongoDB)
├── package.json       # Зависимости
├── .env              # Переменные окружения (не коммитить!)
├── .env.example      # Шаблон .env
├── .gitignore        # Игнорируемые файлы
└── public/
    ├── index.html    # Frontend (Vanilla JS)
    └── video/
        └── bg.mp4    # Видео-фон
```

## 🛠️ API Endpoints

### Auth
- `POST /api/auth/register` - Регистрация
- `POST /api/auth/login` - Вход

### Girls
- `GET /api/girls` - Получить все анкеты
- `POST /api/girls` - CRUD (add/update/delete) [admin]

### Chat
- `GET /api/chat` - Получить чат [auth]
- `POST /api/chat/init` - Инициализировать чат с девушкой [auth]
- `POST /api/chat/send` - Отправить сообщение [auth]

### Admin
- `GET /api/admin/chats` - Все чаты [admin]
- `POST /api/admin/chat/reply` - Ответ оператора [admin]
- `PUT /api/admin/chat/:userId/clear` - Очистить чат [admin]
- `DELETE /api/admin/chat/:userId` - Удалить чат [admin]

### Settings
- `GET /api/settings` - Получить настройки
- `PUT /api/settings` - Обновить настройки [admin]

### Upload
- `POST /api/upload` - Загрузка фото [admin]

### Health
- `GET /api/health` - Проверка статуса сервера

## ⚠️ Важно для Production
1. Смените пароли админов по умолчанию
2. Сгенерируйте уникальный JWT_SECRET
3. Используйте HTTPS (Render предоставляет автоматически)
4. Регулярно делайте бэкапы MongoDB
5. Мониторьте логи приложения

## 📞 Поддержка
Для вопросов обращайтесь к разработчику.
