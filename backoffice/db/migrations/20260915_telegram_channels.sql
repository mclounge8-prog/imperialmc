-- Несколько Telegram-каналов (бот+группа) с привязкой к заведениям.
CREATE TABLE IF NOT EXISTS telegram_channels (
  id          SERIAL PRIMARY KEY,
  key         VARCHAR(50) NOT NULL UNIQUE,
  name        VARCHAR(100) NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  bot_token   TEXT,
  chat_id     TEXT,
  bot_username VARCHAR(100),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_channel_venues (
  channel_id  INT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
  venue_id    INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_channel_venues_venue
  ON telegram_channel_venues(venue_id);

-- Каналы по умолчанию (токены/chat_id проставляются отдельно на сервере).
INSERT INTO telegram_channels (key, name, enabled, bot_username)
VALUES
  ('mc_lounge', 'MC Lounge (Роза + Puff)', true, NULL),
  ('kebab_king', 'Kebab King', true, 'imperialmckebabbot'),
  ('mc_grand', 'MC Гранд', true, 'imperialMC_grand_bot')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    bot_username = COALESCE(EXCLUDED.bot_username, telegram_channels.bot_username),
    updated_at = now();

-- Перенос текущего глобального бота в канал MC Lounge.
UPDATE telegram_channels c
SET bot_token = s.bot_token,
    chat_id = s.chat_id,
    enabled = COALESCE(s.enabled, true),
    updated_at = now()
FROM telegram_settings s
WHERE c.key = 'mc_lounge'
  AND s.id = 1
  AND (c.bot_token IS NULL OR c.bot_token = '');

-- Привязка точек
INSERT INTO telegram_channel_venues (channel_id, venue_id)
SELECT c.id, v.id
FROM telegram_channels c
JOIN venues v ON (
  (c.key = 'mc_lounge' AND v.name IN ('MC Lounge Роза', 'MC Lounge Puff'))
  OR (c.key = 'kebab_king' AND v.name IN ('Kebab King Октябрьская', 'Kebab King Карла'))
  OR (c.key = 'mc_grand' AND v.name IN ('MC Гранд'))
)
ON CONFLICT DO NOTHING;
