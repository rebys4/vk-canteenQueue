# Электронная очередь в столовую — VK Mini App

Мини-приложение для сокращения живых очередей в столовой: запись в очередь, позиция и ETA в реальном времени, вызов «следующего» для админа, профиль (XP/бейджи/история).

---

## Стэк

- **Frontend:** React + Vite + VKUI + VK Bridge, Supabase Realtime  
- **Backend:** Node.js (Express) + Supabase (Postgres, Edge Functions/JS client)  
- **Hosting (frontend):** VK Hosting (через `vk-miniapps-deploy`)  
- **Dev-доступ:** `vk-tunnel` (подписанные launch params в VK)  

---

## Структура репозитория
```
├─ frontend/            # VK Mini App (React/Vite)
│  ├─ src/
│  ├─ index.html
│  ├─ vite.config.ts
│  ├─ vk-hosting-config.json  # конфиг для VK Hosting
│  └─ .env.local              # фронтовые переменные (VITE_*)
│
├─ backend/             # Node.js API (Express)
│  ├─ src/
│  ├─ package.json
│  └─ .env               # серверные переменные (.env.example см. ниже)
│
└─ README.md

```

---

## ⚙️ Переменные окружения

### Frontend (`frontend/.env.local`)
```env
VITE_API_URL=http://localhost:5175
VITE_SUPABASE_URL=https://ocjmbbzbqgnddkkcpiqr.supabase.co
VITE_SUPABASE_ANON=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jam1iYnpicWduZGRra2NwaXFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODUzOTQsImV4cCI6MjA3MDI2MTM5NH0.MJK-JfGGTCSCjiOaV2hrrsOZNn4S_OEgKqFbtWOkkHc
VITE_CANTEEN_ID=c9dcb65b-33e3-4255-abd4-1ee380dae4b3
VITE_ADMINS=220776738
VITE_DEV_VK_ID=220776738
```

### Backend (`backend/.env`)
```env
PORT=5175
SUPABASE_URL=https://ocjmbbzbqgnddkkcpiqr.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jam1iYnpicWduZGRra2NwaXFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDY4NTM5NCwiZXhwIjoyMDcwMjYxMzk0fQ.__Y-NZg5ops9tASEEcc6Js33chCzEOGuEyWwpDbqYfc
VK_ADMINS=220776738
VK_APP_SECRET=QyNGOCt2141y1DYKFgZX
VITE_API_URL=http://localhost:5175
VITE_DEV_VK_ID=220776738
ALLOW_DEV_NO_SIGN=0
```

### Локальный запуск

0. Открыть три терминала (backend, frontend, frontend для запуска vk tunnel) 
1. Backend:
```bash
cd backend
npm i
npm run dev
```

2. Frontend:
```bash
cd frontend
npm i
npm run dev -- --host
```

3. Frontend (vk tunnel):
```bash
cd frontend
npm run tunnel
```


### Деплой приложения
1. Собираем проект:
```bash
cd frontend
npm run build
```

2. Запускаем деплой:
```bash
npm run deploy
```

3. Проходим мини-опрос, авторизацию
4. Приложение запущено!✅

