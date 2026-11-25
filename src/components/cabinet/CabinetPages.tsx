import Link from "next/link";
import {Shell,cabinetNav} from "@/components/DashboardShell";
import {CabinetAuthGate} from "@/components/auth/CabinetAuthGate";
import {CabinetDraftWorkspace} from "@/components/listings/CabinetDraftWorkspace";
import {CabinetPublicationWorkspace} from "./CabinetPublicationWorkspace";
import {BookingsPanel} from "@/components/bookings/BookingsPanel";
import {PlacementReturnNotice} from "@/components/payments/PlacementReturnNotice";
import {CabinetOrganizationClient,CabinetPaymentsClient,CabinetPublicationsClient,CabinetResponsesClient,CabinetSpecialistClient,type CabinetPaymentHistoryItem} from "./CabinetEntryClients";
import {paymentRows,responseRows} from "./dashboard-rows";

export function CabinetPage() {
  return <CabinetListingsPage/>;
}

export function CabinetListingsPage() {
  return (
    <Shell title="Мои объявления" description="Статусы публикаций, просмотры и быстрые действия по объявлениям пользователя." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/obyavleniya" createHref="/razmestit/obyavlenie" createLabel="Создать объявление">
      <PlacementReturnNotice />
      <CabinetDraftWorkspace footer={<div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-slate-200 pt-5 text-sm">
        <Link href="/cabinet/moi-dannye" prefetch={false} className="font-semibold text-[#0875d1] underline">Мои персональные данные</Link>
        <Link href="/cabinet/udalit-akkaunt" className="font-semibold text-[#0875d1] underline">Запросить удаление аккаунта</Link>
      </div>}><CabinetPublicationsClient type="listing" /></CabinetDraftWorkspace>
    </Shell>
  );
}

export function CabinetVacanciesPage() {
  return (
    <Shell title="Мои вакансии" description="Список вакансий работодателя с оплатой публикации и управлением статусом." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/vakansii" createHref="/rabota/vakansii/sozdat" createLabel="Разместить вакансию">
      <PlacementReturnNotice />
      <CabinetPublicationWorkspace>
        <CabinetPublicationsClient type="vacancy" />
      </CabinetPublicationWorkspace>
    </Shell>
  );
}

export function CabinetOrganizationPage() {
  return <Shell title="Организация" description="Данные работодателя и организации в вашем частном профиле." eyebrow="Кабинет"
    nav={cabinetNav} activeHref="/cabinet/organization" createHref={null}>
    <CabinetAuthGate><CabinetOrganizationClient /></CabinetAuthGate>
  </Shell>;
}

export function CabinetWorkRequestsPage() {
  return (
    <Shell title="Мои заказы исполнителям" description="Задачи, которые пользователь размещает для специалистов и исполнителей." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/zakazy" createHref="/rabota/zakazy/sozdat" createLabel="Разместить заказ">
      <PlacementReturnNotice />
      <CabinetPublicationWorkspace>
        <CabinetPublicationsClient type="workRequest" />
      </CabinetPublicationWorkspace>
    </Shell>
  );
}

export function CabinetSpecialistPage() {
  return (
    <Shell title="Анкета специалиста" description="Единая анкета исполнителя для платных откликов и публичного каталога." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/specialist" createHref={null}>
      <PlacementReturnNotice />
      <CabinetPublicationWorkspace><CabinetSpecialistClient /></CabinetPublicationWorkspace>
    </Shell>
  );
}

export function CabinetResponsesPage() {
  const responses = responseRows();

  return (
    <Shell title="Мои отклики" description="Отклики на вакансии со статусами оплаты, отправки и просмотра работодателем." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/otkliki" createHref="/rabota/vakansii" createLabel="Найти вакансию">
      <CabinetPublicationWorkspace>
        <CabinetResponsesClient responses={responses} />
      </CabinetPublicationWorkspace>
    </Shell>
  );
}

export function CabinetBookingsPage(){
 return <Shell title="Бронирования" description="Ваши поездки и заявки гостей: даты, условия и ответы владельцев." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/bronirovaniya" createHref={null}>
  <CabinetPublicationWorkspace><BookingsPanel/></CabinetPublicationWorkspace>
 </Shell>;
}

export function CabinetPaymentsPage() {
  const payments = paymentRows() as CabinetPaymentHistoryItem[];

  return (
    <Shell title="Платежи" description="Сформированные заказы, ожидающие оплаты, и история платежей." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/oplata" createHref={null}>
      <CabinetAuthGate>
        <CabinetPaymentsClient initialPayments={payments} />
      </CabinetAuthGate>
    </Shell>
  );
}

export function CabinetFairApplicationsPage() {
  return (
    <Shell title="Заявки на ярмарку" description="Заявки пользователя на участие в Ярмарке мастеров, статусы оплаты и публикации." eyebrow="Кабинет" nav={cabinetNav} activeHref="/cabinet/fair-applications" createHref="/yarmarka-masterov/zayavka" createLabel="Подать заявку">
      <CabinetPublicationWorkspace>
        <CabinetPublicationsClient type="fairApplication" />
      </CabinetPublicationWorkspace>
    </Shell>
  );
}
