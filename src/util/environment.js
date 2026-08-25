// @ts-check

/**
 * @file environment.js
 * Real-world environmental grounding context fetcher.
 *
 * Responsibilities:
 * - Fetches live weather from Open-Meteo API (temperature, humidity, weather code).
 * - Fetches Indian festivals from Calendar Bharat JSON.
 * - Fetches Google News RSS headlines via rss2json gateway.
 * - Implements 20-minute in-memory cache to reduce API calls.
 * - Provides graceful fallbacks when external services are unavailable.
 */

/**
 * @typedef {import("../classes/types/World.types").EnvironmentSnapshot} EnvironmentSnapshot
 */

import {
    SIMULATION_CITY,
    SIMULATION_LOCATION_FULL,
    SIMULATION_LATITUDE,
    SIMULATION_LONGITUDE,
    SIMULATION_TIMEZONE
} from "./Constants";

/**
 * Open-Meteo Weather code mapping.
 * @type {Record<number, string>}
 */
const WEATHER_CODE_MAP = Object.freeze({
    0: "Clear sky, sunny",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm with rain",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
});

/**
 * Cached in-memory environmental state.
 * @type {{ snapshot: EnvironmentSnapshot | null, fetchedAt: number }}
 */
let cachedEnvironment = {
    snapshot: null,
    fetchedAt: 0
};

/** 
 * Cache TTL: 20 minutes in milliseconds.
 * @readonly
 */
const CACHE_TTL_MS = 20 * 60 * 1000;

/**
 * Fetches real-time temperature and weather conditions via Open-Meteo API using centralized coordinates.
 *
 * @returns {Promise<{ temperature: string, weather: string, humidity: string }>}
 */
async function fetchCityWeather() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${SIMULATION_LATITUDE}&longitude=${SIMULATION_LONGITUDE}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=${encodeURIComponent(SIMULATION_TIMEZONE)}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Weather API returned HTTP ${response.status}`);

        const data = await response.json();
        const temp = data?.current?.temperature_2m;
        const humidity = data?.current?.relative_humidity_2m;
        const code = data?.current?.weather_code;

        const tempStr = typeof temp === "number" ? `${Math.round(temp)}°C` : "32°C";
        const humidityStr = typeof humidity === "number" ? `${humidity}%` : "60%";
        const weatherDesc = (typeof code === "number" && WEATHER_CODE_MAP[code]) ? WEATHER_CODE_MAP[code] : "Warm & pleasant";

        return {
            temperature: tempStr,
            weather: weatherDesc,
            humidity: humidityStr
        };
    } catch (/** @type {unknown} */ err) {
        console.warn("[Environment] Weather fetch failed, using fallback:", err);
        return {
            temperature: "32°C",
            weather: "Warm & partly cloudy",
            humidity: "55%"
        };
    }
}

/**
 * Fetches rich Indian Festivals and Celebrations from calendar-bharat (2026.json).
 *
 * @param {Date} date
 * @returns {Promise<{ todayCelebration: string, upcomingFestivals: string[] }>}
 */
async function fetchCalendarBharatFestivals(date) {
    const url = "https://jayantur13.github.io/calendar-bharat/calendar/2026.json";

    const monthNum = String(date.getMonth() + 1).padStart(2, "0");
    const dayNum = String(date.getDate()).padStart(2, "0");
    const todayFormattedDate = `${date.getFullYear()}-${monthNum}-${dayNum}`;

    /** @type {string} */
    let todayCelebration = `Regular day in ${SIMULATION_CITY}`;
    /** @type {string[]} */
    const upcomingFestivals = [];

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Calendar Bharat returned HTTP ${response.status}`);

        /** @type {Record<string, any>} */
        const calendarData = await response.json();

        const monthKey = date.toLocaleString("en-US", { month: "long" }).toLowerCase();
        const monthDays = calendarData[monthKey] || calendarData.days || calendarData;

        if (typeof monthDays === "object" && monthDays !== null) {
            for (const [key, value] of Object.entries(monthDays)) {
                const dayEntry = typeof value === "object" ? value : { name: String(value) };
                const entryName = dayEntry?.name || dayEntry?.festival || dayEntry?.holiday || String(value || "");

                if (key === todayFormattedDate || key === `${Number(dayNum)}` || key === dayNum) {
                    if (entryName) todayCelebration = `🎉 ${entryName}`;
                } else if (upcomingFestivals.length < 4 && entryName) {
                    upcomingFestivals.push(`${entryName}`);
                }
            }
        }
    } catch (/** @type {unknown} */ err) {
        console.warn("[Environment] Calendar Bharat fetch failed, using seasonal defaults:", err);
    }

    if (upcomingFestivals.length === 0) {
        upcomingFestivals.push("Independence Day", "Diwali Festival of Lights", "Dussehra", "Makar Sankranti");
    }

    return {
        todayCelebration,
        upcomingFestivals
    };
}

/**
 * Fetches top real news headlines via Google News RSS through public RSS-to-JSON gateway.
 *
 * @returns {Promise<string[]>}
 */
async function fetchGoogleNewsHeadlines() {
    const rssFeedUrl = encodeURIComponent("https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en");
    const gatewayUrl = `https://api.rss2json.com/v1/api.json?rss_url=${rssFeedUrl}`;

    try {
        const response = await fetch(gatewayUrl);
        if (!response.ok) throw new Error(`RSS Gateway returned HTTP ${response.status}`);

        const data = await response.json();
        /** @type {string[]} */
        const headlines = [];

        if (Array.isArray(data?.items)) {
            for (let i = 0; i < Math.min(data.items.length, 4); i++) {
                const title = String(data.items[i]?.title || "").replace(/ - [^-]+$/, "").trim();
                if (title) headlines.push(title);
            }
        }

        if (headlines.length > 0) return headlines;
    } catch (/** @type {unknown} */ err) {
        console.warn("[Environment] Google News RSS fetch failed, using local headlines:", err);
    }

    return [
        `Local ${SIMULATION_CITY} metro expansion plans announced`,
        "India gears up for upcoming international cricket series",
        `New street food festival opens in ${SIMULATION_CITY}`,
        "Tech startups report booming growth across regional hubs"
    ];
}

/**
 * Orchestrates and returns a complete, grounded Real-World Environmental snapshot.
 *
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<EnvironmentSnapshot>}
 */
export async function getEnvironmentSnapshot(forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh && cachedEnvironment.snapshot && (now - cachedEnvironment.fetchedAt < CACHE_TTL_MS)) {
        return cachedEnvironment.snapshot;
    }

    const today = new Date();

    const [weatherData, festivalData, newsHeadlines] = await Promise.all([
        fetchCityWeather(),
        fetchCalendarBharatFestivals(today),
        fetchGoogleNewsHeadlines()
    ]);

    /** @type {EnvironmentSnapshot} */
    const snapshot = {
        city: SIMULATION_LOCATION_FULL,
        temperature: weatherData.temperature,
        weather: weatherData.weather,
        humidity: weatherData.humidity,
        todayCelebration: festivalData.todayCelebration,
        upcomingFestivals: festivalData.upcomingFestivals,
        newsHeadlines,
        updatedAt: now
    };

    cachedEnvironment = {
        snapshot,
        fetchedAt: now
    };

    return snapshot;
}