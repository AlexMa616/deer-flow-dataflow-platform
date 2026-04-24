import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface ThemeImagePayload {
  imageUrl: string;
  title: string;
  provider: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  query: string;
  from: "openverse" | "fallback";
}

type VisualMode = "tech" | "gemini" | "ocean";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const themeImageCache = new Map<string, { expiresAt: number; payload: ThemeImagePayload }>();

const EVENT_QUERY_POOL: Record<string, string[]> = {
  "春节": [
    "lunar new year cartoon illustration",
    "spring festival china doodle art",
    "red lantern festive illustration",
  ],
  "元宵节": [
    "lantern festival chinese cartoon illustration",
    "yuanxiao night lights doodle",
    "festival lantern sky illustration",
  ],
  "清明节": [
    "qingming spring landscape illustration",
    "traditional chinese spring festival art",
    "soft green memorial festival illustration",
  ],
  "端午节": [
    "dragon boat festival cartoon illustration",
    "zongzi cute doodle illustration",
    "duanwu dragon boat race art",
  ],
  "七夕节": [
    "qixi festival romantic illustration",
    "chinese valentine doodle cartoon",
    "magpie bridge love story illustration",
  ],
  "中秋节": [
    "mid autumn festival mooncake illustration",
    "full moon night chinese festival cartoon",
    "jade rabbit moon festival doodle",
  ],
  "重阳节": [
    "double ninth festival autumn mountain illustration",
    "chongyang chrysanthemum festival art",
    "autumn hiking celebration illustration",
  ],
  "国庆节": [
    "national day china celebration illustration",
    "city fireworks festival poster art",
    "red gold festive skyline illustration",
  ],
  "元旦": [
    "new year celebration doodle illustration",
    "new year confetti cartoon art",
    "modern festive neon poster",
  ],
  "情人节": [
    "valentine day cartoon illustration",
    "heart themed doodle art",
    "romantic pink red poster illustration",
  ],
  "妇女节": [
    "international women's day illustration",
    "women power floral doodle",
    "purple celebration poster art",
  ],
  "劳动节": [
    "labor day workers celebration illustration",
    "worker themed poster art",
    "construction teamwork cartoon style",
  ],
  "青年节": [
    "youth day dynamic poster illustration",
    "young people festival cartoon art",
  ],
  "儿童节": [
    "children day cartoon illustration",
    "kids celebration doodle art",
    "cute mascot spring poster",
  ],
  "教师节": [
    "teacher day classroom illustration",
    "education themed doodle poster",
  ],
  "万圣节": [
    "halloween cartoon illustration",
    "pumpkin doodle spooky cute art",
    "orange purple festival poster",
  ],
  "圣诞节": [
    "christmas doodle illustration",
    "winter holiday festive cartoon",
    "snow tree gift illustration",
  ],
  "平安夜": [
    "christmas eve warm light illustration",
    "winter night festive doodle",
  ],
  "圣帕特里克节": [
    "saint patricks day shamrock illustration",
    "green clover cartoon festival",
  ],
  "愚人节": [
    "april fools day playful illustration",
    "funny doodle poster art",
  ],
  "地球日": [
    "earth day eco illustration",
    "green planet protection poster",
  ],
  "读书日": [
    "world book day illustration",
    "reading festival doodle art",
  ],
  "环境日": [
    "world environment day illustration",
    "eco nature protection poster",
  ],
  "旅游日": [
    "world tourism day illustration",
    "travel skyline poster art",
  ],
  "母亲节": [
    "mothers day floral illustration",
    "family warm greeting card art",
    "love and gratitude poster illustration",
  ],
  "父亲节": [
    "fathers day celebration illustration",
    "father child warm cartoon art",
  ],
  "春分": [
    "spring equinox blossom illustration",
    "spring balance nature poster art",
  ],
  "夏至": [
    "summer solstice sunshine illustration",
    "summer festival vibrant poster art",
  ],
  "秋分": [
    "autumn equinox harvest illustration",
    "autumn landscape festival art",
  ],
  "冬至": [
    "winter solstice warm festival illustration",
    "winter night celebration doodle",
  ],
  "建党节": [
    "china party founding day celebration illustration",
    "red themed commemorative poster art",
  ],
  "建军节": [
    "army day celebration illustration",
    "military commemorative poster art",
  ],
  "感恩节": [
    "thanksgiving festive illustration",
    "autumn family dinner cartoon art",
  ],
  "世界海洋日": [
    "world oceans day poster illustration",
    "marine protection campaign art",
  ],
  "国际护士节": [
    "international nurses day appreciation illustration",
    "medical care celebration poster art",
  ],
  "世界无烟日": [
    "world no tobacco day campaign poster",
    "health awareness illustration art",
  ],
  "开学季": [
    "back to school cheerful illustration",
    "campus learning poster design",
  ],
  "毕业季": [
    "graduation celebration illustration",
    "campus farewell memory poster",
  ],
};

const DAILY_QUERY_POOL = [
  "premium natural landscape wallpaper 5k",
  "mountain valley wallpaper 5k",
  "city skyline wallpaper premium 4k",
  "sunset coastline wallpaper cinematic 4k",
  "golden hour lake mountain wallpaper",
  "modern city dusk wallpaper high resolution",
  "forest ridge wallpaper 5k",
  "coastal sunset wallpaper high resolution",
];

const MODE_QUERY_POOL: Record<VisualMode, string[]> = {
  tech: [
    "premium city skyline wallpaper 4k",
    "modern city night wallpaper",
    "urban dusk wallpaper cinematic high resolution",
  ],
  gemini: [
    "mountain landscape wallpaper 5k",
    "yosemite valley wallpaper high resolution",
    "forest ridge wallpaper premium 4k",
  ],
  ocean: [
    "sunset coastline wallpaper 4k",
    "golden hour desert wallpaper high resolution",
    "catalina island sunset wallpaper premium",
  ],
};

const FALLBACK_IMAGES: Record<VisualMode, Omit<ThemeImagePayload, "query" | "from">[]> = {
  tech: [
    {
      imageUrl:
        "https://images.unsplash.com/photo-1654832544261-d9639df991de?auto=format&fit=crop&w=1800&q=82",
      title: "City Skyline Night",
      provider: "Unsplash",
      license: "Unsplash",
      attribution: "Andres Siimon",
      sourceUrl:
        "https://unsplash.com/photos/a-city-skyline-at-night-3Qzf-U0XfCE",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1754972722440-f7e7f366bc01?auto=format&fit=crop&w=1800&q=82",
      title: "Urban Rooftop Skyline",
      provider: "Unsplash",
      license: "Unsplash",
      attribution: "Mantas Hesthaven",
      sourceUrl:
        "https://unsplash.com/photos/rooftops-of-houses-with-city-skyline-in-background-S21CrCFzsSc",
    },
  ],
  gemini: [
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers-6k/10-11-6k.jpg",
      title: "El Capitan Cliffs",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers/10-10.jpg",
      title: "Yosemite Valley",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
  ],
  ocean: [
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers/10-15-Day.jpg",
      title: "Catalina Coast Day",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers-6k/10-14-Day-6k.jpg",
      title: "Mojave Desert Day",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
  ],
};

const FAST_REFRESH_IMAGES: Record<VisualMode, Omit<ThemeImagePayload, "query" | "from">[]> = {
  tech: [
    {
      imageUrl:
        "https://images.unsplash.com/photo-1654832544261-d9639df991de?auto=format&fit=crop&w=1600&q=78",
      title: "City Skyline Night",
      provider: "Unsplash",
      license: "Unsplash",
      attribution: "Andres Siimon",
      sourceUrl:
        "https://unsplash.com/photos/a-city-skyline-at-night-3Qzf-U0XfCE",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1754972722440-f7e7f366bc01?auto=format&fit=crop&w=1600&q=78",
      title: "Urban Rooftop Skyline",
      provider: "Unsplash",
      license: "Unsplash",
      attribution: "Mantas Hesthaven",
      sourceUrl:
        "https://unsplash.com/photos/rooftops-of-houses-with-city-skyline-in-background-S21CrCFzsSc",
    },
  ],
  gemini: [
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers-6k/10-11-6k.jpg",
      title: "El Capitan Cliffs",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers-6k/10-13-6k.jpg",
      title: "High Sierra Dusk",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
  ],
  ocean: [
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers/10-15-Day.jpg",
      title: "Catalina Coast Day",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
    {
      imageUrl:
        "https://512pixels.net/downloads/macos-wallpapers/10-15-Night.jpg",
      title: "Catalina Coast Night",
      provider: "512pixels",
      license: "Editorial",
      attribution: "Apple / 512pixels",
      sourceUrl:
        "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
    },
  ],
};

const DEFAULT_FALLBACK_IMAGES: Omit<ThemeImagePayload, "query" | "from">[] = [
  {
    imageUrl:
      "https://512pixels.net/downloads/macos-wallpapers/10-15-Day.jpg",
    title: "Catalina Coast Day",
    provider: "512pixels",
    license: "Editorial",
    attribution: "Apple / 512pixels",
    sourceUrl: "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
  },
  {
    imageUrl:
      "https://512pixels.net/downloads/macos-wallpapers/10-15-Night.jpg",
    title: "Catalina Coast Night",
    provider: "512pixels",
    license: "Editorial",
    attribution: "Apple / 512pixels",
    sourceUrl: "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
  },
  {
    imageUrl:
      "https://512pixels.net/downloads/macos-wallpapers-6k/10-14-Day-6k.jpg",
    title: "Mojave Desert Day",
    provider: "512pixels",
    license: "Editorial",
    attribution: "Apple / 512pixels",
    sourceUrl: "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
  },
  {
    imageUrl:
      "https://512pixels.net/downloads/macos-wallpapers-6k/10-11-6k.jpg",
    title: "El Capitan Cliffs",
    provider: "512pixels",
    license: "Editorial",
    attribution: "Apple / 512pixels",
    sourceUrl: "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
  },
  {
    imageUrl:
      "https://512pixels.net/downloads/macos-wallpapers/10-10.jpg",
    title: "Yosemite Valley",
    provider: "512pixels",
    license: "Editorial",
    attribution: "Apple / 512pixels",
    sourceUrl: "https://512pixels.net/projects/default-mac-wallpapers-in-5k/",
  },
  {
    imageUrl:
      "https://images.unsplash.com/photo-1654832544261-d9639df991de?auto=format&fit=crop&w=1800&q=82",
      title: "City Skyline Night",
    provider: "Unsplash",
    license: "Unsplash",
    attribution: "Andres Siimon",
    sourceUrl: "https://unsplash.com/photos/a-city-skyline-at-night-3Qzf-U0XfCE",
  },
  {
    imageUrl:
      "https://images.unsplash.com/photo-1754972722440-f7e7f366bc01?auto=format&fit=crop&w=1800&q=82",
    title: "Urban Rooftop Skyline",
    provider: "Unsplash",
    license: "Unsplash",
    attribution: "Mantas Hesthaven",
    sourceUrl: "https://unsplash.com/photos/rooftops-of-houses-with-city-skyline-in-background-S21CrCFzsSc",
  },
];

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function pickFromPool<T>(pool: T[], seed: number): T {
  return pool[seed % pool.length]!;
}

function resolveQueries(
  eventName: string,
  extraKeywords: string,
  visualMode: VisualMode,
): string[] {
  const normalizedEvent = normalizeKey(eventName);
  const eventQueries = Object.entries(EVENT_QUERY_POOL)
    .filter(([label]) => {
      const normalizedLabel = normalizeKey(label);
      if (!normalizedEvent) return false;
      return (
        normalizedEvent.includes(normalizedLabel)
        || normalizedLabel.includes(normalizedEvent)
      );
    })
    .flatMap(([, queries]) => queries);
  const keywordTokens = extraKeywords
    .split(/[,，|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const keywordQueries = keywordTokens.flatMap((item) => [
    `${item} illustration`,
    `${item} cartoon doodle`,
  ]);
  const eventNameQueries = eventName.trim()
    ? [`${eventName} cartoon illustration`, `${eventName} festival doodle art`]
    : [];
  const modeQueries = MODE_QUERY_POOL[visualMode] ?? MODE_QUERY_POOL.tech;
  const merged = [...eventNameQueries, ...eventQueries, ...keywordQueries, ...modeQueries];
  const unique = Array.from(
    new Set(
      merged
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  return unique.length > 0 ? unique : [...modeQueries, ...DAILY_QUERY_POOL];
}

function fallbackPayload(
  seed: number,
  query: string,
  visualMode: VisualMode,
  forceRefresh: boolean,
): ThemeImagePayload {
  const modePool = forceRefresh
    ? FAST_REFRESH_IMAGES[visualMode]
    : FALLBACK_IMAGES[visualMode];
  const targetPool = modePool && modePool.length > 0
    ? modePool
    : DEFAULT_FALLBACK_IMAGES;
  const base = pickFromPool(targetPool, seed);
  return {
    ...base,
    query,
    from: "fallback",
  };
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") ?? "unknown";
  const eventName = request.nextUrl.searchParams.get("event") ?? "";
  const keywords = request.nextUrl.searchParams.get("keywords") ?? "";
  const visualModeParam = request.nextUrl.searchParams.get("mode");
  const visualMode: VisualMode =
    visualModeParam === "gemini" || visualModeParam === "ocean"
      ? visualModeParam
      : "tech";
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const nonce = request.nextUrl.searchParams.get("nonce") ?? "";
  const cacheKey = `${date}::${eventName}::${keywords}::${visualMode}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = themeImageCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload, {
        headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=21600" },
      });
    }
  }

  const seed = hashSeed(`${cacheKey}::${nonce}`);
  const queries = resolveQueries(eventName, keywords, visualMode);

  // Use curated high-quality wallpaper pools for faster and more stable loading.
  // This avoids remote search latency and random low-quality results.
  const payload = fallbackPayload(
    seed,
    queries[0] ?? "daily scenic wallpaper",
    visualMode,
    forceRefresh,
  );

  themeImageCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    payload,
  });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=21600" },
  });
}
