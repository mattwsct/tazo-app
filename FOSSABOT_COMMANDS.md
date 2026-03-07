# Fossabot Command URLs

All chat commands are now available at `https://app.tazo.wtf/api/chat/*`

**Query parameter (`?q=$(querystring)`):**
- **Required** for commands that accept user input: !weather Tokyo, !random 1 100, !temp 25, etc.
- **Optional** for no-arg commands (!status, !coin, !speed, etc.) — omit it for brevity, or include it (harmless when empty).
- **Simplest setup:** Use `?q=$(querystring)` for all commands — one URL per command works for both `!cmd` and `!cmd args`.

## Social Media Commands

These commands return profile links. If a username is provided, returns the profile link. Otherwise, returns the fallback link.

```
!instagram [username] → $(customapi https://app.tazo.wtf/api/chat/instagram?q=$(querystring))
!tiktok [username] → $(customapi https://app.tazo.wtf/api/chat/tiktok?q=$(querystring))
!youtube [username] → $(customapi https://app.tazo.wtf/api/chat/youtube?q=$(querystring))
!twitter [username] → $(customapi https://app.tazo.wtf/api/chat/twitter?q=$(querystring))
!kick [username] → $(customapi https://app.tazo.wtf/api/chat/kick?q=$(querystring))
!rumble [username] → $(customapi https://app.tazo.wtf/api/chat/rumble?q=$(querystring))
!twitch [username] → $(customapi https://app.tazo.wtf/api/chat/twitch?q=$(querystring))
!parti [username] → $(customapi https://app.tazo.wtf/api/chat/parti?q=$(querystring))
!dlive [username] → $(customapi https://app.tazo.wtf/api/chat/dlive?q=$(querystring))
```

## Shoutout Command

Multi-platform shoutout that detects the user's platform and generates the appropriate link:

```
!so username → $(customapi https://app.tazo.wtf/api/chat/so?q=$(querystring)&p=$(user.provider))
```

Supports platforms: `twitch`, `youtube`, `kick` (defaults to kick if not specified).

## Location-Based Commands

These commands work with or without a query. If no query is provided, they use your RTIRL GPS location.

### Weather

```
!weather → $(customapi https://app.tazo.wtf/api/chat/weather)
!weather Tokyo → $(customapi https://app.tazo.wtf/api/chat/weather?q=$(querystring))
```

Returns current weather conditions with temperature in both Celsius and Fahrenheit, feels like temperature, notable conditions (wind, humidity, visibility), and weather alerts for severe conditions.

Example outputs:
- `☀️ 25°C/77°F Clear sky · Feels like 27°C/81°F · 15km/h wind`
- `⛈️ 22°C/72°F Thunderstorm · ⚠️ Thunderstorm warning · wind 45km/h`
- `☀️ 42°C/108°F Clear sky · ⚠️ Extreme heat warning · very hot (feels like 45°C/113°F)`

### Forecast

```
!forecast → $(customapi https://app.tazo.wtf/api/chat/forecast)
!forecast Los Angeles → $(customapi https://app.tazo.wtf/api/chat/forecast?q=$(querystring))
```

Returns 5-day weather forecast with temperature ranges, conditions, wind, and humidity for notable days.

Example output: `☀️ Today 20-25°C/68-77°F · 🌧️ Tomorrow 15-18°C/59-64°F · 25km/h wind · 85% humidity | ☀️ Mon Jan 15 18-22°C/64-72°F`

### Time

```
!time → $(customapi https://app.tazo.wtf/api/chat/time)
!time New York → $(customapi https://app.tazo.wtf/api/chat/time?q=$(querystring))
```

### UV Index & Air Quality

```
!uv → $(customapi https://app.tazo.wtf/api/chat/uv)
!aqi → $(customapi https://app.tazo.wtf/api/chat/aqi)
```

Returns UV index and air quality (AQI) at current location. Uses location from overlay/RTIRL.

### Sunrise/Sunset

```
!sun → $(customapi https://app.tazo.wtf/api/chat/sun)
!sun Paris → $(customapi https://app.tazo.wtf/api/chat/sun?q=$(querystring))
```

Returns sunrise and sunset times with time until each event.

Example output: `🌅 Sunrise 6:15 AM (in 2h 30m) · 🌇 Sunset 7:45 PM (in 14h 0m)`

### Map Link

```
!map → $(customapi https://app.tazo.wtf/api/chat/map)
!map London → $(customapi https://app.tazo.wtf/api/chat/map?q=$(querystring))
```

### Location

```
!location → $(customapi https://app.tazo.wtf/api/chat/location)
!location Sydney → $(customapi https://app.tazo.wtf/api/chat/location?q=$(querystring))
```

## Status Commands

### Status (Homepage Data as JSON)

```
!status → $(customapi https://app.tazo.wtf/api/chat/status)
```


## Size Ranking Commands

```
!inch 5.5 4.5 → $(customapi https://app.tazo.wtf/api/chat/inch?q=$(querystring))
!cm 14 11.5 → $(customapi https://app.tazo.wtf/api/chat/cm?q=$(querystring))
```

Or using individual parameters:

```
!inch 5.5 4.5 → $(customapi https://app.tazo.wtf/api/chat/inch?l=$(1)&g=$(2))
!cm 14 11.5 → $(customapi https://app.tazo.wtf/api/chat/cm?l=$(1)&g=$(2))
```

Returns size ranking with percentile, percentage above/below average, and porn star comparisons (if similar size found).

**Features:**
- Uses 2025 meta-analysis data (5.45" avg length, 4.69" avg girth)
- Shows percentile ranking next to each measurement (length and girth separately)
- **Length only:** Compares to similar porn star length (6–9" spectrum)
- **Length + girth:** Compares to porn star if within 1" combined difference
- **Condom suggestion** (when girth provided): Nominal width (mm) + brand hints (Trojan Magnum, Skyn Large, MyONE, etc.) for L/XL/XXL
- Works with length only or length + girth

Example outputs:
- `🍆 7" (top 9.7%) x 5" (top 5.2%): above average length, large girth ~60mm nominal width (XL): Trojan Magnum XL, Pasante King Size. Similar size to Johnny Sins (7" x 5")`
- `🍆 8.5" (top 0.12%) x 5.8" (top 0.05%): huge length, huge girth ~64mm nominal width (XXL): Pasante Super King, MyONE 64. Matches Jax Slayher's size (8.5" x 5.8")`
- `🍆 6" (top 19.7%): above average. Similar length to Chad Alva (6")`
- All ranges show exact top x% or bottom x% with precision down to 0.0000001% when needed.

## Travel Commands

These commands use your RTIRL GPS location to provide country-specific travel information. You can also specify a country code to check other countries' data.

**Available countries:** AU (Australia), BR (Brazil), CA (Canada), CN (China), DE (Germany), ES (Spain), FR (France), GB (United Kingdom), GR (Greece), ID (Indonesia), IN (India), JP (Japan), KR (South Korea), MX (Mexico), MY (Malaysia), NL (Netherlands), NZ (New Zealand), PH (Philippines), PT (Portugal), SG (Singapore), TH (Thailand), TR (Turkey), TW (Taiwan), US (United States), VN (Vietnam), ZA (South Africa)

Use `!countries` to see the full list.

### Food

```
!food → $(customapi https://app.tazo.wtf/api/chat/food)
!food AU → $(customapi https://app.tazo.wtf/api/chat/food?q=AU)
!food JP → $(customapi https://app.tazo.wtf/api/chat/food?q=JP)
```

Returns 3 random local food recommendations. Uses your current country by default, or specify a country code (e.g., `AU`, `JP`) to check other countries.

### Phrases

```
!phrase → $(customapi https://app.tazo.wtf/api/chat/phrase)
!phrase JP → $(customapi https://app.tazo.wtf/api/chat/phrase?q=JP)
!phrase TH → $(customapi https://app.tazo.wtf/api/chat/phrase?q=TH)
```

Returns 3 random local phrases with translations. Uses your current country by default, or specify a country code to check other countries.

### Cultural Tips

```
!tips → $(customapi https://app.tazo.wtf/api/chat/tips)
!tips FR → $(customapi https://app.tazo.wtf/api/chat/tips?q=FR)
!tips IT → $(customapi https://app.tazo.wtf/api/chat/tips?q=IT)
```

Returns 3 random cultural tips to help you navigate local customs and etiquette. Uses your current country by default, or specify a country code to check other countries.

### Emergency Phrases

```
!emergency → $(customapi https://app.tazo.wtf/api/chat/emergency)
!emergency MX → $(customapi https://app.tazo.wtf/api/chat/emergency?q=MX)
!emergency DE → $(customapi https://app.tazo.wtf/api/chat/emergency?q=DE)
```

Returns emergency phone numbers, embassy contact information, and practical emergency guidance for injuries, theft, lost passports, and medical situations. Uses your current country by default, or specify a country code to check other countries. Essential for IRL emergencies when traveling.

Example output: `[Mexico] All: 911 | Police: 066 | Ambulance: 065 | Fire: 068 | Embassy: Contact your embassy... | If injured: Call 065... | If robbed/theft: Call 066...`

### Currency

```
!currency → $(customapi https://app.tazo.wtf/api/chat/currency)
!currency JP → $(customapi https://app.tazo.wtf/api/chat/currency?q=JP)
!currency BR → $(customapi https://app.tazo.wtf/api/chat/currency?q=BR)
```

Returns the local currency name, symbol, and ISO code. Uses your current country by default, or specify a country code to check other countries.

Example output: `[Japan] Yen (JPY) ¥` or `Euro (EUR) €`

### Convert

```
!convert 1000 → $(customapi https://app.tazo.wtf/api/chat/convert?q=1000)
!convert 1,000.50 AUD → $(customapi https://app.tazo.wtf/api/chat/convert?q=1,000.50 AUD)
!convert 1000 AUD JPY → $(customapi https://app.tazo.wtf/api/chat/convert?q=1000 AUD JPY)
```

Converts currency amounts. Supports multiple formats:
- `!convert 1000` - Converts 1000 units of your local currency to USD (or AUD if local currency is USD)
- `!convert 1,000.50 AUD` - Converts 1,000.50 AUD to USD (defaults to USD if only one currency specified, or AUD if FROM is USD)
- `!convert 1000 AUD JPY` - Converts 1000 AUD to JPY (specify both FROM and TO currencies)

**Features:**
- Accepts amounts with commas (1,000) and decimals (1000.50)
- If local currency is USD, defaults to converting to AUD (more useful)
- If FROM currency is USD and only one currency specified, converts to AUD

Example outputs:
- `¥1,000.00 JPY = $6.67 USD | 1 JPY = $0.0067 USD, 1 USD = ¥149.70 JPY` (shows reverse conversion)
- `A$1,000.50 AUD = $658.42 USD | 1 AUD = $0.6584 USD, 1 USD = A$1.5192 AUD`
- `$1,000.00 USD = A$1,520.00 AUD | 1 USD = 1.5200 AUD, 1 AUD = $0.6579 USD`
- `A$1,000.00 AUD = ¥98,765.43 JPY (rate: 1 AUD = 98.7654 JPY)` (reverse shown for common currencies)

### Flirt

```
!flirt → $(customapi https://app.tazo.wtf/api/chat/flirt)
!flirt JP → $(customapi https://app.tazo.wtf/api/chat/flirt?q=JP)
!flirt FR → $(customapi https://app.tazo.wtf/api/chat/flirt?q=FR)
```

Returns 3 random flirting phrases and suggestions in the local language (with translations). Uses your current country by default, or specify a country code to check other countries. If the country is not in the list, returns general English flirting phrases.

Example output: `[Japan] きれいですね (Kirei desu ne) - You're beautiful · 一緒に飲みませんか？ (Issho ni nomimasen ka?) - Would you like to drink together? · また会えますか？ (Mata aemasu ka?) - Can we meet again?`

### Sex
```
!sex → $(customapi https://app.tazo.wtf/api/chat/sex)
!sex JP → $(customapi https://app.tazo.wtf/api/chat/sex?q=JP)
!sex FR → $(customapi https://app.tazo.wtf/api/chat/sex?q=FR)
```

Returns 3 random sexually suggestive phrases in the local language (with translations). Uses your current country by default, or specify a country code to check other countries. Phrases are designed to be humorous in drinking environments and include proper context (e.g., "I want to...", "Can you...", "Let's...").

Example output: `[Japan] I want to cum on your face (顔に射精したい - Kao ni shasei shitai) · I'd like to fuck your asshole (アナルを犯したい - Anaru o okashitai) · Can you suck my cock? (フェラしてくれる？ - Fera shite kureru?)`

### Insults
```
!insults → $(customapi https://app.tazo.wtf/api/chat/insults)
!insults JP → $(customapi https://app.tazo.wtf/api/chat/insults?q=JP)
!insults FR → $(customapi https://app.tazo.wtf/api/chat/insults?q=FR)
```

Returns 3 random local insults and vulgar language in the local language (with translations). Uses your current country by default, or specify a country code to check other countries.

Example output: `[Japan] バカ (Baka) - Idiot · クソ野郎 (Kuso yarou) - Asshole · 死ね (Shine) - Die`

### Countries List

```
!countries → $(customapi https://app.tazo.wtf/api/chat/countries)
```

Returns a list of all available country codes and names for use with other travel commands.

## Stats Commands

### Uptime

```
!uptime → $(customapi https://app.tazo.wtf/api/chat/uptime)
```

Returns how long the stream has been live. Resets when you go live.

Example output: `⏱️ 11h 32m` or `⏱️ 1d 5h 12m`

### Heart Rate

```
!heartrate → $(customapi https://app.tazo.wtf/api/chat/heartrate)
!hr → $(customapi https://app.tazo.wtf/api/chat/hr)
```

Returns heart rate from Pulsoid only (overlay must be open with Pulsoid connected). Session stats: current, low, high this stream.

Example output: `💓 Current: 85 bpm (live) | Low: 72 bpm | High: 120 bpm` or `💓 No heart rate data this stream yet. (Pulsoid on overlay)`

### Speed

```
!speed → $(customapi https://app.tazo.wtf/api/chat/speed)
```

Returns current speed and max speed this stream.

Example output: `Current: 25 km/h | Max: 120 km/h (1h ago)`

### Altitude

```
!altitude → $(customapi https://app.tazo.wtf/api/chat/altitude)
!elevation → $(customapi https://app.tazo.wtf/api/chat/altitude)
```

Returns current altitude, highest, and lowest this stream.

Example output: `Current: 150 m | Highest: 450 m (3h ago) | Lowest: 50 m (5h ago)`

### Followers

```
!followers → $(customapi https://app.tazo.wtf/api/chat/followers)
```

Returns your channel's follower count. Uses kick.com public API; cached 5 minutes. Requires Kick connected (slug stored when you load channel in admin).

Example output: `👥 12,345 followers`

### Subscribers

```
!subs → $(customapi https://app.tazo.wtf/api/chat/subs)
!subscribers → $(customapi https://app.tazo.wtf/api/chat/subs)
```

Returns your channel's subscriber count if available. Note: Kick's public API may not expose subscriber count for all channels.

Example output: `⭐ 1,234 subscribers`

## Wellness Commands (Health Auto Export)

These commands use wellness data imported from Health Auto Export (steps, distance, height, weight). Steps and distance are today's totals; height/weight are latest values.

```
!steps → $(customapi https://app.tazo.wtf/api/chat/steps)
!distance → $(customapi https://app.tazo.wtf/api/chat/distance)
!height → $(customapi https://app.tazo.wtf/api/chat/height)
!weight → $(customapi https://app.tazo.wtf/api/chat/weight)
!wellness → $(customapi https://app.tazo.wtf/api/chat/wellness)
```

**Aliases:** `!dist` for distance, `!ht` for height, `!wt` for weight.

Example outputs:
- `👟 12,450 steps today`
- `🚶 8.2 km (5.1 mi) walked/run today`
- `📏 180 cm (5'11")`
- `⚖️ 75.2 kg (165.8 lbs)`
- `📊 12,450 steps · 8.2 km (5.1 mi) · 180 cm (5'11") · 75.2 kg`

## Fun Commands

### Dice / Roll

```
!dice → $(customapi https://app.tazo.wtf/api/chat/dice)
!roll → $(customapi https://app.tazo.wtf/api/chat/dice)
!dice 20 → $(customapi https://app.tazo.wtf/api/chat/dice?q=20)
!roll 6 3 → $(customapi https://app.tazo.wtf/api/chat/dice?q=6 3)
```

Roll dice with customizable sides and count. Defaults to 6-sided die, single roll.

- `!dice` - Roll a 6-sided die
- `!dice 20` - Roll a 20-sided die
- `!roll 6 3` - Roll 3 six-sided dice

Example output: `🎲 Rolled 15 (d20)` or `🎲 Rolled 4, 6, 2 = 12 (3d6)`

### Coin Flip

```
!coin → $(customapi https://app.tazo.wtf/api/chat/coin)
!flip → $(customapi https://app.tazo.wtf/api/chat/coin)
```

Flip a coin and get heads or tails.

Example output: `🪙 Heads` or `🪙 Tails`

### Magic 8-Ball

```
!8ball → $(customapi https://app.tazo.wtf/api/chat/8ball)
!magic8ball → $(customapi https://app.tazo.wtf/api/chat/8ball)
```

Get a random magic 8-ball response to your question.

Example output: `🎱 It is certain` or `🎱 Ask again later`

### Random Number

```
!random → $(customapi https://app.tazo.wtf/api/chat/random?q=$(querystring))
```

Generate a random number. Works with or without query (use `?q=$(querystring)` so args are passed when provided):
- `!random` - Random 1-100 (empty query defaults to 1-100)
- `!random 100` - Random 1-100
- `!random 1 100` - Random between min and max

Example output: `🎲 Random: 42 (1-100)`

## Utility Commands

### Temperature Conversion

```
!temp 25 → $(customapi https://app.tazo.wtf/api/chat/temp?q=25)
!temp 77 f → $(customapi https://app.tazo.wtf/api/chat/temp?q=77 f)
!temp 22c → $(customapi https://app.tazo.wtf/api/chat/temp?q=22c)
!temp 70f → $(customapi https://app.tazo.wtf/api/chat/temp?q=70f)
!temperature 100 → $(customapi https://app.tazo.wtf/api/chat/temp?q=100)
```

Convert between Celsius and Fahrenheit. Defaults to Celsius to Fahrenheit if no unit specified.

- `!temp 25` - Converts 25°C to Fahrenheit
- `!temp 77 f` - Converts 77°F to Celsius
- `!temp 22c` - Converts 22°C to Fahrenheit (unit attached)
- `!temp 70f` - Converts 70°F to Celsius (unit attached)

Example output: `🌡️ 25°C = 77.0°F` or `🌡️ 77°F = 25.0°C`

### Moon Phase

```
!moon → $(customapi https://app.tazo.wtf/api/chat/moon)
```

Shows the current moon phase and illumination percentage. Uses your current location for accuracy.

Example output: `🌕 Moon: Full Moon (98% illuminated)` or `🌒 Moon: Waxing Crescent (15% illuminated)`

### Fact

```
!fact → $(customapi https://app.tazo.wtf/api/chat/fact)
!fact JP → $(customapi https://app.tazo.wtf/api/chat/fact?q=JP)
!facts AU → $(customapi https://app.tazo.wtf/api/chat/fact?q=AU)
```

Returns a random interesting fact about your current country or a specified country code.

Example output: `[Japan] Japan has over 5.5 million vending machines - more than anywhere else in the world`


---

**Base URL:** `https://app.tazo.wtf/api/chat/`

**Migration Note:** If you're updating from the old `tazo.wtf/api/*` endpoints, simply replace:
- `https://tazo.wtf/api/` → `https://app.tazo.wtf/api/chat/`

**Note:** Stats commands require the overlay to be sending data updates. The overlay automatically sends speed and altitude data when available.
