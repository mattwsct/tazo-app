import { redirect, notFound } from 'next/navigation';
import { LINK_REDIRECT_MAP } from '@/data/links';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return Object.keys(LINK_REDIRECT_MAP).map((slug) => ({ slug }));
}

export default async function GoRedirectPage({ params }: Props) {
  const { slug } = await params;
  const url = LINK_REDIRECT_MAP[slug];
  if (!url) notFound();
  redirect(url);
}

export const dynamic = 'force-static';
