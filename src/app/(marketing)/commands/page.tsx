import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Commands — Tazo',
  description: "All chat commands, games, and the credit system for Tazo's stream.",
};

interface CommandEntry {
  cmd: string;
  aliases?: string[];
  desc: string;
  example?: string;
}

interface Section {
  title: string;
  emoji: string;
  commands: CommandEntry[];
}

const sections: Section[] = [
  {
    title: 'Info & Stats',
    emoji: '📊',
    commands: [
      { cmd: '!ping', desc: 'Check if the bot is responding.' },
      { cmd: '!uptime', aliases: ['!up'], desc: 'How long the stream has been live.' },
      { cmd: '!downtime', aliases: ['!down'], desc: 'Time since the last stream.' },
      { cmd: '!followers', desc: 'Current follower count.' },
      { cmd: '!heartrate', aliases: ['!hr'], desc: "Tazo's live heart rate (BPM)." },
      { cmd: '!steps', desc: 'Steps taken today.' },
      { cmd: '!distance', aliases: ['!dist'], desc: 'Distance walked today.' },
      { cmd: '!wellness', desc: 'Full wellness summary — steps, distance, heart rate.' },
      { cmd: '!speed', desc: 'Current GPS speed.' },
      { cmd: '!altitude', aliases: ['!elevation'], desc: 'Current elevation.' },
    ],
  },
  {
    title: 'Location & Weather',
    emoji: '🌍',
    commands: [
      { cmd: '!location', desc: 'Current city or area.' },
      { cmd: '!map', desc: 'Link to the live map.' },
      { cmd: '!time', desc: 'Local time at current location.' },
      { cmd: '!weather', desc: 'Current weather conditions including temp, wind, and humidity.' },
      { cmd: '!temp <value> [c/f]', aliases: ['!temperature'], desc: 'Convert between Celsius and Fahrenheit.', example: '!temp 25c  or  !temp 77f' },
      { cmd: '!sun', desc: 'Sunrise and sunset times with countdown.' },
      { cmd: '!moon', desc: 'Current moon phase and illumination percentage.' },
    ],
  },
  {
    title: 'Social Links',
    emoji: '🔗',
    commands: [
      { cmd: '!instagram', aliases: ['!ig'], desc: "Tazo's Instagram link." },
      { cmd: '!tiktok', desc: "Tazo's TikTok link." },
      { cmd: '!youtube', aliases: ['!yt'], desc: "Tazo's YouTube channel." },
      { cmd: '!twitter', aliases: ['!x'], desc: "Tazo's Twitter/X link." },
      { cmd: '!discord', desc: 'Join the Discord server.' },
      { cmd: '!kick', desc: "Tazo's Kick profile link." },
      { cmd: '!rumble', desc: "Tazo's Rumble channel." },
      { cmd: '!twitch', desc: "Tazo's Twitch channel." },
      { cmd: '!parti', desc: "Tazo's Parti link." },
      { cmd: '!dlive', desc: "Tazo's DLive channel." },
      { cmd: '!onlyfans', aliases: ['!of'], desc: "Tazo's OnlyFans link." },
      { cmd: '!shoutout <username>', aliases: ['!so <username>'], desc: 'Give a shoutout with a Kick profile link.', example: '!so coolstreamer' },
    ],
  },
  {
    title: 'Travel & Culture',
    emoji: '✈️',
    commands: [
      { cmd: '!food [country]', desc: 'Local foods for the current country or a specified one.', example: '!food JP' },
      { cmd: '!phrase [country]', desc: 'Useful local phrases with translations.', example: '!phrase KR' },
      { cmd: '!emergency [country]', desc: 'Emergency phone numbers for the current or specified country.', example: '!emergency AU' },
      { cmd: '!flirt [country]', desc: 'Local flirty phrases.', example: '!flirt FR' },
      { cmd: '!insults [country]', aliases: ['!insult'], desc: 'Local insults (for fun).', example: '!insults DE' },
      { cmd: '!currency [country]', desc: 'Local currency name, symbol, and code.', example: '!currency TH' },
      { cmd: '!fact [country]', aliases: ['!facts'], desc: 'Random fun fact about the current or specified country.', example: '!fact JP' },
      { cmd: '!countries', desc: 'List all countries with travel data available.' },
    ],
  },
  {
    title: 'Size Ranking',
    emoji: '📏',
    commands: [
      { cmd: '!inch <length> [girth]', desc: 'Submit measurements in inches and see how you rank.', example: '!inch 6 5' },
      { cmd: '!cm <length> [girth]', desc: 'Submit measurements in centimetres and see how you rank.', example: '!cm 15 12' },
    ],
  },
  {
    title: 'Challenges',
    emoji: '🏆',
    commands: [
      { cmd: '!challenge', aliases: ['!ch'], desc: 'View active challenges and their bounties.' },
      { cmd: '!challenge steps', aliases: ['!ch steps'], desc: 'Add a random step-count challenge (easy/medium/hard tiers).' },
      { cmd: '!challenge fitness', aliases: ['!ch fitness'], desc: 'Add a random fitness challenge (push-ups, squats, etc.).' },
      { cmd: '!challenge social', aliases: ['!ch social'], desc: 'Add a random social media challenge.' },
      { cmd: '!goal', desc: 'View the current step goal and progress.' },
    ],
  },
  {
    title: 'Fun & Games',
    emoji: '🎲',
    commands: [
      { cmd: '!8ball <question>', aliases: ['!magic8ball'], desc: 'Ask the magic 8 ball a question.', example: '!8ball Will I win today?' },
      { cmd: '!coin', aliases: ['!flip'], desc: 'Flip a coin — Heads or Tails.' },
      { cmd: '!dice [sides] [count]', aliases: ['!roll'], desc: 'Roll dice. Defaults to 1d6.', example: '!dice 20  or  !roll 6 3' },
      { cmd: '!random [min max]', desc: 'Pick a random number. Defaults to 1–100.', example: '!random 50  or  !random 1 1000' },
      { cmd: '!moon', desc: 'Current moon phase.' },
    ],
  },
  {
    title: 'Credits & Blackjack',
    emoji: '🃏',
    commands: [
      { cmd: '!credits', desc: 'Check your credit balance.' },
      { cmd: '!credits [username]', desc: "Check someone else's balance." },
      { cmd: '!leaderboard', aliases: ['!lb', '!top'], desc: 'Top 10 credit holders.' },
      { cmd: '!give [username] [amount]', desc: 'Give credits to another viewer.' },
      { cmd: '!deal [amount]', aliases: ['!bj [amount]'], desc: 'Start a blackjack game and bet credits.' },
      { cmd: '!hit', desc: 'Take another card in blackjack.' },
      { cmd: '!stand', desc: 'Stand (keep your hand) in blackjack.' },
      { cmd: '!double', desc: 'Double down in blackjack.' },
      { cmd: '!split', desc: 'Split your hand in blackjack.' },
    ],
  },
];

const sectionColors: Record<string, { border: string; badge: string; pill: string }> = {
  'Info & Stats': {
    border: 'border-l-sky-500',
    badge: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    pill: 'bg-sky-500/10 border-sky-500/20',
  },
  'Location & Weather': {
    border: 'border-l-teal-500',
    badge: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    pill: 'bg-teal-500/10 border-teal-500/20',
  },
  'Social Links': {
    border: 'border-l-pink-500',
    badge: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    pill: 'bg-pink-500/10 border-pink-500/20',
  },
  'Travel & Culture': {
    border: 'border-l-orange-500',
    badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    pill: 'bg-orange-500/10 border-orange-500/20',
  },
  'Size Ranking': {
    border: 'border-l-purple-500',
    badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    pill: 'bg-purple-500/10 border-purple-500/20',
  },
  'Challenges': {
    border: 'border-l-yellow-500',
    badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    pill: 'bg-yellow-500/10 border-yellow-500/20',
  },
  'Fun & Games': {
    border: 'border-l-violet-500',
    badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    pill: 'bg-violet-500/10 border-violet-500/20',
  },
  'Credits & Blackjack': {
    border: 'border-l-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    pill: 'bg-emerald-500/10 border-emerald-500/20',
  },
};

function CommandRow({ entry }: { entry: CommandEntry }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors">
      <div className="flex flex-wrap items-center gap-1.5 shrink-0 sm:w-56">
        <code className="inline-block bg-zinc-800 text-emerald-400 text-sm font-mono font-semibold px-2.5 py-1 rounded-md border border-emerald-500/20">
          {entry.cmd}
        </code>
        {entry.aliases?.map((alias) => (
          <code
            key={alias}
            className="inline-block bg-zinc-800/60 text-zinc-500 text-xs font-mono px-2 py-0.5 rounded border border-zinc-700/60"
          >
            {alias}
          </code>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-zinc-300 text-sm leading-relaxed">{entry.desc}</p>
        {entry.example && (
          <p className="text-zinc-600 text-xs mt-1.5">
            e.g.{' '}
            <code className="text-zinc-500 font-mono bg-zinc-800/60 px-1.5 py-0.5 rounded">
              {entry.example}
            </code>
          </p>
        )}
      </div>
    </div>
  );
}

export default function CommandsPage() {
  return (
    <div className="max-w-screen-md mx-auto px-4 py-12 text-zinc-200">
      {/* Hero header */}
      <div className="mb-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-widest mb-5">
          Chat Bot
        </div>
        <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
          Chat Commands
        </h1>
        <p className="text-zinc-400 text-lg max-w-sm mx-auto">
          All commands available in Tazo&apos;s Kick chat. Type any command while the stream is live.
        </p>
      </div>

      {/* Command sections */}
      <div className="space-y-10">
        {sections.map((section) => {
          const colors = sectionColors[section.title] ?? sectionColors['Info & Stats'];
          return (
            <section key={section.title}>
              <div className={`flex items-center gap-3 mb-4 pl-4 border-l-4 ${colors.border}`}>
                <span className="text-2xl" aria-hidden="true">{section.emoji}</span>
                <h2 className="text-xl font-bold text-white">{section.title}</h2>
                <span className={`ml-auto text-xs font-semibold px-2.5 py-0.5 rounded-full border ${colors.badge}`}>
                  {section.commands.length} commands
                </span>
              </div>
              <div className="space-y-2">
                {section.commands.map((entry) => (
                  <CommandRow key={entry.cmd} entry={entry} />
                ))}
              </div>
            </section>
          );
        })}

        {/* Earning Credits callout */}
        <section>
          <div className="flex items-center gap-3 mb-4 pl-4 border-l-4 border-l-yellow-500">
            <span className="text-2xl" aria-hidden="true">💰</span>
            <h2 className="text-xl font-bold text-white">Earning Credits</h2>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 to-zinc-900/60 overflow-hidden">
            <div className="p-6 border-b border-emerald-500/10">
              <p className="text-zinc-300 text-sm leading-relaxed">
                Credits are the in-chat currency for Tazo&apos;s stream. Earn them by supporting the stream,
                then use them to play blackjack with{' '}
                <code className="inline-block bg-zinc-800 text-emerald-400 text-xs font-mono px-2 py-0.5 rounded border border-emerald-500/20">
                  !deal
                </code>{' '}
                or give them away with{' '}
                <code className="inline-block bg-zinc-800 text-emerald-400 text-xs font-mono px-2 py-0.5 rounded border border-emerald-500/20">
                  !give
                </code>.
              </p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { event: 'New subscription', credits: '+100 credits' },
                  { event: 'Resub', credits: '+100 credits' },
                  { event: 'Gift a sub', credits: '+100 credits' },
                  { event: 'Kicks gifted', credits: 'Credits vary by amount' },
                  { event: 'Channel rewards', credits: 'Top up via reward redemptions' },
                ].map((row) => (
                  <div
                    key={row.event}
                    className="flex items-center justify-between gap-2 p-3 rounded-lg bg-white/[0.03] border border-white/5"
                  >
                    <span className="text-zinc-300 text-sm">{row.event}</span>
                    <span className="text-emerald-400 text-sm font-semibold whitespace-nowrap">{row.credits}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center space-y-3">
        <p className="text-zinc-600 text-sm">
          Commands may change — check chat for the latest. Some commands require the stream to be live.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap text-sm">
          <Link href="/me" className="text-emerald-500 hover:text-emerald-400 transition-colors font-medium">
            Check your balance →
          </Link>
          <Link href="/leaderboard" className="text-emerald-500 hover:text-emerald-400 transition-colors font-medium">
            View leaderboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
