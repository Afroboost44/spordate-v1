import { Dumbbell, Twitter, Github, Linkedin } from "lucide-react";
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-black relative">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center space-y-6 md:space-y-0">
          <div className="flex items-center space-x-2">
            <Dumbbell className="h-6 w-6 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] rounded-md p-1 text-white" />
            <span className="font-light text-lg text-white">Spordateur</span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6 text-xs text-gray-500 font-light">
            <Link href="/terms" className="hover:text-white transition-colors">CGU</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Confidentialité</Link>
            <Link href="/legal" className="hover:text-white transition-colors">Mentions légales</Link>
          </nav>

          <div className="flex items-center space-x-4">
            <Link href="#" className="text-gray-600 hover:text-white transition-colors">
              <Twitter className="h-4 w-4" />
              <span className="sr-only">Twitter</span>
            </Link>
            <Link href="#" className="text-gray-600 hover:text-white transition-colors">
              <Linkedin className="h-4 w-4" />
              <span className="sr-only">LinkedIn</span>
            </Link>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800/50 text-center">
          <Link href="/admin/login" className="text-xs text-gray-700 hover:text-gray-500 transition-colors font-light" title="Admin">
            &copy; {new Date().getFullYear()} Spordateur — Association Afroboosteur, Neuchâtel, Suisse
          </Link>
        </div>
      </div>
    </footer>
  );
}
