import type { Metadata } from 'next';

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

function CommandPill({ text, variant = 'primary' }: { text: string; variant?: 'primary' | 'secondary' }) {
  if (variant === 'secondary') {
    return (
      <code className="inline-block bg-zinc-800 text-zinc-400 text-xs font-mono px-2 py-0.5 rounded border border-zinc-700">
        {text}
      </code>
    );
  }
  return (
    <code className="inline-block bg-zinc-800 text-emerald-400 text-sm font-mono font-semibold px-2.5 py-1 rounded-md border border-zinc-700">
      {text}
    </code>
  );
}

export default function CommandsPage() {
  return (
    <div className="max-w-screen-md mx-auto px-4 py-12 text-zinc-200">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-bold text-white mb-3">Chat Commands</h1>
        <p className="text-zinc-400 text-lg">
          All commands available in Tazo&apos;s chat on Kick. Type any command in chat while the stream is live.
        </p>
      </div>

      {/* Command sections */}
      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-white mb-4 pb-2 border-b border-zinc-800">
              <span>{section.emoji}</span>
              <span>{section.title}</span>
            </h2>
            <div className="space-y-3">
              {section.commands.map((entry) => (
                <div
                  key={entry.cmd}
                  className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/60 hover:border-zinc-700/80 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <CommandPill text={entry.cmd} />
                    {entry.aliases?.map((alias) => (
                      <CommandPill key={alias} text={alias} variant="secondary" />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-300 text-sm">{entry.desc}</p>
                    {entry.example && (
                      <p className="text-zinc-500 text-xs mt-1">
                        e.g.{' '}
                        <code className="text-zinc-400 font-mono">{entry.example}</code>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* Credits earning info */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white mb-4 pb-2 border-b border-zinc-800">
            <span>💰</span>
            <span>Earning Credits</span>
          </h2>
          <p className="text-zinc-400 text-sm mb-4">
            Credits are the in-chat currency for Tazo&apos;s stream. Earn them by supporting the stream and chatting,
            then use them to play blackjack with <CommandPill text="!deal" /> or give them away with{' '}
            <CommandPill text="!give" />.
          </p>
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
                className="flex items-center justify-between gap-2 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/60"
              >
                <span className="text-zinc-300 text-sm">{row.event}</span>
                <span className="text-emerald-400 text-sm font-semibold whitespace-nowrap">{row.credits}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Footer note */}
      <p className="mt-12 text-center text-zinc-600 text-sm">
        Commands may change — check chat for the latest. Some commands require the stream to be live.
      </p>
    </div>
  );
}
