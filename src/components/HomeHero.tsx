import { getActiveAdMarqueeMessages } from "@/lib/ad-marquee-store";
import { AdMarquee } from './AdMarquee';

export async function HomeHero() {
  const messages = await getActiveAdMarqueeMessages();

  return <AdMarquee messages={messages}/>;
}
