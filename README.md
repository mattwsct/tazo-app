# 🎮 Tazo Streaming Overlay

A modern, real-time streaming overlay for IRL streams with GPS tracking, weather display, heart rate monitoring, altitude/speed tracking, and smooth animated value transitions.

## ✨ Features

- **📍 Real-time GPS Location** - Smart minimap that shows/hides based on movement
- **🌤️ Live Weather** - Temperature with day/night-aware weather icons and conditions
- **💓 Heart Rate Monitor** - Pulsoid integration with smooth animated value transitions
- **📊 Altitude & Speed** - Real-time elevation and movement speed with smart auto-display
- **🌊 At-Sea Mode** - Automatic water body detection for cruise/ocean streaming
- **🗺️ Smart Location Display** - One setting for overlay, chat (!location), stream title, and map: city, state, or country with country flags
- **✨ Smooth Animations** - Optimized value transitions for speed, altitude, and heart rate
- **🎨 Clean UI** - Modern, responsive design optimized for OBS
- **🤖 Kick Chat Bot** - Auto-responses for subs, gifts, follows, Kicks, and channel point redemptions
- **📊 Chat Polls** - Broadcaster/mod-started polls with live overlay voting bar
- **🧠 Trivia** - First-correct-answer trivia with auto-expiry, reminders, and Credits reward
- **💰 Wallet** - On-stream USD wallet that earns from subs/Kicks, tracks spending in local currency
- **🎯 Challenges** - Mod-managed viewer challenges with Credits bounties shown on overlay
- **🏆 Credits & Blackjack** - Persistent viewer Credits; earn from subs/gifts/Kicks/trivia, spend on blackjack

## 🚀 Quick Start

### 1. Install
```bash
npm install
```

### 2. Configure Environment
Create `.env.local` in project root:

```env
# Required - Admin Panel Authentication
ADMIN_PASSWORD=your_admin_password

# Required - GPS Tracking
NEXT_PUBLIC_RTIRL_PULL_KEY=your_rtirl_pull_key

# Required - Location & Weather Services
NEXT_PUBLIC_LOCATIONIQ_KEY=your_locationiq_key
NEXT_PUBLIC_OPENWEATHERMAP_KEY=your_openweathermap_key

# Required - Settings Storage (Vercel KV)
KV_REST_API_URL=your_vercel_kv_url
KV_REST_API_TOKEN=your_vercel_kv_token
# Use the same values in production and local to share trivia questions, poll state, and other KV data.

# Optional - Additional Features
NEXT_PUBLIC_PULSOID_TOKEN=your_pulsoid_token  # Heart rate monitoring (optional)
NEXT_PUBLIC_MAPTILER_KEY=your_maptiler_key    # Map tiles (optional - falls back to OpenFreeMap if not provided)
# Get free MapTiler key from https://cloud.maptiler.com/account/keys/
EXCHANGERATE_API_KEY=your_exchangerate_api_key  # Exchange rate API (optional - free tier: 1,500 requests/month at https://www.exchangerate-api.com/)

# Optional - Wise card spending integration
WISE_API_TOKEN=your_wise_api_token        # Wise settings → Developer → API tokens (Read Only)
WISE_PROFILE_ID=your_profile_id           # From GET /v1/profiles
WISE_BALANCE_ID=your_balance_id           # From GET /v1/borderless-accounts?profileId=...
WISE_CARD_LAST_FOUR=1234                  # Last 4 digits of the card to track (e.g. Apple Pay card)
```

**Wise card setup** (optional): Tracks real-time card spending during streams. When you tap to pay with Apple Pay or a Wise card, it automatically deducts from your stream wallet and posts to chat.

1. Create a **Read Only** API token at wise.com/settings/api-tokens
2. Get your profile ID: `curl -H "Authorization: Bearer TOKEN" "https://api.transferwise.com/v1/profiles"`
3. Get your balance ID: `curl -H "Authorization: Bearer TOKEN" "https://api.transferwise.com/v1/borderless-accounts?profileId=PROFILE_ID"`
4. Find your card's last 4 digits from the balance statement (GET `/v1/profiles/{profileId}/balance-statements/{balanceId}/statement.json`)
5. Register the webhook (run once after deploying):
   ```bash
   curl -X POST "https://api.transferwise.com/v3/profiles/PROFILE_ID/subscriptions" \
     -H "Authorization: Bearer WISE_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"tazo-wallet","trigger_on":"balances#update","delivery":{"version":"3.0.0","url":"https://your-domain/api/webhooks/wise"}}'
   ```
Only fires when stream is live and the transaction is from the configured card.

### 3. Run
```bash
npm run dev
```

- **Admin Panel**: `http://localhost:3000`
- **Overlay**: `http://localhost:3000/overlay`

## 🎯 Key Features Explained

### Smart GPS Minimap
- **Auto-show when moving** (>5 km/h) - Shows when speed exceeds walking pace
- **Auto-hide when stationary** - Hides when speed drops below 5 km/h
- **Day/night map styling** - Based on real sunrise/sunset times from OpenWeatherMap API
- **Fade transitions** - Smooth 1-second fade in/out for better visual experience

### Location Display Modes
One setting drives overlay, chat (`!location`), stream title, and minimap zoom. The overlay supports 5 display modes:

- **City** - City-level precision: Shows city/town/municipality names (e.g., "Austin", "Tokyo", "Paris")
  - Falls back to state → country if city data unavailable
  - Best for: General travel, transit, city-to-city movement
  
- **State** - State/province level: Shows state/province/prefecture names (e.g., "California", "Tokyo Prefecture", "Ontario")
  - Falls back to country if state data unavailable
  - Best for: Regional tracking, state-level movement
  
- **Country** - Broadest GPS mode: Shows only country name (e.g., "United States", "Japan", "France")
  - Primary line stays empty, country shown on second line with flag
  - Best for: International flights, country-level tracking
  
- **Custom** - Manual text entry: Set your own location text (e.g., "Las Vegas Strip", "Tokyo Station")
  - Optionally show country name and flag below custom text (toggle in admin panel)
  - Works even without GPS data (useful for pre-planned locations)
  - Best for: Specific landmarks, custom location names, pre-planned routes
  
- **Hidden** - No location displayed: Completely hides location section
  - Weather and minimap still function independently
  - Best for: Weather-only or minimap-only overlays

**Manual location update** (admin page, Location section): **Get from browser** uses browser geolocation → reverse geocodes via LocationIQ → updates persistent location for overlay, chat commands (`!location`), and stream title. Used as a one-off until RTIRL provides newer data; the app compares `updatedAt` timestamps so RTIRL fixes overwrite older browser-set locations. **Include location in stream title** toggle shows or hides location when building the title; when hidden, the title does not auto-update on new location. Toggling saves immediately; location data is kept so you can re-add it anytime.

### Location Formatting Logic

The location display system uses a hierarchical fallback system with duplicate name detection to ensure clean, non-redundant location displays.

#### Fallback Hierarchy
The system follows a strict hierarchy: **city → state → country**

Each precision level checks all fields within its category before falling back to the next broadest category:

1. **City Mode** (`'city'`):
   - Checks: `city`, `municipality`, `town`, `village`, `hamlet`, `suburb`
   - If no valid city found → falls back to state
   - If no state found → falls back to country

2. **State Mode** (`'state'`):
   - Checks: `state`, `province`, `region`, `county`
   - If no valid state found → falls back to country

3. **Country Mode** (`'country'`):
   - Shows only country name (shortened if >20 characters)
   - No fallback needed (country is the broadest category)

#### Duplicate Name Detection

To prevent redundant displays like "Downtown Los Angeles, Los Angeles" or "Tokyo, Tokyo Prefecture", the system checks for overlapping names:

- **Primary Line**: Determined by selected precision level (city/state/country)
- **Second Line**: Shows the next broadest category, but skips any names that overlap with the primary

**Overlap Detection Rules**:
- Checks if one name contains the other (case-insensitive)
- Checks if all words from shorter name appear in longer name
- Example: "Downtown Los Angeles" overlaps with "Los Angeles" → skip city, show state instead
- Example: "Tokyo" overlaps with "Tokyo Prefecture" → skip state, show country instead

**Second Line Logic**:
- For **city** primary → tries state → country (skipping overlaps)
- For **state** primary → tries country only (skipping overlaps)
- For **country** primary → no second line (country is broadest)

#### Field Categories

Location data from LocationIQ API is organized into categories (ordered from most appropriate to least appropriate):

- **City Fields**: `city` → `municipality` → `town` → `suburb` → `county` → `village` → `hamlet`
- **State Fields**: `state` → `province` → `region`
- **Country**: `country` (with `countryCode` for flag display)

**Important Notes**:
- `suburb` is part of the city category (used when city is unavailable)
- `county` is part of the city category (represents metropolitan areas like Gold Coast)
- Fields are tried in order - first valid field found is used
- Field names vary by country but hierarchy is generally consistent worldwide

#### Validation Rules

Before using a location name, it must pass validation:

- Not empty
- Not longer than 20 characters (display limit)
- Not just a number (e.g., "123", "5")
- Not ending with space + number (e.g., "Honmachi 3", "Block 12")
- Numbers in the middle are OK (e.g., "4th Avenue", "21st Street")

#### Mode Switching Behavior

When switching display modes in the admin panel:

1. **Instant Update**: Location re-formats immediately using cached location data (`lastRawLocation.current`)
2. **No GPS Wait**: No need to wait for new GPS update - uses existing location data
3. **Fallback Respect**: If selected mode has no data, falls back according to hierarchy
4. **Duplicate Prevention**: Second line automatically adjusts to avoid duplicates

**Example Scenarios**:
- Switch from "City" to "State" → immediately shows state if available, or country if state unavailable
- If location has "Los Angeles" (city) and "California" (state): City mode shows "Los Angeles" (primary), "California" (state)

### At-Sea Detection
When GPS coordinates can't be reverse geocoded (ocean/remote areas):
- Automatically detects water bodies: "Gulf of Mexico 🇺🇸"
- Covers major seas and oceans worldwide
- Shows appropriate regional flag

### Weather Integration
- Temperature in both °C and °F
- Day/night weather icons (based on astronomical sunrise/sunset)
- Weather condition text (auto-shows for notable conditions like rain, snow, storms)
- Auto-updates every 5 minutes
- Location-based weather for your current GPS position

### Altitude & Speed Display
- **Altitude**: Shows elevation in meters and feet
  - Auto mode: Shows when elevation is above 500m (notable elevation like mountains/hills)
    - Hides when elevation drops below 500m
    - Hides when GPS data is stale (>1 minute old)
  - Smooth animated transitions between values
  
- **Speed**: Shows movement speed in km/h and mph
  - Auto mode: Displays when speed ≥10 km/h and GPS data is fresh (<10 seconds old)
  - Hides when GPS data is stale (>10 seconds old) - regardless of speed value
  - Hides when speed <10 km/h (even if GPS is fresh)
  - Smooth animated transitions between values

## 🔧 Admin Panel Settings

Access at `http://localhost:3000` to configure. **Overlay** group: Location & map, Weather/altitude/speed. **Kick** group: Connection, Stream title & chat (title + broadcasts), Poll, Message templates. Related settings are grouped (e.g. location + map; stream title + chat broadcasts share interval).

- **Location** - One setting for overlay, chat (`!location`), stream title, and map zoom: City, State, Country, Custom, or Hidden
  - Custom = manual text on overlay only; stream title uses city when custom/hidden
  - Changes apply immediately via real-time sync
  - Location re-formats instantly when mode changes (uses cached location data)
  - Each mode follows fallback hierarchy: city → state → country
  - Duplicate names automatically detected and skipped on second line
  
- **Custom Location** - Enter custom text when "Custom" mode is selected
  - Auto-saves after 1 second of no typing (debounced)
  - Optional country name/flag display toggle

- **Manual Location (Get from browser)** - Location section; updates overlay, chat commands (`!location`), and stream title until RTIRL provides newer data (uses `updatedAt` comparison)

- **Weather** - Show/hide temperature display
  - Temperature updates every 5 minutes automatically
  - Shows both °C and °F
  
- **Weather Condition** - Control weather icon and description display:
  - **Always** - Always show icon and description
  - **Auto** - Show only for notable conditions (rain, snow, storms, fog, etc.)
  - **Hidden** - Hide icon and description (temperature still shown)
  
- **Altitude Display** - Control elevation display:
  - **Always** - Always show altitude when GPS data available (even if stale)
  - **Auto** - Shows when elevation is above 500m (notable elevation like mountains/hills)
    - Hides when elevation drops below 500m
    - Hides when GPS data is stale (>1 minute old)
  - **Hidden** - Hide altitude completely
  
- **Speed Display** - Control movement speed display:
  - **Always** - Always show speed when GPS data available (even if stale)
  - **Auto** - Show when speed ≥10 km/h AND GPS is fresh (<10 seconds old). Hides when GPS is stale (regardless of speed) or when speed <10 km/h
  - **Hidden** - Hide speed completely
  
- **Minimap** - Three display modes:
  - **Always Show** - Minimap always visible (if GPS data available)
  - **Auto on Movement** - Shows when speed >5 km/h, hides when stationary
  - **Hidden** - Minimap completely hidden
  
- **Map Zoom** - 6 levels from Continental (1) to Neighbourhood (13)
  - Continental (1) - Trans-oceanic view
  - **Same as location** - Zoom matches location precision (city=11, state=8, country=5)
  - Ocean (3) - Coastal view from sea
  - Continental (1) - Wide continental view

### Settings Sync Mechanism
Settings changes propagate to overlay in real-time via:
1. **Server-Sent Events (SSE)** - Primary method, instant updates (<1 second)
   - Public read-only access (no authentication required)
   - Requires Vercel KV for persistence
   - Falls back to polling if SSE unavailable
2. **Polling Fallback** - Checks every 15s when SSE hasn't updated recently
   - Skipped for 20s after each SSE update to reduce KV reads
   - Ensures settings eventually sync even without SSE

**Security Model**
- **Public (overlay runs in OBS without auth cookies)**
  - `/api/get-settings` - GET only, read-only
  - `/api/settings-stream` - GET only (SSE), read-only
  - `/api/location` - GET/POST, persistent location (overlay reads and updates)
  - `/api/location/browser` - POST only, admin sets location from browser geolocation (requires auth)
  - `/api/wellness` - GET only, wellness data for overlay (steps, distance, height, weight).
  - `/api/wellness/import` - POST only, Health Auto Export sends data (X-Wellness-Secret header). Chat broadcast milestones (steps, distance) when enabled in admin. **Tracked metrics**: step_count, walking_running_distance, height, body_mass (weight). **Deduplication**: Rapid or duplicate pushes (e.g. same step count twice within 60s) are skipped. Overlay polls wellness every 60s.
  - `/api/stats/update` - POST only, overlay sends speed/altitude/heart rate for chat commands
- **Authenticated only (admin panel)**
  - `/api/save-settings` - POST only
  - `/api/admin-login`, `/api/logout`, `/api/refresh-session`
  - Admin page (`/`) requires authentication

**Important**: SSE messages include metadata (`type`, `timestamp`) that must be stripped before setting state. Always extract only settings properties when handling SSE updates.

## 🌐 API Services

### Required
- **RealtimeIRL** - GPS tracking ([realtimeirl.com](https://realtimeirl.com/))
- **LocationIQ** - Reverse geocoding ([locationiq.com](https://locationiq.com/))
  - **English Names**: API requests include `accept-language=en` parameter to request English location names
  - **Normalization**: Location names are normalized to English equivalents when possible
  - **Non-Latin Script Filtering**: Location names with non-Latin alphabets (Japanese, Chinese, Arabic, Cyrillic, etc.) are automatically skipped, falling back to the next precision level (e.g., city → state → country)
  - **Latin Script Support**: Basic Latin, accented Latin (é, ñ, ü), Latin Extended-A (Đ, ğ, Polish ąęć), Latin Extended-B (Romanian ș ț), and Latin Extended Additional (Vietnamese ủ, ứ, ơ) are allowed — Vietnamese, Turkish, Polish, Romanian, Czech, Hungarian, and similar scripts display correctly
  - **Fallback**: If English names aren't available or contain non-Latin scripts, the system automatically falls back to broader location levels
- **OpenWeatherMap** - Weather & sunrise/sunset ([openweathermap.org](https://openweathermap.org/))

### Optional
- **Pulsoid** - Heart rate monitoring ([pulsoid.net](https://pulsoid.net/))
- **Mapbox** - Map tiles ([mapbox.com](https://mapbox.com/))
- **Vercel KV** - Settings persistence ([vercel.com/storage/kv](https://vercel.com/storage/kv))

## 🚢 Deployment

### Vercel (Recommended)
```bash
vercel --prod
```

Set environment variables in Vercel dashboard → Project Settings → Environment Variables

### OBS Setup
1. Add **Browser Source** in OBS
2. URL: `https://your-domain.com/overlay` (or `http://localhost:3000/overlay` for local development)
   - **Note**: The version parameter (`?v=...`) is automatically added server-side - you don't need to include it manually
3. Width: `1920`, Height: `1080`
4. Check "Shutdown source when not visible"
5. **Refresh browser when scene becomes active**: ✓ (Recommended for best performance)

**Automatic Cache-Busting**

The overlay automatically prevents caching issues:
- ✅ **Server-Side Version Injection**: Middleware adds `?v=<timestamp>` to overlay URLs before OBS caches them
- ✅ **HTTP Cache Headers**: `Cache-Control: no-cache, no-store, must-revalidate` prevents browser caching
- ✅ **API Cache Busting**: Settings API calls include timestamp parameters for fresh data

**Settings Update Flow**
1. Admin panel saves settings → Settings stored in KV database
2. Immediate broadcast → When settings or poll state changes, all SSE clients receive the update instantly (no polling delay)
3. SSE polling fallback → If no broadcast (e.g. no overlay connected during save), SSE checks KV every 15s
4. Polling fallback → Overlays poll every 20s when SSE hasn't updated recently (skipped for 20s after SSE to reduce KV usage)
5. Settings appear in OBS → No manual refresh needed!

**Vercel KV limits** — Free tier is ~30,000 commands/day. The overlay uses immediate broadcast on write (no extra KV reads) and polling fallback to stay under limits.

**Faster updates without higher cost** — The app uses **broadcast-on-write**: when you save settings, poll state changes, or alerts/leaderboard update (subs, gifts, kicks, follows), the server immediately pushes to all connected SSE overlays. No additional KV reads. Alerts and leaderboard now use SSE for instant delivery instead of waiting for the 2s poll. For even faster poll-end timing (winner in chat as soon as poll ends with zero delay), consider **Upstash QStash** to schedule an HTTP call at exactly poll end time — eliminates reliance on overlay countdown or 1-min cron. Upstash KV remains sufficient for most use cases; no need to switch storage.

**Queued poll timing** — When a poll ends and a winner is announced, the next queued poll starts immediately. The overlay calls poll-end-trigger when its countdown reaches zero (winner in chat within seconds). The poll-cleanup cron runs every minute as backup (ends overdue polls if overlay wasn't open). Winner displays for 10s (configurable). Poll state changes broadcast instantly to overlays. Kick chat webhooks read poll state per message; a busy chat adds reads. One overlay + typical Kick usage fits free tier. Multiple overlays or very active chat may need a paid KV plan.

**If settings changes don't appear in OBS:**
1. **Wait 10-15 seconds** - Settings sync via SSE/polling
2. **Refresh the browser source**: Right-click → Refresh (if needed)
3. **Check browser console**: Right-click browser source → Interact → F12 → Console tab
4. **Verify URL**: Should include version parameter (e.g., `/overlay?v=1234567890`)

**Debugging in OBS**
- Right-click browser source → **Interact** → Opens browser window
- Press **F12** to open DevTools → Check Console for errors
- Settings update logs show when changes are received

## 📊 API Usage

All APIs are within free tier limits for 24/7 streaming:

- **OpenWeatherMap**: ~288 calls/day (0.03% of limit)
- **LocationIQ**: ~1,440 calls/day (29% of limit)
- **Mapbox**: Cached tiles, minimal usage

Rate limiting and cooldowns are built-in to prevent quota issues.

## 🛠️ Tech Stack

- **Next.js 15** - React framework with app router
- **TypeScript** - Type safety
- **CSS Modules** - Component-scoped styling
- **MapLibre GL** - WebGL-based map rendering
- **Server-Sent Events** - Real-time settings sync
- **Custom Hooks** - Reusable animation logic (`useAnimatedValue`)

## 📝 Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run linter
npm run test     # Run tests (Vitest)
npm run test:watch  # Run tests in watch mode
```

## ⚡ Build Performance

**Local builds:** `turbopackFileSystemCacheForBuild` caches compiler artifacts (compile ~1500ms → ~170ms when cached).

**Vercel builds (targeting ~57s → ~30–40s):**

- **`npm ci`** — Uses `npm ci` for install (faster, deterministic). Ensure `package-lock.json` is committed.
- **Build cache** — Vercel caches `.next/cache` and `node_modules` between deployments; cache hits are much faster.
- **Heavy file** — `src/utils/travel-data.ts` (~5.4k lines) is parsed by TypeScript on every build. Moving the data to a JSON file and importing it would reduce type-check time (optional refactor).
- **Clean locally** — `npm run clean` then `npm run build` resets cache; first build after clean is slower

## 🐛 Troubleshooting

**GPS not updating?**
- Check RTIRL pull key is correct
- Verify you're broadcasting location in RealtimeIRL app

**Minimap not showing?**
- Ensure you're moving >5 km/h (or set to "Always On" mode)
- Check Mapbox token is valid
- Verify GPS data is fresh (updates received within last 10 seconds)
- Check browser console for GPS staleness warnings

**Weather not displaying?**
- Verify OpenWeatherMap API key
- Check browser console for API errors

**Admin panel won't load?**
- Set `ADMIN_PASSWORD` in environment variables
- Restart dev server after adding env vars

**Duplicate console logs in development?**
- This is normal! Next.js 15 enables React StrictMode by default in development
- StrictMode intentionally renders components twice to detect side effects
- Logs will appear twice - this is expected behavior and won't happen in production
- To reduce log noise, check browser console filters or disable StrictMode (not recommended)

## 🔒 Security

- Admin password is HTTP-only cookie, never exposed to client
- API keys with `NEXT_PUBLIC_` prefix are safe (domain-restricted, rate-limited)
- All external API tokens are read-only access

## 🎨 Design Principles & Notes for AI Assistants

### Key Design Principles
1. **Readability First**: Text must be legible on stream at 1080p resolution
   - Use font-weight 700+ for critical information
   - Double text shadows for depth and readability
   - Letter spacing for better legibility
   - Tabular numbers for consistent temperature display

2. **International Ready**: Handle all countries, languages, and formats
   - Normalize country names to English for consistency
   - Support international characters and long city names
   - Graceful handling of missing country codes (hide section rather than show incomplete data)
   - Water body detection for cruise/ocean scenarios

3. **API Efficient**: Minimize calls while keeping data fresh
   - **Location updates**: Adaptive thresholds based on speed + API limit enforcement:
     - Minimum 18 seconds between calls (ensures <5,000/day limit)
     - Flights (>200 km/h): 1km distance threshold
     - Driving (50-200 km/h): 100m distance threshold  
     - Walking (<50 km/h): 10m distance threshold
     - Rate limiting: 1 call/second + 5,000 calls/day (enforced client-side)
   - **Weather updates**: Every 5 minutes (time-based, not movement-based)
     - Rate limiting: 50 calls/minute (well under 60/min limit)
   - **Aggressive caching**: 30-minute validity windows for location/weather data

4. **Performance Critical**: Smooth 60fps for OBS capture
   - CSS transitions for smooth appearance/disappearance
   - Hardware acceleration (transform: translateZ(0))
   - Backface visibility optimizations
   - Minimal re-renders with proper React memoization
   - Smooth value animations using `requestAnimationFrame` with easeOutCubic easing
   - Optimized animation thresholds to reduce jitter (1 km/h for speed, 1m for altitude)

5. **Graceful Degradation**: Always show something, even if APIs fail
   - **GPS Freshness**: Location/weather/minimap hide when GPS update is >15 minutes old
   - **Data Validity**: Weather and location data cached for 30 minutes even if GPS becomes stale
   - **Incomplete Data Handling**: If LocationIQ returns country name but no country code, entire top-right section hides (prevents showing incomplete data)
   - Hide incomplete data rather than show errors
   - Progressive enhancement (show what you have)
   - Priority: Location > Weather > Minimap

### Location & Weather Visibility

Location and weather are always shown based on the latest RTIRL data. Use the "Hidden" option in the Location Display mode to manually hide both location and weather when needed (e.g., during flights).

- **Location Display Modes**: City, State, Country, Custom, or Hidden (one setting for overlay, chat, stream title, map)
- **Hidden Mode**: Hides both location and weather display (useful for flights, privacy, etc.)
- **Weather**: Updates every 5 minutes automatically
- **Timezone**: Always updates from RTIRL/LocationIQ/OpenWeatherMap to ensure accurate time/date display

### Common Scenarios
- **Flying**: High speed (>200 km/h), infrequent location updates (1km threshold), country-level display recommended
- **Cruising**: International waters, water body detection critical, show nearest country, ocean zoom level
- **City Exploration**: Frequent updates (10m threshold), detailed location names, city-level display recommended
- **Transit**: Medium speed (50-200 km/h), moderate update frequency (100m threshold), city-level display recommended
- **Walking**: Low speed (<50 km/h), frequent updates (10m threshold), neighborhood or city display

### Location Display Mode Selection Guide
- **City**: Use for general city-level tracking (e.g., "Austin", "Tokyo", "Paris")
  - Best for: General travel, transit, city-to-city movement
  - Most commonly used mode
  - Falls back to state → country if city data unavailable
  - Second line shows state (or country if state overlaps with city)
  
- **State**: Use for state/province-level tracking (e.g., "California", "Tokyo Prefecture", "Ontario")
  - Best for: Regional tracking, state-level movement, showing administrative divisions
  - Falls back to country if state data unavailable
  - Second line shows country only
  
- **Country**: Use for broad geographic tracking (e.g., "United States", "Japan", "France")
  - Best for: International flights, country-level tracking
  - Primary line stays empty, country shown on second line with flag
  - No fallback needed (country is broadest category)
  
- **Custom**: Use for specific landmarks or pre-planned locations
  - Best for: Specific venues, custom location names, pre-planned routes
  - Works without GPS data (manual entry)
  - Can optionally show country/flag below custom text

### Visual Hierarchy
- **Location**: Primary information, largest text (1.875rem), weight 700
- **Weather**: Secondary information, smaller text (1.125rem), weight 800
- **Flags**: 32px width for visibility, subtle border for contrast
- **Icons**: 24px for weather icons, drop shadows for visibility

### API Rate Limits (Free Tier)

All API limits are enforced client-side to prevent quota exhaustion:

#### LocationIQ (Reverse Geocoding)
- **Per-second limit**: 1 call/second (strictly enforced)
- **Daily limit**: 5,000 calls/day (enforced with 90% safety margin = 4,500/day max)
- **Implementation**: 
  - **Dual-layer protection**:
    1. **Time gate**: Minimum 18 seconds between calls (ensures ~4,800 calls/day max, safely under 5,000 limit)
       - Calculation: 5,000/day = ~208/hour = ~3.5/min = 1 call every ~17.3 seconds
       - Using 18 seconds provides safety margin for normal operation
    2. **Rate limiter**: `checkRateLimit('locationiq')` enforces 1 call/second + daily counter
       - Prevents burst traffic if multiple GPS updates arrive quickly
       - Tracks daily usage and blocks if daily limit (4,500/day) is reached
       - Handles edge cases (rapid GPS updates, app restarts, etc.)
  - Combined with distance thresholds (10m/100m/1000m based on speed) to avoid unnecessary calls
  - **Why both layers?** Time gate prevents excessive calls during normal operation, while rate limiter provides burst protection and daily limit enforcement
- **Usage**: ~1,440 calls/day typical (well under limit even for 24/7 streaming)

#### OpenWeatherMap (Weather & Timezone)
- **Per-minute limit**: 60 calls/minute (enforced at 50 calls/minute for safety)
- **Monthly limit**: 1,000,000 calls/month (no daily tracking needed - very conservative usage)
- **Implementation**:
  - Weather updates every 5 minutes (time-based, not movement-based)
  - Rate limiting enforced via `checkRateLimit('openweathermap')` with 2-second cooldown
- **Usage**: ~288 calls/day typical (0.03% of monthly limit)

#### Map Tiles (CartoDB - Free, No Authentication Required)
- **Tile source**: CartoDB Voyager (day) / Dark Matter (night) - free, no API key needed
- **Implementation**:
  - MapLibre GL automatically caches tiles - only downloads new tiles when panning to new areas
  - Map updates use smooth panning (`easeTo`) - no new tile downloads unless moving to new geographic area
  - Throttled to max 1 update per 500ms to prevent excessive map operations
- **Usage**: Minimal - tiles cached, only new tiles downloaded when traveling to new areas
- **Note**: Mapbox token not required - using free CartoDB tiles instead

#### Rate Limiting Strategy
- **Per-second limits**: Enforced immediately to prevent burst traffic
- **Daily limits**: Tracked and enforced for LocationIQ (most restrictive)
- **Cooldown periods**: Minimum time between calls (1s for LocationIQ, 2s for OpenWeatherMap)
- **Adaptive thresholds**: Distance-based thresholds (10m/100m/1000m) reduce API calls when moving slowly
- **Time gates**: Minimum intervals between calls (18s for location, 5min for weather) ensure limits aren't exceeded
- **Dramatic change bypass**: Movement >50km bypasses rate limiting (e.g., airplane GPS reconnects after landing)
- **Concurrency protection**: In-progress flags prevent duplicate concurrent fetches
- **Non-consuming checks**: `canMakeApiCall()` function for logging/debugging without consuming quota

#### Protection Mechanisms Summary
✅ **Per-second limits** enforced immediately  
✅ **Daily limits** tracked and enforced for LocationIQ  
✅ **Cooldown periods** prevent rapid successive calls  
✅ **Time gates** ensure minimum intervals between calls  
✅ **Distance thresholds** reduce calls when stationary  
✅ **Concurrency protection** prevents duplicate fetches  
✅ **Health monitoring** tracks failures and implements backoff  
✅ **Non-consuming checks** for logging (prevents double consumption)

**Critical Fix**: Removed duplicate `checkRateLimit()` calls that were consuming 2x API quota. Rate limit is now checked only once per actual API call.

### Important Code Patterns
- **Data Caching**: Always cache data for smooth transitions (30-minute validity windows)
  - `WEATHER_DATA_VALIDITY_TIMEOUT`: 30 minutes
  - `LOCATION_DATA_VALIDITY_TIMEOUT`: 30 minutes
  - `GPS_FRESHNESS_TIMEOUT`: 15 minutes (when to hide location/weather)
  - `GPS_STALE_TIMEOUT`: 10 seconds (when GPS data is considered stale)
  
- **Value Animations**: Use `useAnimatedValue` hook for smooth integer counting transitions
  - Speed: 80ms per km/h, counts through each integer (50, 51, 52...)
  - Altitude: 200ms per meter, counts through each integer (100, 101, 102...)
  - Heart rate: 100ms per BPM, counts through each integer (70, 71, 72...)
  - All use linear easing for integers to ensure each value is visible
  - Prevents jittery updates from GPS fluctuations
  
- **Incomplete Data Handling**: Hide incomplete data rather than show errors
  - `hasIncompleteLocationData` flag: Set when LocationIQ returns country name but no country code
  - Entire top-right section (location/weather/minimap) hides when flag is true
  - Prevents showing "United States of America" without a flag
  
- **Settings Updates**: Handle SSE messages correctly
  - SSE messages include `type` and `timestamp` metadata
  - Always extract only settings properties: `const { type, timestamp, ...settingsData } = data`
  - Location re-formats immediately when settings change (uses `lastRawLocation.current`)
  
- **API Efficiency**: Use adaptive thresholds based on speed + rate limiting
  - **Rate limiting**: Use `checkRateLimit()` from `rate-limiting.ts` (enforces per-second + daily limits)
  - **Location updates**: Minimum 18 seconds between calls (ensures <5,000/day LocationIQ limit)
  - **Distance thresholds**: 10m (walking), 100m (driving), 1000m (flying) - reduces calls when moving slowly
  - Track successful fetches separately from last attempt times (`lastSuccessfulWeatherFetch`, `lastSuccessfulLocationFetch`)
  - Use refs for synchronous updates (GPS timestamps, API call tracking)
  - Prevent concurrent API calls with `weatherFetchInProgress` and `locationFetchInProgress` flags
  
- **Location Formatting**: Location display updates instantly when settings change
  - `useEffect` watches `settings` and re-formats `lastRawLocation.current` immediately
  - No need to wait for new GPS update to see display mode change
  - Falls back gracefully if formatting fails (keeps existing display)
  - **Fallback Logic**: Each precision level checks all fields in its category before falling back
    - City: checks city fields → state → country
    - State: checks state fields → country
  - **Duplicate Detection**: Second line skips names that overlap with primary line
    - Uses `hasOverlappingNames()` to check if one name contains another
    - Checks all fields within category before moving to next category
    - Example: "Downtown Los Angeles" (primary) → skips "Los Angeles" (city), shows "California" (state)

### Design Improvements Implemented
- ✅ Enhanced text shadows for better readability on stream
- ✅ Increased font weights (location: 700, weather: 800)
- ✅ Larger flags (32px) and weather icons (24px) for visibility
- ✅ Adaptive location update thresholds based on speed
- ✅ Smooth CSS transitions for appearance/disappearance
- ✅ Tabular numbers for consistent temperature display
- ✅ Smooth animated value transitions (speed, altitude, heart rate)
- ✅ Optimized animation settings (easeOutCubic easing, adaptive thresholds)
- ✅ Code optimizations (reusable hooks, removed duplicate code, memoization)

### Common Issues & Gotchas for AI Assistants

1. **Settings Not Updating on Overlay**
   - **Cause**: SSE messages include `type` and `timestamp` metadata that must be stripped
   - **Fix**: Always extract only settings: `const { type, timestamp, ...settingsData } = data`
   - **Check**: Verify `setSettings()` receives clean `OverlaySettings` object, not SSE message object

2. **Location Display Mode Not Reflecting Changes**
   - **Cause**: Location state not re-formatting when settings change
   - **Fix**: Ensure `useEffect` watching `settings` re-formats `lastRawLocation.current` immediately
   - **Check**: Location should update instantly when display mode changes (no GPS update needed)

3. **Location Showing Wrong Precision Level**
   - **Cause**: Location data might not have fields for selected precision level
   - **Fix**: Check `getLocationByPrecision()` fallback order:
     - Neighbourhood mode: neighbourhood → city → state → country
     - City mode: city → state → country (never falls back to neighbourhood)
     - State mode: state → country (never falls back to city/neighbourhood)
   - **Check**: Verify `formatLocation()` is called with correct `displayMode` parameter
   - **Note**: Fallback is intentional - if city data unavailable, shows state/country instead

4. **Country Name Without Flag**
   - **Cause**: LocationIQ returned country name but no country code
   - **Fix**: Set `hasIncompleteLocationData = true` and hide entire top-right section
   - **Check**: Never show country name without flag - better to hide section entirely

5. **GPS Staleness vs Data Validity**
   - **GPS Freshness** (15 min): When to hide location/weather/minimap (GPS update age)
   - **Data Validity** (30 min): How long cached data remains usable (weather/location cache)
   - **GPS Stale** (10 sec): When GPS data is considered stale (no updates received)
   - **Important**: Data can be valid (cached) even if GPS is stale - this allows instant re-display
   - **See "GPS Staleness Behavior" section above for complete details on how staleness is handled**

6. **Minimap Speed Threshold**
   - **Actual**: 5 km/h (walking pace), not 10 km/h as might be documented elsewhere
   - **Check**: `WALKING_PACE_THRESHOLD = 5` in overlay page code

7. **Location Display Modes**
   - **Actual modes**: `'city' | 'state' | 'country' | 'custom' | 'hidden'`
   - **Fallback hierarchy**: city → state → country
   - **Check**: `LocationDisplayMode` type in `src/types/settings.ts`
   - **Duplicate detection**: Second line skips overlapping names (e.g., "Downtown Los Angeles" + "Los Angeles" → shows state instead)

8. **Settings Sync Timing**
   - **SSE**: Primary method, instant (<1 second)
   - **Polling**: Fallback, checks every 2 seconds
   - **Both**: Should work, but SSE preferred for real-time updates

9. **Animation Performance**
   - All value animations use `useAnimatedValue` hook for consistency
   - Speed/altitude/heart rate share same animation logic (DRY principle)
   - Thresholds optimized to reduce GPS jitter (1 km/h for speed, 1m for altitude)
   - EaseOutCubic easing provides smooth, natural feel

### Code Architecture

**Reusable Components & Hooks**
- `useAnimatedValue` - Custom hook for smooth numeric value transitions
  - Used by speed, altitude, and heart rate displays
  - Configurable thresholds, durations, and precision
  - RequestAnimationFrame-based for smooth 60fps animations

**Component Structure**
- `OverlayPage` - Main overlay component with GPS/weather/location logic
- `HeartRateMonitor` - Pulsoid WebSocket integration with animated BPM
- `MapLibreMinimap` - WebGL-based map rendering with day/night styling
- `ErrorBoundary` - Graceful error handling for component failures

**Utilities**
- `location-utils.ts` - Location formatting, fallback logic, duplicate detection
- `api-utils.ts` - External API integrations (LocationIQ, OpenWeatherMap)
- `rate-limiting.ts` - API rate limit enforcement (per-second + daily limits)
- `unit-conversions.ts` - Metric/imperial conversions
- `fallback-utils.ts` - Fallback data creation when APIs fail

### Future Enhancement Ideas
- Smart location name truncation with ellipsis
- Dynamic minimap zoom based on speed
- Loading indicators during API calls
- Country name normalization to English
- Compass indicator for orientation
- Travel direction/heading display

## 🤖 Kick Bot

The app includes a Kick.com bot that auto-responds to follows, subs, resubs, gifted subs, Kicks gifted, and channel point redemptions.

### Setup checklist

1. **Environment variables** (Vercel or `.env.local`):
   ```
   KICK_CLIENT_ID=your_client_id
   KICK_CLIENT_SECRET=your_client_secret
   ```

2. **Kick Dev Dashboard** ([dev.kick.com](https://dev.kick.com)):
   - Create or use your existing app
   - Add **Redirect URL**: `https://app.tazo.wtf/api/kick-oauth/callback` (or your domain)
   - Enable **Webhooks** and set URL: `https://app.tazo.wtf/api/webhooks/kick`
   - Ensure scopes: `chat:write`, `events:subscribe`, `channel:read`, `channel:write`, `channel:rewards:read`, `channel:rewards:write`, `kicks:read`, `moderation:ban`, `user:read`

3. **Deploy** to Vercel so the webhook endpoint is live.

4. **Connect**: Log into admin panel → **Connection** section → **Connect Kick**. Authorize with your Kick account. The bot will auto-subscribe to events and start responding.

5. **Customize messages**: Use the admin panel **Message templates** section to edit message templates and send test messages to kick.com/tazo.

6. **Stream title**: Two fields — (1) Custom title text, (2) Location with country flag emoji. Flag is the separator. **Fetch current** (when live) parses Kick's title. **Auto-push** runs every minute via cron whenever location changes — title stays current even when the stream is offline so it's ready before you go live. Requires `channel:read` and `channel:write` scopes.

### Events & Responses

| Event | Default Response |
|-------|------------------|
| Follow | "New follow from {name}! 💚" |
| New sub | "New sub from {name}! 🎉" |
| Resub | "{name} resubbed! {months} months 💪" |
| Gifted subs | "{gifter} gifted a sub to {name}! 🎁 {lifetimeSubs}" (adds lifetime total when gifter is on leaderboard) |
| Kicks gifted | "{sender} sent {kickDescription}! 💰" (e.g. "Viewer sent Rage Quit (500 kicks)! 💰") |
| Channel reward | "{redeemer} redeemed {title}! ✨" |
| Stream started/ended | "We're live! 🎬" / "Thanks for watching! Stream ended. 🙏" |

Edit templates in the admin panel **Message templates** section. Use the toggles to enable/disable each event type. When a toggle is off, the bot simply doesn't send a message (template text is kept). **Gift subs** has a "Show lifetime subs" toggle — when on, appends the gifter's leaderboard total (e.g. `(5 lifetime)`). **Kicks gifted** has a minimum amount (e.g. 100) — only tips at or above that threshold trigger an alert. Placeholders: `{name}`, `{gifter}`, `{months}`, `{count}`, `{lifetimeSubs}`, `{sender}`, `{amount}`, `{kickDescription}`, `{redeemer}`, `{title}`, `{userInput}`, `{message}`.

**Chat broadcasts** — optionally send location, heart rate, speed, and/or altitude to Kick chat. Location: periodic (e.g. every 5 min). When both stream title and chat location update together, the chat message shows the new title: e.g. `Stream title updated to "Tokyo Trip 🇯🇵 Tokyo, Japan" with new location` instead of only the location name. Heart rate: high/very-high warnings when crossing thresholds — sends once when HR exceeds a limit, no spam until it drops below and exceeds again. Set High (e.g. 100 BPM) and Very high (e.g. 120 BPM). Speed: announces "New top speed: X km/h!" when the stream's top speed is beaten, with a minimum (e.g. 20 km/h) and timeout (e.g. 5 min) to avoid spam. Altitude: same pattern for "New top altitude: X m!" with min (e.g. 50 m) and timeout. Requires Pulsoid for HR; RTIRL for location/speed/altitude. Add `CRON_SECRET` to Vercel env to secure the cron endpoint. The cron path must be in middleware public routes (no auth cookies) since Vercel Cron sends GET with no cookies; the route itself validates `CRON_SECRET` if set. The same cron also auto-updates the Kick stream title with current location when **Auto-push location** is on (every 2 min while live). Overlay retries `update-location` once on failure to improve reliability when LocationIQ is transiently unavailable.

### Chat commands

All commands are handled natively by the bot (no external tool required). Full list at `/commands`.

**General** (anyone): `!ping` → Pong. `!uptime` (`!up`) → stream duration. `!location` → current city/area. `!time` → local time at current location. `!weather` → weather, temp, wind, humidity. `!sun` → sunrise/sunset with countdown. `!moon` → moon phase. `!temp <val> [c/f]` (`!temperature`) → C/F converter. `!map` → Google Maps link. `!steps`, `!distance` (`!dist`), `!wellness` → wellness from Health Auto Export. `!speed`, `!altitude` (`!elevation`), `!heartrate` (`!hr`) → live stats. `!credits` / `!credits username` → Credits balance. `!lb` / `!leaderboard` → top Credits.

**Social links** (anyone): `!instagram` (`!ig`), `!tiktok`, `!youtube` (`!yt`), `!twitter` (`!x`), `!discord`, `!kick`, `!rumble`, `!twitch`, `!parti`, `!dlive`, `!onlyfans` (`!of`) → respective profile links. `!shoutout <user>` (`!so <user>`) → Kick profile link for any username.

**Travel & culture** (anyone): `!food [CC]`, `!phrase [CC]`, `!emergency [CC]`, `!flirt [CC]`, `!insults [CC]`, `!currency [CC]`, `!fact [CC]` (`!facts`) — auto-uses current country; add a 2-letter country code to target any country (e.g. `!food JP`). `!countries` → list all available countries.

**Games** (anyone): `!coin` (`!flip`) → Heads/Tails. `!dice [sides] [count]` (`!roll`) → roll dice (default 1d6). `!8ball <question>` (`!magic8ball`) → magic 8-ball. `!random [min max]` → random number (default 1–100).

**Size ranking** (anyone): `!inch <length> [girth]`, `!cm <length> [girth]` → size submission with ranking.

**Broadcaster/mods only**: `!title [text]` — set stream title (appends location if "Include location in title" is on). `!title` with no args clears the custom title and reverts to location/goals only. `!subscount <N>` — set sub count manually. `!kickscount <N>` — set Kicks count manually. `!timers` (anyone) — list active countdown timers and time remaining. `!poll status` (anyone) — show live vote counts and time remaining for the active poll. `!poll queue` (anyone) — show queued polls. `!credits remove <user> <amount>` (mods) — deduct Credits from a user. `!help` / `!commands` (anyone) — list viewer-available commands.

**Credits & blackjack**: Credits are persistent; new users start with 0. Earn via: Sub +100, Gift sub +100 (to gifter), Kicks +1 per kick, channel point redemption (configurable in admin), trivia win (configurable per question), or `!addcredits user N` (broadcaster/mod). Spend on blackjack. `!deal <bet>` / `!bj <bet>` — start a hand. `!hit` `!stand` `!double` `!split`. Min bet 25. Blackjack pays 1.5×. **Channel reward**: Create a Kick reward with the exact title set in admin (e.g. "Buy Credits"); each redemption grants the configured Credits.

**Trivia** (broadcaster/mods only): `!trivia` or `!quiz` — start a random question from admin Trivia list. First chatter to type the correct answer wins the Credits bounty. `!endtrivia` / `!endquiz` — cancel active trivia. Auto-expires after 5 minutes (reveals the answer in chat); sends a reminder every 2 minutes while unanswered. Winner is shown on overlay for 10 seconds. Configure questions and points in admin under **Trivia**.

**Wallet** (mods only, unless noted): `!wallet` (anyone) — show current balance. `!wallet <amount>` — add USD to wallet. `!wallet set <amount>` — set wallet to exact USD balance. `!wallet on` / `!wallet off` — enable/disable wallet. `!spent` (anyone) — show total spent this stream. `!spent <amount>` / `!spend <amount>` — deduct in local currency (auto-converted to USD using GPS-detected country rate). `!spent refund <amount>` — reverse a spend (adds back to wallet). `!spent set <amount>` — set spent total to exact USD amount. `!spent reset` — reset spent total to $0. Currency updates automatically as you cross borders during stream. If Wise card integration is configured, card transactions automatically deduct from the wallet and post to chat (`💳 CARD -฿253 (-$7.20 USD)`) when the stream is live.

**Challenges** (mods only): `!challenge` (`!ch`) — view active challenges. `!challenge steps` / `!ch steps` — add a random step-count challenge (easy/medium/hard tiers based on current steps). `!challenge fitness` / `!ch fitness` — random fitness challenge (push-ups, squats, etc.). `!challenge social` / `!ch social` — random social media challenge. `!challenge <bounty> <description>` — add a custom challenge. `!complete <description>` — mark complete and award Credits. `!remove <description>` — remove without awarding. `!challenges hide` / `!challenges show` — hide/show on overlay. Hard challenges have time limits — wallet is deducted if failed/expired. When wallet hits $0, a medium or hard challenge triggers automatically.

### Top overlay rotating displays

**Top-left**: Time (fixed) + rotating slot every 7s (Date → Steps → Distance) + Heart rate (fixed). Only items with data are included; respects showSteps/showDistance. Wellness data from Health Auto Export. Steps/distance hidden if data older than 2h (staleness check).

**Top-right**: Location (fixed) + rotating slot every 7s (Temp → Weather condition when notable → Altitude when visible → Speed when above threshold). Weather: current condition and temperature only (no forecast). Altitude/speed follow their display modes.

### Leaderboard, goals & alerts (bottom-right rotation)

The bottom-right overlay area shows **sub goal** and **kicks goal** in a rotating carousel on top, with the **poll** stacked below when active. Both are visible at once so they don’t interfere. The carousel cycles through enabled goal slides every 10 seconds with crossfade transitions. Sub/resub/giftSub alerts appear **inside** the subs goal bar (e.g. "🎉 New sub — username"); kicks alerts appear inside the kicks goal bar. **Auto-increment**: When a goal is reached, the bar stays at 100% for ~15s so gifters see the full bar, then the target auto-increments by the configured amount (default subs +10, kicks +1000). Configure increment amounts in admin. Admin **Leaderboard, goals & alerts** section: subs/kicks goal toggles with targets, auto-increment amounts, overlay alerts toggle, and **Test alert** buttons. Uses the same space as poll.

### Chat poll

When enabled, broadcaster or mods can start a poll with `!poll Question? Option1, Option2, Option3` (comma-separated) or `!poll Food? Pizza burger chips` (space-separated when no commas). No options after `?` = Yes/No. Typing `!poll` with no question/options shows usage. Chatters vote by typing the option text (e.g. `pizza`, `yes`, `y`). Every message counts. Poll runs for a configurable duration (default 60s), then the winner is posted in chat and shown on the overlay (bottom-right) for 10 seconds. If a new `!poll` is sent while one is running, it queues and starts after the current poll and winner display. When a queued poll starts, the bot announces it in chat with how to vote. **Permissions:** Broadcaster can always start and end polls. Mods can start polls (if enabled in settings) and run `!endpoll` to end the current poll early (e.g. if offensive); the next queued poll starts immediately. `!endpoll` is restricted to mods and broadcaster only. Poll options and text on the overlay are displayed in lowercase; special characters and emojis are stripped; slurs and profanity are blocked (both at poll creation and on overlay display). Edit `src/lib/poll-content-filter.ts` to add or remove blocked terms. Admin settings: enable/disable, duration, toggles for Everyone/Mods/VIPs/OGs/Subs to start polls (broadcaster can always start), and max queued polls (1–20). Poll start and winner messages reply to the original `!poll` message to keep the thread together. When queue is full, the bot replies to the user. When a poll is queued, the bot replies with position and estimated start time. Winner message format: `Poll "Question" — Winner wins! (N votes). Top voter: username (M votes).` Requires Kick connected and chat webhooks.

### Trivia

Add questions in admin under **Trivia** (format: `Question ? Answer` or `Question ? Answer1 / Answer2` for multiple accepted answers). Configure default points per question.

**How it works:**
1. Mod/broadcaster types `!trivia` or `!quiz` → bot posts the question in chat.
2. First viewer to type the exact answer (case-insensitive, punctuation-stripped) wins the Credits bounty. Winner shown on overlay for 10s.
3. If nobody answers within **5 minutes**, trivia auto-expires and the answer is revealed in chat.
4. A **reminder** is sent in chat every **2 minutes** while unanswered (up to 5 reminders via cron, then graceful close).
5. `!endtrivia` / `!endquiz` cancels at any time (mod/broadcaster only).

Multiple accepted spellings: separate with ` / ` in the answer field (e.g. `Tokyo / Tokio`).

### Wallet & Challenges

The **Wallet** tracks real money spent during the stream (e.g. food, drinks, transport). It's shown as a panel element on the stream overlay.

- **Earns automatically**: Each new sub adds $5 USD, every 100 Kicks adds $1.
- **`!wallet`** (anyone) — show current balance.
- **`!wallet <amount>`** (mods) — manually add USD (e.g. `!wallet 20`).
- **`!wallet set <amount>`** (mods) — set wallet to exact USD balance.
- **`!wallet on`** / **`!wallet off`** (mods) — enable/disable wallet (pauses accumulation when off).
- **`!spent`** (anyone) — show total spent this stream.
- **`!spent <amount>`** / **`!spend <amount>`** (mods) — deduct in **local currency** (auto-converts using GPS country). E.g. `!spent 1200` in Japan deducts ¥1200 converted to USD.
- **`!spent refund <amount>`** (mods) — reverse a spend: subtracts USD from spent total and adds back to wallet.
- **`!spent set <amount>`** (mods) — set spent total to a specific USD amount.
- **`!spent reset`** (mods) — reset spent total to $0.
- Currency updates automatically every minute as you cross borders (uses GPS country code, not IP).
- **Wise card integration**: If configured, real card transactions (Apple Pay etc.) auto-deduct from wallet and post `💳 CARD -฿253 (-$7.20 USD)` to chat. Only fires when streaming live and the transaction matches the configured card. See Wise card setup in environment variables section.

**Challenges** are viewer-facing bounties shown on the stream overlay (e.g. "Do 20 pushups — 50 Credits").

- **`!challenge`** / **`!ch`** (anyone) — view active challenges.
- **`!ch steps`** / **`!ch fitness`** / **`!ch social`** (mods) — add a random tiered challenge (easy/medium/hard). Step challenges scale from current step count. Hard challenges have time limits and deduct the bounty from wallet on failure/timeout.
- **`!challenge <bounty> <description>`** (mods) — add a custom challenge.
- **`!complete <description>`** (mods) — mark complete and award Credits.
- **`!remove <description>`** (mods) — remove without awarding.
- **`!challenges hide`** / **`!challenges show`** (mods) — hide/show the challenges section.
- **Auto-trigger**: When wallet hits $0, a medium or hard challenge is automatically added.

### Future ideas

- **Top gifter (weekly/monthly)** — no dedicated webhook; would need leaderboard polling or Kick feature request
- **Gift sub milestone** — special message when gift count ≥ threshold (e.g. "X gifted 10 subs!")
- **Moderation banned** — subscribe to `moderation.banned`, add template

### Troubleshooting

**Cron / stream title / HR not updating:**

**Chat broadcasts (HR, speed, altitude, weather, wellness) not sending:**
- **Where to look**: Vercel Dashboard → **Logs** → filter by the cron (e.g. path contains `kick-chat-broadcast`) or search logs for `[Cron HR]`.
- **Useful log lines** (search in Vercel):
  - `[Cron HR] CRON_SKIP` — cron bailed early; payload usually has `reason: 'no_token'` (no Kick token) or check for other reasons.
  - `[Cron HR] LIVE_CHECK` — shows `isLive`, `apiIsLive`, `kvIsLive`. If `isLive: false`, no HR/speed/altitude/weather/wellness messages are sent.
  - `[Cron HR] HEAL_STREAM_SESSION` — cron set `stream_started_at` because API said live but session was missing (e.g. webhook missed go-live). Next run can use session data.
  - `[Cron HR] CRON_DEBUG` — HR block: `hrBroadcast: false` = toggle off; `hrData: false` = no heart rate data; `already_sent_high` / `already_sent_very_high` = won’t send again until HR drops below min then exceeds.
  - `[Cron HR] CHAT_SENT` — a message was sent; payload has `type` (e.g. `heartrate_high`, `speed`, `altitude`, `weather`).
  - `[Cron HR] CHAT_FAIL` — send to Kick failed; payload has `type` and `error`. Check for rate limit or auth errors.
  - `[Cron HR] CRON_END` — end of run; `sent` is how many messages were sent this run.
- **Wellness milestones** (steps/distance): In logs search `[Wellness Milestones]` — `Skip: no Kick token` or `Skip: stream not live` when the helper doesn’t send. After import you may see `[Wellness] Milestone chat sent=N after import`.
- **Overlay**: HR/speed/altitude come from the overlay calling `POST /api/stats/update`. The app does not log each successful receive in production. If overlay has a console (e.g. browser devtools), check for failed requests or 429 (rate limit). Stats are only stored when the stream is considered live (`isStreamLive()`), so if “stream not live” in cron, overlay data may not be stored until after go-live.
- **Best single check**: Call **GET /api/cron/kick-chat-broadcast/status** (with admin auth). Response has `stream.isLive`, `heartRate.reason`, `speed.note`, `altitude.note`, `weather.note`, `streamSession.startedAt`, and `otherReasonsNoMessages` — tells you exactly why each type is or isn’t sending.

- **Mod says "no permission" but has mod badge**: Role detection runs on every message from the Kick webhook payload. We check `identity.role`, `roles[]`, `badges[]`, `is_moderator`, `isModerator`, etc. Ensure **Mods can start polls** is enabled in poll settings. If still failing, check Vercel logs for `[poll] webhook: rejected (no permission)` — it now logs `roles`, `rawSender` so you can see what Kick sends and add support if needed.
- **Poll didn't get queued after another was rejected**: Each message is a separate webhook; rejecting one poll does not block the next. Common causes: (1) **Permission** — if the sender lacks permission (Everyone/Mods/VIPs/OGs/Subs), the bot now replies "You don't have permission to start polls." Previously it was silent. (2) **Deleted message** — if the message was deleted before Kick delivered the webhook, it never arrives. (3) **Debugging** — in Vercel logs, look for `[poll] webhook: rejected (content filter)` or `rejected (no permission)` to see why a poll was skipped.
- **Blackjack state / stream start**: Stream start clears only blackjack state (active hands, deal cooldown), not Credits. Reset triggers when Kick sends `livestream.status.updated` with `is_live: true` to your webhook URL. Ensure Kick Developer Console → Webhook URL is `https://your-domain/api/webhooks/kick`. Use **Reset blackjack state** in Danger zone if needed.
- **Webhooks stop working**: Kick unsubscribes after ~24h of failed deliveries. Use **Fix connection** or **Re-subscribe only** in the admin Connection dropdown.
- **Not responding**: Ensure you completed OAuth (Connect Kick) and tokens are stored. Check Vercel logs for errors.
- **Event toggles**: Each event (Follow, New sub, Resub, Channel reward, etc.) can be toggled off. Flow: (1) You toggle off → POST /api/kick-messages saves to KV. (2) Kick sends webhook → loads enabled from KV, checks toggle. (3) If toggle is off, the message is set to blank so nothing is sent to chat. When toggle is on, the template response is built and sent normally. Verify **which webhook URL** Kick uses: `https://app.tazo.wtf/api/webhooks/kick`.
  - Check Vercel logs for `[Kick webhook] Event path`, `[Kick webhook] KV read`, `[Kick webhook] Toggle check`, and `[Kick webhook] Skipping (toggle off)`. If you see `Skipping` but chat still gets a message, another system (e.g. Fossabot, Kick built-in) may be sending it.
  - **Preview vs production**: KV is per-deployment. Toggling on preview does not affect production and vice versa.

**Where to get logs for debugging (share with AI/support):**
1. **Vercel Dashboard** → Logs tab: Click a request row to see full console output. Search for `[Kick webhook]`.
2. **Vercel CLI**: `vercel logs --follow` for real-time; `vercel logs 2>&1 | grep "Kick webhook"` to filter.

**Vercel logs** (minimal): One `[Kick webhook] Verified:` line per webhook; `Rejected` on bad signature; `Chat send failed:` on send errors.

**`recentEvents` / `rewardPayloadLog` / `decisionLog` empty but `log` has data:**
1. **Webhook URL**: Kick Developer tab → app settings → Webhook URL must be `https://app.tazo.wtf/api/webhooks/kick`.
2. **Resubscribe**: Kick [unsubscribes apps](https://github.com/KickEngineering/KickDevDocs/blob/main/events/webhook-security.md) after webhooks fail for over a day. Use **Connection → Fix connection** or **Re-subscribe only** in the admin panel to re-register. If events are arriving (log has entries), this usually isn't the issue.
3. **KV error**: After a webhook, check Vercel logs for `[Kick webhook] recentEvents push failed:`. If present, KV may be misconfigured or rate-limited.

**Cloudflare caching:** POST requests (webhooks) are normally **not** cached. If you use Cloudflare as a proxy:
- Add a **Cache Rule** (or Page Rule) to *bypass cache* for `/api/webhooks/*`. Example: URL `*app.tazo.wtf/api/webhooks/*` → Cache Level: Bypass.
- If the webhook response is cached, later redemptions might get a cached 200 without your server processing them—you wouldn't send, but stale behavior is possible.
- Check **Firewall** / **Security** settings: Bot Fight Mode or challenge pages can block Kick's webhook delivery.

**Verify who's sending:** Kick may show a native notification when someone redeems a channel reward. To confirm our app is sending: set `KICK_MESSAGE_DEBUG_PREFIX=[bot] ` (with trailing space) in Vercel env vars, deploy, then redeem. If you see `[bot] Tazo redeemed Gift sub!` in chat, it's from us. If not, it's Kick native or another integration (e.g. Fossabot).

**KV / Upstash optimization:** Webhook logging (recent events, debug key) uses ~5–6 KV ops per webhook. To reduce Upstash usage, keep `KICK_WEBHOOK_LOGGING` unset (default). Set `KICK_WEBHOOK_LOGGING=true` only if you need the webhook log for debugging.

**Webhooks never arriving (no POST /api/webhooks/kick in logs):**

1. **Vercel Deployment Protection** (most likely): If enabled, it blocks unauthenticated requests (including Kick's webhooks).
   - Vercel Dashboard → your project → **Settings** → **Deployment Protection**
   - If "Vercel Authentication", "Password Protection", or "Trusted IPs" is on → Kick cannot reach your endpoint.
   - **Fix**: Use Protection Bypass. Get the bypass secret from the same page, then in Kick Dev Dashboard set webhook URL to:
     `https://app.tazo.wtf/api/webhooks/kick?x-vercel-protection-bypass=YOUR_SECRET`
   - Or disable protection for Production (if you only need it for previews).

2. **Test reachability**: Run `curl -X POST https://app.tazo.wtf/api/webhooks/kick -d '{}'` — you should get 401 (signature invalid). If the request appears in Vercel logs, the endpoint is reachable. If you get a Vercel password/auth screen or 404, protection is blocking.

3. **Kick Dev Dashboard**: Verify webhook URL is exactly `https://app.tazo.wtf/api/webhooks/kick` (or with bypass param), "Enable webhooks" is on, and it's the same app as your OAuth.

4. **Cloudflare** (if you use it): Ensure no firewall rules block Kick's IPs or POST requests.

5. **Verify Kick is sending**: Point Kick's webhook URL temporarily at a capture service to confirm they deliver:
   - Go to [webhook.site](https://webhook.site) (free) and copy your unique URL.
   - In Kick Dev Dashboard, change webhook URL to that URL.
   - Have someone type `!ping` in chat. Check webhook.site — if you see the request, Kick is sending and the issue is with your app. If you don't, Kick isn't delivering (unverified app, revoked subs, etc.).

6. **Admin panel diagnostics**: The admin panel **Connection** section shows "Last request received" when *any* POST hits `/api/webhooks/kick` (even before verification). Vercel logs will show `[Kick webhook] Verified:` when the webhook is processed. If both are empty, no request reached your server.

---

## 💬 Chat Commands API

All commands are handled natively by the bot — no external tool (Fossabot etc.) required. The bot processes commands in Kick chat via the webhook handler.

For legacy Fossabot integration, HTTP endpoints are still available at `/api/chat/*`. See [FOSSABOT_COMMANDS.md](./FOSSABOT_COMMANDS.md) for the full list of endpoint URLs.

### Native bot command reference

| Category | Commands |
|----------|----------|
| Info | `!ping`, `!uptime` (`!up`), `!downtime` (`!down`), `!followers`, `!help` (`!commands`) |
| Wellness | `!steps`, `!distance` (`!dist`), `!wellness`, `!heartrate` (`!hr`) |
| Stats | `!speed`, `!altitude` (`!elevation`), `!uv`, `!aqi` |
| Location | `!location`, `!time`, `!map` |
| Weather | `!weather`, `!sun`, `!moon`, `!temp <val> [c/f]` |
| Social | `!instagram` (`!ig`), `!tiktok`, `!youtube` (`!yt`), `!twitter` (`!x`), `!discord`, `!kick`, `!rumble`, `!twitch`, `!parti`, `!dlive`, `!onlyfans` (`!of`), `!shoutout <user>` (`!so`) |
| Travel | `!food [CC]`, `!phrase [CC]`, `!emergency [CC]`, `!flirt [CC]`, `!insults [CC]`, `!currency [CC]`, `!fact [CC]`, `!countries` |
| Games | `!coin` (`!flip`), `!dice [n]` (`!roll`), `!8ball`, `!random [min max]`, `!convert`, `!math` |
| Size | `!inch <len> [girth]`, `!cm <len> [girth]` |
| Credits | `!credits [user]`, `!leaderboard` (`!lb`, `!top`), `!give <user> <n>` |
| Blackjack | `!deal <bet>` (`!bj`), `!hit`, `!stand`, `!double`, `!split` |
| Poll | `!poll <question>? opt1, opt2`, `!poll status`, `!poll queue`, `!rank`, `!endpoll` |
| Wallet | `!wallet`, `!wallet <amount>`, `!wallet set <amount>`, `!wallet on/off`, `!spent`, `!spent <amount>`, `!spent refund <amount>`, `!spent set <amount>`, `!spent reset` |
| Challenges | `!challenge` (`!ch`), `!ch steps/fitness/social`, `!ch <bounty> <desc>`, `!ch done/fail/remove <n>`, `!ch done/fail/remove all`, `!ch clear`, `!challenges hide/show`, `!buychallenge` (`!bc`), `!bcon`, `!bcoff` |
| Trivia | `!trivia` (`!quiz`), `!endtrivia` |
| Timers | `!timer <duration> [label]`, `!timers`, `!cleartimer [label]` |
| Goals | `!subsgoal <n> [label]`, `!kicksgoal <n> [label]`, `!clearsubsgoal`, `!clearkicksgoal`, `!cleargoals`, `!subscount <N>`, `!kickscount <N>` |
| Mod/Broadcaster | `!title [text]`, `!addcredits <user> <n>`, `!credits remove <user> <n>`, `!irl`, `!sleep`, `!chat`, `!software`, `!gym`, `!resetstream` |

## 📄 License

MIT License - feel free to use and modify!

---

**Built for the IRL streaming community** 🚀
