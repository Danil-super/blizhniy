import { getActiveAdMarqueeMessages } from "@/lib/ad-marquee-store";
import type { PublicMarquee } from '@/lib/public-service-publications';
import { formatPublicationDateTime } from '@/lib/publication-time';
import { AdMarquee } from './AdMarquee';
import { PublicPublicationTerms } from './PublicPublicationTerms';

export async function HomeHero() {
  const notices: PublicMarquee[] = [];
  const messages = await getActiveAdMarqueeMessages(placement => {
    const {text,publishedAt,expiresAt,publicationTerms} = placement;
    if (publicationTerms) notices.push(placement);
    return <><span>{text}</span><span className="font-normal text-slate-600"> · Показ с <time dateTime={publishedAt}>{formatPublicationDateTime(publishedAt)}</time> по <time dateTime={expiresAt}>{formatPublicationDateTime(expiresAt)}</time></span></>;
  });

  return <>
    <AdMarquee messages={messages}/>
    {notices.map(({id,text,publicationTerms}) => <PublicPublicationTerms key={id} terms={publicationTerms} title={text}/>)}
  </>;
}
