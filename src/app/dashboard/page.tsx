import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, MapPin } from 'lucide-react';
import Image from 'next/image';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Badge } from "@/components/ui/badge";

const users = [
  { name: 'Jessica, 28', location: 'New York, NY', imageId: 'profile-1', sports: ['Tennis', 'Yoga'] },
  { name: 'Mike, 32', location: 'Los Angeles, CA', imageId: 'profile-2', sports: ['Basketball', 'Gym'] },
  { name: 'Sarah, 25', location: 'Chicago, IL', imageId: 'profile-3', sports: ['Running', 'Cycling'] },
  { name: 'David, 30', location: 'Houston, TX', imageId: 'profile-4', sports: ['Yoga', 'Hiking'] },
  { name: 'Emily, 27', location: 'Phoenix, AZ', imageId: 'profile-5', sports: ['Gym', 'Swimming'] },
  { name: 'Chris, 29', location: 'Philadelphia, PA', imageId: 'profile-6', sports: ['Soccer', 'Running'] },
];

export default function DashboardPage() {
  const profileImages = PlaceHolderImages.filter(p => p.id.startsWith('profile-'));

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2 font-headline">Find Your Match</h1>
        <p className="text-lg text-gray-400">Search for partners for your favorite sports.</p>
      </div>

      <div className="mb-8 p-4 bg-card rounded-lg shadow-lg shadow-accent/5 flex flex-col md:flex-row gap-4 items-center border border-border/20">
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <Input placeholder="Search by sport (e.g., Tennis, Yoga...)" className="pl-10" />
        </div>
        <div className="relative w-full md:flex-1">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <Input placeholder="Location" className="pl-10" />
        </div>
        <Button className="w-full md:w-auto bg-[#D91CD2] text-white font-semibold">Search</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {users.map((user, index) => {
          const userImage = profileImages.find(img => img.id === user.imageId);
          return (
            <Card key={index} className="overflow-hidden bg-card border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20 transition-all duration-300 transform hover:-translate-y-1 cursor-pointer">
              <div className="relative h-64 w-full">
                {userImage && (
                  <Image
                    src={userImage.imageUrl}
                    alt={user.name}
                    fill
                    className="object-cover"
                    data-ai-hint={userImage.imageHint}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="absolute bottom-4 left-4 text-white">
                  <h3 className="text-xl font-bold">{user.name}</h3>
                  <p className="text-sm flex items-center gap-1"><MapPin size={14}/>{user.location}</p>
                </div>
              </div>
              <CardContent className="p-4">
                <p className="text-sm text-foreground/70 mb-3">Interested in:</p>
                <div className="flex flex-wrap gap-2">
                  {user.sports.map(sport => (
                    <Badge key={sport} variant="secondary" className="bg-primary/20 text-accent border-accent/50">{sport}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
