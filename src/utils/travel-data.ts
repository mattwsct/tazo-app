// === 🌍 TRAVEL DATA FOR CHAT COMMANDS ===

// Limits to keep data manageable (enforced when adding new entries)
// Prioritizing phrases over food - phrases are more important for travelers
const MAX_FOODS = 35;
const MAX_PHRASES = 50;

export interface TravelPhrase {
  lang: string;
  text: string;
  roman?: string;
  meaning: string;
}

export interface TravelData {
  foods: string[];
  phrases: TravelPhrase[];
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
      "🍜 soba", "🍜 udon", "🍱 ekiben", "🍖 tonkatsu", "🐟 unagi"
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
      { lang: "Japanese", text: "マジか", roman: "Maji ka", meaning: "seriously?" },
      { lang: "Japanese", text: "マジで", roman: "Maji de", meaning: "for real" },
      { lang: "Japanese", text: "ウケる", roman: "Ukeru", meaning: "hilarious" },
      { lang: "Japanese", text: "お元気ですか", roman: "Ogenki desu ka", meaning: "how are you?" },
      { lang: "Japanese", text: "お名前は", roman: "Onamae wa", meaning: "what's your name?" },
      { lang: "Japanese", text: "私は", roman: "Watashi wa", meaning: "I am" },
      { lang: "Japanese", text: "どこですか", roman: "Doko desu ka", meaning: "where is it?" },
      { lang: "Japanese", text: "いつ", roman: "Itsu", meaning: "when" },
      { lang: "Japanese", text: "なぜ", roman: "Naze", meaning: "why" },
      { lang: "Japanese", text: "どうして", roman: "Doushite", meaning: "why/how" },
      { lang: "Japanese", text: "いくつ", roman: "Ikutsu", meaning: "how many" },
      { lang: "Japanese", text: "お願い", roman: "Onegai", meaning: "please (casual)" },
      { lang: "Japanese", text: "すみませんでした", roman: "Sumimasen deshita", meaning: "I'm sorry (past)" },
      { lang: "Japanese", text: "おはようございます", roman: "Ohayou gozaimasu", meaning: "good morning (formal)" },
      { lang: "Japanese", text: "おやすみ", roman: "Oyasumi", meaning: "good night" },
      { lang: "Japanese", text: "またね", roman: "Mata ne", meaning: "see you later" },
      { lang: "Japanese", text: "じゃあね", roman: "Jaa ne", meaning: "see ya" },
      { lang: "Japanese", text: "おめでとう", roman: "Omedetou", meaning: "congratulations" },
      { lang: "Japanese", text: "お大事に", roman: "Odaiji ni", meaning: "take care" }
    ]
  },
  VN: {
    foods: [
      "🍜 phở", "🍲 bún chả", "🥢 bánh mì", "🍛 cơm tấm", "🍜 bún bò Huế", "🥟 chả giò", "🍤 tôm rang me",
      "🐟 cá kho tộ", "🍜 hủ tiếu", "🍲 bánh xèo", "🥢 bánh cuốn", "🍛 bún riêu", "🍜 mì quảng", "🥟 bánh bao",
      "🍤 chả cá", "🐟 cá nướng", "🍜 bún thịt nướng", "🍲 canh chua", "🥢 gỏi cuốn", "🍛 cơm gà", "🍜 bún ốc",
      "🥟 bánh chưng", "🍤 tôm sú", "🐟 cá lóc nướng trui", "🍜 bún mắm", "🍲 lẩu", "🥢 nem nướng", "🍛 cơm tấm sườn",
      "🍜 bún đậu mắm tôm", "🥟 bánh tét", "🍤 tôm hấp", "🐟 cá chiên", "🍜 bún chả cá", "🍲 cháo", "🥢 bánh canh",
      "🍛 cơm niêu", "☕ cà phê sữa đá", "🍵 trà đá", "🥤 nước mía", "🍺 bia hơi"
    ],
    phrases: [
      { lang: "Vietnamese", text: "Xin chào", roman: "Xin chào", meaning: "hello" },
      { lang: "Vietnamese", text: "Cảm ơn", roman: "Cảm ơn", meaning: "thank you" },
      { lang: "Vietnamese", text: "Xin lỗi", roman: "Xin lỗi", meaning: "sorry" },
      { lang: "Vietnamese", text: "Làm ơn", roman: "Làm ơn", meaning: "please" },
      { lang: "Vietnamese", text: "Bao nhiêu tiền?", roman: "Bao nhiêu tiền?", meaning: "how much?" },
      { lang: "Vietnamese", text: "Ngon", roman: "Ngon", meaning: "delicious" },
      { lang: "Vietnamese", text: "Chào buổi sáng", roman: "Chào buổi sáng", meaning: "good morning" },
      { lang: "Vietnamese", text: "Chào buổi tối", roman: "Chào buổi tối", meaning: "good evening" },
      { lang: "Vietnamese", text: "Tạm biệt", roman: "Tạm biệt", meaning: "goodbye" },
      { lang: "Vietnamese", text: "Có", roman: "Có", meaning: "yes" },
      { lang: "Vietnamese", text: "Không", roman: "Không", meaning: "no" },
      { lang: "Vietnamese", text: "Không sao", roman: "Không sao", meaning: "it's okay" },
      { lang: "Vietnamese", text: "Tôi đói", roman: "Tôi đói", meaning: "I'm hungry" },
      { lang: "Vietnamese", text: "Nước", roman: "Nước", meaning: "water" },
      { lang: "Vietnamese", text: "Cà phê", roman: "Cà phê", meaning: "coffee" },
      { lang: "Vietnamese", text: "Tôi không hiểu", roman: "Tôi không hiểu", meaning: "I don't understand" },
      { lang: "Vietnamese", text: "Bạn nói tiếng Anh không?", roman: "Bạn nói tiếng Anh không?", meaning: "do you speak English?" },
      { lang: "Vietnamese", text: "Ở đâu?", roman: "Ở đâu?", meaning: "where?" },
      { lang: "Vietnamese", text: "Đẹp", roman: "Đẹp", meaning: "beautiful" },
      { lang: "Vietnamese", text: "Tuyệt vời", roman: "Tuyệt vời", meaning: "amazing" },
      { lang: "Vietnamese", text: "Rẻ", roman: "Rẻ", meaning: "cheap" },
      { lang: "Vietnamese", text: "Đắt", roman: "Đắt", meaning: "expensive" },
      { lang: "Vietnamese", text: "Nhanh", roman: "Nhanh", meaning: "fast" },
      { lang: "Vietnamese", text: "Chậm", roman: "Chậm", meaning: "slow" },
      { lang: "Vietnamese", text: "Nóng", roman: "Nóng", meaning: "hot" },
      { lang: "Vietnamese", text: "Lạnh", roman: "Lạnh", meaning: "cold" },
      { lang: "Vietnamese", text: "Mát", roman: "Mát", meaning: "cool" },
      { lang: "Vietnamese", text: "Vui", roman: "Vui", meaning: "fun/happy" },
      { lang: "Vietnamese", text: "Mệt", roman: "Mệt", meaning: "tired" },
      { lang: "Vietnamese", text: "Được", roman: "Được", meaning: "okay/alright" },
      { lang: "Vietnamese", text: "Bạn khỏe không?", roman: "Bạn khỏe không?", meaning: "how are you?" },
      { lang: "Vietnamese", text: "Tên bạn là gì?", roman: "Tên bạn là gì?", meaning: "what's your name?" },
      { lang: "Vietnamese", text: "Tôi tên là", roman: "Tôi tên là", meaning: "my name is" },
      { lang: "Vietnamese", text: "Đây là", roman: "Đây là", meaning: "this is" },
      { lang: "Vietnamese", text: "Kia là", roman: "Kia là", meaning: "that is" },
      { lang: "Vietnamese", text: "Khi nào?", roman: "Khi nào?", meaning: "when?" },
      { lang: "Vietnamese", text: "Tại sao?", roman: "Tại sao?", meaning: "why?" },
      { lang: "Vietnamese", text: "Như thế nào?", roman: "Như thế nào?", meaning: "how?" },
      { lang: "Vietnamese", text: "Bao nhiêu?", roman: "Bao nhiêu?", meaning: "how many/how much?" },
      { lang: "Vietnamese", text: "Xin chào lại", roman: "Xin chào lại", meaning: "hello again" },
      { lang: "Vietnamese", text: "Chúc ngủ ngon", roman: "Chúc ngủ ngon", meaning: "good night" },
      { lang: "Vietnamese", text: "Hẹn gặp lại", roman: "Hẹn gặp lại", meaning: "see you again" },
      { lang: "Vietnamese", text: "Chúc mừng", roman: "Chúc mừng", meaning: "congratulations" },
      { lang: "Vietnamese", text: "Bảo trọng", roman: "Bảo trọng", meaning: "take care" },
      { lang: "Vietnamese", text: "Chúc may mắn", roman: "Chúc may mắn", meaning: "good luck" },
      { lang: "Vietnamese", text: "Xin lỗi vì sự chậm trễ", roman: "Xin lỗi vì sự chậm trễ", meaning: "sorry for the delay" },
      { lang: "Vietnamese", text: "Không có gì", roman: "Không có gì", meaning: "you're welcome" },
      { lang: "Vietnamese", text: "Rất vui được gặp bạn", roman: "Rất vui được gặp bạn", meaning: "nice to meet you" }
    ]
  },
  ID: {
    foods: [
      "🍛 nasi goreng", "🍜 mie goreng", "🍲 rendang", "🥢 satay", "🍛 gado-gado", "🍜 bakso", "🥟 lumpia",
      "🍤 udang goreng", "🐟 ikan bakar", "🍜 soto", "🍲 sate ayam", "🥢 nasi padang", "🍛 ayam goreng", "🍜 laksa",
      "🥟 martabak", "🍤 kerupuk", "🐟 ikan goreng", "🍜 mie ayam", "🍲 rawon", "🥢 pecel lele", "🍛 capcay",
      "🍜 kwetiau", "🥟 pempek", "🍤 udang sambal", "🐟 ikan pepes", "🍜 soto betawi", "🍲 gulai", "🥢 ketoprak",
      "🍛 nasi uduk", "🍜 bubur ayam", "🥟 risoles", "🍤 cumi goreng", "🐟 ikan asam manis", "🍜 mie bakso",
      "🍲 sop buntut", "🥢 gudeg", "🍛 nasi kuning", "☕ kopi", "🍵 teh", "🥤 es jeruk", "🍺 bir Bintang",
      "🍷 tuak", "🥤 es campur"
    ],
    phrases: [
      { lang: "Indonesian", text: "Halo", roman: "Halo", meaning: "hello" },
      { lang: "Indonesian", text: "Terima kasih", roman: "Terima kasih", meaning: "thank you" },
      { lang: "Indonesian", text: "Maaf", roman: "Maaf", meaning: "sorry" },
      { lang: "Indonesian", text: "Tolong", roman: "Tolong", meaning: "please" },
      { lang: "Indonesian", text: "Berapa harganya?", roman: "Berapa harganya?", meaning: "how much?" },
      { lang: "Indonesian", text: "Enak", roman: "Enak", meaning: "delicious" },
      { lang: "Indonesian", text: "Selamat pagi", roman: "Selamat pagi", meaning: "good morning" },
      { lang: "Indonesian", text: "Selamat malam", roman: "Selamat malam", meaning: "good evening" },
      { lang: "Indonesian", text: "Selamat tinggal", roman: "Selamat tinggal", meaning: "goodbye" },
      { lang: "Indonesian", text: "Ya", roman: "Ya", meaning: "yes" },
      { lang: "Indonesian", text: "Tidak", roman: "Tidak", meaning: "no" },
      { lang: "Indonesian", text: "Tidak apa-apa", roman: "Tidak apa-apa", meaning: "it's okay" },
      { lang: "Indonesian", text: "Saya lapar", roman: "Saya lapar", meaning: "I'm hungry" },
      { lang: "Indonesian", text: "Air", roman: "Air", meaning: "water" },
      { lang: "Indonesian", text: "Kopi", roman: "Kopi", meaning: "coffee" },
      { lang: "Indonesian", text: "Saya tidak mengerti", roman: "Saya tidak mengerti", meaning: "I don't understand" },
      { lang: "Indonesian", text: "Bisa bahasa Inggris?", roman: "Bisa bahasa Inggris?", meaning: "do you speak English?" },
      { lang: "Indonesian", text: "Di mana?", roman: "Di mana?", meaning: "where?" },
      { lang: "Indonesian", text: "Cantik", roman: "Cantik", meaning: "beautiful" },
      { lang: "Indonesian", text: "Luar biasa", roman: "Luar biasa", meaning: "amazing" },
      { lang: "Indonesian", text: "Murah", roman: "Murah", meaning: "cheap" },
      { lang: "Indonesian", text: "Mahal", roman: "Mahal", meaning: "expensive" },
      { lang: "Indonesian", text: "Cepat", roman: "Cepat", meaning: "fast" },
      { lang: "Indonesian", text: "Lambat", roman: "Lambat", meaning: "slow" },
      { lang: "Indonesian", text: "Panas", roman: "Panas", meaning: "hot" },
      { lang: "Indonesian", text: "Dingin", roman: "Dingin", meaning: "cold" },
      { lang: "Indonesian", text: "Sejuk", roman: "Sejuk", meaning: "cool" },
      { lang: "Indonesian", text: "Menyenangkan", roman: "Menyenangkan", meaning: "fun" },
      { lang: "Indonesian", text: "Lelah", roman: "Lelah", meaning: "tired" },
      { lang: "Indonesian", text: "Oke", roman: "Oke", meaning: "okay" },
      { lang: "Indonesian", text: "Apa kabar?", roman: "Apa kabar?", meaning: "how are you?" },
      { lang: "Indonesian", text: "Siapa nama Anda?", roman: "Siapa nama Anda?", meaning: "what's your name?" },
      { lang: "Indonesian", text: "Nama saya", roman: "Nama saya", meaning: "my name is" },
      { lang: "Indonesian", text: "Ini", roman: "Ini", meaning: "this" },
      { lang: "Indonesian", text: "Itu", roman: "Itu", meaning: "that" },
      { lang: "Indonesian", text: "Kapan?", roman: "Kapan?", meaning: "when?" },
      { lang: "Indonesian", text: "Mengapa?", roman: "Mengapa?", meaning: "why?" },
      { lang: "Indonesian", text: "Bagaimana?", roman: "Bagaimana?", meaning: "how?" },
      { lang: "Indonesian", text: "Berapa?", roman: "Berapa?", meaning: "how many/how much?" },
      { lang: "Indonesian", text: "Selamat siang", roman: "Selamat siang", meaning: "good afternoon" },
      { lang: "Indonesian", text: "Selamat tidur", roman: "Selamat tidur", meaning: "good night" },
      { lang: "Indonesian", text: "Sampai jumpa", roman: "Sampai jumpa", meaning: "see you" },
      { lang: "Indonesian", text: "Selamat", roman: "Selamat", meaning: "congratulations/safe" },
      { lang: "Indonesian", text: "Hati-hati", roman: "Hati-hati", meaning: "be careful" },
      { lang: "Indonesian", text: "Semoga berhasil", roman: "Semoga berhasil", meaning: "good luck" },
      { lang: "Indonesian", text: "Maaf terlambat", roman: "Maaf terlambat", meaning: "sorry for being late" },
      { lang: "Indonesian", text: "Sama-sama", roman: "Sama-sama", meaning: "you're welcome" },
      { lang: "Indonesian", text: "Senang bertemu Anda", roman: "Senang bertemu Anda", meaning: "nice to meet you" }
    ]
  },
  AU: {
    foods: [
      "🍔 meat pie", "🥩 steak", "🍗 chicken parmigiana", "🍤 prawns", "🐟 barramundi", "🍖 lamb chops",
      "🍔 burger with beetroot", "🥩 kangaroo steak", "🍗 fish and chips", "🍤 Moreton Bay bugs", "🐟 snapper",
      "🍖 sausage roll", "🍔 vegemite sandwich", "🥩 porterhouse", "🍗 roast lamb", "🍤 yabbies", "🐟 flathead",
      "🍖 bangers and mash", "🍔 chicken schnitzel", "🥩 rump steak", "🍗 BBQ chicken", "🍤 mud crab", "🐟 whiting",
      "🍖 lamb shank", "🍔 dim sims", "🥩 eye fillet", "🍗 chicken parmi", "🍤 bugs", "🐟 trevally",
      "🍖 beef pie", "🍔 sausage sizzle", "🥩 T-bone", "🍗 roast chicken", "🍤 prawn cocktail", "🐟 kingfish",
      "🍖 lamb roast", "🍔 party pies", "🥩 scotch fillet", "🍗 chicken wings", "🍤 lobster", "🐟 salmon",
      "🍖 beef burger", "☕ flat white", "🍵 chai", "🥤 lemon squash", "🍺 VB", "🍷 shiraz",
      "🍺 XXXX", "🍷 chardonnay", "🥤 iced coffee", "🍰 lamington", "🍪 ANZAC biscuit"
    ],
    phrases: [
      { lang: "English (Aussie)", text: "G'day", meaning: "hello" },
      { lang: "English (Aussie)", text: "Thanks mate", meaning: "thank you" },
      { lang: "English (Aussie)", text: "Sorry", meaning: "apology" },
      { lang: "English (Aussie)", text: "Please", meaning: "polite request" },
      { lang: "English (Aussie)", text: "How much?", meaning: "asking price" },
      { lang: "English (Aussie)", text: "Beauty", meaning: "great/excellent" },
      { lang: "English (Aussie)", text: "No worries", meaning: "it's okay" },
      { lang: "English (Aussie)", text: "Fair dinkum", meaning: "genuine/true" },
      { lang: "English (Aussie)", text: "Arvo", meaning: "afternoon" },
      { lang: "English (Aussie)", text: "Brekkie", meaning: "breakfast" },
      { lang: "English (Aussie)", text: "Maccas", meaning: "McDonald's" },
      { lang: "English (Aussie)", text: "Servo", meaning: "service station" },
      { lang: "English (Aussie)", text: "Bottle-o", meaning: "bottle shop" },
      { lang: "English (Aussie)", text: "Maccas run", meaning: "trip to McDonald's" },
      { lang: "English (Aussie)", text: "Stoked", meaning: "very happy" },
      { lang: "English (Aussie)", text: "Chuffed", meaning: "pleased" },
      { lang: "English (Aussie)", text: "Ripper", meaning: "excellent" },
      { lang: "English (Aussie)", text: "Bloody oath", meaning: "absolutely yes" },
      { lang: "English (Aussie)", text: "Too easy", meaning: "no problem" },
      { lang: "English (Aussie)", text: "She'll be right", meaning: "it'll be fine" },
      { lang: "English (Aussie)", text: "Good on ya", meaning: "well done" },
      { lang: "English (Aussie)", text: "Chuck a u-ey", meaning: "make a U-turn" },
      { lang: "English (Aussie)", text: "Flat out", meaning: "very busy" },
      { lang: "English (Aussie)", text: "Heaps", meaning: "a lot" },
      { lang: "English (Aussie)", text: "Reckon", meaning: "think/believe" },
      { lang: "English (Aussie)", text: "Dunno", meaning: "don't know" },
      { lang: "English (Aussie)", text: "Ta", meaning: "thanks" },
      { lang: "English (Aussie)", text: "Cheers", meaning: "thanks/goodbye" },
      { lang: "English (Aussie)", text: "See ya", meaning: "goodbye" },
      { lang: "English (Aussie)", text: "Hooroo", meaning: "goodbye" },
      { lang: "English (Aussie)", text: "How ya going?", meaning: "how are you?" },
      { lang: "English (Aussie)", text: "What's your name?", meaning: "asking name" },
      { lang: "English (Aussie)", text: "I'm", meaning: "introducing self" },
      { lang: "English (Aussie)", text: "This is", meaning: "introducing something" },
      { lang: "English (Aussie)", text: "That's", meaning: "pointing out something" },
      { lang: "English (Aussie)", text: "When?", meaning: "asking time" },
      { lang: "English (Aussie)", text: "Why?", meaning: "asking reason" },
      { lang: "English (Aussie)", text: "How?", meaning: "asking method" },
      { lang: "English (Aussie)", text: "How many?", meaning: "asking quantity" },
      { lang: "English (Aussie)", text: "Arvo", meaning: "afternoon" },
      { lang: "English (Aussie)", text: "Night", meaning: "evening/goodnight" },
      { lang: "English (Aussie)", text: "Catch ya later", meaning: "see you later" },
      { lang: "English (Aussie)", text: "Congrats", meaning: "congratulations" },
      { lang: "English (Aussie)", text: "Take care", meaning: "be careful/goodbye" },
      { lang: "English (Aussie)", text: "Good luck", meaning: "wishing success" },
      { lang: "English (Aussie)", text: "Sorry I'm late", meaning: "apology for delay" },
      { lang: "English (Aussie)", text: "No worries", meaning: "you're welcome/it's fine" },
      { lang: "English (Aussie)", text: "Nice to meet ya", meaning: "greeting" }
    ]
  },
  // Add more countries as needed - keeping file size manageable
  // Limits: MAX_FOODS=35, MAX_PHRASES=50 per country (prioritizing phrases)
};

/**
 * Gets travel data for a country code, falling back to global data
 * Returns { data, isCountrySpecific } to indicate if country-specific data exists
 */
export function getTravelData(countryCode: string | null | undefined): TravelData & { isCountrySpecific: boolean } {
  if (!countryCode) return { ...GLOBAL, isCountrySpecific: false };
  const normalized = countryCode.toUpperCase();
  const data = TRAVEL_DATA[normalized];
  if (data) {
    return { ...data, isCountrySpecific: true };
  }
  return { ...GLOBAL, isCountrySpecific: false };
}
