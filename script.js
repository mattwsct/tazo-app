(function() {
// === Configurable Constants ===
const SPEED_THRESHOLD_KMH = 10;
const SPEED_HIDE_DELAY_MS = 10000;
const WEATHER_UPDATE_INTERVAL = 300000; // 5 min
const LOCATION_UPDATE_INTERVAL = 300000; // 5 min
const TIMEZONE_UPDATE_INTERVAL = 600000; // 10 min
const COORDINATE_DEBOUNCE_DEGREES = 0.001; // ~100m base
const TIMEZONE_DEBOUNCE_DEGREES = 0.1; // ~10km for timezone (less frequent)
const OVERLAY_FADE_TIMEOUT_MS = 10000; // 10 seconds to force fade-in if data not ready

// === API Keys ===
const RTIRL_PULL_KEY = 'dpkn4we2kdxhij4m';
const OPENWEATHER_KEY = '92b29dc07db75f14d5900cc500ac9407';
const LOCATIONIQ_KEY = 'pk.c7b5291861bc1fdf0e90a50aed1b574a';
const TIMEZONEDB_KEY = 'YU12WUM970TL';

// === Utility Functions ===
function capitalizeWords(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// Country name shortening mapping - only countries with long names or travel-relevant
const COUNTRY_SHORTENINGS = {
  'United States of America': 'USA',
  'United Kingdom': 'UK',
  'United Arab Emirates': 'UAE',
  'Antigua and Barbuda': 'Antigua',
  'Bosnia and Herzegovina': 'Bosnia',
  'Central African Republic': 'CAR',
  'Democratic Republic of the Congo': 'DR Congo',
  'Dominican Republic': 'Dominican Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Sao Tome and Principe': 'Sao Tome',
  'Trinidad and Tobago': 'Trinidad',
  'Turks and Caicos Islands': 'Turks & Caicos',
  'Saint Kitts and Nevis': 'St. Kitts',
  'Saint Vincent and the Grenadines': 'St. Vincent',
  'Virgin Islands, British': 'BVI',
  'Virgin Islands, U.S.': 'USVI',
  'Federated States of Micronesia': 'Micronesia',
  'Papua New Guinea': 'PNG',
  'Czech Republic': 'Czechia',
  'South Africa': 'South Africa',
  'South Korea': 'South Korea',
  'Philippines': 'Philippines',
  'New Zealand': 'New Zealand'
};

function shortenCountryName(countryName, countryCode = '') {
  if (!countryName) return '';
  const shortened = COUNTRY_SHORTENINGS[countryName] || countryName;
  if (shortened.length > 12 && countryCode) {
    return countryCode.toUpperCase();
  }
  return shortened;
}

function shortenLocalPart(localPart, fallbackLevels) {
  localPart = localPart.replace(/ \d-ch\b/, '').replace('-ku', '').replace(' City', '').trim();
  if (localPart.length > 15 && fallbackLevels.length > 0) {
    return fallbackLevels[0]; // Fallback to next level if too long
  }
  return localPart;
}

function getGeneralLocation(location) {
  if (!location) return '';
  const shortenedCountry = shortenCountryName(location.country || '', location.countryCode || '');
  // Progressive local part: quarter → city_district → name → city → state
  let localPart = shortenLocalPart(location.quarter || '', [location.city_district || location.name || location.city || location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.city_district || '', [location.name || location.city || location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.name || '', [location.city || location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.city || '', [location.state || '']);
  if (!localPart) localPart = shortenLocalPart(location.state || '', []);
  if (localPart) {
    console.log('Calculated location label:', `${localPart}, ${shortenedCountry}`);
    return `${localPart}, ${shortenedCountry}`;
  }
  // Fallback: Use display_name, split by commas, take second-last + last
  if (location.displayName) {
    const parts = location.displayName.split(', ').map(p => p.trim());
    if (parts.length >= 2) {
      let fallbackLocal = parts[parts.length - 2].replace(' City', '');
      if (/\d/.test(fallbackLocal) || fallbackLocal.length <= 3) {
        fallbackLocal = parts[parts.length - 3] || '';
      }
      if (fallbackLocal) {
        console.log('Calculated location label (fallback):', `${fallbackLocal}, ${parts[parts.length - 1]}`);
        return `${fallbackLocal}, ${parts[parts.length - 1]}`;
      }
    }
  }
  console.log('Calculated location label:', shortenedCountry);
  return shortenedCountry;
}

function distanceMoved(lat1, lon1, lat2, lon2) {
  return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lon1 - lon2, 2));
}

// === DOM Elements ===
const timeEl = document.getElementById('time');
const locEl = document.getElementById('location');
const wxEl = document.getElementById('weather');
const speedEl = document.getElementById('speed');
const overlayEl = document.getElementById('overlay');

// === State Management ===
let timezone = null; // Start without timezone
let formatter = null;
let lastWeatherUpdate = 0;
let lastLocationUpdate = 0;
let lastTimezoneUpdate = 0;
let currentCoords = null;
let lastWeatherSuccess = false;
let lastLocationSuccess = false;
let firstWeatherChecked = false;
let firstLocationChecked = false;
let firstTimezoneChecked = false;
let overlayShown = false;
let validWeather = false;
let validLocation = false;
let validTimezone = false;
let speedHideTimeout = null;
let lastAPICoords = null;
let lastWeatherCoords = null;
let weatherRefreshTimer = null;
let rTIRLDataReceived = false; // Flag to indicate RTIRL data has been received

// === Rate Limiting ===
const RATE_LIMITS = {
  openweather: { calls: 0, lastReset: Date.now(), resetInterval: 60000, max: 60 },
  locationiq: { calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 2 },
  timezonedb: { calls: 0, lastReset: Date.now(), resetInterval: 1000, max: 1 }
};

// === Timezone and Time ===
function setTimezone(zone) {
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: zone
    });
    timezone = zone;
    validTimezone = true;
    firstTimezoneChecked = true;
    timeEl.classList.remove('hidden');
    console.log('[Timezone] Set to:', zone);
    checkAndShowOverlay(); // Check after setting timezone
  } catch (err) {
    formatter = null;
    timezone = null;
    validTimezone = false;
    firstTimezoneChecked = true;
    timeEl.classList.add('hidden');
    console.error('[Timezone] Error setting timezone:', err.message);
    checkAndShowOverlay(); // Still check, as fallback might allow partial show
  }
}

let timeInterval = null;

function updateTime() {
  if (!validTimezone || !formatter) return;
  const now = new Date();
  const formatted = formatter.format(now);
  if (timeEl.textContent !== formatted) {
    timeEl.textContent = formatted;
  }
  const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    updateTime();
    if (timeInterval) clearInterval(timeInterval);
    timeInterval = setInterval(updateTime, 60000);
  }, msUntilNextMinute);
}

// === API Rate Limiting ===
function checkRateLimit(api) {
  const limit = RATE_LIMITS[api];
  const now = Date.now();
  if (now - limit.lastReset > limit.resetInterval) {
    limit.calls = 0;
    limit.lastReset = now;
  }
  if (limit.calls >= limit.max) return false;
  limit.calls++;
  return true;
}

// === API Fetch Functions ===
async function fetchWeatherFromOpenWeather(lat, lon) {
  if (!OPENWEATHER_KEY || !checkRateLimit('openweather')) return null;
  try {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric`);
    const data = await response.json();
    console.log('[Weather API Response]:', data);
    if (data.cod === 200 && data.weather && data.weather[0] && data.main) {
      lastWeatherSuccess = true;
      return {
        temp: Math.round(data.main.temp),
        icon: data.weather[0].icon,
        desc: data.weather[0].description
      };
    } else {
      lastWeatherSuccess = false;
      console.error('[Weather API Error]:', data.message || 'Invalid response structure');
    }
  } catch (err) {
    lastWeatherSuccess = false;
    console.error('[Weather API Error]:', err.message);
  }
  return null;
}

async function fetchLocationFromLocationIQ(lat, lon) {
  if (!LOCATIONIQ_KEY || !checkRateLimit('locationiq')) return null;
  try {
    const response = await fetch(`https://us1.locationiq.com/v1/reverse.php?key=${LOCATIONIQ_KEY}&lat=${lat}&lon=${lon}&format=json`);
    const data = await response.json();
    console.log('[LocationIQ API Response]:', data);
    if (data.address) {
      lastLocationSuccess = true;
      console.log('[LocationIQ Address]:', data.address);
      return {
        name: data.address.suburb || data.address.city_district || data.address.neighbourhood,
        quarter: data.address.quarter,
        city_district: data.address.city_district || data.address.ward || data.address.borough,
        city: data.address.city || data.address.town,
        state: data.address.state,
        country: data.address.country,
        countryCode: data.address.country_code ? data.address.country_code.toLowerCase() : '',
        timezone: data.address.timezone,
        displayName: data.display_name
      };
    } else {
      lastLocationSuccess = false;
      console.error('[Location API Error]: No address data', data);
    }
  } catch (err) {
    lastLocationSuccess = false;
    console.error('[Location API Error]:', err.message);
  }
  return null;
}

async function fetchTimezoneFromTimezoneDB(lat, lon) {
  if (!TIMEZONEDB_KEY || !checkRateLimit('timezonedb')) return null;
  try {
    const response = await fetch(`https://api.timezonedb.com/v2.1/get-time-zone?key=${TIMEZONEDB_KEY}&format=json&by=position&lat=${lat}&lng=${lon}`);
    const data = await response.json();
    console.log('[TimezoneDB API Response]:', data);
    if (data.status === 'OK') {
      return data.zoneName;
    } else {
      console.error('[Timezone API Failed]:', data.message || 'Invalid response');
      return null;
    }
  } catch (err) {
    console.error('[Timezone API Error]:', err.message);
    return null;
  }
}

// === Weather Refresh Timer ===
function startWeatherRefreshTimer() {
  if (weatherRefreshTimer) clearInterval(weatherRefreshTimer);
  weatherRefreshTimer = setInterval(async () => {
    if (lastWeatherCoords) {
      const [lat, lon] = lastWeatherCoords;
      const weather = await fetchWeatherFromOpenWeather(lat, lon);
      if (weather) {
        updateWeather(weather.temp, weather.icon, weather.desc);
        lastWeatherUpdate = Date.now();
      }
    }
  }, WEATHER_UPDATE_INTERVAL);
}

// === UI Update Functions ===
function updateWeather(celsius, iconCode, description) {
  firstWeatherChecked = true;
  validWeather = (typeof celsius === 'number' && !!iconCode && !!description);
  if (!validWeather) {
    wxEl.classList.add('hidden');
    console.warn('[Weather] Invalid data - hiding element');
    checkAndShowOverlay();
    return;
  }
  try {
    const fahrenheit = Math.round(celsius * 9 / 5 + 32);
    const desc = capitalizeWords(description);
    const label = `${celsius}°C / ${fahrenheit}°F`;
    const html = `<div class="temp"><img class="loaded" src="https://openweathermap.org/img/wn/${iconCode}.png" alt="Weather: ${desc}">${label}</div><div class="desc">${desc}</div>`;
    wxEl.innerHTML = html;
    wxEl.classList.remove('hidden');
    checkAndShowOverlay();
  } catch (err) {
    wxEl.classList.add('hidden');
    console.error('[Weather Update Error]:', err.message);
    checkAndShowOverlay();
  }
}

function updateLocation(label, countryCode) {
  firstLocationChecked = true;
  validLocation = (!!label && !!countryCode);
  if (!validLocation) {
    locEl.classList.add('hidden');
    console.warn('[Location] Invalid data - hiding element');
    checkAndShowOverlay();
    return;
  }
  try {
    locEl.innerHTML = `<span>${label}</span><img class="flag" src="https://flagcdn.com/${countryCode}.svg" alt="Country: ${label}">`;
    locEl.classList.remove('hidden');
    checkAndShowOverlay();
  } catch (err) {
    locEl.classList.add('hidden');
    console.error('[Location Update Error]:', err.message);
    checkAndShowOverlay();
  }
}

function updateSpeedDisplay(mps) {
  const validMps = isFinite(mps) && mps >= 0 && mps * 3.6 <= 1000 ? mps : 0;
  const kmh = validMps * 3.6;
  speedEl.textContent = `${kmh.toFixed(1)} km/h`;
  if (kmh >= SPEED_THRESHOLD_KMH) {
    speedEl.classList.remove('hidden');
    if (speedHideTimeout) {
      clearTimeout(speedHideTimeout);
      speedHideTimeout = null;
    }
  } else {
    if (speedHideTimeout) clearTimeout(speedHideTimeout);
    speedHideTimeout = setTimeout(() => {
      const currentSpeed = parseFloat(speedEl.textContent);
      if (currentSpeed < SPEED_THRESHOLD_KMH) {
        speedEl.classList.add('hidden');
      }
    }, SPEED_HIDE_DELAY_MS);
  }
}

// === Main Data Update Logic ===
async function updateFromCoordinates(lat, lon) {
  console.log('[Update From Coordinates]: lat=', lat, 'lon=', lon);
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon) || 
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    console.error('[RTIRL] No valid coordinates received:', lat, lon);
    return;
  }
  const currentSpeedKmh = parseFloat(speedEl.textContent) || 0;
  const debounceDegrees = currentSpeedKmh > 100 ? COORDINATE_DEBOUNCE_DEGREES * 10 : COORDINATE_DEBOUNCE_DEGREES;
  if (lastAPICoords && distanceMoved(lat, lon, lastAPICoords[0], lastAPICoords[1]) < debounceDegrees) {
    console.log('[Debounce] Skipped - too close to last coords');
    return;
  }
  lastAPICoords = [lat, lon];
  lastWeatherCoords = [lat, lon];
  const now = Date.now();
  const coordKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (currentCoords === coordKey && now - lastWeatherUpdate < WEATHER_UPDATE_INTERVAL && now - lastLocationUpdate < LOCATION_UPDATE_INTERVAL) {
    console.log('[Cooldown] Skipped - recent update');
    return;
  }
  currentCoords = coordKey;
  if (now - lastWeatherUpdate > WEATHER_UPDATE_INTERVAL) {
    console.log('[Fetching Weather]');
    const weather = await fetchWeatherFromOpenWeather(lat, lon);
    if (weather) {
      updateWeather(weather.temp, weather.icon, weather.desc);
      lastWeatherUpdate = now;
    }
  }
  if (now - lastLocationUpdate > LOCATION_UPDATE_INTERVAL) {
    console.log('[Fetching Location]');
    const location = await fetchLocationFromLocationIQ(lat, lon);
    if (location) {
      const label = getGeneralLocation(location);
      updateLocation(label, location.countryCode || '');
      lastLocationUpdate = now;
      if (location.timezone && location.timezone !== timezone) {
        setTimezone(location.timezone);
        updateTime();
        lastTimezoneUpdate = now;
      }
    }
  }
  if (now - lastTimezoneUpdate > TIMEZONE_UPDATE_INTERVAL || lastTimezoneUpdate === 0) {
    console.log('[Fetching Timezone]');
    const timezoneData = await fetchTimezoneFromTimezoneDB(lat, lon);
    if (timezoneData && timezoneData !== timezone) {
      setTimezone(timezoneData);
      updateTime();
      lastTimezoneUpdate = now;
    }
  } else {
    console.log('[Timezone Skipped] - cooldown or debounce');
  }
}

// === Overlay Fade-In Logic ===
function checkAndShowOverlay() {
  if (!overlayShown && firstWeatherChecked && firstLocationChecked && firstTimezoneChecked && validWeather && validLocation && validTimezone) {
    const img = wxEl.querySelector('img');
    if (img && !img.complete) {
      img.onload = () => overlayEl.classList.add('show');
      img.onerror = () => overlayEl.classList.add('show');
    } else {
      overlayEl.classList.add('show');
    }
    overlayShown = true;
  }
}

// === Initialization ===
function initOverlay() {
  timeEl.textContent = 'Loading...';
  timeEl.classList.add('hidden'); // Hide time initially
  locEl.innerHTML = '<span>Loading location...</span>';
  locEl.classList.add('hidden'); // Hide location initially
  wxEl.innerHTML = '<div class="temp">Loading weather...</div>';
  wxEl.classList.add('hidden'); // Hide weather initially
  speedEl.textContent = '0.0 km/h';
  updateTime(); // Start time update loop, but skipped until validTimezone
  startWeatherRefreshTimer();
  // Force fade-in after timeout if data not fully ready
  setTimeout(() => {
    if (!overlayShown) {
      overlayEl.classList.add('show');
      overlayShown = true;
      console.log('[Timeout] Forcing overlay fade-in');
    }
  }, OVERLAY_FADE_TIMEOUT_MS);
  if (RTIRL_PULL_KEY) {
    try {
      RealtimeIRL.forPullKey(RTIRL_PULL_KEY).addListener(p => {
        if (!p) return;
        console.log('[RTIRL Payload]:', p);
        rTIRLDataReceived = true;
        const speed = typeof p.speed === 'number' ? p.speed : 0;
        updateSpeedDisplay(speed);
        if (p.weather?.temp && p.weather?.icon && p.weather?.desc) {
          updateWeather(Math.round(p.weather.temp), p.weather.icon, p.weather.desc);
          lastWeatherSuccess = true;
        }
        if (p.location) {
          const loc = p.location;
          const label = getGeneralLocation(loc);
          const countryCode = loc.countryCode ? loc.countryCode.toLowerCase() : '';
          if (label && countryCode) {
            updateLocation(label, countryCode);
            lastLocationSuccess = true;
          }
        }
        if (p.location?.timezone && p.location.timezone !== timezone) {
          setTimezone(p.location.timezone);
          updateTime();
        }
        let lat = null, lon = null;
        if (typeof p.location?.lat === 'number' && typeof p.location?.lon === 'number') {
          lat = p.location.lat;
          lon = p.location.lon;
        } else if (typeof p.location?.latitude === 'number' && typeof p.location?.longitude === 'number') {
          lat = p.location.latitude;
          lon = p.location.longitude;
        }
        if (lat !== null && lon !== null) {
          updateFromCoordinates(lat, lon);
        } else {
          console.error('[RTIRL] No valid coordinates in payload:', p.location);
        }
      });
    } catch (err) {
      console.error('[RTIRL Connection Error]:', err.message);
    }
  }
}
document.addEventListener('DOMContentLoaded', initOverlay);
})();