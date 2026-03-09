/**
 * Auto poll content: two poll types —
 *  1. Streamer polls: random question + 5 random boss names as options.
 *  2. General polls: bundled question + specific options (countries, sports, hobbies, etc.).
 * Auto polls randomly pick one of the two types each time.
 */

import type { PollOption } from '@/types/poll';

// ---------------------------------------------------------------------------
// Question bank — 250+ questions across all categories
// All questions expect streamer names as options (e.g. "Who would win...?")
// ---------------------------------------------------------------------------

const STREAMER_POLL_QUESTIONS: readonly string[] = [
  // --- Fight / Competition ---
  'Who would win in a street fight?',
  'Who would win in an MMA cage match?',
  'Who would win a rap battle?',
  'Who would win a poker tournament?',
  'Who would win a chess match?',
  'Who would win a trivia night?',
  'Who would win an arm wrestling match?',
  'Who would win a dance-off?',
  'Who would win in a boxing match?',
  'Who would win a hot dog eating contest?',
  'Who would win a cooking competition?',
  'Who would win a drinking contest? (water only, obviously)',
  'Who would win a staring contest?',
  'Who would win a debate?',
  'Who would win a spelling bee?',
  'Who would win a karaoke battle?',
  'Who would win Jeopardy?',
  'Who would win at Mario Kart?',
  'Who would win at chess boxing?',
  'Who would win a push-up contest?',
  'Who would win a marathon?',
  'Who would win at rock paper scissors best of 100?',
  'Who would win a hot sauce eating challenge?',
  'Who would win a pie eating contest?',
  'Who would win a hackathon?',
  'Who would win a roast battle?',
  'Who would win a spelling contest in a foreign language?',
  'Who would win a talent show?',
  'Who would win a reality TV competition?',

  // --- Survival / Wilderness ---
  'Who would survive a zombie apocalypse longest?',
  'Who would last longest on a deserted island?',
  'Who would survive in the Amazon jungle?',
  'Who would survive an Antarctic expedition?',
  'Who would make the best doomsday prepper?',
  'Who would survive a bear attack?',
  'Who would last longest in a haunted house?',
  'Who would survive a shark encounter?',
  'Who would build the best shelter in the wild?',
  'Who would find food first in the wilderness?',
  'Who would survive a nuclear bunker scenario?',
  'Who would last longest with no internet access?',
  'Who would survive an alien invasion?',
  'Who would survive a zombie horde the longest?',
  'Who would make the best astronaut in deep space?',
  'Who would last longest in a sensory deprivation tank?',
  'Who would survive a 30-day water-only fast?',
  'Who would last longest stranded in a snowstorm?',
  'Who would make the best survivalist on a mountain?',

  // --- Social / Personality ---
  'Who would be the worst roommate?',
  'Who would be the best best friend?',
  'Who would be the most fun at a party?',
  'Who would make the best therapist?',
  'Who would ghost you after one date?',
  'Who would be the most annoying coworker?',
  'Who would cry first in a sad movie?',
  'Who would be the last to arrive to everything?',
  'Who would be most likely to overshare on social media?',
  'Who would be most likely to start a cult?',
  'Who would be the best wingman?',
  'Who would be the best parent?',
  'Who would be the worst driver?',
  'Who would be most likely to argue with a customer service rep?',
  'Who would be most likely to get kicked out of a library?',
  'Who would be most likely to forget their own birthday?',
  'Who would be the most likely to break something expensive by accident?',
  'Who would you want to have at your side at a dinner party?',
  'Who would be most likely to challenge a random stranger to a dance battle?',
  'Who would be most likely to accidentally call a teacher "mum"?',

  // --- Travel / Countries ---
  'Who would make the best travel vlogger?',
  'Who would get lost first in Tokyo?',
  'Who would blend in best in Paris?',
  'Who would survive a trip to the Australian outback?',
  'Who would handle New York City best?',
  'Who would thrive most in Iceland?',
  'Who would be most likely to accidentally offend locals abroad?',
  'Who would enjoy a solo trip to India most?',
  'Who would navigate public transport in London best?',
  'Who would enjoy a cruise around the Mediterranean most?',
  'Who would thrive on a solo trip through Southeast Asia?',
  'Who would be the best guide on a safari in Kenya?',
  'Who would be most likely to overpay for everything as a tourist?',
  'Who would enjoy a Nordic winter the most?',
  'Who would have the most fun at Carnival in Rio?',
  'Who would get the best street food in Bangkok?',
  'Who would survive a road trip across the US?',
  'Who would explore South Korea solo the best?',
  'Who would be the best companion on a Eurotrip?',
  'Who would last longest backpacking through South America?',
  'Who would have the best time at an Oktoberfest in Munich?',
  'Who would blend in best in Dubai?',
  'Who would enjoy a week in Bali the most?',
  'Who would thrive in the chaos of Cairo?',
  'Who would enjoy exploring Scottish highlands the most?',
  'Who would be most likely to move to Japan permanently?',
  'Who would enjoy New Zealand the most?',
  'Who would handle extreme heat in the Sahara best?',

  // --- Sports ---
  'Who would make the best soccer player?',
  'Who would dominate basketball?',
  'Who would be the best surfer?',
  'Who would be the best MMA fighter?',
  'Who would be the fastest swimmer?',
  'Who would win at table tennis?',
  'Who would be the best snowboarder?',
  'Who would be the best at parkour?',
  'Who would win a skateboarding competition?',
  'Who would make the best esports pro?',
  'Who would be the best at archery?',
  'Who would be the best golfer?',
  'Who would win at bowling?',
  'Who would dominate in a game of dodgeball?',
  'Who would win a 100m sprint?',
  'Who would be the best weightlifter?',
  'Who would be the best rock climber?',
  'Who would be the best Formula 1 driver?',
  'Who would win at darts?',
  'Who would be the best tennis player?',
  'Who would be the best at Olympic gymnastics?',
  'Who would win a cycling race?',
  'Who would be the best at fencing?',
  'Who would win a beach volleyball tournament?',

  // --- Fun Activities ---
  'Who would enjoy skydiving the most?',
  'Who would have the most fun at an escape room?',
  'Who would be the best at cooking ramen from scratch?',
  'Who would enjoy a silent retreat the most?',
  'Who would be the best at improv comedy?',
  'Who would be most likely to try bungee jumping?',
  'Who would enjoy a mud run obstacle course the most?',
  'Who would be the best at pottery?',
  'Who would be most likely to take up extreme camping?',
  'Who would be best at stand-up comedy?',
  'Who would enjoy a 48-hour gaming marathon the most?',
  'Who would be the best chef on a campfire?',
  'Who would be most likely to go cliff diving?',
  'Who would be the best at escape rooms?',
  'Who would enjoy karaoke the most?',
  'Who would be best at a hackathon?',
  'Who would enjoy whale watching the most?',
  'Who would be the best at axe throwing?',
  'Who would be most likely to try wing-suit flying?',
  'Who would enjoy a haunted house tour the most?',
  'Who would enjoy a wine tasting the most?',
  'Who would be best at learning a new language in 30 days?',
  'Who would be best at learning a new instrument quickly?',

  // --- Leadership / Work ---
  'Who would make the best president?',
  'Who would make the worst boss at work?',
  'Who would be the best CEO?',
  'Who would make the best prime minister?',
  'Who would make the worst politician?',
  'Who would make the best military general?',
  'Who would make the best firefighter?',
  'Who would make the best doctor in an emergency?',
  'Who would make the best lawyer?',
  'Who would make the best teacher?',
  'Who would make the best scientist?',
  'Who would make the best space mission commander?',
  'Who would make the best detective?',
  'Who would make the best superhero?',
  'Who would make the best game show host?',
  'Who would make the best motivational speaker?',
  'Who would make the best reality TV star?',
  'Who would make the best talk show host?',
  'Who would make the best life coach?',
  'Who would make the best personal trainer?',

  // --- Hypotheticals / Absurd ---
  'Who would win if they could only fight using pool noodles?',
  'Who would eat the weirdest thing for $100?',
  'Who would be most likely to accidentally befriend a criminal?',
  'Who would survive 24 hours in IKEA?',
  'Who would be first to panic during turbulence on a flight?',
  'Who would be most likely to accidentally go viral online?',
  'Who would last longest eating only gas station food?',
  'Who would be most likely to get stuck in an elevator?',
  'Who would win in a watergun fight?',
  'Who would be most likely to challenge a seagull to a fight?',
  'Who would be most likely to accidentally lock themselves out of their car?',
  'Who would eat the most cereal in one sitting?',
  'Who would survive 30 days with only $5 a day?',
  'Who would be most likely to talk to plants?',
  'Who would be most likely to name their Roomba?',
  'Who would be most likely to show up to a black-tie event in shorts?',
  'Who would be most likely to adopt 5 stray cats on impulse?',
  'Who would be most likely to start an argument on an airplane?',
  'Who would be most likely to lose their passport 10 minutes before a flight?',
  'Who would be first to panic during a power outage?',
  'Who would last longest in a silent monastery?',
  'Who would be most likely to get into a speedrun competition by accident?',
  'Who would be most likely to challenge a vending machine when it ate their money?',
  'Who would survive a night in an IKEA warehouse?',
  'Who would be most likely to accidentally join a flash mob?',
  'Who would have the most fun at an anime convention?',

  // --- Food & Eating ---
  'Who would be the best chef in a professional kitchen?',
  'Who would eat the spiciest dish without flinching?',
  'Who would try the weirdest food combination?',
  'Who would survive on instant ramen the longest?',
  'Who would win a sushi-making competition?',
  'Who would eat the most pizza in one sitting?',
  'Who would be most likely to become a food critic?',
  'Who would make the best BBQ host?',
  'Who would survive a week as a vegan?',
  'Who would enjoy a Michelin-star restaurant the most?',

  // --- Camping / Outdoors ---
  'Who would pitch a tent the fastest?',
  'Who would be most likely to get lost on a hike?',
  'Who would complain most on a camping trip?',
  'Who would start a campfire without matches first?',
  'Who would be most likely to befriend local wildlife?',
  'Who would do best on a solo camping trip?',
  'Who would enjoy stargazing in the desert the most?',
  'Who would survive a week off-grid in a cabin?',

  // --- Pop culture / Media ---
  'Who would win a TikTok follower race?',
  'Who would get the most subscribers on YouTube in 1 month?',
  'Who would have the best podcast?',
  'Who would get the most retweets in one day?',
  'Who would write the best-selling memoir?',
  'Who would be the best at Wordle?',
  'Who would be most likely to start the next viral trend?',
  'Who would be the most quoted person at a party?',
];

// ---------------------------------------------------------------------------
// General polls — option POOLS (randomised per question) + question templates
// ---------------------------------------------------------------------------

type PollCategory =
  | 'country'
  | 'city'
  | 'sport'
  | 'extreme_sport'
  | 'esport'
  | 'hobby'
  | 'outdoor_activity'
  | 'cuisine'
  | 'fast_food'
  | 'dessert'
  | 'drink'
  | 'streaming_category'
  | 'streaming_setup'
  | 'superpower'
  | 'fictional_universe'
  | 'era'
  | 'planet'
  | 'vehicle'
  | 'skill'
  | 'animal'
  | 'language';

/** Large randomisable option pools — 5 items are picked at random per poll. */
const OPTION_POOLS: Record<PollCategory, readonly string[]> = {
  country: [
    'Japan', 'Thailand', 'Iceland', 'Portugal', 'Norway', 'New Zealand', 'Colombia', 'Peru',
    'South Korea', 'Vietnam', 'Taiwan', 'Brazil', 'Argentina', 'Turkey', 'Morocco', 'Georgia',
    'Croatia', 'Greece', 'Italy', 'Spain', 'Netherlands', 'Scotland', 'Ireland', 'Canada',
    'Australia', 'Mexico', 'Indonesia', 'Malaysia', 'Philippines', 'Singapore', 'UAE',
    'South Africa', 'Kenya', 'India', 'Nepal', 'Bolivia', 'Chile', 'Serbia', 'Hungary',
    'Czech Republic', 'Poland', 'Kyrgyzstan', 'Armenia', 'Albania', 'Montenegro', 'Ethiopia',
    'Tanzania', 'Oman', 'Jordan', 'Sri Lanka', 'Ecuador', 'Slovakia', 'Slovenia', 'Romania',
    'Bulgaria', 'Finland', 'Denmark', 'Sweden', 'Switzerland', 'Austria', 'Belgium',
  ],
  city: [
    'Tokyo', 'Bangkok', 'Lisbon', 'Barcelona', 'Istanbul', 'Medellín', 'Seoul', 'Taipei',
    'Ho Chi Minh City', 'Chiang Mai', 'Cape Town', 'Buenos Aires', 'Mexico City', 'Amsterdam',
    'Prague', 'Tbilisi', 'Yerevan', 'Sarajevo', 'Sofia', 'Tashkent', 'Bishkek', 'Kathmandu',
    'New York', 'San Francisco', 'London', 'Berlin', 'Melbourne', 'Sydney', 'Kuala Lumpur',
    'Singapore', 'Dubai', 'Marrakech', 'Nairobi', 'Bali', 'Kyoto', 'Osaka', 'Porto',
    'Athens', 'Budapest', 'Vienna', 'Copenhagen', 'Stockholm', 'Helsinki', 'Warsaw',
    'Kraków', 'Bucharest', 'Belgrade', 'Tirana', 'Kotor', 'Tbilisi', 'Almaty', 'Baku',
    'Lima', 'Bogotá', 'Cartagena', 'Montevideo', 'Reykjavik', 'Valletta', 'Nicosia',
    'Wellington', 'Auckland', 'Queenstown', 'Edinburgh', 'Dublin', 'Bruges', 'Valencia',
  ],
  sport: [
    'Football', 'Basketball', 'Tennis', 'MMA', 'Formula 1', 'Surfing', 'Snowboarding',
    'Skateboarding', 'Rock climbing', 'Cycling', 'Gymnastics', 'Boxing', 'Judo', 'Swimming',
    'Athletics', 'Volleyball', 'Table tennis', 'Badminton', 'Golf', 'Cricket', 'Rugby',
    'Archery', 'Fencing', 'Weightlifting', 'Triathlon', 'Parkour', 'Darts', 'Bowling',
    'Baseball', 'American Football', 'Ice hockey', 'Curling', 'Rowing', 'Sailing',
    'Handball', 'Water polo', 'Wrestling', 'Muay Thai', 'Capoeira', 'Kabaddi',
  ],
  extreme_sport: [
    'Skydiving', 'Bungee jumping', 'Base jumping', 'Wingsuit flying', 'Cliff diving',
    'Paragliding', 'Kitesurfing', 'White water rafting', 'Canyoning', 'Highlining',
    'Free solo climbing', 'Big wave surfing', 'Motocross', 'BMX', 'Downhill mountain biking',
    'Freediving', 'Ice climbing', 'Speed skiing', 'Zorbing', 'Volcano boarding',
  ],
  esport: [
    'League of Legends', 'CS2', 'Valorant', 'Dota 2', 'Street Fighter', 'Overwatch',
    'Rocket League', 'PUBG', 'Fortnite', 'Apex Legends', 'Starcraft II', 'Smash Bros',
    'Tekken', 'FIFA', 'Rainbow Six Siege', 'Hearthstone', 'Magic: The Gathering',
  ],
  hobby: [
    'Gaming', 'Hiking', 'Cooking', 'Reading', 'Travelling', 'Photography', 'Music',
    'Drawing', 'Writing', 'Filmmaking', 'Coding', 'Language learning', 'Martial arts',
    'Yoga', 'Meditation', 'Gardening', 'Cycling', 'Rock climbing', 'Dancing', 'Singing',
    'Podcasting', 'Woodworking', 'Pottery', 'Stand-up comedy', 'Volunteering',
    'Astronomy', 'Birdwatching', 'Painting', 'Sculpting', 'Origami', 'Knitting',
    'Skateboarding', 'Surfing', 'Running', 'Weightlifting', 'Swimming', 'Chess',
    'Collecting vinyl', 'Journalling', 'Scrapbooking', 'Calligraphy', 'Cosplay',
  ],
  outdoor_activity: [
    'Hiking', 'Camping', 'Cycling', 'Surfing', 'Rock climbing', 'Kayaking', 'Skiing',
    'Snowboarding', 'Mountain biking', 'Paragliding', 'Scuba diving', 'Snorkelling',
    'Wild swimming', 'Trail running', 'Backpacking', 'Foraging', 'Fishing', 'Hunting',
    'Bouldering', 'Canyoning', 'Via ferrata', 'Horse riding', 'Zip-lining', 'Axe throwing',
  ],
  cuisine: [
    'Japanese', 'Italian', 'Mexican', 'Indian', 'Thai', 'Chinese', 'French', 'Spanish',
    'Turkish', 'Lebanese', 'Greek', 'Korean', 'Vietnamese', 'Peruvian', 'Ethiopian',
    'Moroccan', 'Brazilian', 'Georgian', 'Indonesian', 'American BBQ', 'Portuguese',
    'Argentinian', 'Israeli', 'Egyptian', 'Cambodian', 'Singaporean', 'Malaysian',
  ],
  fast_food: [
    'Tacos', 'Ramen', 'Pizza', 'Burgers', 'Kebabs', 'Sushi', 'Pho', 'Burritos',
    'Pad Thai', 'Falafel', 'Dumplings', 'Shawarma', 'Empanadas', 'Bánh mì', 'Hot dogs',
    'Fried chicken', 'Fish and chips', 'Noodle soup', 'Satay', 'Currywurst',
  ],
  dessert: [
    'Ice cream', 'Tiramisu', 'Churros', 'Mochi', 'Cheesecake', 'Crème brûlée', 'Baklava',
    'Macarons', 'Pavlova', 'Profiteroles', 'Gelato', 'Tres leches', 'Mango sticky rice',
    'Gulab jamun', 'Waffle', 'Crepe', 'Sfenj', 'Knafeh', 'Tarte tatin', 'Panna cotta',
  ],
  drink: [
    'Iced coffee', 'Bubble tea', 'Coconut water', 'Lemonade', 'Matcha latte', 'Smoothie',
    'Fresh juice', 'Kombucha', 'Chai latte', 'Cold brew', 'Horchata', 'Agua fresca',
    'Lassi', 'Teh tarik', 'Calamansi juice', 'Tamarind water', 'Rose water drink',
  ],
  streaming_category: [
    'IRL travel', 'Gaming', 'Just chatting', 'Cooking', 'Fitness', 'Music', 'Art',
    'Outdoor adventure', 'Food touring', 'Tech and coding', 'Q&A', 'Debate streams',
    'Language learning', 'Sports commentary', 'Reaction streams',
  ],
  streaming_setup: [
    'Good mic', 'Fast internet', 'Good camera', 'Lighting', 'Green screen',
    'Dual monitors', 'Stream deck', 'Capture card', 'Noise cancellation', 'Mobile rig',
    'Wide-angle lens', 'Stabiliser/gimbal', 'Portable battery', 'Wireless earpiece',
  ],
  superpower: [
    'Teleportation', 'Invisibility', 'Time travel', 'Mind reading', 'Flying',
    'Super strength', 'Healing factor', 'Shapeshifting', 'Telekinesis', 'Precognition',
    'Breathe underwater', 'Control weather', 'Speak all languages', 'Never need sleep',
    'Photographic memory',
  ],
  fictional_universe: [
    'Star Wars', 'Harry Potter', 'Marvel', 'Lord of the Rings', 'Avatar', 'Dune',
    'The Matrix', 'Naruto', 'One Piece', 'Attack on Titan', 'Dragon Ball', 'Pokémon',
    'The Witcher', 'Game of Thrones', 'Blade Runner', 'Mass Effect', 'The Expanse',
  ],
  era: [
    'Ancient Egypt', 'Ancient Rome', 'Medieval Europe', 'The Renaissance', '1920s',
    '1950s', '1980s', '1990s', 'Present day', 'Near future (2050)', 'Far future',
    'The Viking Age', 'Feudal Japan', 'Wild West', 'Roaring Twenties',
  ],
  planet: [
    'Mars', 'Europa', 'Titan', 'The Moon', 'Ganymede', 'Enceladus', 'Callisto',
    'A terraformed Venus', 'Proxima b', 'Kepler-452b',
  ],
  vehicle: [
    'Campervan', 'Motorcycle', 'Sailboat', '4WD truck', 'Bicycle', 'Sports car',
    'Vintage VW bus', 'Tuk-tuk', 'Electric scooter', 'Houseboat', 'Amphibious car',
    'Helicopter', 'Seaplane', 'Horse', 'Hot air balloon',
  ],
  skill: [
    'Coding', 'Cooking', 'First aid', 'A second language', 'Driving', 'Woodworking',
    'Investing', 'Public speaking', 'Speed reading', 'Lockpicking', 'Navigation',
    'Medical knowledge', 'Martial arts', 'Negotiation', 'Electrical wiring',
  ],
  animal: [
    'Dog', 'Cat', 'Parrot', 'Tortoise', 'Rabbit', 'Ferret', 'Capybara', 'Fox',
    'Hedgehog', 'Axolotl', 'Miniature pig', 'Crow', 'Otter', 'Monkey', 'Fennec fox',
  ],
  language: [
    'Japanese', 'Spanish', 'Mandarin', 'Arabic', 'French', 'Portuguese', 'Korean',
    'German', 'Russian', 'Italian', 'Hindi', 'Swahili', 'Turkish', 'Dutch', 'Greek',
    'Thai', 'Vietnamese', 'Polish', 'Indonesian', 'Tagalog',
  ],
};

interface GeneralPollTemplate {
  question: string;
  category: PollCategory;
}

const GENERAL_POLL_TEMPLATES: readonly GeneralPollTemplate[] = [
  // Countries
  { question: 'Which country should we visit next?', category: 'country' },
  { question: 'Best country for an IRL stream?', category: 'country' },
  { question: 'Which country has the best food scene?', category: 'country' },
  { question: 'Best country for solo travel?', category: 'country' },
  { question: 'Which country has the best street food?', category: 'country' },
  { question: 'Which country has the best nightlife?', category: 'country' },
  { question: 'Most beautiful country for outdoor scenery?', category: 'country' },
  { question: 'Best country for an adventure trip?', category: 'country' },
  { question: 'Best country for a budget trip?', category: 'country' },
  { question: 'Most underrated country to visit?', category: 'country' },
  { question: 'Best country for beach holidays?', category: 'country' },
  { question: 'Best country for learning about history?', category: 'country' },
  { question: 'Which country has the most unique culture?', category: 'country' },
  { question: 'Best country to live in?', category: 'country' },
  { question: 'Which country has the best weather?', category: 'country' },
  { question: 'Best country for a family trip?', category: 'country' },
  { question: 'Which country would you move to if you had to leave home?', category: 'country' },
  { question: 'Best country for hiking and outdoor adventures?', category: 'country' },
  { question: 'Which country has the friendliest locals?', category: 'country' },
  { question: 'Best country for a honeymoon?', category: 'country' },
  // Cities
  { question: 'Best city for an IRL stream?', category: 'city' },
  { question: 'Which city should we explore next?', category: 'city' },
  { question: 'Best city for street food?', category: 'city' },
  { question: 'Which city has the best nightlife?', category: 'city' },
  { question: 'Most beautiful city in the world?', category: 'city' },
  { question: 'Best city for a solo backpacker?', category: 'city' },
  { question: 'Most underrated city to visit?', category: 'city' },
  { question: 'Best city to live in?', category: 'city' },
  { question: 'Which city has the most amazing food scene?', category: 'city' },
  { question: 'Best city for a long-term stay?', category: 'city' },
  { question: 'Which city has the best architecture?', category: 'city' },
  { question: 'Best city for a weekend trip?', category: 'city' },
  // Sports
  { question: "What's the best sport to watch live?", category: 'sport' },
  { question: "What's the most exciting sport overall?", category: 'sport' },
  { question: 'Best sport to play casually?', category: 'sport' },
  { question: 'Most underrated sport?', category: 'sport' },
  { question: 'Which sport requires the most skill?', category: 'sport' },
  { question: 'Best sport to learn as an adult?', category: 'sport' },
  { question: 'Most fun sport to play with friends?', category: 'sport' },
  { question: 'Best sport for fitness?', category: 'sport' },
  { question: 'Best extreme sport to try?', category: 'extreme_sport' },
  { question: 'Which extreme sport would you try first?', category: 'extreme_sport' },
  { question: 'Most terrifying extreme sport?', category: 'extreme_sport' },
  { question: 'Best esport to watch?', category: 'esport' },
  { question: 'Best esport to play competitively?', category: 'esport' },
  // Hobbies
  { question: "What's your favourite hobby?", category: 'hobby' },
  { question: 'Best hobby to pick up this year?', category: 'hobby' },
  { question: 'Best creative hobby?', category: 'hobby' },
  { question: 'Best hobby for stress relief?', category: 'hobby' },
  { question: 'Best solo hobby?', category: 'hobby' },
  { question: 'Best hobby for meeting new people?', category: 'hobby' },
  { question: 'Most satisfying hobby to master?', category: 'hobby' },
  { question: 'Best outdoor activity?', category: 'outdoor_activity' },
  { question: 'Best outdoor adventure for beginners?', category: 'outdoor_activity' },
  { question: 'Best activity for a sunny day?', category: 'outdoor_activity' },
  { question: 'Best activity to try on a trip abroad?', category: 'outdoor_activity' },
  // Food
  { question: 'Best cuisine in the world?', category: 'cuisine' },
  { question: 'Most underrated cuisine?', category: 'cuisine' },
  { question: 'Best cuisine for vegetarians?', category: 'cuisine' },
  { question: 'Which cuisine would you eat every day?', category: 'cuisine' },
  { question: 'Best fast food globally?', category: 'fast_food' },
  { question: 'Best street food dish?', category: 'fast_food' },
  { question: "What's the ultimate comfort food?", category: 'fast_food' },
  { question: 'Best dessert in the world?', category: 'dessert' },
  { question: "What's the most satisfying sweet treat?", category: 'dessert' },
  { question: 'Best drink for a hot day?', category: 'drink' },
  { question: 'Best non-alcoholic drink?', category: 'drink' },
  // Streaming
  { question: 'Best type of stream to watch?', category: 'streaming_category' },
  { question: 'Most entertaining stream category?', category: 'streaming_category' },
  { question: 'Best stream format for growing an audience?', category: 'streaming_category' },
  { question: 'Best streaming setup essential?', category: 'streaming_setup' },
  { question: 'Most important piece of streaming gear?', category: 'streaming_setup' },
  { question: 'What would you upgrade first in a streaming setup?', category: 'streaming_setup' },
  // Hypotheticals / fun
  { question: 'Best superpower to have?', category: 'superpower' },
  { question: 'Which superpower would be most useful in daily life?', category: 'superpower' },
  { question: 'Best fictional universe to live in?', category: 'fictional_universe' },
  { question: 'Which fictional universe would you survive the longest in?', category: 'fictional_universe' },
  { question: 'Best era in history to live in?', category: 'era' },
  { question: 'Which era would you visit for one week?', category: 'era' },
  { question: 'Best planet to colonise after Earth?', category: 'planet' },
  { question: 'Best vehicle for a cross-country adventure?', category: 'vehicle' },
  { question: 'Which vehicle would you use to travel the world?', category: 'vehicle' },
  { question: "What's the most useful skill to have?", category: 'skill' },
  { question: 'Best skill to learn for survival?', category: 'skill' },
  { question: 'Best animal to have as a pet?', category: 'animal' },
  { question: 'Which exotic animal would you have as a pet?', category: 'animal' },
  { question: 'Best language to learn?', category: 'language' },
  { question: 'Most useful language to learn for travel?', category: 'language' },
  { question: 'Which language sounds the coolest?', category: 'language' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick `count` distinct random items from an array. */
function pickRandom<T>(arr: T[], count: number): T[] {
  const out: T[] = [];
  const pool = [...arr];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * Generate a random streamer poll question with 5 randomly chosen boss names as options.
 * @param bossNames - Full list of boss/streamer names (passed in to avoid circular imports).
 */
export function generateStreamerPoll(bossNames: string[]): { question: string; options: PollOption[] } {
  const question = STREAMER_POLL_QUESTIONS[Math.floor(Math.random() * STREAMER_POLL_QUESTIONS.length)];
  const names = pickRandom(bossNames, Math.min(5, bossNames.length));
  const options: PollOption[] = names.map(name => ({ label: name, votes: 0, voters: {} }));
  return { question, options };
}

/**
 * Generate a random general poll (countries, cities, sports, hobbies, etc.).
 * Options are picked at random from the matching pool — different every time.
 */
export function generateGeneralPoll(): { question: string; options: PollOption[] } {
  const template = GENERAL_POLL_TEMPLATES[Math.floor(Math.random() * GENERAL_POLL_TEMPLATES.length)];
  const pool = OPTION_POOLS[template.category];
  const picked = pickRandom(pool as string[], Math.min(5, pool.length));
  const options: PollOption[] = picked.map(label => ({ label, votes: 0, voters: {} }));
  return { question: template.question, options };
}

/**
 * Generate an auto poll — randomly picks either a streamer poll or a general poll (50/50).
 * @param bossNames - Full list of boss/streamer names.
 */
export function generateAutoPoll(bossNames: string[]): { question: string; options: PollOption[] } {
  return Math.random() < 0.5
    ? generateStreamerPoll(bossNames)
    : generateGeneralPoll();
}
