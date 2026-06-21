# REBUS Secure — User Portal

Пакет для `rebus-secure.com`.

## Логіка входу

- `rebus-secure.com` — користувацький портал.
- Після Google OAuth користувач завжди переходить на власну сторінку `verify-2fa.html`.
- Після успішної 2FA користувач завжди переходить у `cabinet.html`.
- Якщо в користувача роль `admin` або `superadmin`, він НЕ перекидається автоматично в адмінку. Він просто отримує в кабінеті додаткове посилання на `https://admin.rebus-secure.com`.
- Звичайні ролі `user` та `operator` працюють тільки в користувацькому порталі.

## Supabase Redirect URLs

Додай у Supabase Authentication → URL Configuration:

```text
https://rebus-secure.com/
https://rebus-secure.com/verify-2fa.html
https://rebus-secure.com/cabinet.html
https://admin.rebus-secure.com/
https://admin.rebus-secure.com/index.html
https://admin.rebus-secure.com/dashboard.html
https://admin.rebus-secure.com/verify-2fa.html
```

## Таблиці доступу

Код шукає профіль у такому порядку:

1. `rebus_profiles`
2. `rebus_admin_access`

Підтримувані ролі:

```text
user
operator
admin
superadmin
```

Для користувацького порталу дозволені всі 4 ролі.
Для переходу в адмін-портал кнопка показується тільки `admin` і `superadmin`.


## Оновлення доступу через rebus_profiles

Користувацький портал перевіряє доступ у таблиці `rebus_profiles` за Google email.

Очікувані поля:
- `email`
- `role` (`user`, `operator`, `admin`, `superadmin`)
- `is_active`
- `status`
- `marker`
- `full_name`

Пошук email виконується через `ilike`, тому регістр літер у пошті не має значення.

Якщо доступ не знайдено, сторінка `access-denied.html` покаже email, який потрібно додати/активувати через адмінку.


## Chrome Web Store поля

Для сторінки продукту можна вказати:

```text
URL-адреса головної сторінки:
https://rebus-secure.com/

URL-адреса сторінки служби підтримки:
https://rebus-secure.com/support.html

Політика конфіденційності:
https://rebus-secure.com/privacy.html
```
