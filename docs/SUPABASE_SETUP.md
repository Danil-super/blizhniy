# Supabase Setup

> ⚠️ Архивная инструкция для прототипа. Перечень SQL ниже **не воспроизводит текущую production-схему**: в репозитории накоплены отдельные миграции, права доступа и настройки Storage. Не запускайте эту сокращённую цепочку на рабочей БД и не включайте `PAYMENT_PROVIDER=mock` для реальных платежей. Перед запуском новой БД необходим чистый прогон полной цепочки миграций, сверка RLS/grants/Auth/Storage и тест восстановления из резервной копии; такой прогон пока не подтверждён.

Эти шаги нужны, когда появится новый проект на supabase.com.

## 1. Создать проект

1. Создай проект Supabase.
2. Открой `Project Settings -> API`.
3. Скопируй:
   - Project URL
   - anon public key
   - service_role key

## 2. Заполнить `.env.local`

Создай или обнови `.env.local`:

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

Если схема уже применялась раньше, перед повторным применением обновлений по ярмарке мастеров безопаснее сначала расширить enum:

```sql
alter type tariff_action add value if not exists 'fair_participation';
```

После этого можно применить новые таблицы `work_requests`, `fair_applications`, `fair_application_images`, обновленный seed категорий/тарифа и RLS-политики.

## 4. Настроить Auth

В `Authentication -> Providers` включить Email.

Рекомендуемые MVP-настройки:

- Email/password: enabled.
- Confirm email: можно выключить на dev, включить перед продом.
- Site URL: локально `http://localhost:3000` или `http://localhost:3001`, на проде реальный домен.
- Redirect URLs:
  - `http://localhost:3000/auth`
  - `http://localhost:3000/cabinet`
  - `http://localhost:3001/auth`
  - `http://localhost:3001/cabinet`

### Включение CAPTCHA и фиксации регистрации

Перед выпуском Auth-изменений проверьте на staging:

1. Выполните миграцию `20260927081011_record_registration_legal_events_20260927.sql`. В журнал записывается время сервера и заявление пользователя о принятии соглашения/ознакомлении с политикой. Данные заявления приходят из клиентского Auth-запроса и **не доказывают**, что пользователь нажал чекбокс в интерфейсе.
2. Укажите `NEXT_PUBLIC_TURNSTILE_SITE_KEY` в сборке сайта. Секрет Cloudflare Turnstile держите только в настройках Supabase Auth; проверьте, что ключ и секрет принадлежат одному виджету. Без публичного ключа обновлённая форма блокирует регистрацию, вход и запрос сброса пароля.
3. Разверните обновлённый сайт и проверьте вход. Затем включите **Auth → Bot and Abuse Protection → Enable CAPTCHA protection → Cloudflare Turnstile** в Supabase, указав секрет. Старую версию сайта нельзя оставлять активной после включения: её Auth-вызовы не передают токен.
4. Повторно проверьте успешные регистрацию, вход и письмо для смены пароля, а также отклонение прямого Auth API-запроса без токена и повторно использованного токена. Проверьте, что строки `registration_legal_events` доступны только серверу и содержат корректные редакции документов и время БД.

Если редакции соглашения или политики изменятся, синхронно обновите `REGISTRATION_LEGAL_VERSIONS` и проверку в SQL-функции до публикации новой формы. Отдельное согласие на публикацию персональных контактов оформляется после проверки правового основания и текста согласия.
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
