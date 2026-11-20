import type {ListingPaymentSnapshot} from '@/lib/postgres-listing-checkout';

const placementNames={
 listing:{subject:'Объявление',genitive:'объявления'},
 vacancy:{subject:'Вакансия',genitive:'вакансии'},
 workRequest:{subject:'Заказ',genitive:'заказа'},
 specialist:{subject:'Анкета',genitive:'анкеты'},
};

export function ListingPaymentStatus({snapshot,testMode=false,target='listing',checkingAutomatically=false}:{snapshot:ListingPaymentSnapshot;testMode?:boolean;target?:keyof typeof placementNames;checkingAutomatically?:boolean}){
 const {subject,genitive}=placementNames[target];
 const {order,fulfillment}=snapshot;
 let title:string,message:string;
 if(order.status==='refunded'){title='Средства возвращены';message=`Актуальное состояние ${genitive} можно посмотреть в кабинете.`;}
 else if(order.status==='failed'){title='Платёж отменён';message=`Проверьте состояние ${genitive} в кабинете перед новой оплатой.`;}
 else if(fulfillment){title='Размещение выполнено';message=`Текущее состояние ${genitive} и срок публикации доступны в кабинете.`;}
 else if(order.status==='succeeded'){title='Оплата подтверждена';message=testMode?`TEST-платёж успешно проверен. Реальные деньги не списывались. ${subject} не публикуется за тестовую оплату.`:'Размещение ещё не подтверждено. Не оплачивайте повторно; проверьте статус позже.';}
 else if(order.status==='pending'){title='Платёж обрабатывается';message=checkingAutomatically
  ? 'Проверяем статус автоматически. Повторно платить не нужно.'
  : 'Повторно платить не нужно. Нажмите «Проверить статус», чтобы узнать результат.';}
 else{title='Заказ подготовлен';message='Переход к оплате ещё не начат. Само создание заказа не означает списания денег.';}
 return <div role="status" aria-live="polite">
  <h2 className="text-xl font-bold text-slate-950">{title}</h2>
  <p className="mt-2 text-sm leading-6 text-slate-700">{message}</p>
  <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-sm">
   <div><dt className="text-slate-600">Сумма заказа</dt><dd className="mt-1 font-semibold text-slate-950">{order.amount.replace('.',',')} ₽</dd></div>
   <div><dt className="text-slate-600">Срок размещения</dt><dd className="mt-1 font-semibold text-slate-950">{order.durationDays} дн.</dd></div>
  </dl>
 </div>;
}
