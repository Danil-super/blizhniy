# Supabase Setup

Эти шаги нужны, когда появится новый проект на supabase.com.

## 1. Создать проект

1. Создай проект Supabase.
2. Открой `Project Settings -> API`.
3. Скопируй:
   - Project URL
   - anon public key
   - service_role key

## 2. Заполнить `.env.local`

Скопируй `.env.example` в `.env.local`:

```bash
cp .env.example .env.local
```

Заполни:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAIL=почта_админа@example.ru
PAYMENT_PROVIDER=mock
```

## 3. Применить SQL

В Supabase открой `SQL Editor` и выполни по порядку:

1. `supabase/schema.sql`
2. `supabase/seed.sql`
3. `supabase/rls.sql`

`schema.sql` создает таблицы, enum-типы и trigger, который автоматически создает `profiles` и базовую роль `user` после регистрации через Supabase Auth.

`seed.sql` заполняет стартовые категории, подкатегории и классификатор специалистов.

`rls.sql` включает Row Level Security и базовые политики доступа.

## 4. Настроить Auth

В `Authentication -> Providers` включить Email.

Рекомендуемые MVP-настройки:

- Email/password: enabled.
- Confirm email: можно выключить на dev, включить перед продом.
- Site URL: локально `http://localhost:3001`, на проде реальный домен.
- Redirect URLs:
  - `http://localhost:3001/auth`
  - `http://localhost:3001/cabinet`

## 5. Назначить админа

После регистрации админского пользователя выполни в SQL Editor:

```sql
insert into user_roles (user_id, role)
select id, 'admin'
from profiles
where email = 'почта_админа@example.ru'
on conflict do nothing;
```

## 6. Storage для фото

В MVP фото можно оставить необязательными. Когда включаем загрузку:

- bucket `listing-images`
- bucket `specialist-photos`
- bucket `organization-logos`

Публичность bucket лучше не включать сразу; безопаснее отдавать изображения через signed URLs или отдельные политики.
