import { getActiveAdMarqueeMessages } from "@/lib/ad-marquee-store";
import { formatPublicationDateTime } from '@/lib/publication-time';
import { AdMarquee } from './AdMarquee';

export async function HomeHero() {
  const messages = await getActiveAdMarqueeMessages(({text,publishedAt,expiresAt})=>
    <><span>{text}</span><span className="font-normal text-slate-600"> · Показ с <time dateTime={publishedAt}>{formatPublicationDateTime(publishedAt)}</time> по <time dateTime={expiresAt}>{formatPublicationDateTime(expiresAt)}</time></span></>);

  return <AdMarquee messages={messages}/>;
}
