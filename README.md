# 🎮 Tazo Streaming Overlay

A modern, real-time streaming overlay for IRL streams with GPS tracking, weather display, and heart rate monitoring.

## ✨ Features

- **📍 Real-time GPS Location** - Smart minimap that shows/hides based on movement
- **🌤️ Live Weather** - Temperature with day/night-aware icons
- **💓 Heart Rate Monitor** - Pulsoid integration for live heart rate display
- **🌊 At-Sea Mode** - Automatic water body detection for cruise/ocean streaming
- **🗺️ Smart Location Display** - City, state, or custom location names with country flags
- **🎨 Clean UI** - Modern, responsive design optimized for OBS

## 🚀 Quick Start

### 1. Install
```bash
npm install
```

### 2. Configure Environment
Create `.env.local` in project root:

```env
# Required - GPS Tracking
NEXT_PUBLIC_RTIRL_PULL_KEY=your_rtirl_pull_key

# Required - Location & Weather
NEXT_PUBLIC_LOCATIONIQ_KEY=your_locationiq_key
NEXT_PUBLIC_OPENWEATHERMAP_KEY=your_openweathermap_key

# Optional - Additional Features
NEXT_PUBLIC_PULSOID_TOKEN=your_pulsoid_token
# Note: Map tiles use free CartoDB (no API key needed)

# Optional - Admin Panel & Settings Sync
ADMIN_PASSWORD=your_admin_password
KV_REST_API_URL=your_vercel_kv_url
KV_REST_API_TOKEN=your_vercel_kv_token
KV_REST_API_READ_ONLY_TOKEN=your_vercel_kv_readonly_token
```

### 3. Run
```bash
npm run dev
```

- **Admin Panel**: `http://localhost:3000`
- **Overlay**: `http://localhost:3000/overlay`

## 🎯 Key Features Explained

### Smart GPS Minimap
- **Auto-show when moving** (>5 km/h) - Shows when speed exceeds walking pace
- **Auto-hide when stationary** - Hides when speed drops below 5 km/h or GPS becomes stale
- **GPS staleness detection** - Hides if no GPS updates received in 10 seconds
- **Day/night map styling** - Based on real sunrise/sunset times from OpenWeatherMap API
- **Fade transitions** - Smooth 1-second fade in/out for better visual experience

### Location Display Modes
The overlay supports 6 location display modes, each showing different levels of geographic detail:

- **Neighbourhood** - Most precise: Shows neighbourhood/suburb/district names (e.g., "Downtown", "SoHo", "Shinjuku")
  - Falls back to city → state → country if neighbourhood data unavailable
  - Best for: City exploration, walking tours, detailed location tracking
  
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

### Location Formatting Logic

The location display system uses a hierarchical fallback system with duplicate name detection to ensure clean, non-redundant location displays.

#### Fallback Hierarchy
The system follows a strict hierarchy: **neighbourhood → city → state → country**

Each precision level checks all fields within its category before falling back to the next broadest category:

1. **Neighbourhood Mode** (`'neighbourhood'`):
   - Checks: `neighbourhood`, `quarter`, `ward`, `borough`, `district`, `suburb`
   - If no valid neighbourhood found → falls back to city
   - If no city found → falls back to state
   - If no state found → falls back to country

2. **City Mode** (`'city'`):
   - Checks: `city`, `municipality`, `town`, `village`, `hamlet`
   - If no valid city found → falls back to state
   - If no state found → falls back to country
   - **Important**: Never falls back to neighbourhood (would be more specific, not broader)

3. **State Mode** (`'state'`):
   - Checks: `state`, `province`, `region`, `county`
   - If no valid state found → falls back to country
   - **Important**: Never falls back to city or neighbourhood (would be more specific)

4. **Country Mode** (`'country'`):
   - Shows only country name (shortened if >20 characters)
   - No fallback needed (country is the broadest category)

#### Duplicate Name Detection

To prevent redundant displays like "Downtown Los Angeles, Los Angeles" or "Tokyo, Tokyo Prefecture", the system checks for overlapping names:

- **Primary Line**: Determined by selected precision level (neighbourhood/city/state/country)
- **Second Line**: Shows the next broadest category, but skips any names that overlap with the primary

**Overlap Detection Rules**:
- Checks if one name contains the other (case-insensitive)
- Checks if all words from shorter name appear in longer name
- Example: "Downtown Los Angeles" overlaps with "Los Angeles" → skip city, show state instead
- Example: "Tokyo" overlaps with "Tokyo Prefecture" → skip state, show country instead

**Second Line Logic**:
- For **neighbourhood** primary → tries city → state → country (skipping overlaps)
- For **city** primary → tries state → country (skipping overlaps)
- For **state** primary → tries country only (skipping overlaps)
- For **country** primary → no second line (country is broadest)

#### Field Categories

Location data from LocationIQ API is organized into categories (ordered from most appropriate to least appropriate):

- **Neighbourhood Fields**: `neighbourhood` → `quarter` → `ward` → `suburb` → `district` → `borough`
- **City Fields**: `city` → `municipality` → `town` → `county` → `village` → `hamlet`
- **State Fields**: `state` → `province` → `region`
- **Country**: `country` (with `countryCode` for flag display)

**Important Notes**:
- `suburb` is treated as a neighbourhood field, not a city field
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
- Switch from "Neighbourhood" to "City" → immediately shows city if available, or state if city unavailable
- Switch from "City" to "State" → immediately shows state if available, or country if state unavailable
- If location has "Downtown Los Angeles" (neighbourhood) and "Los Angeles" (city):
  - Neighbourhood mode: "Downtown Los Angeles" (primary), "California" (state, city skipped due to overlap)
  - City mode: "Los Angeles" (primary), "California" (state)

### At-Sea Detection
When GPS coordinates can't be reverse geocoded (ocean/remote areas):
- Automatically detects water bodies: "Gulf of Mexico 🇺🇸"
- Covers major seas and oceans worldwide
- Shows appropriate regional flag

### Weather Integration
- Temperature in both °C and °F
- Day/night weather icons (based on astronomical sunrise/sunset)
- Auto-updates every 5 minutes
- Location-based weather for your current GPS position

## 🔧 Admin Panel Settings

Access at `http://localhost:3000` to configure:

- **Location Display** - Choose precision level (Neighbourhood/City/State/Country) or custom text
  - Changes apply immediately to overlay via real-time sync
  - Location re-formats instantly when mode changes (uses cached location data)
  - Each mode follows fallback hierarchy: neighbourhood → city → state → country
  - Duplicate names automatically detected and skipped on second line
  
- **Custom Location** - Enter custom text when "Custom" mode is selected
  - Auto-saves after 1 second of no typing (debounced)
  - Optional country name/flag display toggle
  
- **Weather** - Show/hide temperature display
  - Temperature updates every 5 minutes automatically
  - Shows both °C and °F
  
- **Minimap** - Three display modes:
  - **Always Show** - Minimap always visible (if GPS data available)
  - **Auto on Movement** - Shows when speed >5 km/h, hides when stationary or GPS stale
  - **Hidden** - Minimap completely hidden
  
- **Map Zoom** - 6 levels from Continental (1) to Neighbourhood (13)
  - Continental (1) - Trans-oceanic view
  - Ocean (3) - Coastal view from sea
  - Country (5) - Country view (matches "Country" location display mode)
  - State (8) - State/province view (matches "State" location display mode)
  - City (11) - Whole city view (matches "City" location display mode)
  - Neighbourhood (13) - Streets & buildings (matches "Neighbourhood" location display mode)

- **To-Do List** - Add, edit, complete, and delete tasks
  - Shows on overlay when enabled
  - Tasks sorted: incomplete first, then completed

### Settings Sync Mechanism
Settings changes propagate to overlay in real-time via:
1. **Server-Sent Events (SSE)** - Primary method, instant updates (<1 second)
   - Public read-only access (no authentication required)
   - Requires Vercel KV for persistence
   - Falls back to polling if SSE unavailable
2. **Polling Fallback** - Checks for updates every 2 seconds
   - Used when SSE not available (e.g., no KV configured)
   - Ensures settings eventually sync even without SSE

**Security Model**
- **Read Access**: Public (overlay needs to read settings)
  - `/api/get-settings` - GET only, read-only
  - `/api/settings-stream` - GET only (SSE), read-only
- **Write Access**: Authenticated only (admin panel)
  - `/api/save-settings` - POST only, requires authentication
  - All other `/api/` routes require authentication

**Important**: SSE messages include metadata (`type`, `timestamp`) that must be stripped before setting state. Always extract only settings properties when handling SSE updates.

## 🌐 API Services

### Required
- **RealtimeIRL** - GPS tracking ([realtimeirl.com](https://realtimeirl.com/))
- **LocationIQ** - Reverse geocoding ([locationiq.com](https://locationiq.com/))
  - **English Names**: API requests include `accept-language=en` parameter to request English location names
  - **Normalization**: Location names are normalized to English equivalents when possible
  - **Non-Latin Script Filtering**: Location names with non-Latin alphabets (Japanese, Chinese, Arabic, Cyrillic, etc.) are automatically skipped, falling back to the next precision level (e.g., city → state → country)
  - **Accented Characters**: Accented Latin characters (é, ñ, ü, etc.) are allowed and displayed normally
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
2. Server-Sent Events (SSE) broadcasts update → All connected overlays receive update instantly
3. Polling fallback → Overlays check for updates every 2 seconds if SSE unavailable
4. Settings appear in OBS → No manual refresh needed!

**If settings changes don't appear in OBS:**
1. **Wait 2-5 seconds** - Settings sync automatically via SSE/polling
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
- **Tailwind CSS** - Styling
- **MapLibre GL** - Map rendering
- **Server-Sent Events** - Real-time settings sync

## 📝 Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run linter
```

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

5. **Graceful Degradation**: Always show something, even if APIs fail
   - **GPS Freshness**: Location/weather/minimap hide when GPS update is >15 minutes old
   - **Data Validity**: Weather and location data cached for 30 minutes even if GPS becomes stale
   - **Incomplete Data Handling**: If LocationIQ returns country name but no country code, entire top-right section hides (prevents showing incomplete data)
   - Hide incomplete data rather than show errors
   - Progressive enhancement (show what you have)
   - Priority: Location > Weather > Minimap

### GPS Staleness Behavior

The overlay automatically shows/hides location and weather based on GPS data freshness to ensure accurate information display:

#### How It Works

**Core Behavior**: Location and weather automatically appear when GPS is fresh and disappear when GPS becomes stale, continuously toggling based on RTIRL updates.

1. **On Initial Load/Refresh**:
   - **Stale GPS (>15 minutes old)**: 
     - ✅ Time/Date: **Visible** (timezone from RTIRL or OpenWeatherMap)
     - ❌ Location: **Hidden** (no API calls made)
     - ❌ Weather: **Hidden** (no API calls made, unless timezone needed)
     - ❌ Minimap: **Hidden**
   - **Fresh GPS (<15 minutes old)**:
     - ✅ All elements visible and APIs fetch normally

2. **During Runtime**:
   - **GPS becomes stale (>15 minutes old)**:
     - Location/weather automatically hide after 15-minute timeout
     - Timezone continues updating from RTIRL (ensures accurate time/date)
     - Minimap hides if speed-based mode is enabled
   - **Fresh GPS data arrives**:
     - Location/weather immediately reappear
     - APIs fetch fresh data for location and weather
     - Minimap shows if speed-based mode and movement detected
   - **Cycle repeats**: As GPS alternates between fresh and stale, location/weather toggle accordingly

3. **Timezone Updates**:
   - **Always updates** from RTIRL, even when GPS is stale
   - Falls back to OpenWeatherMap if RTIRL doesn't provide timezone
   - Ensures time/date display remains accurate regardless of GPS staleness

#### Key Behaviors

- **Time/Date**: Always visible (uses timezone from last RTIRL update, regardless of staleness)
- **Location/Weather**: Automatically hide when GPS is stale, reappear when fresh
- **Minimap**: Hidden when GPS is stale (if speed-based mode enabled)
- **API Calls**: Prevented for location/weather when GPS is stale (saves API quota)
- **Timezone Fetching**: Still occurs when needed (for accurate time display)
- **Automatic Toggle**: No manual intervention needed - location/weather appear/disappear based on GPS freshness

#### Technical Details

- **GPS Freshness Timeout**: 15 minutes (`GPS_FRESHNESS_TIMEOUT`)
- **GPS Stale Detection**: 10 seconds without updates (`GPS_STALE_TIMEOUT`)
- **Data Validity**: 30 minutes (cached data remains usable even if GPS becomes stale)
- **State Management**: `hasReceivedFreshGps` flag (with ref for async callbacks) controls location/weather visibility
- **Timezone Priority**: RTIRL → LocationIQ → OpenWeatherMap (always updates regardless of GPS staleness)
- **Timestamp Handling**: Uses reception time when RTIRL is actively sending updates, payload timestamp when not receiving updates

### Common Scenarios
- **Flying**: High speed (>200 km/h), infrequent location updates (1km threshold), country-level display recommended
- **Cruising**: International waters, water body detection critical, show nearest country, ocean zoom level
- **City Exploration**: Frequent updates (10m threshold), detailed location names, neighborhood-level display recommended
- **Transit**: Medium speed (50-200 km/h), moderate update frequency (100m threshold), city-level display recommended
- **Walking**: Low speed (<50 km/h), frequent updates (10m threshold), neighborhood or city display

### Location Display Mode Selection Guide
- **Neighbourhood**: Use when you want maximum detail (e.g., "Downtown", "SoHo", "Shinjuku")
  - Best for: Walking tours, city exploration, detailed location tracking
  - Falls back to city → state → country if neighbourhood data unavailable
  - Second line shows city (or state/country if city overlaps with neighbourhood)
  
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

### Important Code Patterns
- **Data Caching**: Always cache data for smooth transitions (30-minute validity windows)
  - `WEATHER_DATA_VALIDITY_TIMEOUT`: 30 minutes
  - `LOCATION_DATA_VALIDITY_TIMEOUT`: 30 minutes
  - `GPS_FRESHNESS_TIMEOUT`: 15 minutes (when to hide location/weather)
  - `GPS_STALE_TIMEOUT`: 10 seconds (when GPS data is considered stale)
  
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
    - Neighbourhood: checks neighbourhood fields → city → state → country
    - City: checks city fields → state → country (never neighbourhood)
    - State: checks state fields → country (never city/neighbourhood)
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
   - **Actual modes**: `'neighbourhood' | 'city' | 'state' | 'country' | 'custom' | 'hidden'`
   - **Note**: Uses British spelling `'neighbourhood'` (not `'neighborhood'`)
   - **Fallback hierarchy**: neighbourhood → city → state → country
   - **Check**: `LocationDisplayMode` type in `src/types/settings.ts`
   - **Duplicate detection**: Second line skips overlapping names (e.g., "Downtown Los Angeles" + "Los Angeles" → shows state instead)

8. **Settings Sync Timing**
   - **SSE**: Primary method, instant (<1 second)
   - **Polling**: Fallback, checks every 5 seconds
   - **Both**: Should work, but SSE preferred for real-time updates

### Future Enhancement Ideas
- Smart location name truncation with ellipsis
- Dynamic minimap zoom based on speed
- Loading indicators during API calls
- Country name normalization to English
- Compass indicator for orientation
- Travel direction/heading display

## 📄 License

MIT License - feel free to use and modify!

---

**Built for the IRL streaming community** 🚀
