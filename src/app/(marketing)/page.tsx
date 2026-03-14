import StreamEmbed from '@/components/marketing/StreamEmbed';
import HeroSection from '@/components/marketing/HeroSection';
import LinkGrid from '@/components/marketing/LinkGrid';

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <section className="py-12 px-4 overflow-visible">
        <StreamEmbed />
        <LinkGrid />
      </section>
    </>
  );
}
