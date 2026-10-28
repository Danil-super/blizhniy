import {checkServicePublicationForm,type ServicePublicationForm} from './service-publication-contract.ts';
/** Preserve old fields on reopen, but keep one authoritative editable about text. */
export function specialistAbout(form:{description?:string|null;skills?:string|null;experience?:string|null}):string {
 const description=form.description?.trim()??'',parts=[description];
 if(form.skills?.trim()&&!description.includes(form.skills.trim()))parts.push(`Навыки: ${form.skills.trim()}`);
 if(form.experience?.trim()&&!description.includes(form.experience.trim()))parts.push(`Опыт и квалификация: ${form.experience.trim()}`);
 return parts.filter(Boolean).join('\n\n');
}
/** Readiness is not public catalogue eligibility, paid status or moderation approval. */
export function checkSpecialistApplicationForm(form:ServicePublicationForm):string[]{
 if(form.kind!=='specialist')return ['Для отклика заполните анкету специалиста.'];
 const about=specialistAbout(form);
 return checkServicePublicationForm({...form,description:about,skills:about});
}
