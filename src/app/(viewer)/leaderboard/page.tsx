import { redirect } from 'next/navigation';

// /leaderboard → /leaderboard/tazo
export default function LeaderboardIndexPage() {
  redirect('/leaderboard/tazo');
}
