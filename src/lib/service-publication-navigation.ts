import type {ServicePublicationKind} from './service-publication-contract';
export const servicePublicationNavigation:Record<ServicePublicationKind,{form:string;cabinet:string;create:string}>={
 specialist:{form:'/rabota/specialisty/anketa',cabinet:'/cabinet/specialist',create:'Создать анкету'},
 fair:{form:'/yarmarka-masterov/zayavka',cabinet:'/cabinet/fair-applications',create:'Новая заявка на ярмарку'},
 marquee:{form:'/reklama/begushchaya-stroka',cabinet:'/reklama/begushchaya-stroka?view=list',create:'Создать рекламный текст'},
};
