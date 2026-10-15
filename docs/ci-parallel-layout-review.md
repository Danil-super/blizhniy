# Ускорение CI: одобрено владельцем

Статус: владелец подтвердил публикацию15.10.2026 ответом «делай» после просмотра предложенного изменения. Разрешение относится к параллельному layout job, не к отключению проверок, покупкам, смене Auth или runtime. Публикация и фактический результат GitHub проверяются отдельно; human-review условие CONSTRAINTS для этого diff выполнено.

Предлагается вынести существующие layout-проверки из конца `validate` в параллельный job `category_heroes` того же reusable workflow. Команды обоих browser scripts, startup/readiness loop, BASE_URL и deadlines не меняются — native test сравнивает точный hash прежнего шага из e9a979f. На каждом runner — свой checkout, Node22/npm cache, quality floor перед `npm ci`; lifecycle policy из `.npmrc` сохраняется. Actions остаются на прежних immutable SHA.

Types/lint/native/shell/build/audit остаются обязательными в `validate`. Category layouts остаются обязательными во втором job: без `if`, `needs` и `continue-on-error`. Вызывающий deploy по-прежнему зависит от результата **всего** reusable CI и security/codeql; post-deploy smoke/rollback не меняются. Ни production env, ни БД/ПД не передаются новому job. [GitHub: needs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds), [вызов reusable workflow как job](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#calling-a-reusable-workflow).

Ожидаемый эффект — ожидание более длинного из двух параллельных этапов вместо их суммы. Это пока расчёт, не измеренное ускорение нового CI: новый workflow ещё не запускался на GitHub. Цена — второй runner и повторный install; расход Actions minutes может увеличиться. Runner quota/billing не меняются автоматически и не покупаются.

Измеренный исходный прогон [38674234937](https://github.com/Danil-super/blizhniy/actions/runs/38674234937): validate10мин44с, из них layout4мин50с после build; новый layout job начнётся параллельно, но фактическую экономию нужно измерить на GitHub после review.

Проверено локально: YAML parse и focused19/19 (новый контракт + прежние security/floor/SSH workflow regressions), полный native1232/1232 без skips, lint нового теста без ошибок, quality floor clean; RED отсутствующего отдельного job, GREEN после переноса. Mutation `continue-on-error: true` поймана, источник восстановлен. Локального actionlint нет; его отсутствие не выдано за успешную проверку. Реальную конкуренцию, итог caller и сохранение blocked deploy можно подтвердить только после одобренного запуска GitHub.

После публикации нужно проверить оба обязательных job и deploy; при регрессии вернуть прежнюю последовательную структуру без удаления проверок. Сборка на VPS, перевод на Node22, prebuilt artifact pipeline и включение нового Auth **не входят** в этот diff и не считаются решёнными этим ускорением.
