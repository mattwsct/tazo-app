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
      { cmd: '!time', desc: 'Local time at the current location.' },
      { cmd: '!weather', desc: 'Current weather conditions.' },
      { cmd: '!temp', aliases: ['!temperature'], desc: 'Current temperature.' },
      { cmd: '!forecast', desc: 'Weather forecast for the next few days.' },
      { cmd: '!uv', desc: 'UV index at the current location.' },
      { cmd: '!aqi', desc: 'Air quality index.' },
    ],
  },
  {
    title: 'Fun & Utility',
    emoji: '🎲',
    commands: [
      { cmd: '!convert', desc: 'Unit or currency conversion.', example: '!convert 100 usd jpy' },
      { cmd: '!math', aliases: ['!calc'], desc: 'Calculator.', example: '!calc 15 * 8' },
      { cmd: '!8ball', desc: 'Ask the magic 8 ball a question.', example: '!8ball Will I win today?' },
      { cmd: '!coin', aliases: ['!flip'], desc: 'Flip a coin.' },
      { cmd: '!dice', aliases: ['!roll'], desc: 'Roll a dice.' },
      { cmd: '!fact', aliases: ['!facts'], desc: 'Get a random fun fact.' },
    ],
  },
  {
    title: 'Credits & Games',
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
  'Fun & Utility': {
    border: 'border-l-violet-500',
    badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    pill: 'bg-violet-500/10 border-violet-500/20',
  },
  'Credits & Games': {
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
                  { event: 'Resub', credits: '+50 credits' },
                  { event: 'Gift a sub', credits: '+75 credits per sub' },
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
        <p className="text-zinc-500 text-sm">
          Check your balance at{' '}
          <Link href="/dashboard" className="text-emerald-500 hover:text-emerald-400 transition-colors font-medium">
            tazo.wtf/dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
