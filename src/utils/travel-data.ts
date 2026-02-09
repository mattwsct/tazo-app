// === 🌍 TRAVEL DATA FOR CHAT COMMANDS ===

export interface TravelPhrase {
  lang: string;
  text: string;
  roman?: string;
  meaning: string;
}

export interface TravelData {
  foods: string[];
  phrases: TravelPhrase[];
  sidequests: string[];
}

export const GLOBAL: TravelData = {
  foods: [
    "🍕 pizza", "🍔 burger", "🍜 noodles", "🍱 bento", "🌮 taco", "🍣 sushi", "🍛 curry", "🥙 wrap",
    "🍝 pasta", "🍲 soup", "🥗 salad", "🍖 kebab", "🍗 chicken", "🥩 steak", "🍤 shrimp", "🐟 fish",
    "🥐 croissant", "🍞 bread", "🥖 baguette", "🧀 cheese", "🥚 eggs", "🥓 bacon", "🥞 pancakes",
    "🍳 omelet", "🥪 sandwich", "🌯 burrito", "🍟 fries", "🍿 popcorn", "🍩 donut", "🍪 cookie",
    "🧁 cupcake", "🍰 cake", "🍫 chocolate", "🍭 candy", "🍬 lollipop", "🍯 honey", "🥛 milk",
    "☕ coffee", "🍵 tea", "🥤 soda", "🍺 beer", "🍷 wine", "🍸 cocktail", "🥃 whiskey"
  ],
  phrases: [
    { lang: "English", text: "Hello", meaning: "greeting" },
    { lang: "English", text: "Thank you", meaning: "expression of gratitude" },
    { lang: "English", text: "Please", meaning: "polite request" },
    { lang: "English", text: "Excuse me", meaning: "apology or attention-getter" },
    { lang: "English", text: "How much?", meaning: "asking price" },
    { lang: "Spanish", text: "Hola", meaning: "hello" },
    { lang: "Spanish", text: "Gracias", meaning: "thank you" },
    { lang: "French", text: "Bonjour", meaning: "good day" },
    { lang: "French", text: "Merci", meaning: "thank you" },
    { lang: "German", text: "Guten Tag", meaning: "good day" },
    { lang: "Italian", text: "Ciao", meaning: "hello/goodbye" },
    { lang: "Portuguese", text: "Olá", meaning: "hello" },
    { lang: "Russian", text: "Привет", roman: "Privet", meaning: "hi" },
    { lang: "Arabic", text: "مرحبا", roman: "Marhaba", meaning: "hello" },
    { lang: "Hindi", text: "नमस्ते", roman: "Namaste", meaning: "hello" }
  ],
  sidequests: [
    "Find the best local coffee shop", "Try street food from 3 different vendors",
    "Visit a local market", "Take a photo with a landmark", "Learn 5 local phrases",
    "Find a hidden gem restaurant", "Watch a sunset", "Explore a random neighborhood",
    "Try the local specialty drink", "Find street art", "Visit a temple or church",
    "Take public transport somewhere new", "Find the best view in the city",
    "Try a local dessert", "Visit a museum", "Find a local park", "Watch people",
    "Try a new cuisine", "Find a bookstore", "Visit a local market", "Take a walk",
    "Find a good spot for people watching", "Try local snacks", "Explore side streets",
    "Find a quiet place", "Try something you've never had", "Visit a local shop",
    "Find a good photo spot", "Try the local breakfast", "Explore on foot"
  ]
};

export const TRAVEL_DATA: Record<string, TravelData> = {
  JP: {
    foods: [
      "🍜 ramen", "🍣 sushi", "🍱 bento", "🍛 curry rice", "🍙 onigiri", "🍘 senbei", "🥟 gyoza",
      "🍢 oden", "🍡 dango", "🍥 naruto", "🍚 rice", "🍲 miso soup", "🥢 tempura", "🍤 ebi fry",
      "🐟 sashimi", "🍖 yakitori", "🥩 wagyu", "🍵 matcha", "🍮 pudding", "🍰 castella", "🍡 mochi",
      "🍪 senbei", "🍫 pocky", "🍬 konpeito", "🍯 honey", "🥛 milk", "🍺 sake", "🍶 nihonshu",
      "☕ coffee", "🍵 green tea", "🥤 ramune", "🍧 kakigori", "🍨 ice cream", "🥟 shumai",
      "🍜 soba", "🍜 udon", "🍱 ekiben", "🍖 tonkatsu", "🐟 unagi", "🍤 katsu", "🥩 sukiyaki"
    ],
    phrases: [
      { lang: "Japanese", text: "こんにちは", roman: "Konnichiwa", meaning: "hello (daytime)" },
      { lang: "Japanese", text: "ありがとう", roman: "Arigatou", meaning: "thank you" },
      { lang: "Japanese", text: "すみません", roman: "Sumimasen", meaning: "excuse me" },
      { lang: "Japanese", text: "お願いします", roman: "Onegaishimasu", meaning: "please" },
      { lang: "Japanese", text: "いくらですか", roman: "Ikura desu ka", meaning: "how much?" },
      { lang: "Japanese", text: "おいしい", roman: "Oishii", meaning: "delicious" },
      { lang: "Japanese", text: "いただきます", roman: "Itadakimasu", meaning: "before eating" },
      { lang: "Japanese", text: "ごちそうさまでした", roman: "Gochisousama deshita", meaning: "after eating" },
      { lang: "Japanese", text: "おはよう", roman: "Ohayou", meaning: "good morning" },
      { lang: "Japanese", text: "こんばんは", roman: "Konbanwa", meaning: "good evening" },
      { lang: "Japanese", text: "さようなら", roman: "Sayounara", meaning: "goodbye" },
      { lang: "Japanese", text: "はい", roman: "Hai", meaning: "yes" },
      { lang: "Japanese", text: "いいえ", roman: "Iie", meaning: "no" },
      { lang: "Japanese", text: "大丈夫", roman: "Daijoubu", meaning: "it's okay" },
      { lang: "Japanese", text: "美味しい", roman: "Umai", meaning: "tasty" },
      { lang: "Japanese", text: "お腹すいた", roman: "Onaka suita", meaning: "I'm hungry" },
      { lang: "Japanese", text: "お疲れ様", roman: "Otsukaresama", meaning: "good work" },
      { lang: "Japanese", text: "頑張って", roman: "Ganbatte", meaning: "do your best" },
      { lang: "Japanese", text: "かわいい", roman: "Kawaii", meaning: "cute" },
      { lang: "Japanese", text: "すごい", roman: "Sugoi", meaning: "amazing" },
      { lang: "Japanese", text: "やばい", roman: "Yabai", meaning: "crazy/intense" },
      { lang: "Japanese", text: "最高", roman: "Saikou", meaning: "the best" },
      { lang: "Japanese", text: "楽しい", roman: "Tanoshii", meaning: "fun" },
      { lang: "Japanese", text: "疲れた", roman: "Tsukareta", meaning: "tired" },
      { lang: "Japanese", text: "元気", roman: "Genki", meaning: "energetic" },
      { lang: "Japanese", text: "クソ", roman: "Kuso", meaning: "damn (strong)" },
      { lang: "Japanese", text: "チクショウ", roman: "Chikushou", meaning: "damn it (strong)" },
      { lang: "Japanese", text: "マジか", roman: "Maji ka", meaning: "seriously?" },
      { lang: "Japanese", text: "やばすぎ", roman: "Yabasugi", meaning: "too crazy" },
      { lang: "Japanese", text: "マジで", roman: "Maji de", meaning: "for real" },
      { lang: "Japanese", text: "ウケる", roman: "Ukeru", meaning: "hilarious" },
      { lang: "Japanese", text: "ヤバい", roman: "Yabai", meaning: "crazy/intense" }
    ],
    sidequests: [
      "Find the best ramen shop", "Try 7-Eleven onigiri", "Visit a konbini", "Try vending machine food",
      "Find the best sushi spot", "Try takoyaki from a street vendor", "Visit a temple", "Try matcha",
      "Find a good izakaya", "Try karaage", "Visit a cat cafe", "Try purikura photo booth",
      "Find the best convenience store snacks", "Try melon pan", "Visit a shrine", "Try konbini coffee",
      "Find a good yakiniku place", "Try taiyaki", "Visit a park", "Try Japanese breakfast",
      "Find the best tempura", "Try mochi", "Visit a market", "Try sake", "Find a good soba place",
      "Try dango", "Visit a bookstore", "Try kakigori", "Find the best tonkatsu", "Try okonomiyaki",
      "Find a hidden ramen spot", "Try katsu curry", "Visit an arcade", "Try Japanese street food",
      "Find the best karaage", "Try onigiri variations", "Visit a garden", "Try local craft beer",
      "Find a good tonkotsu ramen", "Try Japanese desserts", "Visit a museum", "Try regional specialties",
      "Find the best izakaya", "Try yakitori", "Visit a hot spring area", "Try local snacks"
    ]
  },
  // Add more countries as needed - keeping file size manageable
  // Full data available in original tazo-web implementation
};

/**
 * Gets travel data for a country code, falling back to global data
 */
export function getTravelData(countryCode: string | null | undefined): TravelData {
  if (!countryCode) return GLOBAL;
  const normalized = countryCode.toUpperCase();
  return TRAVEL_DATA[normalized] || GLOBAL;
}
