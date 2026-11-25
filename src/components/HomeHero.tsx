import { getActiveAdMarqueeMessages } from "@/lib/ad-marquee-store";
import { formatPublicationDateTime } from '@/lib/publication-time';
import { AdMarquee } from './AdMarquee';

export async function HomeHero() {
  const messages = await getActiveAdMarqueeMessages(({text,publishedAt,expiresAt})=>
    `${text} · Показ с ${formatPublicationDateTime(publishedAt)} по ${formatPublicationDateTime(expiresAt)}`);

  return <AdMarquee messages={messages}/>;
}
