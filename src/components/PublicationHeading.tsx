import type {ReactNode} from 'react';

/** One hierarchy for public listings, vacancies and work requests. */
export function PublicationHeading({title,price,children}:{title:string;price:string;children?:ReactNode}){
 return <header className="mb-5 min-w-0" data-publication-heading>
  <h1 className="break-words text-2xl font-bold leading-tight text-[#060b27] [overflow-wrap:anywhere] sm:text-3xl">{title}</h1>
  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
   <p className="break-words text-xl font-bold text-[#060b27]" data-publication-price>{price}</p>
   {children}
  </div>
 </header>;
}
