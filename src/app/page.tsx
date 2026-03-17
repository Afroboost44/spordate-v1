"use client";

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  BarChart3,
  Heart,
  MapPin,
  Zap,
  Users,
  Trophy,
  CheckCircle,
  ArrowRight,
  ActivitySquare,
  Droplet,
  Wind,
  Bike,
  TrendingUp,
  Star,
  ChevronRight
} from 'lucide-react';

interface Sport {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
}

interface Testimonial {
  name: string;
  location: string;
  image: string;
  text: string;
  sport: string;
  rating: number;
}

const SPORTS: Sport[] = [
  {
    id: 'tennis',
    name: 'Tennis',
    icon: <Trophy className="h-6 w-6" />,
    color: 'from-yellow-400 to-yellow-600'
  },
  {
    id: 'yoga',
    name: 'Yoga',
    icon: <Wind className="h-6 w-6" />,
    color: 'from-green-400 to-green-600'
  },
  {
    id: 'running',
    name: 'Running',
    icon: <Zap className="h-6 w-6" />,
    color: 'from-red-400 to-red-600'
  },
  {
    id: 'swimming',
    name: 'Natation',
    icon: <Droplet className="h-6 w-6" />,
    color: 'from-blue-400 to-blue-600'
  },
  {
    id: 'cycling',
    name: 'Vélo',
    icon: <Bike className="h-6 w-6" />,
    color: 'from-orange-400 to-orange-600'
  },
  {
    id: 'climbing',
    name: 'Escalade',
    icon: <TrendingUp className="h-6 w-6" />,
    color: 'from-purple-400 to-purple-600'
  },
  {
    id: 'soccer',
    name: 'Football',
    icon: <ActivitySquare className="h-6 w-6" />,
    color: 'from-green-500 to-green-700'
  },
  {
    id: 'fitness',
    name: 'Fitness',
    icon: <BarChart3 className="h-6 w-6" />,
    color: 'from-pink-400 to-pink-600'
  }
];

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Sophie Mercier',
    location: 'Genève',
    image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
    text: 'Spordateur m\'a permis de trouver une partenaire de tennis régulière. C\'est devenu une vraie amitié !',
    sport: 'Tennis',
    rating: 5
  },
  {
    name: 'Marc Dubois',
    location: 'Zürich',
    image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
    text: 'Excellent pour trouver des gens avec qui courir le matin. La communauté est super motivante.',
    sport: 'Running',
    rating: 5
  },
  {
    name: 'Julia Schmidt',
    location: 'Lausanne',
    image: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop',
    text: 'J\'adore l\'application ! Facile à utiliser et j\'ai rencontré plein de personnes intéressantes.',
    sport: 'Yoga',
    rating: 5
  },
  {
    name: 'Pierre Lefevre',
    location: 'Bern',
    image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop',
    text: 'Spordateur a transformé ma routine de gym. Avoir un partenaire fait toute la différence !',
    sport: 'Fitness',
    rating: 5
  }
];

const SWISS_CITIES = ['Genève', 'Zürich', 'Lausanne', 'Bern', 'Bâle', 'Lucerne', 'Saint-Gall', 'Winterthur'];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
      {/* Background gradient accents */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-rose-600/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl animate-pulse" />
      </div>

      <div className="relative z-10">
        {/* Navigation */}
        <nav className="sticky top-0 z-50 border-b border-slate-700/50 backdrop-blur-xl bg-slate-900/80">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-gradient-to-r from-violet-500 to-rose-500 rounded-lg flex items-center justify-center">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl text-white">Spordateur</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#how-it-works" className="text-gray-300 hover:text-white transition">Comment ça marche</a>
              <a href="#sports" className="text-gray-300 hover:text-white transition">Sports</a>
              <a href="#testimonials" className="text-gray-300 hover:text-white transition">Avis</a>
              <Button asChild className="bg-gradient-to-r from-violet-500 to-rose-500 text-white font-bold hover:shadow-lg hover:shadow-violet-500/50">
                <Link href="/signup">Commencer</Link>
              </Button>
            </div>
            <div className="md:hidden">
              <Button asChild size="sm" className="bg-gradient-to-r from-violet-500 to-rose-500 text-white font-bold">
                <Link href="/signup">Commencer</Link>
              </Button>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="container mx-auto px-4 py-20 md:py-32 text-center">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="inline-block">
              <span className="px-4 py-2 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 text-sm font-medium">
                ✨ Nouvelle génération de matchmaking sportif
              </span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold text-white">
              Trouve ton
              <span className="block mt-4 text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-rose-400 to-orange-400">
                Sport Date
              </span>
            </h1>

            <p className="text-xl md:text-2xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Connecte-toi avec des passionnés de sport près de chez toi. Matche, Book, Play. C'est aussi simple que ça.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <Button asChild size="lg" className="bg-gradient-to-r from-violet-500 to-rose-500 text-white font-bold text-lg px-8 py-6 rounded-full shadow-lg shadow-violet-500/50 hover:shadow-xl hover:shadow-rose-500/50 transition-all transform hover:scale-105">
                <Link href="/signup">Commencer gratuitement</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-violet-500/50 text-gray-200 hover:bg-violet-500/10 px-8 py-6 rounded-full">
                <Link href="#how-it-works">
                  En savoir plus <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="pt-8 flex flex-col md:flex-row gap-8 justify-center items-center text-sm text-gray-400 border-t border-slate-700/50">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-400" />
                <span>100% gratuit</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-400" />
                <span>Sans abonnement</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-400" />
                <span>Sécurisé & vérifié</span>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="container mx-auto px-4 py-20 md:py-32">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Comment ça marche</h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              En 3 étapes simples, trouve ton partenaire de sport idéal
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Step 1 */}
            <div className="relative">
              <div className="absolute top-0 left-0 h-12 w-12 bg-gradient-to-r from-violet-500 to-rose-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                1
              </div>
              <Card className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-slate-700/50 backdrop-blur h-full pt-20">
                <CardContent className="space-y-4">
                  <div className="flex justify-center mb-4">
                    <Heart className="h-12 w-12 text-violet-400" />
                  </div>
                  <h3 className="text-xl font-bold text-center text-white">Match avec des profils</h3>
                  <p className="text-gray-400 text-center">
                    Explore les profils de passionnés de sport près de toi. Matche avec ceux qui te plaisent.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Step 2 */}
            <div className="relative">
              <div className="absolute top-0 left-0 h-12 w-12 bg-gradient-to-r from-violet-500 to-rose-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                2
              </div>
              <Card className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-slate-700/50 backdrop-blur h-full pt-20">
                <CardContent className="space-y-4">
                  <div className="flex justify-center mb-4">
                    <Users className="h-12 w-12 text-rose-400" />
                  </div>
                  <h3 className="text-xl font-bold text-center text-white">Book une session</h3>
                  <p className="text-gray-400 text-center">
                    Chatouille avec ton match, discutez et organisez votre session de sport.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Step 3 */}
            <div className="relative">
              <div className="absolute top-0 left-0 h-12 w-12 bg-gradient-to-r from-violet-500 to-rose-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                3
              </div>
              <Card className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-slate-700/50 backdrop-blur h-full pt-20">
                <CardContent className="space-y-4">
                  <div className="flex justify-center mb-4">
                    <Trophy className="h-12 w-12 text-orange-400" />
                  </div>
                  <h3 className="text-xl font-bold text-center text-white">Play et amuse-toi</h3>
                  <p className="text-gray-400 text-center">
                    Rencontre ton partenaire et profite de ta session de sport. Évalue l'expérience.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Sports Categories */}
        <section id="sports" className="container mx-auto px-4 py-20 md:py-32">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Tous les sports te plaisent</h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Des centaines de sports et d'activités disponibles. Trouve ton partenaire peu importe ta passion
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto mb-8">
            {SPORTS.map((sport) => (
              <Card key={sport.id} className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-slate-700/50 backdrop-blur hover:border-violet-500/30 transition cursor-pointer group">
                <CardContent className="p-6 text-center space-y-3">
                  <div className={`h-12 w-12 mx-auto bg-gradient-to-r ${sport.color} rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform`}>
                    {sport.icon}
                  </div>
                  <h3 className="font-semibold text-white">{sport.name}</h3>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center">
            <Button variant="outline" className="border-violet-500/50 text-gray-200 hover:bg-violet-500/10">
              Voir tous les sports <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>

        {/* Testimonials */}
        <section id="testimonials" className="container mx-auto px-4 py-20 md:py-32">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Avis de la communauté</h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Les vraies histoires de sportifs qui se sont trouvés grâce à Spordateur
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {TESTIMONIALS.map((testimonial, idx) => (
              <Card key={idx} className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-slate-700/50 backdrop-blur hover:border-violet-500/30 transition">
                <CardContent className="p-6 space-y-4">
                  {/* Rating */}
                  <div className="flex items-center gap-1">
                    {Array(testimonial.rating)
                      .fill(0)
                      .map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      ))}
                  </div>

                  {/* Quote */}
                  <p className="text-gray-300 italic text-lg">"{testimonial.text}"</p>

                  {/* Author */}
                  <div className="flex items-center gap-3 pt-4 border-t border-slate-700/50">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-500 to-rose-500 overflow-hidden flex-shrink-0">
                      <Image
                        src={testimonial.image}
                        alt={testimonial.name}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <p className="font-semibold text-white text-sm">{testimonial.name}</p>
                      <p className="text-gray-400 text-xs flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {testimonial.location} • {testimonial.sport}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Swiss Coverage */}
        <section className="container mx-auto px-4 py-20 md:py-32">
          <Card className="bg-gradient-to-r from-slate-800/50 to-slate-900/50 border-slate-700/50 backdrop-blur overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-8 md:p-12">
              <div className="space-y-6">
                <h2 className="text-3xl md:text-4xl font-bold text-white">Actif dans toute la Suisse</h2>
                <p className="text-gray-300 text-lg">
                  Spordateur est disponible dans les plus grandes villes suisses. Peu importe où tu es, tu trouveras ton partenaire de sport.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {SWISS_CITIES.map((city) => (
                    <div key={city} className="flex items-center gap-2 text-gray-300">
                      <div className="h-2 w-2 rounded-full bg-violet-400" />
                      {city}
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative h-64 md:h-auto">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/20 to-rose-500/20 rounded-lg" />
                <MapPin className="h-32 w-32 text-violet-400/30 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
            </div>
          </Card>
        </section>

        {/* Partner CTA */}
        <section className="container mx-auto px-4 py-20 md:py-32">
          <Card className="bg-gradient-to-r from-violet-600/20 to-rose-600/20 border-violet-500/30 backdrop-blur overflow-hidden">
            <CardContent className="p-8 md:p-12 text-center space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-white">
                Tu es un studio ou une salle de sport ?
              </h2>
              <p className="text-gray-300 text-lg max-w-2xl mx-auto">
                Rejoins le réseau Spordateur et augmente ta visibilité. Connecte-toi avec des milliers de sportifs motivés.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                <Button asChild className="bg-gradient-to-r from-violet-500 to-rose-500 text-white font-bold text-lg px-8 py-6 hover:shadow-lg">
                  <Link href="/partners">Devenir partenaire</Link>
                </Button>
                <Button variant="outline" className="border-violet-500/50 text-gray-200 hover:bg-violet-500/10 text-lg px-8 py-6">
                  Nous contacter
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CTA Banner */}
        <section className="container mx-auto px-4 py-16 md:py-24 text-center">
          <div className="space-y-8">
            <h2 className="text-4xl md:text-5xl font-bold text-white">
              Prêt à trouver ton <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-rose-400">Sport Date</span> ?
            </h2>
            <p className="text-gray-300 text-xl max-w-2xl mx-auto">
              Rejoins des milliers de sportifs qui ont déjà trouvé leur partenaire idéal
            </p>
            <div className="flex justify-center">
              <Button asChild size="lg" className="bg-gradient-to-r from-violet-500 to-rose-500 text-white font-bold text-lg px-10 py-7 rounded-full shadow-xl shadow-violet-500/50 hover:shadow-2xl hover:shadow-rose-500/50 transition-all transform hover:scale-105">
                <Link href="/signup">Créer un compte gratuit</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-700/50 backdrop-blur bg-slate-900/50 mt-20">
          <div className="container mx-auto px-4 py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
              {/* Brand */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 bg-gradient-to-r from-violet-500 to-rose-500 rounded-lg flex items-center justify-center">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <span className="font-bold text-lg text-white">Spordateur</span>
                </div>
                <p className="text-gray-400 text-sm">
                  La plateforme suisse pour trouver ton partenaire de sport idéal.
                </p>
              </div>

              {/* Product */}
              <div>
                <h4 className="font-semibold text-white mb-4">Produit</h4>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li><a href="#" className="hover:text-white transition">Comment ça marche</a></li>
                  <li><a href="#" className="hover:text-white transition">Sports</a></li>
                  <li><a href="#" className="hover:text-white transition">Tarifs</a></li>
                  <li><a href="#" className="hover:text-white transition">Blog</a></li>
                </ul>
              </div>

              {/* Company */}
              <div>
                <h4 className="font-semibold text-white mb-4">Entreprise</h4>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li><a href="#" className="hover:text-white transition">À propos</a></li>
                  <li><a href="#" className="hover:text-white transition">Carrières</a></li>
                  <li><a href="#" className="hover:text-white transition">Presse</a></li>
                  <li><a href="#" className="hover:text-white transition">Partenaires</a></li>
                </ul>
              </div>

              {/* Legal */}
              <div>
                <h4 className="font-semibold text-white mb-4">Légal</h4>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li><a href="#" className="hover:text-white transition">Confidentialité</a></li>
                  <li><a href="#" className="hover:text-white transition">Conditions</a></li>
                  <li><a href="#" className="hover:text-white transition">Cookies</a></li>
                  <li><a href="#" className="hover:text-white transition">Contact</a></li>
                </ul>
              </div>
            </div>

            <div className="border-t border-slate-700/50 pt-8 flex flex-col md:flex-row justify-between items-center text-sm text-gray-400">
              <p>&copy; 2026 Spordateur. Tous droits réservés.</p>
              <div className="flex gap-6 mt-4 md:mt-0">
                <a href="#" className="hover:text-white transition">Twitter</a>
                <a href="#" className="hover:text-white transition">Instagram</a>
                <a href="#" className="hover:text-white transition">Facebook</a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
