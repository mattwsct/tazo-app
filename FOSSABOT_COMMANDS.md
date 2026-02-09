# Fossabot Command URLs

All chat commands are now available at `https://app.tazo.wtf/api/chat/*`

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

### Forecast

```
!forecast → $(customapi https://app.tazo.wtf/api/chat/forecast)
!forecast Los Angeles → $(customapi https://app.tazo.wtf/api/chat/forecast?q=$(querystring))
```

### Time

```
!time → $(customapi https://app.tazo.wtf/api/chat/time)
!time New York → $(customapi https://app.tazo.wtf/api/chat/time?q=$(querystring))
```

### Sunrise/Sunset

```
!sun → $(customapi https://app.tazo.wtf/api/chat/sun)
!sun Paris → $(customapi https://app.tazo.wtf/api/chat/sun?q=$(querystring))
```

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

## Travel Commands

These commands use your RTIRL GPS location to provide country-specific travel information. You can also specify a country code to check other countries' data.

**Available countries:** JP (Japan), VN (Vietnam), ID (Indonesia), AU (Australia), TH (Thailand), KR (South Korea), PH (Philippines), SG (Singapore), MY (Malaysia), TW (Taiwan), IN (India), CN (China), FR (France), ES (Spain), IT (Italy), DE (Germany), GB (UK), CA (Canada), MX (Mexico)

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

Returns 3 random emergency phrases with translations. Uses your current country by default, or specify a country code to check other countries. Useful for IRL emergencies when you need help from locals.

## Stats Commands

### Speed

```
!speed → $(customapi https://app.tazo.wtf/api/chat/speed)
```

Returns current speed and max speed over last 24h.

Example output: `Current: 25 km/h | Max: 120 km/h (1h ago)`

### Altitude

```
!altitude → $(customapi https://app.tazo.wtf/api/chat/altitude)
!elevation → $(customapi https://app.tazo.wtf/api/chat/altitude)
```

Returns current altitude, highest, and lowest over last 24h.

Example output: `Current: 150 m | Highest: 450 m (3h ago) | Lowest: 50 m (5h ago)`


---

**Base URL:** `https://app.tazo.wtf/api/chat/`

**Migration Note:** If you're updating from the old `tazo.wtf/api/*` endpoints, simply replace:
- `https://tazo.wtf/api/` → `https://app.tazo.wtf/api/chat/`

**Note:** Stats commands require the overlay to be sending data updates. The overlay automatically sends speed and altitude data when available.
