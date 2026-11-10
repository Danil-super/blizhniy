# Review: локальный кандидат роли возвратов

10.11.2026. [Точный patch](refund-worker-role.patch). [Описание и ограничения](../audit-refund-worker-role.md).

Новый standalone guard и SQL0054; существующие guard/workflows/runtime не меняются. План без executor, без пароля и без LOGIN; preflight только read-only. Три lock-only триггера не мешают финансовым definer-эффектам, но запрещают менять ID. Членства и прямые финансовые UPDATE запрещены. Проверяются дополнительные права системных функций/таблиц/колонок, параметров и схем. 62 штатных metadata SELECT сверены по исходникам PostgreSQL18.6, другие объекты и grant options не разрешаются.

Новые проверки добавлены к существующему обязательному PostgreSQL-набору; прежние assertions и floors не меняются. Focused46/46 прошли на настоящей disposable PostgreSQL18.6 с fake HTTP. Финальная регрессия: native2576/2576 и все13 обязательных PG-наборов774/774 за216.8s, без skips. Независимое инженерное ревью выявило системные ACL/параметры/схемы; замечания учтены. Дополнительную модель владелец пропустил. Сборка, проверка секретов и запуск стенда записываются в основном журнале инкремента.

Согласование касается только сохранения локального кандидата. Нет установки роли/0054 на ручном стенде или production, push/deploy, подключения к службе или реального provider HTTP. Полная сверка фактических business-объектов БД и service/artifact/TLS/TEST preflight остаются до включения. Возвраты и LIVE не включаются.

Основание review: CONSTRAINTS.md:47 — «Изменения самого guard/workflows … обязательно проверяются человеком».

Владелец одобрил точный diff10.11.2026: «Одобряю точный diff, только локально». Согласование не распространяется на установку роли/0054 на ручном или рабочем сайте, запуск службы и push.

SHA256 точных версий:

- `database/migrations/0054-refund-worker-locks.sql`: `58e0541d6519d37ade73c8b1cf14e28aaeb4846266c4618bad7186a52c3ec43b`
- `scripts/refund-worker-role.mjs`: `fc0a2d5c2d4584b54d2bca7c1f348d7d5358db73e2dab6e5ff5c19d7955ab683`
- `tests/refund-worker-role-cases.mjs`: `7196e7d3e0d289940e8ef8294edf12507eba3d011677c9eff47eb234043e3062`
- `tests/refund-worker-role.test.mjs`: `6ec7ec535a5beb7901989c29f5ab28e7706694db94a0e634acde4285fd3fb130`
- `tests/placement-refund-approval-postgres.mjs`: `e96efe31f87bded549d3b4fd4250e39357ca81072127d96af24e0b992faa9330`
