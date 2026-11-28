import {
  publicationTermsCategory,
  type PublicPublicationTerms as Terms,
  type PublicationTermsChoice,
} from '@/lib/publication-consent-terms';

const descriptions: Record<PublicationTermsChoice, string> = {
  none: 'Дополнительные условия и запреты отсутствуют.',
  'no-transfer': 'Дальнейшая передача данных запрещена.',
  'view-only': 'Разрешён только просмотр. Дальнейшая передача и иная обработка запрещены.',
};

export function PublicPublicationTerms({ terms, images = [], title }: {
  terms?: Terms;
  images?: readonly string[];
  title?: string;
}) {
  if (!terms?.length) return null;
  return <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
    <summary className="cursor-pointer break-words font-semibold">
      Условия распространения данных{title ? ` · ${title}` : ''}
    </summary>
    <dl className="mt-2 space-y-2">
      {terms.map(({ category, terms }) => {
        const photo = category.startsWith('photo:') ? images.findIndex(url => url.endsWith('/photos/' + category.slice(6))) : -1;
        return <div key={category}>
          <dt className="font-semibold">{photo >= 0 ? `Фотография №${photo + 1}` : publicationTermsCategory(category)}</dt>
          <dd>{descriptions[terms]}</dd>
        </div>;
      })}
    </dl>
  </details>;
}
