import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { PlaceHolderImages } from '@/lib/placeholder-images';

export function HeroSection() {
  const heroImage = PlaceHolderImages.find(p => p.id === 'hero-image');

  return (
    <section className="relative w-full h-[80vh] min-h-[500px] flex items-center justify-center text-center text-white">
      {heroImage && (
        <Image
          src={heroImage.imageUrl}
          alt={heroImage.description}
          fill
          className="object-cover"
          data-ai-hint={heroImage.imageHint}
          priority
        />
      )}
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 container px-4 md:px-6">
        <div className="max-w-3xl mx-auto">
          {/* Phase 9.5 c14 BUG4 — charte stricte #D91CD2 magenta unifié (avant : gradient violet/rose). */}
          <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl font-headline text-accent">
            Find Your Perfect Match.
          </h1>
          <p className="mt-4 md:mt-6 text-lg md:text-xl text-gray-200 max-w-2xl mx-auto">
            Connect with people who share your passion for sports. Spordateur helps you find a partner for your favorite activity, from tennis to yoga.
          </p>
          <div className="mt-8 flex justify-center">
            <Button asChild size="lg" className="bg-accent hover:bg-accent/90 text-white font-bold text-lg px-8 py-6 rounded-full transition-transform transform hover:scale-105 shadow-lg shadow-accent/30">
              <Link href="/signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
