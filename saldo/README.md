# FinSolution

Phone ledger with no login and no storefront. The interface is English. Surfaces use Kyant's Liquid Glass (Backdrop) over a colored field, and the Android navigation bar stays hidden until a swipe from the bottom edge.

- Обзор: остаток, доходы и расходы текущего месяца, последние операции
- Доходы и расходы по месяцам
- Анализ: кольцо категорий и столбцы расходов за полгода (Vico)
- Кредитный калькулятор, аннуитет
- Записи лежат в файле на телефоне
- При запуске приложение читает `https://dash.ref2b.com/saldo/version.json`. Если `versionCode` больше установленного, скачивает APK без кэша и открывает установщик Android. Если загрузка срывается, баннер открывает тот же файл в браузере

Первая установка: https://dash.ref2b.com/saldo/

Сборка подписывается ключом из `keystore/`, он не попадает в git. Копия ключа и пароля лежит на сервере в `/root/saldo-signing/`. Новая сборка должна быть подписана тем же ключом, иначе Android не поставит её поверх старой.

Шрифты Manrope и Fraunces распространяются по лицензии OFL.
