"use client";
import Link from 'next/link';

export function CabinetStart() {
  return <section aria-labelledby="cabinet-start-title" className="mb-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <h2 id="cabinet-start-title" className="text-xl font-bold text-brand-ink">С чего начать</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Профиль и настройки — выше. Здесь можно создать объявление, вернуться к сохранённым данным и проверить результат модерации.</p>
    <nav aria-label="Быстрые действия кабинета" className="mt-4 flex flex-wrap gap-3">
      <Link href="/razmestit/obyavlenie" className="inline-flex min-h-11 items-center rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Создать объявление</Link>
      <Link href="/cabinet/obyavleniya" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-blue focus-visible:outline focus-visible:outline-2">Мои объявления</Link>
      <a href="#cabinet-profile" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue underline">Профиль и контакты</a>
    </nav>
    <ol className="mt-4 list-inside list-decimal space-y-2 text-sm leading-6 text-slate-700">
      <li>Проверьте имя и контакты в настройках профиля.</li>
      <li>Заполните объявление, добавьте фото и сохраните изменения.</li>
      <li>Отправьте на модерацию. Результат и причина отказа появятся в карточке объявления.</li>
    </ol>
    <p className="mt-3 text-xs leading-5 text-slate-600">Черновики не видны другим посетителям. Одобрение модератором не означает публикацию: подключение оплаты — следующий этап разработки.</p>
  </section>;
}
