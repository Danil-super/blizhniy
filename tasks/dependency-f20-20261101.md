# Локальный F20 — 01.11.2026

Основание: продолжение исправлений PDF-аудита, локально. Выбран предусмотренный F20 путь доказательства эквивалентности backport; dependency manifests, lock, vendor, старые тесты, guard/workflows не менять. Production не затрагивать.

- [x] Сверить исходный F20 PDF с текущим lock и свежим native audit.
- [x] Graphify/Code Graph до анализа; актуальная Context7 и primary upstream документация.
- [x] Скачать pinned official6.1.5, проверить registry ECDSA подпись, SHA512/SHA256 и все37 файлов.
- [x] Добавить offline archive verifier и точный regression vendor/installed equivalence без ослабления прежних проверок.
- [x] Отрицательный контроль: исполняемый mutant обнаруживается, восстановленная копия зелёная; повреждённый archive отвергается.
- [x] Независимое ревью; замечание о symlink inventory исправлено, связь signed archive → file inventory воспроизводима.
- [x] Новый minimatch advisory отдельно разобран по реальным потребителям и instrumented ESLint; остаётся открытым, не объявлен исправлением.
- [x] Focused22/22 и native2440/2440; production build прошёл.

- [x] Types/lint/floor зелёные; прежнее lint warning не скрыто.
- [x] Graphify code-only и Code Graph обновлены для текущего проекта.
- [x] Ручной стенд запущен без сброса данных: HTTPS health/ready200 и real DB/HTML/build proof пройдены.

PostgreSQL/browser не повторялись без изменений application/SQL/dependencies. Следующие незакрытые пункты — DEP-MINIMATCH-20261101, финансовая сквозная приёмка F01–F03, оставшиеся lifecycle/retention F04–F06/F08, QA01 и эксплуатационная приёмка; локальный proof не заменяет release/staging checks. Подробности: `docs/audit-dependency-f20.md`.
