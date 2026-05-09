import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, CreditCard } from 'lucide-react';

export function WhySpordateSection() {
  const benefits = [
    {
      icon: <ShieldCheck className="h-10 w-10 mb-4 text-accent" />,
      title: 'Security First',
      description: 'Your safety is our priority. We verify profiles and provide a secure platform for you to connect with others.',
    },
    {
      icon: <CreditCard className="h-10 w-10 mb-4 text-accent" />,
      title: 'Safe Payments',
      description: 'Book activities and split costs with ease through our secure, integrated payment system. No cash needed.',
    },
  ];

  return (
    <section id="why-us" className="w-full py-20 md:py-32 bg-black">
      <div className="container px-4 md:px-6">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl font-headline">Why Choose Spordateur?</h2>
          <p className="mt-4 text-gray-400 md:text-xl">
            We focus on what matters most: your experience and safety.
          </p>
        </div>
        <div className="mt-12 grid gap-8 md:grid-cols-2 max-w-4xl mx-auto">
          {benefits.map((benefit, index) => (
            <Card
              key={index}
              className="bg-card border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20 transition-shadow duration-300 transform hover:-translate-y-2"
            >
              <CardHeader className="items-center text-center">
                {benefit.icon}
                <CardTitle className="text-2xl font-bold">{benefit.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-center text-gray-400">
                <p>{benefit.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
