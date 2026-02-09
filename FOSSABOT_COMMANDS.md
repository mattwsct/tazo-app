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

### JSON (Full RTIRL Data)

```
!json → $(customapi https://app.tazo.wtf/api/chat/json)
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

These commands use your RTIRL GPS location to provide country-specific travel information.

### Food

```
!food → $(customapi https://app.tazo.wtf/api/chat/food)
```

Returns 3 random local food recommendations based on your current country.

### Phrases

```
!phrase → $(customapi https://app.tazo.wtf/api/chat/phrase)
```

Returns 3 random local phrases with translations based on your current country.

### Sidequests

```
!sidequest → $(customapi https://app.tazo.wtf/api/chat/sidequest)
```

Returns 3 random local activity suggestions based on your current country.

## Stats Commands

### Heart Rate

```
!hr → $(customapi https://app.tazo.wtf/api/chat/hr)
```

Returns current heart rate, min/max over last 24h, and average.

Example output: `Current: 75 BPM | Min: 65 (2h ago) | Max: 95 (30m ago) | Avg: 78`

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

### Combined Stats

```
!stats → $(customapi https://app.tazo.wtf/api/chat/stats)
```

Returns combined summary: location, speed, altitude, heart rate, distance traveled, countries/cities visited.

Example output: `Location: Tokyo, Japan 🇯🇵 | Speed: 25 km/h | Altitude: 150 m | HR: 75 BPM | Distance: 12.5 km | Countries: 2`

## Debug

```
!debug → $(customapi https://app.tazo.wtf/api/chat/debug)
```

Returns debug information about available routes and current RTIRL data.

---

**Base URL:** `https://app.tazo.wtf/api/chat/`

**Migration Note:** If you're updating from the old `tazo.wtf/api/*` endpoints, simply replace:
- `https://tazo.wtf/api/` → `https://app.tazo.wtf/api/chat/`

**Note:** Stats commands require the overlay to be sending data updates. The overlay automatically sends heartrate, speed, and altitude data when available.
